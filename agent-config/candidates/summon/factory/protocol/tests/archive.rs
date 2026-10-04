//! Recursive archive fixtures, not native execution or live child discovery.
use summon_protocol::evidence::*;
use summon_protocol::visibility::*;
use summon_protocol::*;

fn observed(id: &str) -> AgentRunAttemptV1 {
    // Unmanaged/native records must archive without invented managed attempts.
    AgentRunAttemptV1 {
        version: 1,
        node_id: id.into(),
        management: Management::ObservedOnly,
        identity: RecordIdentity {
            agent_id: Some(id.into()),
            run_id: None,
            attempt_id: None,
            native_session: None,
        },
        source: SourceStamp {
            owner: "fixture-reader".into(),
            reference: id.into(),
            read_at_unix_ms: 1000,
            sha256: Some(sha256(id.as_bytes())),
            state: FactState::Current,
            detail: None,
        },
        managed: None,
        origin: Fact::current(
            "fixture-commissioner",
            "original fixture brief",
            1000,
            Origin {
                agent_id: Some(id.into()),
                brief: "Observed-only fixture brief".into(),
                acceptance: vec![],
                rationale: vec![],
                decisions: vec![],
            },
        ),
        native: Fact::current(
            "native-fixture",
            "observed fixture state",
            1000,
            NativeState::Running,
        ),
        lineage: Fact::current(
            "fixture-reader",
            "fixture inventory",
            1000,
            Lineage {
                complete: true,
                unresolved: vec![],
                edges: vec![],
            },
        ),
        evidence: vec![],
        child_packets: vec![],
        decisions: vec![],
        metadata_sha256: None,
    }
}
fn bind(parent: &mut AgentRunAttemptV1, child: &AgentRunAttemptV1, packet: &PacketManifestV1) {
    let mut e = Relation {
        edge_id: format!("{}->{}", parent.node_id, child.node_id),
        from: parent.node_id.clone(),
        to: child.node_id.clone(),
        kind: RelationKind::Child,
        original_source_ref: "fixture delegation".into(),
        source: SourceStamp {
            owner: "fixture-reader".into(),
            reference: "fixture original edge".into(),
            read_at_unix_ms: 1000,
            sha256: None,
            state: FactState::Current,
            detail: None,
        },
    };
    e.source.sha256 = Some(e.fact_digest());
    let mut l = parent.lineage.value.clone().unwrap();
    l.edges.push(e.clone());
    parent.lineage = Fact::current("fixture-reader", "fixture inventory", 1000, l);
    parent.child_packets.push(ChildPacketRef {
        edge_id: e.edge_id,
        node_id: child.node_id.clone(),
        packet: SourceStamp {
            owner: "fixture-packet-owner".into(),
            reference: packet.archive_sha256(),
            read_at_unix_ms: 1000,
            sha256: Some(packet.archive_sha256()),
            state: FactState::Current,
            detail: None,
        },
        child_binding_sha256: Some(child.binding_sha256()),
    });
}
#[test]
fn reopen_requires_original_grandchild_archive_not_only_latest_semantic_equivalent() {
    let leaf = observed("leaf");
    let p_leaf = PacketManifestV1::export(
        &VisibilityGraph::new(vec![leaf.clone()]).unwrap(),
        "leaf",
        &[],
    )
    .unwrap();
    let mut mid = observed("mid");
    bind(&mut mid, &leaf, &p_leaf);
    let p_mid = PacketManifestV1::export(
        &VisibilityGraph::new(vec![mid.clone(), leaf.clone()]).unwrap(),
        "mid",
        std::slice::from_ref(&p_leaf),
    )
    .unwrap();
    let mut root = observed("root");
    bind(&mut root, &mid, &p_mid);
    let original = PacketManifestV1::export(
        &VisibilityGraph::new(vec![root.clone(), mid.clone(), leaf.clone()]).unwrap(),
        "root",
        &[p_mid.clone(), p_leaf.clone()],
    )
    .unwrap();
    let mut refreshed = leaf;
    refreshed.source.read_at_unix_ms += 100;
    let latest = PacketManifestV1::export(
        &VisibilityGraph::new(vec![refreshed.clone()]).unwrap(),
        "leaf",
        &[],
    )
    .unwrap();
    mid.child_packets[0].packet.sha256 = Some(latest.archive_sha256());
    mid.child_packets[0].packet.reference = latest.archive_sha256();
    let fresh = VisibilityGraph::new(vec![root, mid, refreshed]).unwrap();
    let missing = original
        .reopen(&fresh, &[p_mid.clone(), latest.clone()])
        .unwrap();
    assert!(
        missing.issues.iter().any(|i| i.node_id == "leaf"
            && i.state == FactState::Missing
            && i.reason.contains("archive")),
        "original grandchild archive must be reconstructable, even if latest bytes bind identical logical candidate"
    );
    let complete = original.reopen(&fresh, &[p_mid, p_leaf, latest]).unwrap();
    assert!(
        !complete
            .issues
            .iter()
            .any(|i| i.state == FactState::Missing && i.reason.contains("archive"))
    );
    assert!(!complete.recursive_pass); // observed-only archive remains unknown Summon phase
}

