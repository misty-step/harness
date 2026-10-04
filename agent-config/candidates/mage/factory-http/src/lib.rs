//! Stateless consumer of the canonical hosted gateway, NOT an authority,
//! admission service, native dispatcher or delivery ledger. Never auto-retries.
use anyhow::{ensure, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{io::Read, path::Path, time::Duration};
use summon_protocol::{authority::*, evidence::PacketManifestV1, visibility::*, *};
use url::Url;

const MAX_RESPONSE: usize = 4 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Config {
    pub origin: String,
    pub binding: AuthorityBinding,
    /// Optional owner-supplied, approved Access assertion; never a native OAuth
    /// credential/cookie reader. No secret value belongs in this config or logs.
    pub assertion_env: Option<String>,
    #[serde(default)]
    pub loopback_fixture: bool,
}
pub struct Client {
    agent: ureq::Agent,
    origin: Url,
    binding: AuthorityBinding,
    assertion: Option<String>,
}
#[derive(Serialize)]
pub struct Response {
    pub authority: AttributedAuthority,
    pub body: Value,
}
impl Client {
    /// A binding selects the requested scope; it does NOT assert a principal,
    /// grant or admission. The gateway alone authenticates and authorizes it.
    pub fn new(config: Config) -> Result<Self> {
        let origin = Url::parse(&config.origin).context("invalid gateway origin")?;
        ensure!(
            origin.username().is_empty()
                && origin.password().is_none()
                && origin.query().is_none()
                && origin.fragment().is_none()
                && origin.path() == "/",
            "gateway must be a bare origin without credentials, query or path"
        );
        ensure!(
            origin.scheme() == "https"
                || (config.loopback_fixture
                    && origin.scheme() == "http"
                    && matches!(origin.host_str(), Some("127.0.0.1" | "[::1]"))),
            "HTTPS required; explicit IP-loopback fixture only"
        );
        for field in [
            &config.binding.instance,
            &config.binding.namespace,
            &config.binding.account_id,
            &config.binding.project_id,
        ] {
            ensure!(
                !field.trim().is_empty()
                    && field.len() <= 4096
                    && !field.chars().any(char::is_control),
                "invalid requested scope"
            );
        }
        let assertion = config
            .assertion_env
            .map(|name| -> Result<String> {
                ensure!(
                    !name.is_empty()
                        && name.len() <= 128
                        && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_'),
                    "invalid assertion environment name"
                );
                let value = std::env::var(name).map_err(|_| {
                    anyhow::anyhow!(
                        "named owner assertion unavailable; no login or credential fallback"
                    )
                })?;
                ensure!(
                    !value.is_empty()
                        && value.len() <= 16384
                        && !value.chars().any(char::is_control),
                    "invalid owner assertion transport value"
                );
                Ok(value)
            })
            .transpose()?;
        let agent = ureq::Agent::config_builder()
            .http_status_as_error(false)
            .max_redirects(0)
            .max_redirects_will_error(false)
            .proxy(None)
            .max_idle_connections(0)
            .max_idle_connections_per_host(0)
            .timeout_global(Some(Duration::from_secs(5)))
            .build()
            .into();
        Ok(Self {
            agent,
            origin,
            binding: config.binding,
            assertion,
        })
    }
    fn exchange(&self, path: &str, body: Option<&[u8]>) -> Result<Response> {
        let url = self.origin.join(path)?;
        let binding = serde_json::to_string(&self.binding)?;
        let request = if let Some(body) = body {
            let mut request = self
                .agent
                .post(url.as_str())
                .header("x-summon-authority", &binding)
                .header("Content-Type", "application/json");
            if let Some(value) = &self.assertion {
                request = request.header("cf-access-jwt-assertion", value);
            }
            request.send(body)
        } else {
            let mut request = self
                .agent
                .get(url.as_str())
                .header("x-summon-authority", &binding);
            if let Some(value) = &self.assertion {
                request = request.header("cf-access-jwt-assertion", value);
            }
            request.call()
        };
        // Do not expose request/header debug output, forward arbitrary caller
        // identity headers, reuse connections or follow an auth/login redirect.
        let mut response = request
            .map_err(|_| anyhow::anyhow!("gateway transport unavailable; no automatic resend"))?;
        let status = response.status().as_u16();
        let authority = response
            .headers()
            .get("x-summon-authority")
            .and_then(|v| v.to_str().ok())
            .map(str::to_owned);
        let actor = response
            .headers()
            .get("x-summon-actor")
            .and_then(|v| v.to_str().ok())
            .map(str::to_owned);
        let mut bytes = Vec::new();
        response
            .body_mut()
            .as_reader()
            .take((MAX_RESPONSE + 1) as u64)
            .read_to_end(&mut bytes)
            .map_err(|_| anyhow::anyhow!("incomplete gateway response; no automatic resend"))?;
        ensure!(
            bytes.len() <= MAX_RESPONSE,
            "gateway response exceeds 4MiB bound"
        );
        if !(200..300).contains(&status) {
            let code = serde_json::from_slice::<Refusal>(&bytes)
                .ok()
                .map(|r| r.code)
                .filter(|s| {
                    s.len() <= 64
                        && !s.is_empty()
                        && s.bytes().all(|b| b.is_ascii_lowercase() || b == b'_')
                })
                .unwrap_or_else(|| "noncanonical_response".into());
            // The server's status/code is retained; do not print arbitrary HTML,
            // redirects, response secrets or echoed credentials.
            ensure!(
                false,
                "gateway HTTP {status}, refusal {code}; no automatic resend"
            );
        }
        let returned: AuthorityBinding = serde_json::from_str(
            authority
                .as_deref()
                .context("missing scoped gateway response")?,
        )
        .map_err(|_| anyhow::anyhow!("invalid scoped gateway response"))?;
        ensure!(
            returned == self.binding,
            "gateway returned a different account/project/instance/namespace"
        );
        let actor_id = actor.context("missing server-attributed actor")?;
        ensure!(
            !actor_id.trim().is_empty()
                && actor_id.len() <= 4096
                && !actor_id.chars().any(char::is_control),
            "invalid server-attributed actor"
        );
        let body =
            serde_json::from_slice(&bytes).map_err(|_| anyhow::anyhow!("invalid gateway JSON"))?;
        Ok(Response {
            authority: AttributedAuthority {
                binding: returned,
                actor_id,
            },
            body,
        })
    }
    pub fn read(&self, run: &str, endpoint: &str) -> Result<Response> {
        validate_run_id(run).map_err(|e| anyhow::anyhow!("{}", e.code))?;
        ensure!(
            ["status", "view", "packet", "authority"].contains(&endpoint),
            "unsupported canonical read endpoint"
        );
        let response = self.exchange(&format!("/v1/runs/{run}/{endpoint}"), None)?;
        match endpoint {
            "status" => {
                let status: Status = decode(&response.body)?;
                validate_status(&status, run)?;
            }
            "view" => {
                let record: AgentRunAttemptV1 = decode(&response.body)?;
                let managed = record
                    .managed
                    .context("hosted view missing managed source")?;
                validate_status(&managed, run)?;
            }
            "packet" => {
                let packet: PacketManifestV1 = decode(&response.body)?;
                packet
                    .validate_archive()
                    .map_err(|e| anyhow::anyhow!("{}", e.code))?;
                let managed = packet
                    .record
                    .managed
                    .context("hosted packet missing managed source")?;
                validate_status(&managed, run)?;
            }
            "authority" => {
                let authority: AttributedAuthority = decode(&response.body)?;
                ensure!(
                    authority.binding == response.authority.binding,
                    "authority body/header scope differs"
                );
            }
            _ => unreachable!(),
        }
        Ok(response)
    }
    /// Submit ONCE. All failures, including a missing/invalid response, leave
    /// command acceptance uncertain. Caller retains ORIGINAL IDs/body/revision
    /// and explicitly reads/reconciles; this client never invokes a native task.
    pub fn send(&self, run: &str, endpoint: &str, bytes: &[u8]) -> Result<Response> {
        validate_run_id(run).map_err(|e| anyhow::anyhow!("{}", e.code))?;
        ensure!(
            bytes.len() <= storage::MAX_BYTES,
            "canonical request exceeds 512KiB"
        );
        let parsed: Value = serde_json::from_slice(bytes)
            .map_err(|_| anyhow::anyhow!("invalid canonical request JSON"))?;
        let _action = match endpoint {
            "intake" => {
                let r: Intake = decode(&parsed)?;
                ensure!(r.task.id == run, "intake/task run differs");
                r.task
                    .validate()
                    .map_err(|e| anyhow::anyhow!("{}", e.code))?;
                GatewayAction::Intake
            }
            "input" => {
                let _: InputRequest = decode(&parsed)?;
                GatewayAction::Steer
            }
            "hold" => {
                let _: HoldRequest = decode(&parsed)?;
                GatewayAction::Hold
            }
            "cancel" => {
                let _: CancelRequest = decode(&parsed)?;
                GatewayAction::Cancel
            }
            "claim" => {
                let _: ClaimRequest = decode(&parsed)?;
                GatewayAction::Claim
            }
            "observe" | "reconcile" => {
                let _: ObserveRequest = decode(&parsed)?;
                GatewayAction::NativeFacts
            }
            "metadata" => {
                let _: MetadataRequest = decode(&parsed)?;
                GatewayAction::Metadata
            }
            // Proof issuer/actor and admission remain authority-owner work.
            // No invented hosted supplied-record/archive or proof bypass route.
            _ => anyhow::bail!("unsupported client command endpoint"),
        };
        let path = if endpoint == "intake" {
            "/v1/intake".into()
        } else {
            format!("/v1/runs/{run}/{endpoint}")
        };
        let response = self.exchange(&path, Some(bytes)).context(
            "command acceptance UNKNOWN unless original request is reconciled; never blind resend",
        )?;
        (|| -> Result<()> {
            if endpoint=="metadata" {
                let record:AgentRunAttemptV1=decode(&response.body)?;
                validate_status(&record.managed.context("metadata response missing managed source")?,run)?;
            } else {
                let reply:Reply=decode(&response.body)?;
                validate_status(&reply.run,run)?;
            }
            Ok(())
        })().context("command acceptance UNKNOWN: invalid reply; reconcile original request, never blind resend")?;
        Ok(response)
    }
}
fn decode<T: serde::de::DeserializeOwned>(value: &Value) -> Result<T> {
    serde_json::from_value(value.clone())
        .map_err(|_| anyhow::anyhow!("invalid canonical response/request shape"))
}
fn validate_status(status: &Status, run: &str) -> Result<()> {
    ensure!(
        status.authority == "summon_do"
            && status.protocol_version == VERSION
            && status.run_id == run
            && status.task.id == run,
        "canonical status authority/version/run differs"
    );
    Ok(())
}
fn file(path: &str) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    std::fs::File::open(Path::new(path))?
        .take((storage::MAX_BYTES + 1) as u64)
        .read_to_end(&mut bytes)?;
    ensure!(
        bytes.len() <= storage::MAX_BYTES,
        "client input exceeds 512KiB"
    );
    Ok(bytes)
}
/// Shared CLI entry for Mage/Pi. No launcher/session/loadout mutation; no
/// automatic claim->native invoke, observe->POST or native ACK inference.
pub fn cli(args: &[String]) -> Result<Value> {
    ensure!(matches!(args.len(),4|5),"factory CONFIG read RUN_ID status|view|packet|authority OR factory CONFIG send RUN_ID intake|input|hold|cancel|claim|observe|reconcile|metadata BODY.json");
    let config: Config = serde_json::from_slice(&file(&args[0])?)
        .map_err(|_| anyhow::anyhow!("invalid client config"))?;
    let client = Client::new(config)?;
    let response = match (args[1].as_str(), args.len()) {
        ("read", 4) => client.read(&args[2], &args[3])?,
        ("send", 5) => client.send(&args[2], &args[3], &file(&args[4])?)?,
        _ => anyhow::bail!("invalid factory client arguments"),
    };
    Ok(
        json!({"gateway":response,"native_ack":"not_inferred","task_admission":"not_inferred","native_execution":"not_invoked"}),
    )
}
