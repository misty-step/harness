//! Executive capability broker. Pi Durable owns execution; Summon owns runs.
//! This store contains memory and effect intents/receipts, never task phases or due times.
use anyhow::{bail, ensure, Context, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeSet,
    fs,
    io::{Read, Write},
    os::unix::fs::{MetadataExt, PermissionsExt},
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

pub const MAX_FRAME: usize = 512 * 1024;
pub mod mail;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    Coo,
    Cto,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Skill {
    pub name: String,
    pub description: String,
    pub body: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Instance {
    pub id: String,
    pub role: Role,
    pub instructions: String,
    pub skills: Vec<Skill>,
    pub provider: String,
    pub model: String,
    pub thinking: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Integration {
    pub capability: String,
    pub executable: PathBuf,
    pub args: Vec<String>,
    /// Names only; secrets remain at the existing authenticated consumer.
    #[serde(default)]
    pub env_names: Vec<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Grant {
    pub id: String,
    pub instance: String,
    pub capability: String,
    pub arguments_sha256: String,
    pub authority_ref: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Config {
    pub schema: String,
    pub state_dir: PathBuf,
    pub node: PathBuf,
    pub adapter: PathBuf,
    /// Existing supported credential/model consumer, never a second agent loop.
    pub native_models_entry: PathBuf,
    pub instances: Vec<Instance>,
    /// Opaque canonical config, decoded by its ONE owning HTTP library. This
    /// avoids copying fields when Relay adds a supported credential transport.
    pub factory: Option<Value>,
    #[serde(default)]
    pub integrations: Vec<Integration>,
    #[serde(default)]
    pub grants: Vec<Grant>,
}
impl Config {
    pub fn load(path: &Path) -> Result<Self> {
        let bytes = fs::read(path)?;
        ensure!(bytes.len() <= MAX_FRAME, "configuration exceeds bound");
        let config: Self = serde_json::from_slice(&bytes)?;
        config.validate()?;
        Ok(config)
    }
    pub fn validate(&self) -> Result<()> {
        ensure!(
            self.schema == "mage-executive/1",
            "unsupported executive schema"
        );
        ensure!(
            self.state_dir.is_absolute()
                && self.node.is_absolute()
                && self.adapter.is_absolute()
                && self.native_models_entry.is_absolute(),
            "absolute host paths required"
        );
        ensure!(
            self.instances.len() == 2,
            "exactly one COO and one CTO required"
        );
        ensure!(
            self.instances
                .iter()
                .filter(|i| i.role == Role::Coo)
                .count()
                == 1
                && self
                    .instances
                    .iter()
                    .filter(|i| i.role == Role::Cto)
                    .count()
                    == 1,
            "distinct COO and CTO required"
        );
        let mut ids = BTreeSet::new();
        for i in &self.instances {
            identifier(&i.id)?;
            ensure!(ids.insert(&i.id), "duplicate instance");
            ensure!(
                i.provider == "openai-codex" && i.model == "gpt-6.1-sol" && i.thinking == "xhigh",
                "unsupported route; no provider/model/cash fallback"
            );
            ensure!(
                !i.instructions.trim().is_empty() && i.instructions.len() <= 64 * 1024,
                "invalid instructions"
            );
            let mut names = BTreeSet::new();
            for s in &i.skills {
                identifier(&s.name)?;
                ensure!(
                    names.insert(&s.name)
                        && s.body.len() <= 64 * 1024
                        && s.description.len() <= 4096,
                    "invalid/duplicate skill"
                );
            }
        }
        if let Some(factory) = &self.factory {
            let _: summon_http_client::Config = serde_json::from_value(factory.clone())?;
        }
        let mut caps = BTreeSet::new();
        for i in &self.integrations {
            ensure!(
                external_capability(&i.capability) && caps.insert(&i.capability),
                "unsupported/duplicate integration capability"
            );
            ensure!(
                i.executable.is_absolute(),
                "integration executable must be absolute"
            );
            ensure!(
                i.args.len() <= 32 && i.args.iter().all(|s| s.len() <= 4096),
                "integration argv exceeds bound"
            );
            for name in &i.env_names {
                ensure!(
                    !name.is_empty()
                        && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_'),
                    "invalid environment name"
                );
            }
        }
        let mut grants = BTreeSet::new();
        for g in &self.grants {
            identifier(&g.id)?;
            self.instance(&g.instance)?;
            ensure!(
                grants.insert(&g.id)
                    && g.arguments_sha256.len() == 64
                    && g.arguments_sha256.bytes().all(|b| b.is_ascii_hexdigit())
                    && !g.authority_ref.trim().is_empty(),
                "invalid/duplicate grant"
            );
            ensure!(
                effect_capability(&g.capability),
                "grant is not an external effect capability"
            );
        }
        Ok(())
    }
    pub fn instance(&self, id: &str) -> Result<&Instance> {
        self.instances
            .iter()
            .find(|i| i.id == id)
            .context("unknown executive instance")
    }
}
pub fn identifier(s: &str) -> Result<()> {
    ensure!(
        !s.is_empty()
            && s.len() <= 128
            && s.bytes().all(|b| b.is_ascii_alphanumeric()
                || b == b'-'
                || b == b'_'
                || b == b':'
                || b == b'.'),
        "invalid stable identity"
    );
    Ok(())
}
pub fn digest(v: &Value) -> String {
    format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(v).expect("JSON value"))
    )
}
pub fn permits(role: Role, capability: &str) -> bool {
    matches!(
        capability,
        "memory_write" | "memory_recall" | "skill_read" | "factory_read" | "context_search"
    ) || match role {
        Role::Coo => matches!(
            capability,
            "delegate"
                | "schedule_read"
                | "schedule_request"
                | "schedule_cancel"
                | "mail_read"
                | "mail_send"
                | "voice_speak"
                | "glass_read"
                | "glass_write"
        ),
        Role::Cto => matches!(
            capability,
            "factory_intake" | "factory_steer" | "factory_cancel" | "report" | "glass_read"
        ),
    }
}
fn external_capability(c: &str) -> bool {
    matches!(
        c,
        "schedule_read"
            | "schedule_request"
            | "schedule_cancel"
            | "mail_read"
            | "mail_send"
            | "voice_speak"
            | "glass_read"
            | "glass_write"
    )
}
fn effect_capability(c: &str) -> bool {
    matches!(
        c,
        "schedule_request" | "schedule_cancel" | "mail_send" | "voice_speak" | "glass_write"
    )
}
pub fn private_dir(path: &Path) -> Result<()> {
    let m = fs::symlink_metadata(path)?;
    ensure!(
        m.is_dir()
            && !m.file_type().is_symlink()
            && m.mode() & 0o077 == 0
            && m.uid() == unsafe { libc::geteuid() },
        "state directory must be private, real and owner-only"
    );
    ensure!(
        fs::canonicalize(path)? == path,
        "state directory must be canonical"
    );
    Ok(())
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ToolRequest {
    pub instance: String,
    pub capability: String,
    pub operation_id: String,
    pub arguments: Value,
    pub grant_id: Option<String>,
}

pub struct Broker {
    db: Connection,
}
impl Broker {
    pub fn open(config: &Config) -> Result<Self> {
        private_dir(&config.state_dir)?;
        let path = config.state_dir.join("broker.sqlite");
        if path.exists() {
            ensure!(
                fs::symlink_metadata(&path)?.is_file()
                    && !fs::symlink_metadata(&path)?.file_type().is_symlink(),
                "invalid broker storage"
            );
        }
        let db = Connection::open(&path)?;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
        db.busy_timeout(std::time::Duration::from_secs(5))?;
        db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
          CREATE TABLE IF NOT EXISTS notes(instance TEXT NOT NULL, key TEXT NOT NULL, revision INTEGER NOT NULL, text TEXT NOT NULL, source TEXT NOT NULL, PRIMARY KEY(instance,key,revision));
          CREATE TABLE IF NOT EXISTS effects(instance TEXT NOT NULL, capability TEXT NOT NULL, id TEXT NOT NULL, digest TEXT NOT NULL, grant_id TEXT UNIQUE, receipt TEXT, PRIMARY KEY(instance,capability,id));")?;
        Ok(Self { db })
    }
    /// An immutable intent is committed BEFORE dispatch. Missing receipt is a hold,
    /// not retry authority. A grant can fund exactly one intent, across new call IDs.
    pub fn begin(&mut self, r: &ToolRequest) -> Result<Option<Value>> {
        let tx = self
            .db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let hash = digest(&r.arguments);
        let old: Option<(String, Option<String>, Option<String>)> = tx.query_row("SELECT digest,grant_id,receipt FROM effects WHERE instance=? AND capability=? AND id=?", params![r.instance,r.capability,r.operation_id], |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?))).optional()?;
        if let Some((old_hash, grant, receipt)) = old {
            ensure!(
                old_hash == hash && grant == r.grant_id,
                "operation identity conflict"
            );
            if let Some(receipt) = receipt {
                return Ok(Some(serde_json::from_str(&receipt)?));
            }
            bail!("ambiguous_effect_hold: intent exists without an owner receipt; inspect/reconcile, never resend");
        }
        tx.execute(
            "INSERT INTO effects(instance,capability,id,digest,grant_id) VALUES (?,?,?,?,?)",
            params![r.instance, r.capability, r.operation_id, hash, r.grant_id],
        )?;
        tx.commit()?;
        Ok(None)
    }
    pub fn finish(&self, r: &ToolRequest, receipt: &Value) -> Result<()> {
        let n = self.db.execute("UPDATE effects SET receipt=? WHERE instance=? AND capability=? AND id=? AND digest=? AND receipt IS NULL",params![serde_json::to_string(receipt)?,r.instance,r.capability,r.operation_id,digest(&r.arguments)])?;
        ensure!(n == 1, "effect receipt conflict");
        Ok(())
    }
    pub fn effects(&self, instance: &str) -> Result<Value> {
        let mut statement = self.db.prepare("SELECT capability,id,digest,receipt FROM effects WHERE instance=? ORDER BY rowid DESC LIMIT 100")?;
        let rows = statement.query_map([instance], |r| Ok(json!({"capability":r.get::<_,String>(0)?,"operation_id":r.get::<_,String>(1)?,"arguments_sha256":r.get::<_,String>(2)?,"owner_receipt":r.get::<_,Option<String>>(3)?})))?.collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(json!(rows))
    }
    /// Hosted callers must supply the instance derived from their authenticated
    /// service/principal binding, NOT from the request or a model header.
    pub fn execute_for(
        &mut self,
        config: &Config,
        bound_instance: &str,
        r: &ToolRequest,
    ) -> Result<Value> {
        ensure!(
            r.instance == bound_instance,
            "authenticated_instance_scope_refused"
        );
        self.execute(config, r)
    }
    /// Local trusted-host bridge; model tools cannot select their instance.
    pub fn execute(&mut self, config: &Config, r: &ToolRequest) -> Result<Value> {
        identifier(&r.operation_id)?;
        let instance = config.instance(&r.instance)?;
        ensure!(
            permits(instance.role, &r.capability),
            "wrong_role_capability_refused"
        );
        ensure!(
            serde_json::to_vec(&r.arguments)?.len() <= MAX_FRAME / 2,
            "tool arguments exceed bound"
        );
        match r.capability.as_str() {
            "memory_write" => self.memory_write(r),
            "memory_recall" => self.memory_recall(r),
            "skill_read" => {
                #[derive(Deserialize)]
                #[serde(deny_unknown_fields)]
                struct Args {
                    name: String,
                }
                let a: Args = serde_json::from_value(r.arguments.clone())?;
                let skill = instance
                    .skills
                    .iter()
                    .find(|s| s.name == a.name)
                    .context("skill unavailable to this role")?;
                Ok(serde_json::to_value(skill)?)
            }
            "factory_read" => {
                #[derive(Deserialize)]
                #[serde(deny_unknown_fields)]
                struct Args {
                    run: String,
                    endpoint: String,
                }
                let a: Args = serde_json::from_value(r.arguments.clone())?;
                let client = factory_client(config)?;
                Ok(serde_json::to_value(client.read(&a.run, &a.endpoint)?)?)
            }
            "factory_intake" | "factory_steer" | "factory_cancel" => {
                #[derive(Deserialize)]
                #[serde(deny_unknown_fields)]
                struct Args {
                    run: String,
                    body: Value,
                }
                let a: Args = serde_json::from_value(r.arguments.clone())?;
                let client = factory_client(config)?;
                // The shared client validates canonical types/scope. No claim,
                // proof, authority grant, external-effect or native-invoke tool.
                if let Some(receipt) = self.begin(r)? {
                    return Ok(receipt);
                }
                let endpoint = match r.capability.as_str() {
                    "factory_intake" => "intake",
                    "factory_steer" => "input",
                    _ => "cancel",
                };
                let result = serde_json::to_value(client.send(
                    &a.run,
                    endpoint,
                    &serde_json::to_vec(&a.body)?,
                )?)?;
                self.finish(r, &result)?;
                Ok(result)
            }
            cap if external_capability(cap) => {
                let integration = config
                    .integrations
                    .iter()
                    .find(|i| i.capability == cap)
                    .context("unsupported_integration: no approved consumer binding")?;
                if effect_capability(cap) {
                    let grant = config
                        .grants
                        .iter()
                        .find(|g| Some(&g.id) == r.grant_id.as_ref())
                        .context("external_effect_requires_exact_grant")?;
                    ensure!(
                        grant.instance == r.instance
                            && grant.capability == cap
                            && grant.arguments_sha256 == digest(&r.arguments),
                        "external_effect_grant_mismatch"
                    );
                    if let Some(receipt) = self.begin(r)? {
                        return Ok(receipt);
                    }
                } else {
                    ensure!(
                        r.grant_id.is_none(),
                        "read does not consume an action grant"
                    );
                }
                let receipt = integration_call(integration, r)?;
                if effect_capability(cap) {
                    self.finish(r, &receipt)?;
                }
                Ok(receipt)
            }
            _ => bail!("capability belongs to the durable host, not this broker"),
        }
    }
    fn memory_write(&mut self, r: &ToolRequest) -> Result<Value> {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Args {
            key: String,
            expected_revision: u64,
            text: String,
            source: String,
        }
        let a: Args = serde_json::from_value(r.arguments.clone())?;
        identifier(&a.key)?;
        ensure!(
            !a.text.trim().is_empty()
                && a.text.len() <= 8192
                && !a.source.trim().is_empty()
                && a.source.len() <= 4096,
            "memory requires bounded text and original source"
        );
        ensure!(
            r.grant_id.is_none(),
            "memory cannot consume an external grant"
        );
        // Memory is a local transaction, not an external effect sandwich.
        let tx = self
            .db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let hash = digest(&r.arguments);
        let old: Option<(String, Option<String>)> = tx
            .query_row(
                "SELECT digest,receipt FROM effects WHERE instance=? AND capability=? AND id=?",
                params![r.instance, r.capability, r.operation_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        if let Some((old_hash, receipt)) = old {
            ensure!(old_hash == hash, "memory_operation_identity_conflict");
            return Ok(serde_json::from_str(
                &receipt.context("legacy memory intent requires reconciliation")?,
            )?);
        }
        let revision: u64 = tx.query_row(
            "SELECT COALESCE(MAX(revision),0) FROM notes WHERE instance=? AND key=?",
            params![r.instance, a.key],
            |row| row.get(0),
        )?;
        ensure!(
            revision == a.expected_revision,
            "memory_revision_conflict; recall before correction"
        );
        let receipt = json!({"key":a.key,"revision":revision+1,"source":a.source});
        tx.execute(
            "INSERT INTO notes(instance,key,revision,text,source) VALUES (?,?,?,?,?)",
            params![r.instance, a.key, revision + 1, a.text, a.source],
        )?;
        tx.execute(
            "INSERT INTO effects(instance,capability,id,digest,receipt) VALUES (?,?,?,?,?)",
            params![
                r.instance,
                r.capability,
                r.operation_id,
                hash,
                serde_json::to_string(&receipt)?
            ],
        )?;
        tx.commit()?;
        Ok(receipt)
    }
    fn memory_recall(&self, r: &ToolRequest) -> Result<Value> {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Args {
            query: String,
        }
        let a: Args = serde_json::from_value(r.arguments.clone())?;
        ensure!(a.query.len() <= 256, "recall query exceeds bound");
        let pattern = format!(
            "%{}%",
            a.query
                .replace('\\', "\\\\")
                .replace('%', "\\%")
                .replace('_', "\\_")
        );
        let mut statement = self.db.prepare("SELECT key,revision,text,source FROM notes n WHERE instance=? AND revision=(SELECT MAX(revision) FROM notes WHERE instance=n.instance AND key=n.key) AND (text LIKE ? ESCAPE '\\' OR key LIKE ? ESCAPE '\\') ORDER BY rowid DESC LIMIT 10")?;
        let mut budget = 16 * 1024;
        let mut values = Vec::new();
        for row in statement.query_map(params![r.instance,pattern,pattern],|row| Ok(json!({"key":row.get::<_,String>(0)?,"revision":row.get::<_,u64>(1)?,"text":row.get::<_,String>(2)?,"source":row.get::<_,String>(3)?})))? {
            let row = row?; let size = serde_json::to_vec(&row)?.len();
            if size > budget { break; } budget -= size; values.push(row);
        }
        Ok(json!({"instance":r.instance,"notes":values,"authority":false}))
    }
}
fn factory_client(config: &Config) -> Result<summon_http_client::Client> {
    let c = config
        .factory
        .as_ref()
        .context("unsupported_factory_route: no admitted factory binding")?;
    summon_http_client::Client::new(serde_json::from_value(c.clone())?)
}
fn integration_call(i: &Integration, r: &ToolRequest) -> Result<Value> {
    let mut cmd = Command::new(&i.executable);
    cmd.args(&i.args)
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    for name in &i.env_names {
        if let Ok(v) = std::env::var(name) {
            cmd.env(name, v);
        }
    }
    let mut child = cmd.spawn().context("approved integration unavailable")?;
    let mut input = child
        .stdin
        .take()
        .context("integration stdin unavailable")?;
    input.write_all(&serde_json::to_vec(r)?)?;
    input.write_all(b"\n")?;
    drop(input);
    let mut output = Vec::new();
    // Continue draining oversized output so the owned process cannot block exit.
    let mut stream = child
        .stdout
        .take()
        .context("integration stdout unavailable")?;
    let mut chunk = [0; 8192];
    let mut exceeded = false;
    loop {
        let n = stream.read(&mut chunk)?;
        if n == 0 {
            break;
        }
        if output.len() + n <= MAX_FRAME {
            output.extend_from_slice(&chunk[..n]);
        } else {
            exceeded = true;
        }
    }
    let exit = child.wait()?;
    ensure!(
        exit.success() && !exceeded,
        "integration outcome unavailable; effect intent retained for reconciliation"
    );
    let result: Value = serde_json::from_slice(&output)
        .context("integration returned no canonical owner receipt")?;
    ensure!(
        result.get("operation_id").and_then(Value::as_str) == Some(&r.operation_id)
            && result
                .get("owner_ref")
                .and_then(Value::as_str)
                .is_some_and(|s| !s.trim().is_empty()),
        "integration receipt not bound to operation/owner"
    );
    Ok(result)
}
