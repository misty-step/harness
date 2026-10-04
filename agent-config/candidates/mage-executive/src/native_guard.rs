//! Native request admission facts, not another task/account/run authority.
//! Reserve before the physical fetch; ambiguity never refunds a request budget.
use crate::{digest, identifier, Broker, Config, Role, MAX_FRAME};
use anyhow::{ensure, Context, Result};
use rusqlite::{params, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    io::Read,
    path::PathBuf,
    process::{Command, Stdio},
    time::{SystemTime, UNIX_EPOCH},
};

pub const MAX_TOTAL: u64 = 12;
pub const MAX_PER_INPUT: u64 = 4;
pub const MAX_BODY: usize = 96 * 1024;

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct QuotaReader {
    pub executable: PathBuf,
    pub args: Vec<String>,
    #[serde(default)]
    pub env_names: Vec<String>,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NativeStaging {
    pub admission_ref: String,
    pub account_ref: String,
    pub coo_input_id: String,
    pub commission_id: String,
    pub quota_reader: QuotaReader,
}
impl NativeStaging {
    pub fn validate(&self) -> Result<()> {
        for id in [
            &self.admission_ref,
            &self.account_ref,
            &self.coo_input_id,
            &self.commission_id,
        ] {
            identifier(id)?;
        }
        ensure!(
            self.account_ref.starts_with("acct-") && self.account_ref.len() == 15,
            "native account must use the owning ai-usage pseudonym"
        );
        ensure!(
            self.quota_reader.executable.is_absolute()
                && self.quota_reader.args.len() <= 32
                && self.quota_reader.args.iter().all(|a| a.len() <= 4096),
            "invalid native quota reader binding"
        );
        for name in &self.quota_reader.env_names {
            ensure!(
                !name.is_empty() && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_'),
                "invalid native quota environment name"
            );
        }
        Ok(())
    }
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub instance: String,
    pub input_id: String,
    pub input_class: String,
    pub account_ref: String,
    pub body_sha256: String,
    pub body_bytes: usize,
    pub tools: Vec<String>,
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Quota {
    pub schema: String,
    pub owner_ref: String,
    pub account_ref: String,
    pub provider: String,
    pub model: String,
    pub effort: String,
    pub auth_type: String,
    pub auth_source: String,
    pub billing: String,
    pub verdict: String,
    pub observed_at_ms: u64,
    pub remaining_percent: f64,
    pub extra_usage_enabled: Option<bool>,
    pub degraded: Option<String>,
}
impl Quota {
    pub fn check(&self, account: &str, now_ms: u64) -> Result<()> {
        ensure!(
            self.schema == "mage-native-quota/1" && !self.owner_ref.is_empty(),
            "unsupported_native_quota_receipt"
        );
        ensure!(
            self.account_ref == account
                && self.provider == "openai-codex"
                && self.model == "gpt-6.1-sol"
                && self.effort == "xhigh"
                && self.auth_type == "oauth"
                && self.auth_source == "stored"
                && self.billing == "plan",
            "native_selected_route_or_billing_refused"
        );
        ensure!(
            self.verdict == "usable"
                && self.degraded.is_none()
                && self.remaining_percent.is_finite()
                && self.remaining_percent > 0.0
                && self.remaining_percent <= 100.0
                && self.observed_at_ms <= now_ms
                && now_ms - self.observed_at_ms <= 300_000,
            "native_quota_unavailable_or_stale"
        );
        ensure!(
            self.extra_usage_enabled == Some(false),
            "native_extra_usage_unknown_or_enabled"
        );
        Ok(())
    }
}
fn read_quota(reader: &QuotaReader) -> Result<Quota> {
    let mut command = Command::new(&reader.executable);
    command
        .args(&reader.args)
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    for name in &reader.env_names {
        if let Ok(value) = std::env::var(name) {
            command.env(name, value);
        }
    }
    let mut child = command.spawn().context("native_quota_reader_unavailable")?;
    let mut bytes = Vec::new();
    let mut stream = child
        .stdout
        .take()
        .context("native quota stdout unavailable")?;
    // Drain while bounding, and wait OUR reader before return.
    let mut buffer = [0; 8192];
    let mut overflow = false;
    loop {
        let n = stream.read(&mut buffer)?;
        if n == 0 {
            break;
        }
        if bytes.len() + n <= MAX_FRAME {
            bytes.extend_from_slice(&buffer[..n]);
        } else {
            overflow = true;
        }
    }
    ensure!(
        child.wait()?.success() && !overflow,
        "native_quota_reader_failed"
    );
    serde_json::from_slice(&bytes)
        .context("unsupported_native_quota_receipt: explicit fresh extra-usage state required")
}
impl Broker {
    /// The local trusted final-fetch adapter calls this, never a model tool.
    pub fn native_admit(&mut self, config: &Config, request: &Request) -> Result<Value> {
        let policy = config
            .native_staging
            .as_ref()
            .context("native_staging_admission_required")?;
        policy.validate()?;
        ensure!(
            request.account_ref == policy.account_ref
                && request.body_bytes <= MAX_BODY
                && request.body_sha256.len() == 64
                && request.body_sha256.bytes().all(|c| c.is_ascii_hexdigit()),
            "native_final_body_or_account_refused"
        );
        let role = config.instance(&request.instance)?.role;
        ensure!(
            match request.input_class.as_str() {
                "coo_input" => role == Role::Coo && request.input_id == policy.coo_input_id,
                "cto_commission" =>
                    role == Role::Cto
                        && request.input_id == format!("mage-commission:{}", policy.commission_id),
                "coo_wake" => role == Role::Coo && request.input_id.starts_with("mage-report:"),
                _ => false,
            },
            "native_original_input_scope_refused"
        );
        let allowed = stage_tools(role);
        ensure!(request.tools == allowed, "native_stage_tool_offer_refused");
        let quota = read_quota(&policy.quota_reader)?;
        let now = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis() as u64;
        quota.check(&policy.account_ref, now)?;
        self.reserve_native(policy, request, &quota.owner_ref)
    }
    pub(crate) fn reserve_native(
        &mut self,
        policy: &NativeStaging,
        r: &Request,
        owner_ref: &str,
    ) -> Result<Value> {
        self.db.execute_batch("CREATE TABLE IF NOT EXISTS native_policy(singleton INTEGER PRIMARY KEY CHECK(singleton=1),digest TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS native_sends(id INTEGER PRIMARY KEY, input_class TEXT NOT NULL,input_id TEXT NOT NULL,instance TEXT NOT NULL,account_ref TEXT NOT NULL,body_sha256 TEXT NOT NULL,quota_ref TEXT NOT NULL);")?;
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let policy_hash = digest(&serde_json::to_value(policy)?);
        let previous: Option<String> = tx
            .query_row(
                "SELECT digest FROM native_policy WHERE singleton=1",
                [],
                |r| r.get(0),
            )
            .optional()?;
        if let Some(old) = previous {
            ensure!(
                old == policy_hash,
                "native_admission_changed_no_budget_reset"
            );
        } else {
            tx.execute("INSERT INTO native_policy VALUES(1,?)", [&policy_hash])?;
        }
        let bound: Option<(String, String)> = tx
            .query_row(
                "SELECT input_id,instance FROM native_sends WHERE input_class=? LIMIT 1",
                [&r.input_class],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        if let Some((id, instance)) = bound {
            ensure!(
                id == r.input_id && instance == r.instance,
                "native_input_identity_changed_no_budget_reset"
            );
        }
        let total: u64 = tx.query_row("SELECT COUNT(*) FROM native_sends", [], |r| r.get(0))?;
        let per_input: u64 = tx.query_row(
            "SELECT COUNT(*) FROM native_sends WHERE input_class=?",
            [&r.input_class],
            |r| r.get(0),
        )?;
        ensure!(
            total < MAX_TOTAL && per_input < MAX_PER_INPUT,
            "native_physical_request_budget_exhausted"
        );
        tx.execute("INSERT INTO native_sends(input_class,input_id,instance,account_ref,body_sha256,quota_ref) VALUES(?,?,?,?,?,?)",params![r.input_class,r.input_id,r.instance,r.account_ref,r.body_sha256,owner_ref])?;
        let id = tx.last_insert_rowid();
        tx.commit()?;
        Ok(
            json!({"native_send_intent":id,"account_ref":r.account_ref,"instance":r.instance,"input_id":r.input_id,"input_class":r.input_class,"body_sha256":r.body_sha256,"total_reserved":total+1,"input_reserved":per_input+1,"quota_owner_ref":owner_ref,"applied":false,"authority":"local-staging-only","output_token_bound":"not proven"}),
        )
    }
}
pub fn stage_tools(role: Role) -> Vec<String> {
    let mut tools = vec![
        "mage_context_search",
        "mage_factory_read",
        "mage_memory_recall",
        "mage_memory_write",
        "mage_skill_read",
    ];
    if role == Role::Coo {
        tools.push("mage_delegate");
    }
    tools.sort_unstable();
    tools.into_iter().map(str::to_owned).collect()
}
