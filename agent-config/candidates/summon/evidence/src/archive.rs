//! Shared manifests, immutable bytes, and explicit fresh-owner revalidation.
use crate::{
    retention,
    source::{candidate_bytes, object_ref, stamp},
};
use anyhow::{ensure, Result};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, BTreeSet, VecDeque},
    fs,
    path::Path,
};
use summon_protocol::{
    evidence::{ExportRequest, PacketManifestV1},
    visibility::*,
};

fn packet_catalog(
    archive: &Path,
    seeds: Vec<String>,
    node: &str,
) -> Result<(Vec<PacketManifestV1>, Vec<ReadIssue>, bool, bool)> {
    let mut queue = VecDeque::from(seeds);
    let mut visited = BTreeSet::new();
    let mut packets = Vec::new();
    let mut issues = Vec::new();
    let mut valid = true;
    let mut complete = true;
    while let Some(digest) = queue.pop_front() {
        if !visited.insert(digest.clone()) {
            continue;
        }
        ensure!(
            visited.len() <= MAX_RECORDS,
            "original packet catalog exceeds bound"
        );
        match retention::load(archive, &digest) {
            Ok(bytes) => {
                let packet: PacketManifestV1 = serde_json::from_slice(&bytes)?;
                packet.validate_archive().map_err(crate::refused)?;
                ensure!(
                    packet.archive_sha256() == digest,
                    "child manifest exact byte digest mismatch"
                );
                for child in &packet.record.child_packets {
                    if let Some(digest) = &child.packet.sha256 {
                        queue.push_back(digest.clone());
                    }
                }
                packets.push(packet);
            }
            Err(error) => {
                let state = if archive.join("objects").join(&digest).exists() {
                    valid = false;
                    FactState::Failed
                } else {
                    complete = false;
                    FactState::Missing
                };
                issues.push(issue(
                    node,
                    state,
                    &object_ref(&digest),
                    &format!("bound packet unavailable or corrupt: {error}"),
                ));
            }
        }
    }
    Ok((packets, issues, valid, complete))
}

