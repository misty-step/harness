//! Standalone native Pi adapter. Protocol/DO owns runs; this owns native IPC facts.
use anyhow::{ensure, Context, Result};
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
    process::Stdio,
};
use summon_protocol::{
    sha256, CancelRequest, Dispatch, NativeReceipt, NativeSession, Observation, ObserveRequest,
    Termination,
};
use tokio::{
    io::{AsyncBufRead, AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, ChildStdout, Command},
};

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Config {
    pub host: String,
    pub state_dir: String,
    pub extension: String,
}
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct NativeInput<'a> {
    run_id: &'a str,
    attempt_id: &'a str,
    input_id: &'a str,
    text_sha256: &'a str,
    session_id: &'a str,
    session_file: &'a str,
    text: &'a str,
}

pub fn private_dir(path: &Path) -> Result<PathBuf> {
    ensure!(path.is_absolute(), "native transport path must be absolute");
    if !path.exists() {
        fs::create_dir_all(path)?;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    }
    let meta = fs::symlink_metadata(path)?;
    ensure!(
        meta.is_dir()
            && meta.uid() == unsafe { libc::getuid() }
            && meta.mode() & 0o077 == 0
            && fs::canonicalize(path)? == path,
        "native transport directory must be canonical and owner-only"
    );
    Ok(path.to_owned())
}
fn immutable(path: &Path, bytes: &[u8]) -> Result<bool> {
    if path.exists() {
        ensure!(
            fs::read(path)? == bytes,
            "native transport identity/payload conflict"
        );
        return Ok(false);
    }
    let temp = path.with_extension(format!("tmp-{}", std::process::id()));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW)
        .open(&temp)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    let linked = fs::hard_link(&temp, path);
    fs::remove_file(temp)?;
    linked?;
    File::open(path.parent().context("no transport parent")?)?.sync_all()?;
    Ok(true)
}
pub async fn record<R: AsyncBufRead + Unpin>(input: &mut R) -> Result<Option<Value>> {
    let mut bytes = Vec::new();
    loop {
        let available = input.fill_buf().await?;
        if available.is_empty() {
            ensure!(bytes.is_empty(), "truncated native RPC record");
            return Ok(None);
        }
        let n = available
            .iter()
            .position(|b| *b == b'\n')
            .map(|i| i + 1)
            .unwrap_or(available.len());
        ensure!(
            bytes.len() + n <= 1024 * 1024,
            "native RPC record exceeds 1MiB bound"
        );
        let done = available[n - 1] == b'\n';
        bytes.extend_from_slice(&available[..n]);
        input.consume(n);
        if done {
            return Ok(Some(serde_json::from_slice(&bytes)?));
        }
    }
}

pub fn native_args(
    dispatch: &Dispatch,
    config: &Config,
    session: &NativeSession,
    resume: bool,
    sessions: &Path,
) -> Result<Vec<String>> {
    ensure!(
        dispatch.task.route.harness == "pi" && dispatch.task.route.provider == "openai-codex",
        "pilot only supports native Pi openai-codex; no fallback"
    );
    ensure!(
        dispatch.text_sha256 == sha256(dispatch.text.as_bytes()),
        "dispatch text hash mismatch"
    );
    ensure!(
        Path::new(&dispatch.task.workspace).is_absolute()
            && Path::new(&dispatch.task.workspace).is_dir(),
        "workspace must be an existing absolute directory"
    );
    ensure!(
        Path::new(&config.extension).is_absolute() && Path::new(&config.extension).is_file(),
        "explicit native SDK extension source required"
    );
    ensure!(
        !config.host.is_empty() && session.runtime == "pi" && session.host == config.host,
        "native runtime/host handoff must be explicit"
    );
    ensure!(
        !dispatch.task.route.model.contains([':', '/']) && !dispatch.task.route.model.is_empty(),
        "exact native model selector required"
    );
    ensure!(
        ["off", "minimal", "low", "medium", "high", "xhigh", "max"]
            .contains(&dispatch.task.route.effort.as_str()),
        "invalid native thinking selector"
    );
    let mut args = vec![
        "--mode".into(),
        "rpc".into(),
        "--offline".into(),
        "--provider".into(),
        dispatch.task.route.provider.clone(),
        "--model".into(),
        dispatch.task.route.model.clone(),
        "--thinking".into(),
        dispatch.task.route.effort.clone(),
        "--no-extensions".into(),
        "--no-prompt-templates".into(),
        "--extension".into(),
        config.extension.clone(),
        "--session-dir".into(),
        sessions.to_string_lossy().into_owned(),
        "--tools".into(),
        "read,grep,find,ls".into(),
    ];
    if resume {
        ensure!(
            Path::new(&session.session_file).is_absolute()
                && Path::new(&session.session_file).is_file(),
            "exact native resume file unavailable; never create a replacement"
        );
        args.extend(["--session".into(), session.session_file.clone()]);
    } else {
        args.extend(["--session-id".into(), session.session_id.clone()]);
    }
    if let Some(context) = &dispatch.task.context {
        if let Some(instructions) = &context.instructions {
            args.push("--no-context-files".into());
            for text in instructions {
                ensure!(
                    !text.is_empty() && !text.contains('\0') && !Path::new(text).exists(),
                    "instructions require frozen literal text, not an unresolved file reference"
                );
                args.extend(["--append-system-prompt".into(), text.clone()]);
            }
        }
        if let Some(skills) = &context.skills {
            args.push("--no-skills".into());
            for skill in skills {
                ensure!(
                    Path::new(skill).is_absolute() && Path::new(skill).exists(),
                    "skill requires existing absolute native reference"
                );
                args.extend(["--skill".into(), skill.clone()]);
            }
        }
    }
    Ok(args)
}

