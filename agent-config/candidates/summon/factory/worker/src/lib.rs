use serde::Deserialize;
use summon_protocol::*;
use worker::*;

const MAX_BYTES: usize = 512 * 1024;

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
    let run_id = if path == "/v1/intake" && req.method() == Method::Post {
        match parse::<Intake>(&body) {
            Ok(r) => r.task.id,
            Err(e) => return refusal(e),
        }
    } else if let Some((id, action)) = route(path) {
        if (action == "status" && req.method() == Method::Get)
            || (matches!(
                action,
                "input" | "claim" | "observe" | "reconcile" | "hold" | "proof" | "cancel"
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
            .to_array::<Row>()?;
        rows.into_iter()
            .next()
            .map(|r| serde_json::from_str::<Run>(&r.snapshot).map_err(Error::from))
            .transpose()
    }
    fn save(&self, run: &Run) -> worker::Result<bool> {
        let snapshot = serde_json::to_string(run)?;
        if snapshot.len() > MAX_BYTES {
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
            if !self.save(&run)? {
                return error(
                    "state_limit",
                    "run snapshot exceeds 512KiB; no mutation committed",
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
        if !replayed && !self.save(&run)? {
            return error(
                "state_limit",
                "run snapshot exceeds 512KiB; no mutation committed",
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
        self.apply(&path, &body)
    }
}
