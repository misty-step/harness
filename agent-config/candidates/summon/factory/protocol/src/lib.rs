//! Summon owns ordered input and proof bindings. Native runtimes own execution facts.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

pub const VERSION: u32 = 1;
pub type Result<T> = std::result::Result<T, Refusal>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Refusal {
    pub code: String,
    pub message: String,
}
fn refuse<T>(code: &str, message: &str) -> Result<T> {
    Err(Refusal {
        code: code.into(),
        message: message.into(),
    })
}
fn nonempty(s: &str) -> Result<()> {
    if s.trim().is_empty() || s.chars().any(char::is_control) || s.len() > 4096 {
        return refuse(
            "invalid_input",
            "identity/reference must be nonempty, bounded and without control characters",
        );
    }
    Ok(())
}
fn text(s: &str) -> Result<()> {
    if s.trim().is_empty() || s.contains('\0') || s.len() > 65536 {
        return refuse(
            "invalid_input",
            "text must be nonempty, without NUL and at most 64KiB",
        );
    }
    Ok(())
}
fn digest(s: &str) -> Result<()> {
    if s.len() != 64
        || !s
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return refuse("invalid_input", "digest must be lowercase SHA-256");
    }
    Ok(())
}
pub fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn hash<T: Serialize>(value: &T) -> String {
    sha256(&serde_json::to_vec(value).expect("protocol values serialize"))
}
pub fn validate_run_id(id: &str) -> Result<()> {
    if !id.starts_with("cf1:")
        || id.len() <= 4
        || id.len() > 128
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_:".contains(&b))
    {
        return refuse(
            "invalid_run_id",
            "pilot IDs use cf1:<opaque ASCII id>; never import TS-owned runs",
        );
    }
    Ok(())
}
fn path(s: &str) -> Result<()> {
    if s.contains('\\') || s.split('/').any(|p| p.is_empty() || p == "." || p == "..") {
        return refuse(
            "invalid_input",
            "outputs must be relative paths without traversal",
        );
    }
    nonempty(s)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskKind {
    Implementation,
    Research,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Route {
    pub harness: String,
    pub provider: String,
    pub model: String,
    pub effort: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Source {
    pub adapter: String,
    pub id: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum Check {
    Command {
        id: String,
        argv: Vec<String>,
        issuers: Vec<String>,
    },
    Review {
        id: String,
        criterion: String,
        issuers: Vec<String>,
    },
}
impl Check {
    pub fn id(&self) -> &str {
        match self {
            Self::Command { id, .. } | Self::Review { id, .. } => id,
        }
    }
    fn issuers(&self) -> &[String] {
        match self {
            Self::Command { issuers, .. } | Self::Review { issuers, .. } => issuers,
        }
    }
}
/// Instructions/skills are frozen references or inline text chosen by the commissioner.
/// None means native defaults; Some([]) means none. This cannot override runtime permissions.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Context {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub instructions: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skills: Option<Vec<String>>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct TaskSpec {
    pub id: String,
    pub kind: TaskKind,
    pub brief: String,
    pub workspace: String,
    pub route: Route,
    pub checks: Vec<Check>,
    pub outputs: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<Source>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub commission_ref: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context: Option<Context>,
}
impl TaskSpec {
    pub fn validate(&self) -> Result<()> {
        validate_run_id(&self.id)?;
        text(&self.brief)?;
        nonempty(&self.workspace)?;
        if !self.workspace.starts_with('/') {
            return refuse(
                "invalid_input",
                "workspace must be absolute; runner validates existence/confinement",
            );
        }
        for s in [
            &self.route.harness,
            &self.route.provider,
            &self.route.model,
            &self.route.effort,
        ] {
            nonempty(s)?;
        }
        if let Some(s) = &self.source {
            nonempty(&s.adapter)?;
            nonempty(&s.id)?;
        }
        if let Some(s) = &self.commission_ref {
            nonempty(s)?;
        }
        if let Some(c) = &self.context {
            for values in [&c.instructions, &c.skills].into_iter().flatten() {
                for s in values {
                    text(s)?;
                }
            }
        }
        let mut ids = BTreeSet::new();
        for check in &self.checks {
            nonempty(check.id())?;
            if !ids.insert(check.id()) || check.issuers().is_empty() {
                return refuse(
                    "invalid_input",
                    "checks require unique IDs and explicit allowed issuers",
                );
            }
            for s in check.issuers() {
                nonempty(s)?;
            }
            match check {
                Check::Command { argv, .. } => {
                    if argv.is_empty() {
                        return refuse("invalid_input", "command check needs explicit argv");
                    }
                    nonempty(&argv[0])?;
                    for s in argv {
                        if s.contains('\0') {
                            return refuse("invalid_input", "argv contains NUL");
                        }
                    }
                }
                Check::Review { criterion, .. } => text(criterion)?,
            }
        }
        let mut paths = BTreeSet::new();
        for s in &self.outputs {
            path(s)?;
            if !paths.insert(s) {
                return refuse("invalid_input", "duplicate output path");
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DeliveryState {
    Queued,
    Dispatching,
    Acknowledged,
    Answered,
    Uncertain,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    Implementing,
    Researching,
    AwaitingReview,
    VerifiedDelivery,
    Interrupted,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct NativeSession {
    pub runtime: String,
    pub host: String,
    pub session_id: String,
    pub session_file: String,
}
impl NativeSession {
    fn validate(&self) -> Result<()> {
        for s in [
            &self.runtime,
            &self.host,
            &self.session_id,
            &self.session_file,
        ] {
            nonempty(s)?;
        }
        Ok(())
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct NativeReceipt {
    pub session: NativeSession,
    pub native_message_ref: String,
    pub evidence_ref: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Input {
    pub input_id: String,
    pub text: String,
    pub text_sha256: String,
    pub state: DeliveryState,
    pub attempt_id: Option<String>,
    pub acknowledged: Option<NativeReceipt>,
    pub answer: Option<String>,
    pub answer_ref: Option<String>,
    pub uncertainty: Option<String>,
    pub termination: Option<Termination>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Intake {
    pub task: TaskSpec,
    pub initial_input_id: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct InputRequest {
    pub input_id: String,
    pub text: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ClaimRequest {
    pub claim_id: String,
    pub runner_id: String,
    pub expected_revision: u64,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Dispatch {
    pub run_id: String,
    pub input_id: String,
    pub attempt_id: String,
    pub runner_id: String,
    pub text: String,
    pub text_sha256: String,
    pub task: TaskSpec,
    pub native_session: Option<NativeSession>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct ClaimRecord {
    request: ClaimRequest,
    dispatch: Dispatch,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Artifact {
    pub path: String,
    pub sha256: String,
}
/// Complete immutable workspace snapshot, NOT just HEAD plus declared outputs.
/// A trusted verifier must materialize and hash this snapshot before issuing checks.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Delivery {
    pub workspace_sha256: String,
    pub revision: Option<String>,
    pub artifacts: Vec<Artifact>,
    pub evidence_ref: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Observation {
    Acknowledged {
        receipt: NativeReceipt,
    },
    Answered {
        receipt: NativeReceipt,
        text: String,
        answer_ref: String,
    },
    Uncertain {
        reason: String,
        evidence_ref: String,
    },
    Terminated {
        termination: Termination,
    },
    Delivery {
        delivery: Delivery,
    },
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ObserveRequest {
    pub event_id: String,
    pub input_id: String,
    pub attempt_id: String,
    pub text_sha256: String,
    pub expected_revision: u64,
    pub observation: Observation,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Termination {
    pub session: NativeSession,
    pub evidence_ref: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CancelRequest {
    pub cancel_id: String,
    pub input_id: String,
    pub attempt_id: String,
    pub reason: String,
    pub authority_ref: String,
    pub expected_revision: u64,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Action {
    Dispatch,
    Verify,
    Release,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct HoldRequest {
    pub hold_id: String,
    pub action: Action,
    pub reason: String,
    pub authority_ref: String,
    pub active: bool,
    pub expected_revision: u64,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Verdict {
    Pass,
    Block,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProofRequest {
    pub proof_id: String,
    pub check_id: String,
    pub coverage_sha256: String,
    pub issuer: String,
    pub verdict: Verdict,
    pub evidence_ref: String,
    pub expected_revision: u64,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Run {
    pub protocol_version: u32,
    pub revision: u64,
    pub task: TaskSpec,
    pub manifest_sha256: String,
    pub initial_input_id: String,
    pub inputs: Vec<Input>,
    pub native_session: Option<NativeSession>,
    pub delivery: Option<Delivery>,
    pub holds: BTreeMap<String, HoldRequest>,
    pub cancellations: BTreeMap<String, CancelRequest>,
    pub proofs: Vec<ProofRequest>,
    claims: BTreeMap<String, ClaimRecord>,
    observations: BTreeMap<String, ObserveRequest>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Status {
    pub protocol_version: u32,
    pub authority: String,
    pub revision: u64,
    pub phase: Phase,
    pub run_id: String,
    pub task: TaskSpec,
    pub manifest_sha256: String,
    pub inputs: Vec<Input>,
    pub native_session: Option<NativeSession>,
    pub delivery: Option<Delivery>,
    pub coverage_sha256: Option<String>,
    pub holds: Vec<HoldRequest>,
    pub cancellations: Vec<CancelRequest>,
    pub proofs: Vec<ProofRequest>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Reply {
    pub run: Status,
    pub dispatch: Option<Dispatch>,
    pub replayed: bool,
}

impl Run {
    pub fn intake(request: Intake) -> Result<Self> {
        request.task.validate()?;
        nonempty(&request.initial_input_id)?;
        let input = Input::queued(request.initial_input_id.clone(), request.task.brief.clone());
        Ok(Self {
            protocol_version: VERSION,
            revision: 1,
            manifest_sha256: hash(&request.task),
            task: request.task,
            initial_input_id: request.initial_input_id,
            inputs: vec![input],
            native_session: None,
            delivery: None,
            holds: BTreeMap::new(),
            cancellations: BTreeMap::new(),
            proofs: vec![],
            claims: BTreeMap::new(),
            observations: BTreeMap::new(),
        })
    }
    pub fn same_intake(&self, request: &Intake) -> Result<()> {
        if self.task != request.task || self.initial_input_id != request.initial_input_id {
            return refuse(
                "intake_conflict",
                "run ID already binds a different immutable task/input ID",
            );
        }
        Ok(())
    }
    fn revision(&self, expected: u64) -> Result<()> {
        if self.revision != expected {
            return refuse(
                "revision_conflict",
                "read status and reconcile against the current revision",
            );
        }
        Ok(())
    }
    fn held(&self, action: Action) -> Result<()> {
        if self.holds.values().any(|h| h.active && h.action == action) {
            return refuse("action_held", "an active hold blocks this action only");
        }
        Ok(())
    }
    fn ready(&self) -> bool {
        !self.inputs.is_empty()
            && self
                .inputs
                .iter()
                .all(|i| i.state == DeliveryState::Answered)
    }
    pub fn coverage(&self) -> Option<String> {
        if !self.ready() {
            return None;
        }
        self.delivery
            .as_ref()
            .map(|d| hash(&(&self.manifest_sha256, &self.inputs, d)))
    }
    pub fn phase(&self) -> Phase {
        if self
            .inputs
            .iter()
            .any(|i| i.state == DeliveryState::Uncertain)
        {
            return Phase::Interrupted;
        }
        if !self.ready() {
            return match self.task.kind {
                TaskKind::Implementation => Phase::Implementing,
                TaskKind::Research => Phase::Researching,
            };
        }
        if let Some(coverage) = self.coverage() {
            let pass = !self.task.checks.is_empty()
                && self.task.checks.iter().all(|check| {
                    self.proofs
                        .iter()
                        .rev()
                        .find(|p| p.check_id == check.id() && p.coverage_sha256 == coverage)
                        .is_some_and(|p| p.verdict == Verdict::Pass)
                });
            if pass && self.held(Action::Verify).is_ok() {
                return Phase::VerifiedDelivery;
            }
        }
        Phase::AwaitingReview
    }
    pub fn status(&self) -> Status {
        Status {
            protocol_version: VERSION,
            authority: "summon_do".into(),
            revision: self.revision,
            phase: self.phase(),
            run_id: self.task.id.clone(),
            task: self.task.clone(),
            manifest_sha256: self.manifest_sha256.clone(),
            inputs: self.inputs.clone(),
            native_session: self.native_session.clone(),
            delivery: self.delivery.clone(),
            coverage_sha256: self.coverage(),
            holds: self.holds.values().cloned().collect(),
            cancellations: self.cancellations.values().cloned().collect(),
            proofs: self.proofs.clone(),
        }
    }
    pub fn reply(&self, dispatch: Option<Dispatch>, replayed: bool) -> Reply {
        Reply {
            run: self.status(),
            dispatch,
            replayed,
        }
    }
    pub fn input(&mut self, request: InputRequest) -> Result<bool> {
        nonempty(&request.input_id)?;
        text(&request.text)?;
        if let Some(input) = self.inputs.iter().find(|i| i.input_id == request.input_id) {
            if input.text != request.text {
                return refuse("input_conflict", "input ID already binds different text");
            }
            return Ok(true);
        }
        self.inputs
            .push(Input::queued(request.input_id, request.text));
        self.delivery = None;
        self.revision += 1;
        Ok(false)
    }
    pub fn claim(&mut self, request: ClaimRequest) -> Result<(Dispatch, bool)> {
        nonempty(&request.claim_id)?;
        nonempty(&request.runner_id)?;
        if let Some(old) = self.claims.get(&request.claim_id) {
            if old.request != request {
                return refuse(
                    "claim_conflict",
                    "claim ID already binds different arguments",
                );
            }
            return Ok((old.dispatch.clone(), true));
        }
        self.revision(request.expected_revision)?;
        self.held(Action::Dispatch)?;
        if self.inputs.iter().any(|i| {
            matches!(
                i.state,
                DeliveryState::Dispatching | DeliveryState::Acknowledged | DeliveryState::Uncertain
            )
        }) {
            return refuse(
                "reconciliation_required",
                "possible native dispatch blocks all further claims; age never grants takeover",
            );
        }
        if self
            .inputs
            .iter()
            .any(|i| i.state == DeliveryState::Answered)
            && self.native_session.is_none()
        {
            return refuse(
                "session_unavailable",
                "resume requires the observed native session",
            );
        }
        let input = self
            .inputs
            .iter_mut()
            .find(|i| i.state == DeliveryState::Queued)
            .ok_or_else(|| Refusal {
                code: "nothing_queued".into(),
                message: "no queued input".into(),
            })?;
        input.state = DeliveryState::Dispatching;
        input.attempt_id = Some(request.claim_id.clone());
        let dispatch = Dispatch {
            run_id: self.task.id.clone(),
            input_id: input.input_id.clone(),
            attempt_id: request.claim_id.clone(),
            runner_id: request.runner_id.clone(),
            text: input.text.clone(),
            text_sha256: input.text_sha256.clone(),
            task: self.task.clone(),
            native_session: self.native_session.clone(),
        };
        self.claims.insert(
            request.claim_id.clone(),
            ClaimRecord {
                request,
                dispatch: dispatch.clone(),
            },
        );
        self.revision += 1;
        Ok((dispatch, false))
    }
    /// Both endpoints share receipt deduplication. Reconcile permits definitive native facts,
    /// never a claim that an ambiguous input was unsent and never a retry authorization.
    pub fn observe(&mut self, request: ObserveRequest, reconcile: bool) -> Result<bool> {
        nonempty(&request.event_id)?;
        if let Some(old) = self.observations.get(&request.event_id) {
            if old != &request {
                return refuse(
                    "event_conflict",
                    "event ID already binds different native facts",
                );
            }
            return Ok(true);
        }
        self.revision(request.expected_revision)?;
        let index = self
            .inputs
            .iter()
            .position(|i| i.input_id == request.input_id)
            .ok_or_else(|| Refusal {
                code: "unknown_input".into(),
                message: "input ID not found".into(),
            })?;
        let input = &self.inputs[index];
        if input.attempt_id.as_deref() != Some(&request.attempt_id)
            || input.text_sha256 != request.text_sha256
        {
            return refuse(
                "native_mismatch",
                "native facts must bind exact attempt/input payload",
            );
        }
        if input.state == DeliveryState::Queued {
            return refuse("not_dispatched", "queued is not delivered");
        }
        if reconcile && input.state != DeliveryState::Uncertain {
            return refuse(
                "reconcile_refused",
                "only uncertain input may be reconciled",
            );
        }
        if !reconcile
            && input.state == DeliveryState::Uncertain
            && !matches!(request.observation, Observation::Terminated { .. })
        {
            return refuse(
                "reconciliation_required",
                "uncertain input needs explicit reconciliation",
            );
        }
        match &request.observation {
            Observation::Acknowledged { receipt } | Observation::Answered { receipt, .. } => {
                receipt.session.validate()?;
                nonempty(&receipt.native_message_ref)?;
                nonempty(&receipt.evidence_ref)?;
                if receipt.session.runtime != self.task.route.harness
                    || self
                        .native_session
                        .as_ref()
                        .is_some_and(|s| s != &receipt.session)
                    || input.acknowledged.as_ref().is_some_and(|r| {
                        r.session != receipt.session
                            || r.native_message_ref != receipt.native_message_ref
                    })
                {
                    return refuse(
                        "session_mismatch",
                        "native session/message identity cannot change",
                    );
                }
                if input.state == DeliveryState::Answered {
                    return refuse(
                        "already_answered",
                        "answer is immutable; use original event ID for retries",
                    );
                }
                if let Observation::Answered {
                    text: answer,
                    answer_ref,
                    ..
                } = &request.observation
                {
                    text(answer)?;
                    nonempty(answer_ref)?;
                }
                self.native_session = Some(receipt.session.clone());
                let input = &mut self.inputs[index];
                input.acknowledged = Some(receipt.clone());
                input.uncertainty = None;
                if let Observation::Answered {
                    text, answer_ref, ..
                } = &request.observation
                {
                    input.state = DeliveryState::Answered;
                    input.answer = Some(text.clone());
                    input.answer_ref = Some(answer_ref.clone());
                } else {
                    input.state = DeliveryState::Acknowledged;
                }
            }
            Observation::Uncertain {
                reason,
                evidence_ref,
            } => {
                text(reason)?;
                nonempty(evidence_ref)?;
                if reconcile || input.state == DeliveryState::Answered {
                    return refuse(
                        "invalid_observation",
                        "uncertainty cannot erase a final answer or resolve uncertainty",
                    );
                }
                self.inputs[index].state = DeliveryState::Uncertain;
                self.inputs[index].uncertainty = Some(format!("{reason} [{evidence_ref}]"));
            }
            Observation::Terminated { termination } => {
                termination.session.validate()?;
                nonempty(&termination.evidence_ref)?;
                if reconcile
                    || termination.session.runtime != self.task.route.harness
                    || self
                        .native_session
                        .as_ref()
                        .is_some_and(|s| s != &termination.session)
                {
                    return refuse(
                        "termination_refused",
                        "termination requires exact independently observed native identity; not reconciliation",
                    );
                }
                self.native_session = Some(termination.session.clone());
                let input = &mut self.inputs[index];
                input.termination = Some(termination.clone());
                if input.state != DeliveryState::Answered {
                    input.state = DeliveryState::Uncertain;
                    input.uncertainty = Some(
                        "native termination observed, but input/answer delivery remains ambiguous"
                            .into(),
                    );
                }
            }
            Observation::Delivery { delivery } => {
                if reconcile || !self.ready() {
                    return refuse(
                        "delivery_not_ready",
                        "delivery snapshot requires every input answered",
                    );
                }
                digest(&delivery.workspace_sha256)?;
                nonempty(&delivery.evidence_ref)?;
                if let Some(r) = &delivery.revision {
                    nonempty(r)?;
                }
                let mut paths = BTreeSet::new();
                for artifact in &delivery.artifacts {
                    path(&artifact.path)?;
                    digest(&artifact.sha256)?;
                    if !paths.insert(&artifact.path) {
                        return refuse("invalid_input", "duplicate artifact");
                    }
                }
                if self.task.outputs.iter().any(|p| !paths.contains(p)) {
                    return refuse(
                        "missing_output",
                        "delivery must cover every declared output",
                    );
                }
                self.delivery = Some(delivery.clone());
            }
        }
        self.observations.insert(request.event_id.clone(), request);
        self.revision += 1;
        Ok(false)
    }
    pub fn cancel(&mut self, request: CancelRequest) -> Result<bool> {
        nonempty(&request.cancel_id)?;
        text(&request.reason)?;
        nonempty(&request.authority_ref)?;
        if let Some(old) = self.cancellations.get(&request.cancel_id) {
            if old != &request {
                return refuse(
                    "cancel_conflict",
                    "cancel ID already binds different request",
                );
            }
            return Ok(true);
        }
        self.revision(request.expected_revision)?;
        if !self.inputs.iter().any(|i| {
            i.input_id == request.input_id
                && i.attempt_id.as_deref() == Some(&request.attempt_id)
                && matches!(
                    i.state,
                    DeliveryState::Dispatching
                        | DeliveryState::Acknowledged
                        | DeliveryState::Uncertain
                )
        }) {
            return refuse(
                "cancel_refused",
                "cancel must target exact possibly active attempt",
            );
        }
        self.cancellations
            .insert(request.cancel_id.clone(), request);
        self.revision += 1;
        Ok(false)
    }
    pub fn hold(&mut self, request: HoldRequest) -> Result<bool> {
        nonempty(&request.hold_id)?;
        text(&request.reason)?;
        nonempty(&request.authority_ref)?;
        if self.holds.get(&request.hold_id) == Some(&request) {
            return Ok(true);
        }
        self.revision(request.expected_revision)?;
        if let Some(old) = self.holds.get(&request.hold_id) {
            if old.action != request.action || old.authority_ref != request.authority_ref {
                return refuse("hold_conflict", "hold action and authority cannot change");
            }
        }
        self.holds.insert(request.hold_id.clone(), request);
        self.revision += 1;
        Ok(false)
    }
    pub fn proof(&mut self, request: ProofRequest) -> Result<bool> {
        nonempty(&request.proof_id)?;
        nonempty(&request.evidence_ref)?;
        digest(&request.coverage_sha256)?;
        if let Some(old) = self.proofs.iter().find(|p| p.proof_id == request.proof_id) {
            if old != &request {
                return refuse("proof_conflict", "proof ID already binds different receipt");
            }
            return Ok(true);
        }
        self.revision(request.expected_revision)?;
        self.held(Action::Verify)?;
        let check = self
            .task
            .checks
            .iter()
            .find(|c| c.id() == request.check_id)
            .ok_or_else(|| Refusal {
                code: "unknown_check".into(),
                message: "task did not require this check".into(),
            })?;
        if !check.issuers().contains(&request.issuer) {
            return refuse(
                "issuer_refused",
                "issuer is not allowed by frozen task check policy",
            );
        }
        if self.coverage().as_deref() != Some(&request.coverage_sha256) {
            return refuse(
                "stale_proof",
                "proof does not bind current complete delivery/input/task snapshot",
            );
        }
        self.proofs.push(request);
        self.revision += 1;
        Ok(false)
    }
}
impl Input {
    fn queued(input_id: String, text: String) -> Self {
        Self {
            input_id,
            text_sha256: sha256(text.as_bytes()),
            text,
            state: DeliveryState::Queued,
            attempt_id: None,
            acknowledged: None,
            answer: None,
            answer_ref: None,
            uncertainty: None,
            termination: None,
        }
    }
}

/// Replaceable native boundary. No ledger, permission override, fallback, or effect broker.
/// Invoke only a fresh (replayed=false) claim, through a durable local transport spool.
/// Implementations validate workspace, frozen context, native route and permissions before use.
pub trait RuntimeAdapter {
    type Error;
    fn invoke(
        &mut self,
        dispatch: &Dispatch,
    ) -> std::result::Result<Vec<ObserveRequest>, Self::Error>;
    fn reconcile(
        &mut self,
        dispatch: &Dispatch,
    ) -> std::result::Result<Vec<ObserveRequest>, Self::Error>;
    /// Request native cancellation only; emitted termination facts require independent observation.
    fn cancel(
        &mut self,
        request: &CancelRequest,
        dispatch: &Dispatch,
    ) -> std::result::Result<Vec<ObserveRequest>, Self::Error>;
}