/// One owned native process, no task phases or scheduler. Call deliver(), then
/// observe/wait or request_abort() while native work is active. Acceptance is external.
pub struct NativePi {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    pub session: NativeSession,
    root: PathBuf,
    run_id: String,
    task_sha256: String,
    _lock: File,
    sequence: u64,
    pub settled_count: u64,
}
impl NativePi {
    pub async fn start(dispatch: &Dispatch, config: &Config) -> Result<Self> {
        let root = private_dir(Path::new(&config.state_dir))?;
        let root = private_dir(&root.join(sha256(dispatch.run_id.as_bytes())))?;
        let lock = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW)
            .open(root.join("native.lock"))?;
        lock.try_lock_exclusive()
            .context("native process already owned; no lease takeover")?;
        let stored = root.join("native.session");
        let previous: Option<NativeSession> = if stored.exists() {
            Some(serde_json::from_slice(&fs::read(&stored)?)?)
        } else {
            None
        };
        if let (Some(expected), Some(previous)) = (&dispatch.native_session, &previous) {
            ensure!(
                expected == previous,
                "native session conflict; explicit handoff required"
            );
        }
        let resume = dispatch.native_session.is_some() || previous.is_some();
        let mut session = dispatch
            .native_session
            .clone()
            .or(previous)
            .unwrap_or_else(|| NativeSession {
                runtime: "pi".into(),
                host: config.host.clone(),
                session_id: format!("summon-{}", sha256(dispatch.run_id.as_bytes())),
                session_file: String::new(),
            });
        let sessions = private_dir(&root.join("sessions"))?;
        let args = native_args(dispatch, config, &session, resume, &sessions)?;
        // Native auth stays native. No login, credential reads/copies, API-key flags,
        // alternate route or paid fallback is implemented here.
        let mut child = Command::new("pi")
            .args(args)
            .current_dir(&dispatch.task.workspace)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()?;
        let stdin = child.stdin.take().context("native stdin unavailable")?;
        let stdout = BufReader::new(child.stdout.take().context("native stdout unavailable")?);
        let mut process = Self {
            child,
            stdin,
            stdout,
            session: session.clone(),
            root,
            run_id: dispatch.run_id.clone(),
            task_sha256: sha256(&serde_json::to_vec(&dispatch.task)?),
            _lock: lock,
            sequence: 0,
            settled_count: 0,
        };
        let state = process.command(json!({"type":"get_state"})).await?;
        ensure!(
            state["sessionId"] == session.session_id
                && state["model"]["provider"] == dispatch.task.route.provider
                && state["model"]["id"] == dispatch.task.route.model
                && state["thinkingLevel"] == dispatch.task.route.effort,
            "native identity/route/thinking mismatch; no input sent"
        );
        let file = state["sessionFile"]
            .as_str()
            .context("native persistent session required")?;
        if resume {
            ensure!(
                file == session.session_file,
                "native resume switched/forked; refused"
            );
        } else {
            session.session_file = file.into();
        }
        process.session = session;
        immutable(&stored, &serde_json::to_vec(&process.session)?)?;
        let commands = process.command(json!({"type":"get_commands"})).await?;
        let commands = commands["commands"]
            .as_array()
            .context("native extension discovery missing")?;
        for name in ["summon-native-input", "summon-native-receipt"] {
            ensure!(
                commands.iter().any(|command| command["name"] == name
                    && command["source"] == "extension"
                    && command["sourceInfo"]["path"] == config.extension),
                "explicit native SDK command source not loaded; no input sent"
            );
        }
        // Bound one native attempt; no automatic retry/compaction calls in pilot.
        process
            .command(json!({"type":"set_auto_retry","enabled":false}))
            .await?;
        process
            .command(json!({"type":"set_auto_compaction","enabled":false}))
            .await?;
        Ok(process)
    }
    pub async fn next_event(&mut self) -> Result<Option<Value>> {
        let event = record(&mut self.stdout).await?;
        if event.as_ref().is_some_and(|v| v["type"] == "agent_settled") {
            self.settled_count += 1;
        }
        Ok(event)
    }
    pub async fn command(&mut self, mut command: Value) -> Result<Value> {
        self.sequence += 1;
        let id = format!("summon-native-{}", self.sequence);
        command["id"] = json!(id);
        self.stdin
            .write_all(format!("{command}\n").as_bytes())
            .await?;
        self.stdin.flush().await?;
        loop {
            let event = self
                .next_event()
                .await?
                .context("native EOF; ACK may remain uncertain")?;
            if event["type"] == "response" && event["id"] == id {
                ensure!(
                    event["success"] == true,
                    "native command refused: {}",
                    event["error"]
                );
                return Ok(event["data"].clone());
            }
        }
    }
    fn input<'a>(&'a self, dispatch: &'a Dispatch) -> NativeInput<'a> {
        NativeInput {
            run_id: &dispatch.run_id,
            attempt_id: &dispatch.attempt_id,
            input_id: &dispatch.input_id,
            text_sha256: &dispatch.text_sha256,
            session_id: &self.session.session_id,
            session_file: &self.session.session_file,
            text: &dispatch.text,
        }
    }
    /// Recover only an already observed native session; never create a replacement.
    pub async fn recover(dispatch: &Dispatch, config: &Config) -> Result<Self> {
        let stored = Path::new(&config.state_dir)
            .join(sha256(dispatch.run_id.as_bytes()))
            .join("native.session");
        ensure!(
            dispatch.native_session.is_some() || stored.is_file(),
            "native session unknown; reconciliation cannot launch a replacement"
        );
        Self::start(dispatch, config).await
    }
    /// Returns true only for first dispatch intent. Response success is NOT ACK.
    /// A duplicate invokes no model and must use observe() to reconcile native facts.
    pub async fn deliver(&mut self, dispatch: &Dispatch) -> Result<bool> {
        ensure!(
            dispatch.run_id == self.run_id
                && sha256(&serde_json::to_vec(&dispatch.task)?) == self.task_sha256,
            "native owner/loadout changed; explicit handoff required"
        );
        let payload = serde_json::to_string(&self.input(dispatch))?;
        let intent = self
            .root
            .join(format!("{}.intent", sha256(dispatch.attempt_id.as_bytes())));
        if !immutable(&intent, payload.as_bytes())? {
            return Ok(false);
        }
        let state = self.command(json!({"type":"get_state"})).await?;
        ensure!(
            state["isStreaming"] == false && state["pendingMessageCount"] == 0,
            "native session busy; attempt uncertain, no blind retry"
        );
        self.command(json!({"type":"prompt","message":format!("/summon-native-input {payload}")}))
            .await?;
        Ok(true)
    }
    pub async fn wait_settled(&mut self, before: u64) -> Result<()> {
        while self.settled_count <= before {
            self.next_event()
                .await?
                .context("native exit before settled; uncertain")?;
        }
        Ok(())
    }
    /// Requests abort of this exact owned native attempt. Native abort response is
    /// an idle/cancellation fact, NOT process termination or successful completion.
    pub async fn request_abort(
        &mut self,
        request: &CancelRequest,
        dispatch: &Dispatch,
    ) -> Result<()> {
        ensure!(
            request.input_id == dispatch.input_id
                && request.attempt_id == dispatch.attempt_id
                && !request.authority_ref.is_empty(),
            "cancel must name exact owned attempt and source authority"
        );
        self.command(json!({"type":"clear_queue"})).await?;
        self.command(json!({"type":"abort"})).await?;
        Ok(())
    }
    pub async fn observe(
        &mut self,
        dispatch: &Dispatch,
        revision: u64,
    ) -> Result<Vec<ObserveRequest>> {
        ensure!(
            dispatch.run_id == self.run_id
                && sha256(&serde_json::to_vec(&dispatch.task)?) == self.task_sha256,
            "native owner/loadout mismatch"
        );
        let payload = serde_json::to_string(&self.input(dispatch))?;
        self.command(
            json!({"type":"prompt","message":format!("/summon-native-receipt {payload}")}),
        )
        .await?;
        let data = self.command(json!({"type":"get_entries"})).await?;
        let branch = active_branch(&data)?;
        let expected = serde_json::to_value(self.input(dispatch))?;
        let message = branch.iter().position(|e| {
            e["type"] == "custom_message"
                && e["customType"] == "summon.pi.input.v1"
                && e["details"] == expected
                && e["content"] == dispatch.text
        });
        let receipt = branch.iter().find(|e| {
            e["type"] == "custom"
                && e["customType"] == "summon.pi.receipt.v1"
                && e["data"]["attemptId"] == dispatch.attempt_id
        });
        let make = |suffix: &str, observation, expected_revision| ObserveRequest {
            event_id: format!("{}:{suffix}", dispatch.attempt_id),
            input_id: dispatch.input_id.clone(),
            attempt_id: dispatch.attempt_id.clone(),
            text_sha256: dispatch.text_sha256.clone(),
            expected_revision,
            observation,
        };
        let Some((position, receipt)) = message.zip(receipt) else {
            return Ok(vec![make(
                "uncertain",
                Observation::Uncertain {
                    reason: "no exact durable active-branch native ACK; never resend".into(),
                    evidence_ref: format!("pi:{}", self.session.session_file),
                },
                revision,
            )]);
        };
        ensure!(
            receipt["data"]["messageEntryId"] == branch[position]["id"],
            "native receipt/message conflict"
        );
        // The SDK command verified disk and fsynced before persisting this receipt.
        let native = NativeReceipt {
            session: self.session.clone(),
            native_message_ref: branch[position]["id"]
                .as_str()
                .context("native message ID missing")?
                .into(),
            evidence_ref: format!(
                "pi:{}#{}",
                self.session.session_file,
                receipt["id"]
                    .as_str()
                    .context("native receipt ID missing")?
            ),
        };
        let answer = branch[position + 1..]
            .iter()
            .take_while(|e| {
                e["type"] != "custom_message"
                    && !(e["type"] == "message" && e["message"]["role"] == "user")
            })
            .filter(|e| e["type"] == "message" && e["message"]["role"] == "assistant")
            .last();
        if let Some(answer) = answer.filter(|e| e["message"]["stopReason"] == "stop") {
            let text = answer["message"]["content"]
                .as_array()
                .context("assistant content missing")?
                .iter()
                .filter_map(|b| {
                    if b["type"] == "text" {
                        b["text"].as_str()
                    } else {
                        None
                    }
                })
                .collect::<Vec<_>>()
                .join("\n");
            if !text.trim().is_empty() {
                return Ok(vec![make(
                    "answer",
                    Observation::Answered {
                        receipt: native,
                        text,
                        answer_ref: format!(
                            "pi:{}#{}",
                            self.session.session_file,
                            answer["id"]
                                .as_str()
                                .context("assistant entry ID missing")?
                        ),
                    },
                    revision,
                )]);
            }
        }
        Ok(vec![make(
            "ack",
            Observation::Acknowledged { receipt: native },
            revision,
        )])
    }
    /// Only waiting this owned child proves its exit. No timeout/lease/signal guess.
    pub async fn shutdown(self) -> Result<Termination> {
        let Self {
            mut child,
            stdin,
            mut stdout,
            session,
            _lock,
            ..
        } = self;
        // AsyncWrite::shutdown on ChildStdin does not close the pipe. Drop the
        // actual owned handle, continue draining stdout, and retain the lock
        // until the owned native process has really exited.
        drop(stdin);
        let pid = child.id().context("missing owned native PID")?;
        while record(&mut stdout).await?.is_some() {}
        let status = child.wait().await?;
        drop(_lock);
        Ok(Termination {
            session,
            evidence_ref: format!("owned-pi-exit:pid={pid}:status={status}"),
        })
    }
}

