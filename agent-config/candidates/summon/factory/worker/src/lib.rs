use serde::Deserialize;
use summon_protocol::evidence::{ExportRequest, PacketManifestV1, PageRequest, ReopenRequest};
use summon_protocol::visibility::{
    AgentRunAttemptV1, MetadataRequest, RunMetadata, VisibilityGraph, validate_metadata,
};
use summon_protocol::*;
use worker::*;

const MAX_BYTES: usize = storage::MAX_BYTES;

fn error(code: &str, message: &str, status: u16) -> worker::Result<Response> {
    Response::from_json(&Refusal {
        code: code.into(),
        message: message.into(),
    })
    .map(|r| r.with_status(status))
}
fn refusal(e: Refusal) -> worker::Result<Response> {
    let status = if e.code.starts_with("invalid_") {
        400
    } else {
        409
    };
    Response::from_json(&e).map(|r| r.with_status(status))
}
fn parse<T: serde::de::DeserializeOwned>(body: &str) -> std::result::Result<T, Refusal> {
    serde_json::from_str(body).map_err(|e| Refusal {
        code: "invalid_json".into(),
        message: e.to_string(),
    })
}
fn route(path: &str) -> Option<(&str, &str)> {
    let rest = path.strip_prefix("/v1/runs/")?;
    let (run_id, action) = rest.split_once('/')?;
    if action.contains('/') {
        return None;
    }
    Some((run_id, action))
}

#[event(fetch)]
pub async fn fetch(mut req: Request, env: Env, _ctx: worker::Context) -> worker::Result<Response> {
    // This pilot has no hosted authentication boundary. Fail closed away from loopback.
    let url = req.url()?;
    if !matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]")) {
        return error(
            "local_only",
            "this unauthenticated candidate only accepts loopback requests",
            403,
        );
    }
    let path = url.path();
    let mut body = String::new();
    if req.method() == Method::Post {
        // Check actual bytes as well as Content-Length. No remote binding or model calls.
        let bytes = req.bytes().await?;
        if bytes.len() > MAX_BYTES {
            return error("request_too_large", "request limit is 512KiB", 413);
        }
        body = match String::from_utf8(bytes) {
            Ok(s) => s,
            Err(_) => return error("invalid_json", "body must be UTF-8 JSON", 400),
        };
    }
    if path.starts_with("/v1/visibility/") && req.method() == Method::Post {
        return project(path, &body);
    }
    let run_id = if path == "/v1/intake" && req.method() == Method::Post {
        match parse::<Intake>(&body) {
            Ok(r) => r.task.id,
            Err(e) => return refusal(e),
        }
    } else if let Some((id, action)) = route(path) {
        if (matches!(action, "status" | "view" | "packet") && req.method() == Method::Get)
            || (matches!(
                action,
                "input"
                    | "claim"
                    | "observe"
                    | "reconcile"
                    | "hold"
                    | "proof"
                    | "cancel"
                    | "metadata"
            ) && req.method() == Method::Post)
        {
            id.to_owned()
        } else {
            return error("not_found", "unknown method/endpoint", 404);
        }
    } else {
        return error("not_found", "unknown method/endpoint", 404);
    };
    if let Err(e) = validate_run_id(&run_id) {
        return refusal(e);
    }
    let namespace = env.durable_object("SUMMON_RUNS")?;
    let stub = namespace
        .id_from_name(&format!("summon-v1:{run_id}"))?
        .get_stub()?;
    let mut init = RequestInit::new();
    init.with_method(req.method());
    if req.method() == Method::Post {
        init.with_body(Some(body.into()));
    }
    stub.fetch_with_request(Request::new_with_init(url.as_str(), &init)?)
        .await
}