#[test]
fn local_archives_are_unassessed_linear_and_requested_rollups_keep_every_named_failure() {
    let states = [
        FactState::Missing,
        FactState::Stale,
        FactState::Failed,
        FactState::Uncertain,
        FactState::Inaccessible,
        FactState::Cancelled,
    ];
    let mut previous_bytes = None;
    for depth in [4, 8, 16, 32] {
        let mut records = Vec::new();
        let mut packets = Vec::new();
        for index in (0..depth).rev() {
            let mut record = observed(&format!("node-{index:04}"));
            let mut lineage = record.lineage.value.clone().unwrap();
            lineage.complete = false;
            lineage.unresolved.push(InventoryGap {
                reference: format!("named-gap-{index:04}"),
                state: states[index % states.len()].clone(),
                reason: "retained authored fixture gap".into(),
            });
            record.lineage = Fact::current("fixture-reader", "fixture inventory", 1000, lineage);
            if let (Some(child), Some(packet)) = (records.last(), packets.last()) {
                bind(&mut record, child, packet);
            }
            let packet = PacketManifestV1::archive(record.clone()).unwrap();
            assert!(
                packet.proof.is_none(),
                "stored local facts are UNASSESSED, never green"
            );
            let bytes = serde_json::to_vec(&packet).unwrap();
            assert!(
                serde_json::from_slice::<serde_json::Value>(&bytes)
                    .unwrap()
                    .get("proof")
                    .is_none()
            );
            assert_eq!(packet.record, record);
            assert_eq!(packet.binding_sha256, record.binding_sha256());
            records.push(record);
            packets.push(packet);
        }
        let retained_bytes: usize = packets
            .iter()
            .map(|p| serde_json::to_vec(p).unwrap().len())
            .sum();
        if let Some(previous) = previous_bytes {
            assert!(
                retained_bytes < previous * 23 / 10,
                "doubling depth must not quadruple retained manifests"
            );
        }
        previous_bytes = Some(retained_bytes);
        let graph = VisibilityGraph::new(records.clone()).unwrap();
        let root = packets.last().unwrap();
        let requested = root.reopen(&graph, &packets).unwrap();
        assert!(!requested.recursive_pass);
        for index in 0..depth {
            assert_eq!(
                requested
                    .issues
                    .iter()
                    .filter(|i| i.reference == format!("named-gap-{index:04}")
                        && i.state == states[index % states.len()])
                    .count(),
                1
            );
        }
        let assessed = PacketManifestV1::export(&graph, &root.record.node_id, &packets).unwrap();
        assert_eq!(assessed.proof.as_ref().unwrap(), &requested);
        assert_eq!(packets.iter().filter(|p| p.proof.is_some()).count(), 0);
        eprintln!(
            "local packaging depth={depth} retained_manifest_bytes={retained_bytes} requested_issues={}",
            requested.issues.len()
        );
    }
}

