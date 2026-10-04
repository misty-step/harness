//! Immutable packet archives and fresh recursive validation. Failed runs are exportable.
use crate::visibility::*;
use crate::{Result, digest, hash, refuse};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, VecDeque};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct RecursiveProof {
    /// Derived evidence completeness/currentness, NOT product Done or external-effect authority.
    pub recursive_pass: bool,
    pub issues: Vec<ReadIssue>,
}
/// ONE packet schema. The record retains frozen brief/acceptance, original source
/// rationale/decisions, native trace/evidence references and immutable child bindings.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PacketManifestV1 {
    pub version: u32,
    pub record: AgentRunAttemptV1,
    pub binding_sha256: String,
    /// None/omitted is explicitly UNASSESSED, never an empty successful proof.
    /// Historical proof-bearing archives keep their original bytes and field order.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub proof: Option<RecursiveProof>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExportRequest {
    pub root: String,
    pub records: Vec<AgentRunAttemptV1>,
    pub packets: Vec<PacketManifestV1>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PageRequest {
    pub root: String,
    pub records: Vec<AgentRunAttemptV1>,
    pub cursor: Option<PageCursor>,
    pub limit: usize,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReopenRequest {
    pub packet: PacketManifestV1,
    pub records: Vec<AgentRunAttemptV1>,
    pub packets: Vec<PacketManifestV1>,
}
impl PacketManifestV1 {
    /// Hash deterministic compact JSON archive bytes (including read timestamps). Semantic
    /// currentness is separately bound by binding_sha256, which excludes read time.
    pub fn archive_sha256(&self) -> String {
        hash(self)
    }
    pub fn validate_archive(&self) -> Result<()> {
        if self.version != READ_VERSION {
            return refuse("packet_version", "unsupported packet version");
        }
        self.record.validate()?;
        digest(&self.binding_sha256)?;
        if self.binding_sha256 != self.record.binding_sha256() {
            return refuse("packet_digest_mismatch", "archive record content changed");
        }
        if self
            .proof
            .as_ref()
            .is_some_and(|p| p.recursive_pass != p.issues.is_empty())
        {
            return refuse(
                "packet_invalid",
                "archive pass cannot conceal retained issues",
            );
        }
        Ok(())
    }
    /// Retain ONE node's complete owner facts and original child refs. No graph
    /// traversal or recursive assessment is stored at every ancestor. Requested
    /// views use export/reopen to assess descendants from their actual owners.
    pub fn archive(record: AgentRunAttemptV1) -> Result<Self> {
        let packet = Self {
            version: READ_VERSION,
            binding_sha256: record.binding_sha256(),
            record,
            proof: None,
        };
        packet.validate_archive()?;
        Ok(packet)
    }
    /// Requested-view assessment. Do not call per-node when retaining a tree:
    /// archive local records, then derive this rollup once for the requested root.
    pub fn export(graph: &VisibilityGraph, root: &str, packets: &[Self]) -> Result<Self> {
        let record = graph
            .records
            .get(root)
            .ok_or_else(|| crate::Refusal {
                code: "unknown_root".into(),
                message: "packet root absent".into(),
            })?
            .clone();
        let proof = assess(graph, root, packets)?;
        Ok(Self {
            version: READ_VERSION,
            binding_sha256: record.binding_sha256(),
            record,
            proof: Some(proof),
        })
    }
    /// Reopening is read-only. A retained green archive is NEVER promoted to current
    /// on a changed/failed source, candidate, edge, child binding or missing inventory.
    pub fn reopen(&self, graph: &VisibilityGraph, packets: &[Self]) -> Result<RecursiveProof> {
        self.validate_archive()?;
        let mut records: Vec<_> = graph.records.values().cloned().collect();
        // Reconstruct the ORIGINAL bound archive refs, not a convenient latest packet.
        if let Some(root) = records
            .iter_mut()
            .find(|r| r.node_id == self.record.node_id)
        {
            root.child_packets = self.record.child_packets.clone();
        }
        let archive_graph = VisibilityGraph::new(records)?;
        let mut proof = assess(&archive_graph, &self.record.node_id, packets)?;
        if graph
            .records
            .get(&self.record.node_id)
            .is_none_or(|r| r.binding_sha256() != self.binding_sha256)
        {
            proof.issues.push(ReadIssue {
                node_id: self.record.node_id.clone(),
                state: FactState::Stale,
                reference: self.record.source.reference.clone(),
                reason: "retained packet root differs from current source binding".into(),
            });
        }
        proof.recursive_pass = proof.issues.is_empty();
        Ok(proof)
    }
}
fn issue(node: &str, state: FactState, reference: &str, reason: &str) -> ReadIssue {
    ReadIssue {
        node_id: node.into(),
        state,
        reference: reference.into(),
        reason: reason.into(),
    }
}
fn assess(
    graph: &VisibilityGraph,
    root: &str,
    packets: &[PacketManifestV1],
) -> Result<RecursiveProof> {
    if packets.len() > MAX_RECORDS {
        return refuse(
            "graph_limit",
            "packet catalog too large; use bounded drill down",
        );
    }
    let mut catalog = BTreeMap::new();
    for packet in packets {
        packet.validate_archive()?;
        let digest = packet.archive_sha256();
        if let Some(old) = catalog.insert(digest, packet) {
            if old != packet {
                return refuse(
                    "packet_conflict",
                    "same archive digest has conflicting content",
                );
            }
        }
    }
    let mut issues = graph.issues(root)?;
    let mut queue = VecDeque::from([graph.records.get(root).expect("issues validated root")]);
    let mut visited = BTreeSet::new();
    // Follow the actual immutable packet tree, not the latest graph's archive refs.
    // Fresh graph facts are assessed separately and bind every selected archive.
    while let Some(record) = queue.pop_front() {
        let node = &record.node_id;
        let outgoing: Vec<_> = record
            .lineage
            .value
            .as_ref()
            .into_iter()
            .flat_map(|l| &l.edges)
            .filter(|e| &e.from == node)
            .collect();
        // An unrelated/archive child reference must not be silently counted as proof.
        for child in &record.child_packets {
            if !outgoing
                .iter()
                .any(|e| e.edge_id == child.edge_id && e.to == child.node_id)
            {
                return refuse(
                    "child_packet_conflict",
                    "child packet does not bind an original outgoing relationship",
                );
            }
        }
        for edge in outgoing {
            let Some(child) = record
                .child_packets
                .iter()
                .find(|c| c.edge_id == edge.edge_id && c.node_id == edge.to)
            else {
                issues.push(issue(
                    &node,
                    FactState::Missing,
                    &edge.source.reference,
                    "relationship has no bound immutable child packet",
                ));
                continue;
            };
            if child.packet.state != FactState::Current {
                issues.push(issue(
                    &edge.to,
                    child.packet.state.clone(),
                    &child.packet.reference,
                    "child packet source not current",
                ));
                continue;
            }
            let Some(current) = graph.records.get(&edge.to) else {
                continue;
            };
            let current_binding = current.binding_sha256();
            if child.child_binding_sha256.as_deref() != Some(&current_binding) {
                issues.push(issue(
                    &edge.to,
                    FactState::Stale,
                    &child.packet.reference,
                    "child candidate/source/packet binding changed",
                ));
                continue;
            }
            let Some(packet) = child.packet.sha256.as_ref().and_then(|d| catalog.get(d)) else {
                issues.push(issue(
                    &edge.to,
                    FactState::Missing,
                    &child.packet.reference,
                    "bound child archive not present in export/reopen catalog",
                ));
                continue;
            };
            if packet.record.node_id != edge.to || packet.binding_sha256 != current_binding {
                issues.push(issue(
                    &edge.to,
                    FactState::Stale,
                    &child.packet.reference,
                    "child archive does not cover current identity/candidate",
                ));
            }
            if packet.record.node_id == edge.to
                && packet.binding_sha256 == current_binding
                && visited.insert(packet.archive_sha256())
            {
                queue.push_back(&packet.record);
            }
            // Stored packet.proof is historical. Source/currentness and ORIGINAL
            // archive descendants are checked afresh, at every depth.
        }
    }
    Ok(RecursiveProof {
        recursive_pass: issues.is_empty(),
        issues,
    })
}
