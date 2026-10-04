//! Deep/shared/cycle/native/evidence examples here are explicit synthetic fixtures.
use std::collections::BTreeSet;
use summon_protocol::evidence::*;
use summon_protocol::visibility::*;
use summon_protocol::*;

fn verified(id: &str) -> Status {
    let task: TaskSpec = serde_json::from_value(serde_json::json!({
        "id":id,"kind":"research","brief":"Synthetic source-backed fixture brief","workspace":"/fixture/work",
        "route":{"harness":"pi","provider":"fixture","model":"fixture","effort":"high"},
        "checks":[{"id":"required","type":"review","criterion":"Fixture criterion","issuers":["fixture-reviewer"]}],"outputs":["result.md"]
    })).unwrap();
    let mut run = Run::intake(Intake {
        task,
        initial_input_id: "input".into(),
    })
    .unwrap();
    let (dispatch, _) = run
        .claim(ClaimRequest {
            claim_id: "attempt".into(),
            runner_id: "fixture-runner".into(),
            expected_revision: run.revision,
        })
        .unwrap();
    run.observe(
        ObserveRequest {
            event_id: "answer".into(),
            input_id: dispatch.input_id.clone(),
            attempt_id: dispatch.attempt_id.clone(),
            text_sha256: dispatch.text_sha256.clone(),
            expected_revision: run.revision,
            observation: Observation::Answered {
                receipt: NativeReceipt {
                    session: NativeSession {
                        runtime: "pi".into(),
                        host: "fixture-host".into(),
                        session_id: id.into(),
                        session_file: format!("/fixture/{id}.jsonl"),
                    },
                    native_message_ref: "fixture-user-entry".into(),
                    evidence_ref: "fixture-transcript".into(),
                },
                text: "Fixture answer".into(),
                answer_ref: "fixture-assistant-entry".into(),
            },
        },
        false,
    )
    .unwrap();
    run.observe(
        ObserveRequest {
            event_id: "delivery".into(),
            input_id: dispatch.input_id,
            attempt_id: dispatch.attempt_id,
            text_sha256: dispatch.text_sha256,
            expected_revision: run.revision,
            observation: Observation::Delivery {
                delivery: Delivery {
                    workspace_sha256: sha256(id.as_bytes()),
                    revision: Some("fixture-candidate".into()),
                    artifacts: vec![Artifact {
                        path: "result.md".into(),
                        sha256: sha256(b"fixture bytes"),
                    }],
                    evidence_ref: "fixture-snapshot".into(),
                },
            },
        },
        false,
    )
    .unwrap();
    run.proof(ProofRequest {
        proof_id: "proof".into(),
        check_id: "required".into(),
        coverage_sha256: run.coverage().unwrap(),
        issuer: "fixture-reviewer".into(),
        verdict: Verdict::Pass,
        evidence_ref: "fixture-review".into(),
        expected_revision: run.revision,
    })
    .unwrap();
    run.status()
}
fn metadata(status: &Status) -> RunMetadata {
    let owner = format!("summon_do:{}", status.run_id);
    RunMetadata {
        origin: Fact::current(
            "fixture-commissioner",
            "fixture-commission",
            1000,
            Origin {
                agent_id: Some(format!("agent:{}", status.run_id)),
                brief: status.task.brief.clone(),
                acceptance: vec!["Frozen original-source acceptance".into()],
                rationale: vec![],
                decisions: vec![],
            },
        ),
        native: Fact::current(
            "pi",
            "fixture-native-observation",
            1000,
            NativeState::Settled,
        ),
        lineage: Fact::current(
            &owner,
            "fixture-scope-inventory",
            1000,
            Lineage {
                complete: true,
                unresolved: vec![],
                edges: vec![],
            },
        ),
        evidence: required_evidence(status),
        child_packets: vec![],
        decisions: vec![],
    }
}
// Explicit synthetic receipt collection against the actual frozen task/native refs.
fn required_evidence(status: &Status) -> Vec<EvidenceRef> {
    let d = status.delivery.as_ref().unwrap();
    let make = |kind, owner: &str, reference: &str, bytes: String| EvidenceRef {
        kind,
        source: SourceStamp {
            owner: owner.into(),
            reference: reference.into(),
            read_at_unix_ms: 1000,
            sha256: Some(bytes),
            state: FactState::Current,
            detail: Some("synthetic fixture receipt, not native collection".into()),
        },
        candidate_sha256: Some(d.workspace_sha256.clone()),
        coverage_sha256: status.coverage_sha256.clone(),
    };
    let mut refs = vec![make(
        EvidenceKind::Candidate,
        "fixture-verifier",
        &d.evidence_ref,
        sha256(b"fixture manifest bytes"),
    )];
    for a in &d.artifacts {
        refs.push(make(
            EvidenceKind::Deliverable,
            "fixture-verifier",
            &a.path,
            a.sha256.clone(),
        ));
    }
    for i in &status.inputs {
        if let Some(r) = &i.acknowledged {
            refs.push(make(
                EvidenceKind::Trace,
                &status.task.route.harness,
                &r.evidence_ref,
                sha256(b"fixture native trace bytes"),
            ));
        }
    }
    for c in &status.task.checks {
        let p = status
            .proofs
            .iter()
            .rev()
            .find(|p| {
                p.check_id == c.id() && Some(&p.coverage_sha256) == status.coverage_sha256.as_ref()
            })
            .unwrap();
        let kind = match c {
            Check::Command { .. } => EvidenceKind::Check,
            Check::Review { .. } => EvidenceKind::Review,
        };
        refs.push(make(
            kind,
            &p.issuer,
            &p.evidence_ref,
            sha256(b"fixture exact check receipt"),
        ));
    }
    refs
}
fn record(id: &str) -> AgentRunAttemptV1 {
    let status = verified(id);
    let m = metadata(&status);
    AgentRunAttemptV1::from_status(status, Some(&m), 1000)
}
fn edge(from: &str, to: &str) -> Relation {
    let mut edge = Relation {
        edge_id: format!("{from}->{to}"),
        from: from.into(),
        to: to.into(),
        kind: RelationKind::Child,
        original_source_ref: "fixture-original-delegation".into(),
        source: SourceStamp {
            owner: format!("summon_do:{from}"),
            reference: format!("{from}/relationship/{to}"),
            read_at_unix_ms: 1000,
            sha256: None,
            state: FactState::Current,
            detail: None,
        },
    };
    edge.source.sha256 = Some(edge.fact_digest());
    edge
}
fn link(
    parent: &mut AgentRunAttemptV1,
    child: &AgentRunAttemptV1,
    packet: Option<&PacketManifestV1>,
) {
    let e = edge(&parent.node_id, &child.node_id);
    let mut l = parent.lineage.value.clone().unwrap();
    l.edges.push(e.clone());
    parent.lineage = Fact::current(
        &format!("summon_do:{}", parent.node_id),
        "fixture-scope-inventory",
        1000,
        l,
    );
    if let Some(p) = packet {
        parent.child_packets.push(ChildPacketRef {
            edge_id: e.edge_id,
            node_id: child.node_id.clone(),
            packet: SourceStamp {
                owner: format!("summon_do:{}", child.node_id),
                reference: format!("fixture-archive:{}", p.archive_sha256()),
                read_at_unix_ms: 1000,
                sha256: Some(p.archive_sha256()),
                state: FactState::Current,
                detail: None,
            },
            child_binding_sha256: Some(child.binding_sha256()),
        });
    }
}
#[test]
fn task_required_receipts_cannot_be_missing_partial_unrelated_or_unbound() {
    let complete = record("cf1:required-receipts");
    assert!(
        packet(vec![complete.clone()], &complete.node_id, &[])
            .proof
            .as_ref()
            .unwrap()
            .recursive_pass
    );
    for mode in [
        "empty",
        "partial",
        "unrelated",
        "stale",
        "unbound",
        "wrong-output-bytes",
        "wrong-check-owner",
    ] {
        let mut record = complete.clone();
        match mode {
            "empty" => record.evidence.clear(),
            "partial" => {
                record.evidence.pop();
            }
            "unrelated" => {
                for e in &mut record.evidence {
                    e.source.reference = "unrelated fresh bytes".into();
                }
            }
            "stale" => {
                for e in &mut record.evidence {
                    e.coverage_sha256 = Some(sha256(b"old task/input/candidate"));
                }
            }
            "unbound" => {
                for e in &mut record.evidence {
                    e.coverage_sha256 = None;
                    e.candidate_sha256 = None;
                }
            }
            "wrong-output-bytes" => {
                record
                    .evidence
                    .iter_mut()
                    .find(|e| e.kind == EvidenceKind::Deliverable)
                    .unwrap()
                    .source
                    .sha256 = Some(sha256(b"wrong artifact bytes"))
            }
            "wrong-check-owner" => {
                record
                    .evidence
                    .iter_mut()
                    .find(|e| e.kind == EvidenceKind::Review)
                    .unwrap()
                    .source
                    .owner = "unapproved reviewer".into()
            }
            _ => unreachable!(),
        }
        let archive = packet(vec![record.clone()], &record.node_id, &[]);
        archive.validate_archive().unwrap();
        assert!(
            !archive.proof.as_ref().unwrap().recursive_pass,
            "{mode} evidence cannot cover frozen task outputs/checks/native trace"
        );
        assert!(
            archive
                .proof
                .as_ref()
                .unwrap()
                .issues
                .iter()
                .any(|i| matches!(i.state, FactState::Missing | FactState::Stale)),
            "{mode}"
        );
    }
}