fn derived<T: serde::Serialize>(result: summon_protocol::Result<T>) -> worker::Result<Response> {
    match result {
        Ok(value) => Response::from_json(&value),
        Err(e) => refusal(e),
    }
}
fn project(path: &str, body: &str) -> worker::Result<Response> {
    match path {
        "/v1/visibility/page" => derived((|| {
            let request: PageRequest = parse(body)?;
            VisibilityGraph::new(request.records)?.page(
                &request.root,
                request.cursor.as_ref(),
                request.limit,
            )
        })()),
        "/v1/visibility/export" => derived((|| {
            let request: ExportRequest = parse(body)?;
            PacketManifestV1::export(
                &VisibilityGraph::new(request.records)?,
                &request.root,
                &request.packets,
            )
        })()),
        "/v1/visibility/reopen" => derived((|| {
            let request: ReopenRequest = parse(body)?;
            request
                .packet
                .reopen(&VisibilityGraph::new(request.records)?, &request.packets)
        })()),
        _ => error("not_found", "unknown projection endpoint", 404),
    }
}
#[durable_object]
pub struct SummonRun {
    state: State,
}

#[derive(Deserialize)]
struct Row {
    snapshot: String,
}

impl SummonRun {
    fn load(&self) -> worker::Result<Option<Run>> {
        let rows = self
            .state
            .storage()
            .sql()
            .exec("SELECT snapshot FROM run WHERE singleton = 1", None)?
            .raw()
            .collect::<worker::Result<Vec<_>>>()?;
        rows.into_iter()
            .next()
            .map(|row| match row.into_iter().next() {
                Some(SqlStorageValue::Blob(bytes)) => storage::decode(&bytes).map_err(Error::from),
                Some(SqlStorageValue::String(json)) => {
                    storage::decode(json.as_bytes()).map_err(Error::from)
                }
                _ => Err(Error::from("invalid run snapshot storage type")),
            })
            .transpose()
    }
    fn metadata(&self) -> worker::Result<Option<RunMetadata>> {
        let rows = self
            .state
            .storage()
            .sql()
            .exec(
                "SELECT snapshot FROM source_metadata WHERE singleton=1",
                None,
            )?
            .to_array::<Row>()?;
        rows.into_iter()
            .next()
            .map(|r| serde_json::from_str(&r.snapshot).map_err(Error::from))
            .transpose()
    }
    fn save_metadata(&self, metadata: &RunMetadata) -> worker::Result<bool> {
        let snapshot = serde_json::to_string(metadata)?;
        if snapshot.len() > MAX_BYTES {
            return Ok(false);
        }
        self.state.storage().sql().exec("INSERT INTO source_metadata(singleton,snapshot) VALUES(1,?) ON CONFLICT(singleton) DO UPDATE SET snapshot=excluded.snapshot", vec![snapshot.into()])?;
        Ok(true)
    }
    fn save(&self, run: &Run, admission: bool) -> worker::Result<bool> {
        let snapshot = storage::encode(run).map_err(Error::from)?;
        if !storage::fits(run, &snapshot, admission) {
            return Ok(false);
        }
        // One synchronous SQLite write is the entire durable commit. No awaits between
        // load -> pure transition -> write: DO request execution cannot interleave here.
        self.state.storage().sql().exec(
            "INSERT INTO run(singleton, snapshot) VALUES (1, ?) ON CONFLICT(singleton) DO UPDATE SET snapshot=excluded.snapshot",
            vec![snapshot.into()],
        )?;
        Ok(true)
    }
    fn apply(&self, path: &str, body: &str) -> worker::Result<Response> {
        let existing = self.load()?;
        if path == "/v1/intake" {
            let request = match parse::<Intake>(body) {
                Ok(r) => r,
                Err(e) => return refusal(e),
            };
            if let Some(run) = existing {
                if let Err(e) = run.same_intake(&request) {
                    return refusal(e);
                }
                return Response::from_json(&run.reply(None, true));
            }
            let run = match Run::intake(request) {
                Ok(r) => r,
                Err(e) => return refusal(e),
            };
            if !self.save(&run, true)? {
                return error(
                    "state_limit",
                    "canonical snapshot plus reserved native outcomes exceeds 512KiB; no mutation committed",
                    413,
                );
            }
            return Response::from_json(&run.reply(None, false));
        }
        let Some((run_id, action)) = route(path) else {
            return error("not_found", "unknown endpoint", 404);
        };
        let Some(mut run) = existing else {
            return error("not_found", "unknown run; status never creates one", 404);
        };
        if run.task.id != run_id {
            return error("run_mismatch", "object does not own this run", 409);
        }
        if action == "status" {
            return Response::from_json(&run.status());
        }
        if matches!(action, "view" | "packet" | "metadata") {
            let metadata = self.metadata()?;
            if action == "metadata" {
                let request: MetadataRequest = match parse(body) {
                    Ok(r) => r,
                    Err(e) => return refusal(e),
                };
                if let Err(e) = validate_metadata(&run.status(), metadata.as_ref(), &request) {
                    return refusal(e);
                }
                if !self.save_metadata(&request.metadata)? {
                    return error(
                        "state_limit",
                        "metadata exceeds 512KiB; no mutation committed",
                        413,
                    );
                }
                return Response::from_json(&AgentRunAttemptV1::from_status(
                    run.status(),
                    Some(&request.metadata),
                    Date::now().as_millis(),
                ));
            }
            let view = AgentRunAttemptV1::from_status(
                run.status(),
                metadata.as_ref(),
                Date::now().as_millis(),
            );
            if action == "view" {
                return Response::from_json(&view);
            }
            return derived(PacketManifestV1::export(
                &match VisibilityGraph::new(vec![view]) {
                    Ok(g) => g,
                    Err(e) => return refusal(e),
                },
                run_id,
                &[],
            ));
        }
        let result: summon_protocol::Result<(Option<Dispatch>, bool)> = (|| {
            Ok(match action {
                "input" => (None, run.input(parse(body)?)?),
                "claim" => {
                    let (dispatch, replayed) = run.claim(parse(body)?)?;
                    (Some(dispatch), replayed)
                }
                "observe" | "reconcile" => {
                    (None, run.observe(parse(body)?, action == "reconcile")?)
                }
                "cancel" => (None, run.cancel(parse(body)?)?),
                "hold" => (None, run.hold(parse(body)?)?),
                "proof" => (None, run.proof(parse(body)?)?),
                _ => {
                    return Err(Refusal {
                        code: "not_found".into(),
                        message: "unknown endpoint".into(),
                    });
                }
            })
        })();
        let (dispatch, replayed) = match result {
            Ok(r) => r,
            Err(e) => return refusal(e),
        };
        // Native facts may consume the loss/recovery margin, not the final-answer
        // reservation. Other writes cannot consume either before acceptance.
        let admission = !matches!(action, "observe" | "reconcile");
        if !replayed && !self.save(&run, admission)? {
            return error(
                "state_limit",
                "canonical snapshot plus reserved native outcomes exceeds 512KiB; no mutation committed",
                413,
            );
        }
        Response::from_json(&run.reply(dispatch, replayed))
    }
}
impl DurableObject for SummonRun {
    fn new(state: State, _env: Env) -> Self {
        // Constructor cannot return errors; create the table in fetch instead.
        Self { state }
    }
    async fn fetch(&self, mut req: Request) -> worker::Result<Response> {
        let path = req.path();
        let body = if req.method() == Method::Post {
            req.text().await?
        } else {
            String::new()
        };
        self.state.storage().sql().exec("CREATE TABLE IF NOT EXISTS run(singleton INTEGER PRIMARY KEY CHECK(singleton=1), snapshot TEXT NOT NULL)", None)?;
        self.state.storage().sql().exec("CREATE TABLE IF NOT EXISTS source_metadata(singleton INTEGER PRIMARY KEY CHECK(singleton=1), snapshot TEXT NOT NULL)", None)?;
        self.apply(&path, &body)
    }
}