/// Optional synchronous protocol boundary. The owning caller supplies current DO
/// revision and admission; returned observations must be committed by that owner.
/// Live cancellation during a blocked invoke uses NativePi/CLI's async control path.
pub struct Adapter {
    config: Config,
    revision: u64,
    runtime: tokio::runtime::Runtime,
    process: Option<NativePi>,
}
impl Adapter {
    pub fn new(config: Config, revision: u64) -> Result<Self> {
        Ok(Self {
            config,
            revision,
            runtime: tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()?,
            process: None,
        })
    }
    pub fn set_revision(&mut self, revision: u64) {
        self.revision = revision;
    }
    pub fn shutdown(&mut self) -> Result<Option<Termination>> {
        self.process
            .take()
            .map(|process| self.runtime.block_on(process.shutdown()))
            .transpose()
    }
}
impl summon_protocol::RuntimeAdapter for Adapter {
    type Error = anyhow::Error;
    fn invoke(&mut self, dispatch: &Dispatch) -> Result<Vec<ObserveRequest>> {
        if self.process.is_none() {
            self.process = Some(
                self.runtime
                    .block_on(NativePi::start(dispatch, &self.config))?,
            );
        }
        let process = self.process.as_mut().unwrap();
        self.runtime.block_on(async {
            let before = process.settled_count;
            if process.deliver(dispatch).await? {
                process.wait_settled(before).await?;
            }
            process.observe(dispatch, self.revision).await
        })
    }
    fn reconcile(&mut self, dispatch: &Dispatch) -> Result<Vec<ObserveRequest>> {
        if self.process.is_none() {
            self.process = Some(
                self.runtime
                    .block_on(NativePi::recover(dispatch, &self.config))?,
            );
        }
        self.runtime.block_on(
            self.process
                .as_mut()
                .unwrap()
                .observe(dispatch, self.revision),
        )
    }
    fn cancel(
        &mut self,
        request: &CancelRequest,
        dispatch: &Dispatch,
    ) -> Result<Vec<ObserveRequest>> {
        let process = self
            .process
            .as_mut()
            .context("native owner unavailable; cancellation/termination unknown")?;
        self.runtime.block_on(async {
            process.request_abort(request, dispatch).await?;
            process.observe(dispatch, self.revision).await
        })
    }
}