fn packet(
    records: Vec<AgentRunAttemptV1>,
    root: &str,
    packets: &[PacketManifestV1],
) -> PacketManifestV1 {
    PacketManifestV1::export(&VisibilityGraph::new(records).unwrap(), root, packets).unwrap()
}
#[test]
fn shared_child_is_one_node_and_packets_reopen_with_original_bindings() {
    let leaf = record("cf1:shared");
    let p_leaf = packet(vec![leaf.clone()], &leaf.node_id, &[]);
    let mut a = record("cf1:a");
    let mut b = record("cf1:b");
    link(&mut a, &leaf, Some(&p_leaf));
    link(&mut b, &leaf, Some(&p_leaf));
    let mut dependency = b.lineage.value.clone().unwrap();
    dependency.edges[0].kind = RelationKind::Dependency;
    dependency.edges[0].source.sha256 = Some(dependency.edges[0].fact_digest());
    b.lineage = Fact::current(
        "summon_do:cf1:b",
        "fixture-scope-inventory",
        1000,
        dependency,
    );
    let p_a = packet(
        vec![a.clone(), leaf.clone()],
        &a.node_id,
        std::slice::from_ref(&p_leaf),
    );
    let p_b = packet(
        vec![b.clone(), leaf.clone()],
        &b.node_id,
        std::slice::from_ref(&p_leaf),
    );
    let mut root = record("cf1:root");
    link(&mut root, &a, Some(&p_a));
    link(&mut root, &b, Some(&p_b));
    let graph =
        VisibilityGraph::new(vec![root.clone(), a.clone(), b.clone(), leaf.clone()]).unwrap();
    let catalog = vec![p_leaf.clone(), p_a, p_b];
    let manifest = PacketManifestV1::export(&graph, &root.node_id, &catalog).unwrap();
    assert!(manifest.proof.as_ref().unwrap().recursive_pass);
    let reopened: PacketManifestV1 =
        serde_json::from_slice(&serde_json::to_vec(&manifest).unwrap()).unwrap();
    assert!(reopened.reopen(&graph, &catalog).unwrap().recursive_pass);
    let page = graph.page(&root.node_id, None, 128).unwrap();
    assert_eq!(page.records.len(), 4);
    assert_eq!(page.edges.len(), 4);
    assert_eq!(
        page.records
            .iter()
            .map(|r| r.node_id.clone())
            .collect::<BTreeSet<_>>()
            .len(),
        4
    );
    // Child source/candidate changes even when parent candidate and last-good archive are unchanged.
    let mut changed = leaf.clone();
    let status = changed.managed.as_mut().unwrap();
    status.delivery.as_mut().unwrap().workspace_sha256 = sha256(b"changed complete tree");
    status.revision += 1;
    changed.source.sha256 = Some(sha256(&serde_json::to_vec(status).unwrap()));
    let fresh = VisibilityGraph::new(vec![root, a, b, changed]).unwrap();
    let result = reopened.reopen(&fresh, &catalog).unwrap();
    assert!(!result.recursive_pass);
    assert!(result.issues.iter().any(|i| i.state == FactState::Stale));
}
#[test]
fn timestamps_alone_preserve_semantics_but_not_archive_bytes_and_reader_failure_blocks() {
    let leaf = record("cf1:leaf");
    let old = packet(vec![leaf.clone()], &leaf.node_id, &[]);
    let mut parent = record("cf1:parent");
    link(&mut parent, &leaf, Some(&old));
    let graph = VisibilityGraph::new(vec![parent.clone(), leaf.clone()]).unwrap();
    let root =
        PacketManifestV1::export(&graph, &parent.node_id, std::slice::from_ref(&old)).unwrap();
    let mut refreshed = leaf.clone();
    refreshed.source.read_at_unix_ms += 99;
    refreshed.origin.source.read_at_unix_ms += 99;
    assert_eq!(leaf.binding_sha256(), refreshed.binding_sha256());
    let new = packet(vec![refreshed.clone()], &refreshed.node_id, &[]);
    assert_ne!(old.archive_sha256(), new.archive_sha256());
    parent.child_packets[0].packet.sha256 = Some(new.archive_sha256());
    parent.child_packets[0].packet.reference = "new timestamp-only archive".into();
    let fresh = VisibilityGraph::new(vec![parent.clone(), refreshed.clone()]).unwrap();
    assert_eq!(root.binding_sha256, parent.binding_sha256());
    // Original archived root still requires ORIGINAL child bytes, not a convenience latest file.
    assert!(
        root.reopen(&fresh, std::slice::from_ref(&old))
            .unwrap()
            .recursive_pass
    );
    assert!(
        !root
            .reopen(&fresh, std::slice::from_ref(&new))
            .unwrap()
            .recursive_pass
    );
    assert!(
        PacketManifestV1::export(&fresh, &parent.node_id, std::slice::from_ref(&new))
            .unwrap()
            .proof
            .as_ref()
            .unwrap()
            .recursive_pass
    );
    refreshed.source.state = FactState::Failed;
    refreshed.source.detail = Some("actual reader failed; retained last-good bytes".into());
    let failed = VisibilityGraph::new(vec![parent, refreshed]).unwrap();
    let proof = root.reopen(&failed, &[old, new]).unwrap();
    assert!(!proof.recursive_pass);
    assert!(proof.issues.iter().any(|i| i.state == FactState::Failed));
}
#[test]
fn missing_inaccessible_incomplete_cancelled_and_interrupted_are_exportable_not_green() {
    let leaf = record("cf1:absent");
    let mut parent = record("cf1:parent");
    link(&mut parent, &leaf, None);
    let p = packet(vec![parent.clone()], &parent.node_id, &[]);
    assert!(!p.proof.as_ref().unwrap().recursive_pass);
    let mut incomplete = parent.lineage.value.clone().unwrap();
    incomplete.complete = false;
    incomplete.unresolved.push(InventoryGap {
        reference: "undiscovered workers".into(),
        state: FactState::Inaccessible,
        reason: "scope reader unavailable".into(),
    });
    parent.lineage = Fact::current(
        "summon_do:cf1:parent",
        "fixture-scope-inventory",
        1000,
        incomplete,
    );
    parent.native.source.state = FactState::Cancelled;
    let s = parent.managed.as_mut().unwrap();
    s.phase = Phase::Interrupted;
    parent.source.sha256 = Some(sha256(&serde_json::to_vec(s).unwrap()));
    let p = packet(vec![parent.clone()], &parent.node_id, &[]);
    p.validate_archive().unwrap();
    assert!(!p.proof.as_ref().unwrap().recursive_pass);
    for state in [
        FactState::Missing,
        FactState::Cancelled,
        FactState::Inaccessible,
    ] {
        assert!(
            p.proof
                .as_ref()
                .unwrap()
                .issues
                .iter()
                .any(|i| i.state == state)
        );
    }
}
#[test]
fn cycle_conflicting_identity_and_relationship_source_are_refused_before_export() {
    let mut a = record("cf1:a");
    let mut b = record("cf1:b");
    link(&mut a, &b, None);
    link(&mut b, &a, None);
    assert_eq!(
        VisibilityGraph::new(vec![a.clone(), b]).err().unwrap().code,
        "lineage_cycle"
    );
    let mut duplicate = a.clone();
    duplicate.source.state = FactState::Stale;
    assert_eq!(
        VisibilityGraph::new(vec![a.clone(), duplicate])
            .err()
            .unwrap()
            .code,
        "identity_conflict"
    );
    let mut aliased = a.clone();
    aliased.node_id = "duplicated-native-worker".into();
    assert_eq!(
        VisibilityGraph::new(vec![a.clone(), aliased])
            .err()
            .unwrap()
            .code,
        "identity_conflict"
    );
    let mut conflicting = record("cf1:other-reader");
    let mut original = a.lineage.value.clone().unwrap();
    original.edges[0].source.owner = "competing-edge-owner".into();
    conflicting.lineage = Fact::current(
        "summon_do:cf1:other-reader",
        "fixture scope",
        1000,
        original,
    );
    assert_eq!(
        VisibilityGraph::new(vec![a, conflicting])
            .err()
            .unwrap()
            .code,
        "identity_conflict"
    );
}
#[test]
fn deep_fixture_pages_have_no_depth_cutoff_and_cursor_cannot_mix_source_revisions() {
    let mut records: Vec<_> = (0..512).map(|n| record(&format!("cf1:deep-{n}"))).collect();
    for n in 0..511 {
        let child = records[n + 1].clone();
        link(&mut records[n], &child, None);
    }
    let graph = VisibilityGraph::new(records.clone()).unwrap();
    let mut seen = BTreeSet::new();
    let mut cursor = None;
    loop {
        let page = graph.page("cf1:deep-0", cursor.as_ref(), 37).unwrap();
        for r in page.records {
            assert!(seen.insert(r.node_id));
        }
        cursor = page.next;
        if cursor.is_none() {
            break;
        }
    }
    assert_eq!(seen.len(), 512);
    let first = graph.page("cf1:deep-0", None, 1).unwrap();
    records[511].source.state = FactState::Inaccessible;
    let changed = VisibilityGraph::new(records).unwrap();
    assert_eq!(
        changed
            .page("cf1:deep-0", first.next.as_ref(), 1)
            .unwrap_err()
            .code,
        "stale_cursor"
    );
}
#[test]
fn unmanaged_observed_agent_has_unknown_summon_phase_and_origin_cannot_override_task() {
    let managed = record("cf1:managed");
    let mut observed = managed.clone();
    observed.management = Management::ObservedOnly;
    observed.managed = None;
    observed.identity.run_id = None;
    observed.identity.attempt_id = None;
    observed.source.owner = "pi-native".into();
    observed.validate().unwrap();
    let p = packet(vec![observed.clone()], &observed.node_id, &[]);
    assert!(!p.proof.as_ref().unwrap().recursive_pass);
    observed.identity.attempt_id = Some("invented".into());
    assert_eq!(observed.validate().unwrap_err().code, "identity_conflict");
    let status = managed.managed.unwrap();
    let old = metadata(&status);
    let mut request = MetadataRequest {
        expected_run_revision: status.revision,
        expected_metadata_sha256: Some(managed.metadata_sha256.unwrap()),
        metadata: old.clone(),
    };
    request.metadata.origin = Fact::current(
        "fixture-commissioner",
        "fixture-commission",
        2000,
        Origin {
            acceptance: vec!["replacement".into()],
            ..old.origin.value.clone().unwrap()
        },
    );
    assert_eq!(
        validate_metadata(&status, Some(&old), &request)
            .unwrap_err()
            .code,
        "origin_conflict"
    );
}
