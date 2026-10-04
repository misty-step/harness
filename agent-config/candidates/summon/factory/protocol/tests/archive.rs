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