pub fn active_branch(data: &Value) -> Result<Vec<Value>> {
    let entries = data["entries"]
        .as_array()
        .context("native entries missing")?;
    let mut cursor = data["leafId"].as_str();
    let mut branch = Vec::new();
    while let Some(id) = cursor {
        ensure!(branch.len() <= entries.len(), "native branch cycle");
        let entry = entries
            .iter()
            .find(|e| e["id"] == id)
            .context("native active branch parent missing")?;
        branch.push(entry.clone());
        cursor = entry["parentId"].as_str();
    }
    branch.reverse();
    Ok(branch)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn dispatch(root: &Path) -> Dispatch {
        serde_json::from_value(json!({"run_id":"cf1:native","input_id":"input-1","attempt_id":"claim-1","runner_id":"runner","text":"Read supplied source.","text_sha256":sha256(b"Read supplied source."),"native_session":null,"task":{"id":"cf1:native","kind":"research","brief":"Read supplied source.","workspace":root,"route":{"harness":"pi","provider":"openai-codex","model":"exact-model","effort":"high"},"checks":[],"outputs":[]}})).unwrap()
    }
    #[test]
    fn context_selections_and_exact_resume_guards_reach_native_args() -> Result<()> {
        let root = tempfile::tempdir()?;
        let extension = root.path().join("native-input.ts");
        fs::write(&extension, "fixture")?;
        let config = Config {
            host: "local".into(),
            state_dir: root.path().to_string_lossy().into(),
            extension: extension.to_string_lossy().into(),
        };
        let native = NativeSession {
            runtime: "pi".into(),
            host: "local".into(),
            session_id: "native-1".into(),
            session_file: "/missing/session.jsonl".into(),
        };
        let mut d = dispatch(root.path());
        let defaults = native_args(&d, &config, &native, false, root.path())?;
        assert!(!defaults.contains(&"--no-context-files".into()));
        assert!(!defaults.contains(&"--no-skills".into()));
        d.task.context = Some(summon_protocol::Context {
            instructions: Some(vec![]),
            skills: Some(vec![]),
        });
        let empty = native_args(&d, &config, &native, false, root.path())?;
        assert!(empty.contains(&"--no-context-files".into()));
        assert!(empty.contains(&"--no-skills".into()));
        assert!(native_args(&d, &config, &native, true, root.path()).is_err());
        d.task.context.as_mut().unwrap().instructions =
            Some(vec!["Frozen task-specific instruction.".into()]);
        assert!(native_args(&d, &config, &native, false, root.path())?
            .contains(&"Frozen task-specific instruction.".into()));
        d.task.route.provider = "openrouter".into();
        assert!(native_args(&d, &config, &native, false, root.path()).is_err());
        Ok(())
    }
    #[tokio::test]
    #[ignore = "opt-in installed Pi startup/owned-exit walk; no model prompt"]
    async fn installed_native_startup_and_owned_exit_without_model_call() -> Result<()> {
        let scratch = std::env::var("TMPDIR").context("run-scoped TMPDIR required")?;
        let root = tempfile::Builder::new()
            .prefix("native-rpc-start-")
            .tempdir_in(scratch)?;
        fs::set_permissions(root.path(), fs::Permissions::from_mode(0o700))?;
        let mut d = dispatch(root.path());
        d.task.route.model =
            std::env::var("NATIVE_PI_MODEL").context("exact configured native model required")?;
        d.task.context = Some(summon_protocol::Context {
            instructions: Some(vec![]),
            skills: Some(vec![]),
        });
        let config = Config {
            host: "local-startup-proof".into(),
            state_dir: root.path().to_string_lossy().into(),
            extension: std::env::var("NATIVE_PI_EXTENSION")
                .context("explicit native SDK source required")?,
        };
        let mut native = NativePi::start(&d, &config).await?;
        let commands = native.command(json!({"type":"get_commands"})).await?;
        assert!(commands["commands"]
            .as_array()
            .unwrap()
            .iter()
            .all(|c| c["source"] != "skill"));
        assert_eq!(
            native.settled_count, 0,
            "startup must not invent a model run"
        );
        let state = native.command(json!({"type":"get_state"})).await?;
        assert_eq!(state["messageCount"], 0);
        let termination = native.shutdown().await?;
        assert_eq!(termination.session.runtime, "pi");
        assert!(termination.evidence_ref.starts_with("owned-pi-exit:"));
        // Pi has not created a transcript without user/model conversation. Exact
        // recovery must refuse rather than manufacture a resumed session.
        assert!(NativePi::recover(&d, &config).await.is_err());
        Ok(())
    }
    #[test]
    fn native_active_branch_excludes_abandoned_ack_history() -> Result<()> {
        let data = json!({"leafId":"new","entries":[{"id":"root","parentId":null},{"id":"abandoned-receipt","parentId":"root"},{"id":"new","parentId":"root"}]});
        let branch = active_branch(&data)?;
        assert_eq!(branch.len(), 2);
        assert_eq!(branch[1]["id"], "new");
        Ok(())
    }
    #[test]
    fn immutable_native_intent_never_becomes_retry_permission() -> Result<()> {
        let root = tempfile::tempdir()?;
        let path = root.path().join("attempt.intent");
        assert!(immutable(&path, b"exact")?);
        assert!(!immutable(&path, b"exact")?);
        assert!(immutable(&path, b"changed").is_err());
        Ok(())
    }
}
