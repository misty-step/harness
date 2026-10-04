//! Versioned source-backed reads. No projection here mutates a run or owns native facts.
use crate::{NativeSession, Phase, Result, Status, digest, hash, nonempty, refuse};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, VecDeque};

pub const READ_VERSION: u32 = 1;
pub const MAX_RECORDS: usize = 10_000;
pub const MAX_PAGE: usize = 128;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FactState {
    Current,
    Missing,
    Stale,
    Failed,
    Uncertain,
    Cancelled,
    Inaccessible,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct SourceStamp {
    pub owner: String,
    pub reference: String,
    pub read_at_unix_ms: u64,
    pub sha256: Option<String>,
    pub state: FactState,
    pub detail: Option<String>,
}
impl SourceStamp {
    pub fn validate(&self) -> Result<()> {
        nonempty(&self.owner)?;
        nonempty(&self.reference)?;
        if let Some(d) = &self.sha256 {
            digest(d)?;
        }
        if self.state == FactState::Current && self.sha256.is_none() {
            return refuse("invalid_source", "current source requires an exact digest");
        }
        Ok(())
    }
    pub fn unavailable(owner: &str, reference: &str, time: u64, state: FactState) -> Self {
        Self {
            owner: owner.into(),
            reference: reference.into(),
            read_at_unix_ms: time,
            sha256: None,
            state,
            detail: None,
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Fact<T> {
    pub source: SourceStamp,
    pub value: Option<T>,
}
impl<T: Serialize> Fact<T> {
    pub fn current(owner: &str, reference: &str, time: u64, value: T) -> Self {
        Self {
            source: SourceStamp {
                owner: owner.into(),
                reference: reference.into(),
                read_at_unix_ms: time,
                sha256: Some(content_hash(&value)),
                state: FactState::Current,
                detail: None,
            },
            value: Some(value),
        }
    }
    pub fn validate(&self) -> Result<()> {
        self.source.validate()?;
        if self.source.state == FactState::Current && self.value.is_none() {
            return refuse("invalid_source", "current fact requires a value");
        }
        if let Some(value) = &self.value {
            if self.source.sha256.as_deref() != Some(&content_hash(value)) {
                return refuse(
                    "source_digest_mismatch",
                    "fact bytes do not match source digest",
                );
            }
        } else if self.source.sha256.is_some() {
            return refuse("invalid_source", "unavailable fact has no value to bind");
        }
        Ok(())
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct AuthoredRef {
    pub author: String,
    pub source: SourceStamp,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Origin {
    pub agent_id: Option<String>,
    pub brief: String,
    /// Frozen original acceptance text; does not replace the TaskSpec check policy.
    pub acceptance: Vec<String>,
    /// Already-authored rationale/decisions only; no reconstructed private thinking.
    pub rationale: Vec<AuthoredRef>,
    pub decisions: Vec<AuthoredRef>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct RecordIdentity {
    pub agent_id: Option<String>,
    pub run_id: Option<String>,
    pub attempt_id: Option<String>,
    pub native_session: Option<NativeSession>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NativeState {
    Unknown,
    Running,
    Settled,
    Terminated,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RelationKind {
    Child,
    Dependency,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Relation {
    pub edge_id: String,
    pub from: String,
    pub to: String,
    pub kind: RelationKind,
    pub original_source_ref: String,
    pub source: SourceStamp,
}
impl Relation {
    pub fn fact_digest(&self) -> String {
        hash(&(
            &self.edge_id,
            &self.from,
            &self.to,
            &self.kind,
            &self.original_source_ref,
        ))
    }
    pub fn validate(&self) -> Result<()> {
        for s in [
            &self.edge_id,
            &self.from,
            &self.to,
            &self.original_source_ref,
        ] {
            nonempty(s)?;
        }
        self.source.validate()?;
        if self.source.sha256.as_deref() != Some(&self.fact_digest()) {
            return refuse(
                "edge_digest_mismatch",
                "relationship must bind original identity/provenance",
            );
        }
        Ok(())
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct InventoryGap {
    pub reference: String,
    pub state: FactState,
    pub reason: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Lineage {
    pub complete: bool,
    pub unresolved: Vec<InventoryGap>,
    pub edges: Vec<Relation>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceKind {
    Candidate,
    Deliverable,
    Trace,
    Check,
    Review,
    Consumer,
    Authorization,
    Release,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct EvidenceRef {
    pub kind: EvidenceKind,
    pub source: SourceStamp,
    pub candidate_sha256: Option<String>,
    pub coverage_sha256: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ChildPacketRef {
    pub edge_id: String,
    pub node_id: String,
    pub packet: SourceStamp,
    pub child_binding_sha256: Option<String>,
}
/// Additional source metadata, not a second run/status store. Origin is frozen once supplied.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct RunMetadata {
    pub origin: Fact<Origin>,
    pub native: Fact<NativeState>,
    pub lineage: Fact<Lineage>,
    pub evidence: Vec<EvidenceRef>,
    pub child_packets: Vec<ChildPacketRef>,
    /// Later authored technical dispositions; original commission remains frozen.
    #[serde(default)]
    pub decisions: Vec<AuthoredRef>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct MetadataRequest {
    pub expected_run_revision: u64,
    pub expected_metadata_sha256: Option<String>,
    pub metadata: RunMetadata,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Management {
    Summon,
    ObservedOnly,
}
/// ONE read schema for managed runs/attempts and observed-only native agents.
/// managed=None means unknown Summon phase, never an invented managed attempt.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct AgentRunAttemptV1 {
    pub version: u32,
    pub node_id: String,
    pub management: Management,
    pub identity: RecordIdentity,
    pub source: SourceStamp,
    pub managed: Option<Status>,
    pub origin: Fact<Origin>,
    pub native: Fact<NativeState>,
    pub lineage: Fact<Lineage>,
    pub evidence: Vec<EvidenceRef>,
    pub child_packets: Vec<ChildPacketRef>,
    #[serde(default)]
    pub decisions: Vec<AuthoredRef>,
    pub metadata_sha256: Option<String>,
}
impl AgentRunAttemptV1 {
    pub fn from_status(status: Status, metadata: Option<&RunMetadata>, time: u64) -> Self {
        let id = status.run_id.clone();
        let missing = |owner: &str, reference: &str| {
            SourceStamp::unavailable(owner, reference, time, FactState::Missing)
        };
        let origin = metadata.map(|m| m.origin.clone()).unwrap_or(Fact {
            source: missing("commissioner", &format!("{id}/origin")),
            value: None,
        });
        let agent_id = origin.value.as_ref().and_then(|o| o.agent_id.clone());
        let native = metadata.map(|m| m.native.clone()).unwrap_or(Fact {
            source: missing(&status.task.route.harness, &format!("{id}/native")),
            value: None,
        });
        let lineage = metadata.map(|m| m.lineage.clone()).unwrap_or(Fact {
            source: missing(&format!("summon_do:{id}"), &format!("{id}/lineage")),
            value: None,
        });
        Self {
            version: READ_VERSION,
            node_id: id.clone(),
            management: Management::Summon,
            identity: RecordIdentity {
                agent_id,
                run_id: Some(id.clone()),
                attempt_id: None,
                native_session: status.native_session.clone(),
            },
            source: SourceStamp {
                owner: format!("summon_do:{id}"),
                reference: format!("{id}/status@{}", status.revision),
                read_at_unix_ms: time,
                sha256: Some(hash(&status)),
                state: FactState::Current,
                detail: None,
            },
            managed: Some(status),
            origin,
            native,
            lineage,
            evidence: metadata.map(|m| m.evidence.clone()).unwrap_or_default(),
            child_packets: metadata
                .map(|m| m.child_packets.clone())
                .unwrap_or_default(),
            decisions: metadata.map(|m| m.decisions.clone()).unwrap_or_default(),
            metadata_sha256: metadata.map(content_hash),
        }
    }
    pub fn validate(&self) -> Result<()> {
        if self.version != READ_VERSION {
            return refuse("read_version", "unsupported read version");
        }
        nonempty(&self.node_id)?;
        self.source.validate()?;
        for s in [
            &self.identity.agent_id,
            &self.identity.run_id,
            &self.identity.attempt_id,
        ]
        .into_iter()
        .flatten()
        {
            nonempty(s)?;
        }
        if let Some(session) = &self.identity.native_session {
            session.validate()?;
        }
        if let Some(status) = &self.managed {
            if self.management != Management::Summon
                || self.identity.run_id.as_deref() != Some(&status.run_id)
                || self.identity.native_session != status.native_session
                || self.source.owner != format!("summon_do:{}", status.run_id)
                || self.source.sha256.as_deref() != Some(&hash(status))
            {
                return refuse(
                    "identity_conflict",
                    "managed read must reference exact DO run/native identity and bytes",
                );
            }
            if self.identity.attempt_id.as_ref().is_some_and(|a| {
                !status
                    .inputs
                    .iter()
                    .any(|i| i.attempt_id.as_ref() == Some(a))
            }) {
                return refuse(
                    "identity_conflict",
                    "attempt is not a source-owned managed attempt",
                );
            }
        } else if self.management == Management::Summon {
            if self.identity.run_id.is_none()
                || self.source.state == FactState::Current
                || self.identity.attempt_id.is_some()
            {
                return refuse(
                    "identity_conflict",
                    "unavailable managed source needs known run reference, unavailable state and no invented attempt",
                );
            }
        } else if self.identity.run_id.is_some() || self.identity.attempt_id.is_some() {
            return refuse(
                "identity_conflict",
                "observed-only agent cannot invent Summon run/attempt identity",
            );
        } else if self.identity.agent_id.is_none() && self.identity.native_session.is_none() {
            return refuse(
                "identity_conflict",
                "observed-only record requires an actual agent or native identity",
            );
        }
        self.origin.validate()?;
        self.native.validate()?;
        self.lineage.validate()?;
        if let Some(origin) = &self.origin.value {
            crate::text(&origin.brief)?;
            if self
                .managed
                .as_ref()
                .is_some_and(|s| s.task.brief != origin.brief)
            {
                return refuse(
                    "origin_conflict",
                    "descriptive origin cannot replace the immutable TaskSpec brief",
                );
            }
            if origin.agent_id != self.identity.agent_id {
                return refuse("identity_conflict", "frozen origin agent identity differs");
            }
            for r in origin.rationale.iter().chain(&origin.decisions) {
                nonempty(&r.author)?;
                r.source.validate()?;
            }
            for s in &origin.acceptance {
                crate::text(s)?;
            }
        }
        if let Some(lineage) = &self.lineage.value {
            for edge in &lineage.edges {
                edge.validate()?;
            }
            for gap in &lineage.unresolved {
                nonempty(&gap.reference)?;
                crate::text(&gap.reason)?;
            }
        }
        let mut decisions = BTreeSet::new();
        for r in &self.decisions {
            nonempty(&r.author)?;
            r.source.validate()?;
            if !decisions.insert((&r.source.owner, &r.source.reference)) {
                return refuse("identity_conflict", "duplicate authored decision source");
            }
        }
        for e in &self.evidence {
            e.source.validate()?;
            for d in [&e.candidate_sha256, &e.coverage_sha256]
                .into_iter()
                .flatten()
            {
                digest(d)?;
            }
        }
        let mut bound = BTreeSet::new();
        for c in &self.child_packets {
            nonempty(&c.edge_id)?;
            nonempty(&c.node_id)?;
            c.packet.validate()?;
            if let Some(d) = &c.child_binding_sha256 {
                digest(d)?;
            }
            if !bound.insert(&c.edge_id) {
                return refuse("identity_conflict", "duplicate child packet edge binding");
            }
        }
        Ok(())
    }
    /// Read timestamps are audit data, not content freshness. Changing a candidate,
    /// source state/reference/digest, edge or child packet DOES change this binding.
    pub fn binding_sha256(&self) -> String {
        let mut value = serde_json::to_value(self).expect("read schema serializes");
        value.as_object_mut().unwrap().remove("metadata_sha256");
        // Archive bytes/read timestamps may refresh without changing child evidence.
        // The semantic child binding still covers its candidate, facts and descendants.
        for child in value["child_packets"].as_array_mut().unwrap() {
            let source = child["packet"].as_object_mut().unwrap();
            source.remove("sha256");
            source.remove("reference");
        }
        content_hash(&value)
    }
    pub fn local_issues(&self) -> Vec<ReadIssue> {
        let mut out = Vec::new();
        let mut source = |s: &SourceStamp, fact: &str| {
            if s.state != FactState::Current {
                out.push(ReadIssue {
                    node_id: self.node_id.clone(),
                    state: s.state.clone(),
                    reference: s.reference.clone(),
                    reason: fact.into(),
                });
            }
        };
        source(&self.source, "run/agent source not current");
        source(&self.origin.source, "origin not current");
        source(&self.native.source, "native state not current");
        source(&self.lineage.source, "lineage not current");
        for e in &self.evidence {
            source(&e.source, "evidence not current");
        }
        if let Some(o) = &self.origin.value {
            for r in o.rationale.iter().chain(&o.decisions) {
                source(&r.source, "authored reference not current");
            }
        }
        for decision in &self.decisions {
            source(&decision.source, "authored decision source not current");
        }
        if self
            .managed
            .as_ref()
            .is_none_or(|s| s.phase != Phase::VerifiedDelivery)
        {
            out.push(ReadIssue { node_id: self.node_id.clone(), state: FactState::Uncertain, reference: self.source.reference.clone(), reason: "no current verified managed artifact (observed-only agents have unknown Summon phase)".into() });
        }
        if self.native.value == Some(NativeState::Unknown) {
            out.push(ReadIssue {
                node_id: self.node_id.clone(),
                state: FactState::Uncertain,
                reference: self.native.source.reference.clone(),
                reason: "native state unknown".into(),
            });
        }
        if let Some(l) = &self.lineage.value {
            if !l.complete {
                out.push(ReadIssue {
                    node_id: self.node_id.clone(),
                    state: FactState::Missing,
                    reference: self.lineage.source.reference.clone(),
                    reason: "child discovery incomplete".into(),
                });
            }
            for g in &l.unresolved {
                out.push(ReadIssue {
                    node_id: self.node_id.clone(),
                    state: g.state.clone(),
                    reference: g.reference.clone(),
                    reason: g.reason.clone(),
                });
            }
            for e in &l.edges {
                if e.source.state != FactState::Current {
                    out.push(ReadIssue {
                        node_id: self.node_id.clone(),
                        state: e.source.state.clone(),
                        reference: e.source.reference.clone(),
                        reason: "relationship source not current".into(),
                    });
                }
            }
        }
        if let Some(status) = &self.managed {
            // Completeness comes from frozen task/native facts, not whatever the
            // metadata publisher happened to include or descriptive acceptance.
            let candidate = status.delivery.as_ref().map(|d| &d.workspace_sha256);
            let coverage = status.coverage_sha256.as_ref();
            let mut required_issues = Vec::new();
            let mut required = |kinds: &[EvidenceKind],
                                reference: &str,
                                owner: Option<&str>,
                                bytes: Option<&str>,
                                label: &str| {
                let matching: Vec<_> = self
                    .evidence
                    .iter()
                    .filter(|e| {
                        kinds.contains(&e.kind)
                            && e.source.reference == reference
                            && owner.is_none_or(|o| e.source.owner == o)
                    })
                    .collect();
                let current = matching.iter().any(|e| {
                    e.source.state == FactState::Current
                        && e.candidate_sha256.as_ref() == candidate
                        && candidate.is_some()
                        && e.coverage_sha256.as_ref() == coverage
                        && coverage.is_some()
                        && bytes.is_none_or(|b| e.source.sha256.as_deref() == Some(b))
                });
                if !current {
                    required_issues.push(ReadIssue { node_id: self.node_id.clone(),
                        state: if matching.is_empty() { FactState::Missing } else { FactState::Stale },
                        reference: reference.into(), reason: format!("required {label} receipt missing, unavailable or not bound to current task delivery") });
                }
            };
            if let Some(delivery) = &status.delivery {
                required(
                    &[EvidenceKind::Candidate],
                    &delivery.evidence_ref,
                    None,
                    None,
                    "complete snapshot",
                );
            } else {
                out.push(ReadIssue {
                    node_id: self.node_id.clone(),
                    state: FactState::Missing,
                    reference: format!("{}/delivery", status.run_id),
                    reason: "required current complete delivery snapshot missing".into(),
                });
            }
            // Native trace is tied to the actual acknowledged input, not a generic
            // fresh trace from another run. No observed-only attempt is invented.
            for input in &status.inputs {
                if let Some(receipt) = &input.acknowledged {
                    required(
                        &[EvidenceKind::Trace],
                        &receipt.evidence_ref,
                        Some(&status.task.route.harness),
                        None,
                        "native input trace",
                    );
                }
            }
            for path in &status.task.outputs {
                let artifact = status
                    .delivery
                    .as_ref()
                    .and_then(|d| d.artifacts.iter().find(|a| &a.path == path));
                required(
                    &[EvidenceKind::Deliverable],
                    path,
                    None,
                    artifact.map(|a| a.sha256.as_str()),
                    "declared output",
                );
            }
            for check in &status.task.checks {
                let proof = status.proofs.iter().rev().find(|p| {
                    p.check_id == check.id()
                        && Some(&p.coverage_sha256) == coverage
                        && check.issuers().contains(&p.issuer)
                        && p.verdict == crate::Verdict::Pass
                });
                if let Some(proof) = proof {
                    let kinds = match check {
                        crate::Check::Command { .. } => {
                            vec![EvidenceKind::Check, EvidenceKind::Consumer]
                        }
                        crate::Check::Review { .. } => vec![EvidenceKind::Review],
                    };
                    required(
                        &kinds,
                        &proof.evidence_ref,
                        Some(&proof.issuer),
                        None,
                        &format!("task check {}", check.id()),
                    );
                } else {
                    out.push(ReadIssue {
                        node_id: self.node_id.clone(),
                        state: FactState::Missing,
                        reference: format!("{}/check/{}", status.run_id, check.id()),
                        reason: "required current task-authorized passing check receipt missing"
                            .into(),
                    });
                }
            }
            out.extend(required_issues);
            for e in &self.evidence {
                if e.candidate_sha256.as_ref().is_some_and(|d| {
                    status
                        .delivery
                        .as_ref()
                        .is_none_or(|c| &c.workspace_sha256 != d)
                }) || e
                    .coverage_sha256
                    .as_ref()
                    .is_some_and(|d| status.coverage_sha256.as_ref() != Some(d))
                {
                    out.push(ReadIssue {
                        node_id: self.node_id.clone(),
                        state: FactState::Stale,
                        reference: e.source.reference.clone(),
                        reason: "evidence candidate/coverage changed".into(),
                    });
                }
            }
        }
        out
    }
}
/// Semantic content hash excludes only typed read timestamps, at every nested source stamp.
pub(crate) fn content_hash<T: Serialize>(value: &T) -> String {
    fn strip(v: &mut serde_json::Value) {
        match v {
            serde_json::Value::Object(o) => {
                o.remove("read_at_unix_ms");
                for v in o.values_mut() {
                    strip(v);
                }
            }
            serde_json::Value::Array(a) => {
                for v in a {
                    strip(v);
                }
            }
            _ => (),
        }
    }
    let mut value = serde_json::to_value(value).expect("read schema serializes");
    strip(&mut value);
    hash(&value)
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ReadIssue {
    pub node_id: String,
    pub state: FactState,
    pub reference: String,
    pub reason: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PageCursor {
    pub graph_sha256: String,
    pub offset: usize,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct GraphPage {
    pub version: u32,
    pub root: String,
    pub graph_sha256: String,
    pub records: Vec<AgentRunAttemptV1>,
    pub edges: Vec<Relation>,
    pub unresolved: Vec<ReadIssue>,
    pub next: Option<PageCursor>,
}
/// A derived request-scoped graph, never persisted as a competing status ledger.
pub struct VisibilityGraph {
    pub records: BTreeMap<String, AgentRunAttemptV1>,
    pub edges: BTreeMap<String, Relation>,
    pub sha256: String,
}
impl VisibilityGraph {
    pub fn new(records: Vec<AgentRunAttemptV1>) -> Result<Self> {
        if records.len() > MAX_RECORDS {
            return refuse(
                "graph_limit",
                "page/drill down rather than exceed 10000 records per snapshot",
            );
        }
        let mut nodes = BTreeMap::new();
        let mut identities = BTreeMap::new();
        let mut edges = BTreeMap::new();
        for record in records {
            record.validate()?;
            let identity = if record.management == Management::Summon {
                hash(&(&record.identity.run_id, &record.identity.attempt_id))
            } else {
                hash(&(&record.identity.agent_id, &record.identity.native_session))
            };
            if identities
                .insert(identity, record.node_id.clone())
                .is_some_and(|n| n != record.node_id)
            {
                return refuse(
                    "identity_conflict",
                    "one actual identity cannot be duplicated under multiple nodes",
                );
            }
            if let Some(old) = nodes.get(&record.node_id) {
                let old: &AgentRunAttemptV1 = old;
                if old.binding_sha256() != record.binding_sha256() {
                    return refuse(
                        "identity_conflict",
                        "same node ID has conflicting source facts",
                    );
                }
            }
            if let Some(l) = &record.lineage.value {
                for e in &l.edges {
                    if let Some(old) = edges.get(&e.edge_id) {
                        let old: &Relation = old;
                        if content_hash(old) != content_hash(e) {
                            return refuse(
                                "identity_conflict",
                                "relationship ID has conflicting owner/identity/provenance",
                            );
                        }
                    }
                    edges.insert(e.edge_id.clone(), e.clone());
                }
            }
            nodes.insert(record.node_id.clone(), record);
        }
        if edges.len() > MAX_RECORDS * 8 {
            return refuse("graph_limit", "relationship snapshot too large");
        }
        // Kahn's algorithm includes unresolved endpoint identities and is stack-safe at any depth.
        let mut degree = BTreeMap::<String, usize>::new();
        let mut outgoing = BTreeMap::<String, Vec<String>>::new();
        for n in nodes.keys() {
            degree.entry(n.clone()).or_default();
        }
        for e in edges.values() {
            degree.entry(e.from.clone()).or_default();
            *degree.entry(e.to.clone()).or_default() += 1;
            outgoing
                .entry(e.from.clone())
                .or_default()
                .push(e.to.clone());
        }
        let mut ready: VecDeque<_> = degree
            .iter()
            .filter(|(_, d)| **d == 0)
            .map(|(n, _)| n.clone())
            .collect();
        let mut count = 0;
        while let Some(n) = ready.pop_front() {
            count += 1;
            for child in outgoing.get(&n).into_iter().flatten() {
                let d = degree.get_mut(child).unwrap();
                *d -= 1;
                if *d == 0 {
                    ready.push_back(child.clone());
                }
            }
        }
        if count != degree.len() {
            return refuse(
                "lineage_cycle",
                "child/dependency cycle refused before projection/export",
            );
        }
        let sha256 = content_hash(&(&nodes, &edges));
        Ok(Self {
            records: nodes,
            edges,
            sha256,
        })
    }
    pub fn reachable(&self, root: &str) -> Result<Vec<String>> {
        if !self.records.contains_key(root) {
            return refuse("unknown_root", "root source record is absent");
        }
        let mut visited = BTreeSet::new();
        let mut queue = VecDeque::from([root.to_owned()]);
        let mut order = vec![];
        while let Some(n) = queue.pop_front() {
            if !visited.insert(n.clone()) {
                continue;
            }
            for e in self.edges.values().filter(|e| e.from == n) {
                queue.push_back(e.to.clone());
            }
            order.push(n);
        }
        Ok(order)
    }
    pub fn issues(&self, root: &str) -> Result<Vec<ReadIssue>> {
        let mut out = vec![];
        for n in self.reachable(root)? {
            if let Some(r) = self.records.get(&n) {
                out.extend(r.local_issues());
            } else {
                out.push(ReadIssue {
                    node_id: n.clone(),
                    state: FactState::Missing,
                    reference: n,
                    reason: "child/dependency source absent from inventory".into(),
                });
            }
        }
        Ok(out)
    }
    pub fn page(&self, root: &str, cursor: Option<&PageCursor>, limit: usize) -> Result<GraphPage> {
        if limit == 0 || limit > MAX_PAGE {
            return refuse("page_limit", "page size must be 1..128");
        }
        if cursor.is_some_and(|c| c.graph_sha256 != self.sha256) {
            return refuse("stale_cursor", "graph changed; reopen drill-down snapshot");
        }
        let order = self.reachable(root)?;
        let offset = cursor.map_or(0, |c| c.offset);
        if offset > order.len() {
            return refuse("invalid_cursor", "cursor exceeds inventory");
        }
        let end = (offset + limit).min(order.len());
        let selected = &order[offset..end];
        Ok(GraphPage {
            version: READ_VERSION,
            root: root.into(),
            graph_sha256: self.sha256.clone(),
            records: selected
                .iter()
                .filter_map(|n| self.records.get(n).cloned())
                .collect(),
            edges: self
                .edges
                .values()
                .filter(|e| selected.contains(&e.from))
                .cloned()
                .collect(),
            unresolved: self.issues(root)?,
            next: (end < order.len()).then(|| PageCursor {
                graph_sha256: self.sha256.clone(),
                offset: end,
            }),
        })
    }
}

pub fn validate_metadata(
    status: &Status,
    old: Option<&RunMetadata>,
    request: &MetadataRequest,
) -> Result<()> {
    if request.expected_run_revision != status.revision
        || request.expected_metadata_sha256 != old.map(content_hash)
    {
        return refuse(
            "revision_conflict",
            "run or source metadata changed; reread view",
        );
    }
    if let Some(old) = old {
        if content_hash(&old.origin.value) != content_hash(&request.metadata.origin.value)
            || old.origin.source.owner != request.metadata.origin.source.owner
            || old.origin.source.reference != request.metadata.origin.source.reference
            || old.origin.source.sha256 != request.metadata.origin.source.sha256
        {
            return refuse(
                "origin_conflict",
                "original acceptance/rationale/decision source snapshot is immutable",
            );
        }
        for original in &old.decisions {
            let Some(current) = request.metadata.decisions.iter().find(|r| {
                r.source.owner == original.source.owner
                    && r.source.reference == original.source.reference
            }) else {
                return refuse(
                    "decision_removal",
                    "retain original authored dispositions in evidence history",
                );
            };
            if current.author != original.author || current.source.sha256 != original.source.sha256
            {
                return refuse(
                    "identity_conflict",
                    "authored decision identity/source digest cannot change",
                );
            }
        }
        if let Some(a) = &old.lineage.value {
            let Some(b) = &request.metadata.lineage.value else {
                return refuse(
                    "edge_removal",
                    "retain original relationships even when discovery reader fails",
                );
            };
            for edge in &a.edges {
                let Some(current) = b.edges.iter().find(|e| e.edge_id == edge.edge_id) else {
                    return refuse(
                        "edge_removal",
                        "cannot hide a failed/interrupted child by removing its original edge",
                    );
                };
                if current.fact_digest() != edge.fact_digest()
                    || current.source.owner != edge.source.owner
                    || current.source.reference != edge.source.reference
                {
                    return refuse(
                        "identity_conflict",
                        "relationship identity/owner/original provenance cannot change",
                    );
                }
            }
        }
    } else if status.inputs.iter().any(|i| i.attempt_id.is_some()) {
        return refuse(
            "origin_late",
            "freeze origin before native dispatch; do not reconstruct old private rationale",
        );
    }
    let record = AgentRunAttemptV1::from_status(status.clone(), Some(&request.metadata), 0);
    if let Some(l) = &record.lineage.value {
        if record.lineage.source.owner != record.source.owner
            || l.edges
                .iter()
                .any(|e| e.from != record.node_id || e.source.owner != record.source.owner)
        {
            return refuse(
                "edge_owner",
                "this DO registers only its outgoing relationship facts",
            );
        }
    }
    VisibilityGraph::new(vec![record])?;
    Ok(())
}