pub fn export(records: Vec<AgentRunAttemptV1>, root: &str, archive: &Path) -> Result<Value> {
    let mut graph = VisibilityGraph::new(records).map_err(crate::refused)?;
    let seeds = graph
        .records
        .values()
        .flat_map(|r| &r.child_packets)
        .filter_map(|c| c.packet.sha256.clone())
        .collect();
    let (mut catalog, _, _, _) = packet_catalog(archive, seeds, root)?;
    let mut exported: BTreeMap<String, usize> = BTreeMap::new();
    let reachable = graph.reachable(root).map_err(crate::refused)?;
    let mut remaining: BTreeSet<_> = reachable
        .iter()
        .filter(|n| graph.records.contains_key(*n))
        .cloned()
        .collect();
    while !remaining.is_empty() {
        let ready: Vec<_> = remaining
            .iter()
            .filter(|node| {
                graph
                    .edges
                    .values()
                    .filter(|e| &e.from == *node)
                    .all(|e| !remaining.contains(&e.to))
            })
            .cloned()
            .collect();
        ensure!(
            !ready.is_empty(),
            "owner graph cycle/refusal cannot be bypassed"
        );
        for node in ready {
            let edges: Vec<_> = graph.edges.values().filter(|e| e.from == node).collect();
            let record = graph.records.get_mut(&node).unwrap();
            // Only a new observed-only export may bind previously absent archive
            // refs. Never replace registered refs or author managed DO metadata.
            if record.management == Management::ObservedOnly && record.child_packets.is_empty() {
                record.child_packets = edges
                    .iter()
                    .map(|edge| {
                        if let Some(index) = exported.get(&edge.to) {
                            let packet = &catalog[*index];
                            let digest = packet.archive_sha256();
                            ChildPacketRef {
                                edge_id: edge.edge_id.clone(),
                                node_id: edge.to.clone(),
                                packet: stamp(
                                    "summon-evidence",
                                    &object_ref(&digest),
                                    Some(digest),
                                    FactState::Current,
                                ),
                                child_binding_sha256: Some(packet.binding_sha256.clone()),
                            }
                        } else {
                            ChildPacketRef {
                                edge_id: edge.edge_id.clone(),
                                node_id: edge.to.clone(),
                                packet: SourceStamp::unavailable(
                                    "summon-evidence",
                                    &format!("missing-child:{}", edge.to),
                                    crate::source::now(),
                                    FactState::Missing,
                                ),
                                child_binding_sha256: None,
                            }
                        }
                    })
                    .collect();
            }
            record.validate().map_err(crate::refused)?;
            // One graph and one original+new catalog. Export reads records/edges,
            // not the initial graph's page cursor digest; no whole-payload clone
            // for each node, and no original archive replacement.
            let packet =
                PacketManifestV1::export(&graph, &node, &catalog).map_err(crate::refused)?;
            let digest = retention::retain(archive, &serde_json::to_vec(&packet)?)?;
            ensure!(
                digest == packet.archive_sha256(),
                "shared manifest/actual archive bytes disagree"
            );
            exported.insert(node.clone(), catalog.len());
            catalog.push(packet);
            remaining.remove(&node);
        }
    }
    let packet = &catalog[*exported.get(root).unwrap()];
    let root_packet_sha256 = packet.archive_sha256();
    let proof = packet.proof.clone();
    // Shared ExportRequest is the portable frame; only the root is inline. Child
    // manifests live at their EXACT bound object digests, no latest-packet fallback.
    let bundle = ExportRequest {
        root: root.into(),
        records: graph.records.into_values().collect(),
        packets: vec![packet.clone()],
    };
    let digest = retention::retain(archive, &serde_json::to_vec(&bundle)?)?;
    Ok(
        json!({"bundle_sha256":digest,"root_packet_sha256":root_packet_sha256,"proof":proof,"archive_directory":archive}),
    )
}
fn issue(node: &str, state: FactState, reference: &str, reason: &str) -> ReadIssue {
    ReadIssue {
        node_id: node.into(),
        state,
        reference: reference.into(),
        reason: reason.into(),
    }
}
// Fresh observed-only snapshots do not register exporter-owned packet refs.
// Reconstruct only those absent refs from this ORIGINAL frame, bottom-up, while
// rebinding descendants to fresh owner facts. Never hydrate managed/explicit refs
// or copy historical child semantic bindings over a changed current source.
fn observed_archive_bindings(
    mut current: VisibilityGraph,
    archived: &VisibilityGraph,
) -> Result<VisibilityGraph> {
    let mut pending: BTreeMap<_, _> = current
        .records
        .values()
        .filter(|r| r.management == Management::ObservedOnly && r.child_packets.is_empty())
        .filter_map(|r| {
            archived
                .records
                .get(&r.node_id)
                .filter(|old| {
                    old.management == Management::ObservedOnly && !old.child_packets.is_empty()
                })
                .map(|old| (r.node_id.clone(), old.child_packets.clone()))
        })
        .collect();
    while !pending.is_empty() {
        let ready: Vec<_> = pending
            .iter()
            .filter(|(_, refs)| refs.iter().all(|c| !pending.contains_key(&c.node_id)))
            .map(|(node, _)| node.clone())
            .collect();
        ensure!(
            !ready.is_empty(),
            "original observed archive binding cycle refused"
        );
        for node in ready {
            let mut refs = pending.remove(&node).unwrap();
            for child in &mut refs {
                child.child_binding_sha256 = current
                    .records
                    .get(&child.node_id)
                    .map(AgentRunAttemptV1::binding_sha256);
            }
            current.records.get_mut(&node).unwrap().child_packets = refs;
        }
    }
    Ok(current)
}
pub fn reopen(
    archive: &Path,
    digest: &str,
    fresh: Option<Vec<AgentRunAttemptV1>>,
) -> Result<Value> {
    let bundle: ExportRequest = serde_json::from_slice(&retention::load(archive, digest)?)?;
    ensure!(
        bundle.packets.len() == 1 && bundle.packets[0].record.node_id == bundle.root,
        "portable root manifest conflict"
    );
    let root = &bundle.packets[0];
    root.validate_archive().map_err(crate::refused)?;
    let archived = VisibilityGraph::new(bundle.records.clone()).map_err(crate::refused)?;
    ensure!(
        archived
            .records
            .get(&bundle.root)
            .is_some_and(|r| r.binding_sha256() == root.binding_sha256),
        "portable frame/root source conflict"
    );
    let (catalog, mut availability, mut valid, mut complete) =
        packet_catalog(archive, vec![root.archive_sha256()], &bundle.root)?;
    let mut inspected = BTreeSet::new();
    // Validate evidence retained by the ORIGINAL archive descendants as well as
    // the captured source inventory, not only convenient latest graph rows.
    for record in bundle
        .records
        .iter()
        .chain(catalog.iter().map(|p| &p.record))
    {
        for evidence in &record.evidence {
            let Some(digest) = evidence.source.reference.strip_prefix("object:") else {
                continue;
            };
            if !inspected.insert(digest.to_owned()) {
                continue;
            }
            ensure!(
                evidence.source.sha256.as_deref() == Some(digest),
                "retained evidence reference/digest conflict"
            );
            let bytes = match retention::load(archive, digest) {
                Ok(bytes) => bytes,
                Err(error) => {
                    if archive.join("objects").join(digest).exists() {
                        valid = false;
                    } else {
                        complete = false;
                    }
                    availability.push(issue(
                        &record.node_id,
                        FactState::Missing,
                        &evidence.source.reference,
                        &format!("retained evidence unavailable or corrupt: {error}"),
                    ));
                    continue;
                }
            };
            ensure!(
                evidence.source.sha256.as_deref() == Some(digest),
                "retained evidence reference/digest conflict"
            );
            if evidence.source.owner == "git-source" {
                let original: Value = serde_json::from_slice(&bytes)?;
                if let Some(path) = original["source_root"].as_str() {
                    match candidate_bytes(Path::new(path)) {
                        Ok(current) if summon_protocol::sha256(&current) == digest => (),
                        Ok(_) => availability.push(issue(&record.node_id, FactState::Stale, path, "actual candidate source revision/bytes changed; retained proof cannot cover it")),
                        Err(_) => availability.push(issue(&record.node_id, FactState::Inaccessible, path, "current candidate source unavailable; archive integrity is not freshness")),
                    }
                }
            }
            if evidence.source.owner == "pi-native" && evidence.kind == EvidenceKind::Trace {
                let original: Value = serde_json::from_slice(&bytes)?;
                if let Some(path) = original["source_ref"].as_str() {
                    ensure!(
                        record
                            .identity
                            .native_session
                            .as_ref()
                            .is_some_and(|n| n.session_file == path),
                        "native trace/original owner tuple conflict"
                    );
                    match fs::read(path) {
                        Ok(current) if current.len() <= 64 * 1024 * 1024 && original["source_sha256"] == summon_protocol::sha256(&current) => (),
                        Ok(_) => availability.push(issue(&record.node_id, FactState::Stale, path, "original native append bytes changed since retained snapshot; active branch remains unobserved")),
                        Err(_) => availability.push(issue(&record.node_id, FactState::Inaccessible, path, "original native source unavailable; filtered archive remains retained")),
                    }
                }
            }
        }
    }
    let current = match fresh {
        Some(records) => observed_archive_bindings(
            VisibilityGraph::new(records).map_err(crate::refused)?,
            &archived,
        )?,
        None => {
            availability.push(issue(&bundle.root, FactState::Uncertain, "fresh_owner_sources", "archive reopened without fresh shared owner views; current semantic binding not established"));
            archived
        }
    };
    let mut proof = root.reopen(&current, &catalog).map_err(crate::refused)?;
    proof.issues.extend(availability);
    proof.recursive_pass = proof.issues.is_empty();
    Ok(
        json!({"bundle_sha256":digest,"root_packet_sha256":root.archive_sha256(),"available_digests_valid":valid,"archive_objects_complete":complete,"proof":proof}),
    )
}
