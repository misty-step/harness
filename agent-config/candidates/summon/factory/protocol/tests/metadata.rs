//! Metadata fixtures test original source ownership, not native delivery.
use summon_protocol::visibility::*;
use summon_protocol::*;

#[test]
fn metadata_keeps_original_edges_and_authored_dispositions_without_changing_check_policy() {
    let task:TaskSpec=serde_json::from_value(serde_json::json!({"id":"cf1:metadata","kind":"research","brief":"Frozen source brief","workspace":"/fixture","route":{"harness":"pi","provider":"fixture","model":"fixture","effort":"high"},"checks":[],"outputs":[]})).unwrap();
    let run = Run::intake(Intake {
        task,
        initial_input_id: "initial".into(),
    })
    .unwrap();
    let status = run.status();
    let mut relation = Relation {
        edge_id: "original-edge".into(),
        from: status.run_id.clone(),
        to: "cf1:child".into(),
        kind: RelationKind::Child,
        original_source_ref: "original-native-delegation".into(),
        source: SourceStamp {
            owner: "summon_do:cf1:metadata".into(),
            reference: "original-edge-receipt".into(),
            read_at_unix_ms: 1000,
            sha256: None,
            state: FactState::Current,
            detail: None,
        },
    };
    relation.source.sha256 = Some(relation.fact_digest());
    let mut metadata = RunMetadata {
        origin: Fact::current(
            "commissioner",
            "original-commission",
            1000,
            Origin {
                agent_id: None,
                brief: status.task.brief.clone(),
                acceptance: vec!["Descriptive acceptance only".into()],
                rationale: vec![],
                decisions: vec![],
            },
        ),
        native: Fact {
            source: SourceStamp::unavailable("pi", "unknown presence", 1000, FactState::Missing),
            value: None,
        },
        lineage: Fact::current(
            "summon_do:cf1:metadata",
            "inventory",
            1000,
            Lineage {
                complete: false,
                unresolved: vec![],
                edges: vec![relation],
            },
        ),
        evidence: vec![],
        child_packets: vec![],
        decisions: vec![],
    };
    let request = MetadataRequest {
        expected_run_revision: status.revision,
        expected_metadata_sha256: None,
        metadata: metadata.clone(),
    };
    validate_metadata(&status, None, &request).unwrap();
    let before = AgentRunAttemptV1::from_status(status.clone(), Some(&metadata), 1000);
    let authored = AuthoredRef {
        author: "CTO".into(),
        source: SourceStamp {
            owner: "native-cto-session".into(),
            reference: "actual-authored-disposition-ref".into(),
            read_at_unix_ms: 1000,
            sha256: Some(sha256(b"fixture already-authored decision")),
            state: FactState::Current,
            detail: None,
        },
    };
    metadata.decisions.push(authored);
    let appended = MetadataRequest {
        expected_run_revision: status.revision,
        expected_metadata_sha256: before.metadata_sha256.clone(),
        metadata: metadata.clone(),
    };
    validate_metadata(&status, Some(&request.metadata), &appended).unwrap();
    let with_decision = AgentRunAttemptV1::from_status(status.clone(), Some(&metadata), 1000);
    assert_eq!(
        with_decision.managed.as_ref().unwrap().task.checks,
        status.task.checks
    );
    assert_eq!(run.status(), status); // projection/metadata validation cannot write kernel phase
    let mut removed = metadata.clone();
    removed.lineage.value.as_mut().unwrap().edges.clear();
    removed.lineage = Fact::current(
        "summon_do:cf1:metadata",
        "inventory",
        1001,
        removed.lineage.value.take().unwrap(),
    );
    let bad = MetadataRequest {
        expected_run_revision: status.revision,
        expected_metadata_sha256: with_decision.metadata_sha256.clone(),
        metadata: removed,
    };
    assert_eq!(
        validate_metadata(&status, Some(&metadata), &bad)
            .unwrap_err()
            .code,
        "edge_removal"
    );
    let mut bad = bad;
    bad.metadata = metadata.clone();
    bad.metadata.decisions.clear();
    assert_eq!(
        validate_metadata(&status, Some(&metadata), &bad)
            .unwrap_err()
            .code,
        "decision_removal"
    );
}