#[test]
fn legacy_proof_bytes_and_mixed_original_nested_archives_remain_exact() {
    let leaf = observed("old-leaf");
    let old_leaf = PacketManifestV1::export(
        &VisibilityGraph::new(vec![leaf.clone()]).unwrap(),
        "old-leaf",
        &[],
    )
    .unwrap();
    // Independent old wire framing: order/explicit historical proof cannot change
    // just because the new Rust field is optional. This is an archive digest contract.
    let legacy_bytes = format!(
        "{{\"version\":1,\"record\":{},\"binding_sha256\":\"{}\",\"proof\":{}}}",
        serde_json::to_string(&leaf).unwrap(),
        leaf.binding_sha256(),
        serde_json::to_string(old_leaf.proof.as_ref().unwrap()).unwrap()
    )
    .into_bytes();
    let parsed: PacketManifestV1 = serde_json::from_slice(&legacy_bytes).unwrap();
    parsed.validate_archive().unwrap();
    assert_eq!(serde_json::to_vec(&parsed).unwrap(), legacy_bytes);
    assert_eq!(parsed.archive_sha256(), sha256(&legacy_bytes));
    let mut invalid = parsed.clone();
    invalid.proof.as_mut().unwrap().recursive_pass = true;
    assert_eq!(
        invalid.validate_archive().unwrap_err().code,
        "packet_invalid"
    );
    let mut mid = observed("old-mid");
    bind(&mut mid, &leaf, &old_leaf);
    let old_mid = PacketManifestV1::export(
        &VisibilityGraph::new(vec![mid.clone(), leaf.clone()]).unwrap(),
        "old-mid",
        std::slice::from_ref(&old_leaf),
    )
    .unwrap();
    let original_mid_bytes = serde_json::to_vec(&old_mid).unwrap();
    let mut root = observed("new-root");
    bind(&mut root, &mid, &old_mid);
    let local_root = PacketManifestV1::archive(root.clone()).unwrap();
    let graph = VisibilityGraph::new(vec![root.clone(), mid.clone(), leaf.clone()]).unwrap();
    let mixed = local_root
        .reopen(&graph, &[old_mid.clone(), old_leaf.clone()])
        .unwrap();
    assert_eq!(
        mixed,
        PacketManifestV1::export(&graph, "new-root", &[old_mid.clone(), old_leaf.clone()])
            .unwrap()
            .proof
            .unwrap()
    );
    assert!(!mixed.recursive_pass);
    let missing = local_root
        .reopen(&graph, std::slice::from_ref(&old_mid))
        .unwrap();
    assert!(missing.issues.iter().any(|i| i.node_id == "old-leaf"
        && i.state == FactState::Missing
        && i.reason.contains("archive")));
    let latest_leaf = PacketManifestV1::archive(leaf.clone()).unwrap();
    assert_ne!(latest_leaf.archive_sha256(), old_leaf.archive_sha256());
    let replaced = local_root
        .reopen(&graph, &[old_mid.clone(), latest_leaf.clone()])
        .unwrap();
    assert!(replaced.issues.iter().any(|i| i.node_id == "old-leaf"
        && i.state == FactState::Missing
        && i.reason.contains("archive")));
    // New local child below an original assessed parent uses the same reader.
    let mut new_mid = mid.clone();
    new_mid.child_packets[0].packet.sha256 = Some(latest_leaf.archive_sha256());
    new_mid.child_packets[0].packet.reference = latest_leaf.archive_sha256();
    let new_mid_packet = PacketManifestV1::archive(new_mid.clone()).unwrap();
    let mut new_parent = observed("assessed-parent");
    bind(&mut new_parent, &new_mid, &new_mid_packet);
    let new_graph = VisibilityGraph::new(vec![new_parent.clone(), new_mid, leaf]).unwrap();
    let old_style_parent = PacketManifestV1::export(
        &new_graph,
        "assessed-parent",
        &[new_mid_packet.clone(), latest_leaf.clone()],
    )
    .unwrap();
    assert_eq!(
        old_style_parent
            .reopen(&new_graph, &[new_mid_packet, latest_leaf])
            .unwrap(),
        old_style_parent.proof.clone().unwrap()
    );
    assert_eq!(serde_json::to_vec(&old_mid).unwrap(), original_mid_bytes);
    assert_eq!(serde_json::to_vec(&old_leaf).unwrap(), legacy_bytes);
}
