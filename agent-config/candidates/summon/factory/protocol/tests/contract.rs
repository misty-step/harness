use summon_protocol::*;

fn task() -> TaskSpec {
    serde_json::from_value(serde_json::json!({
        "id":"cf1:contract", "kind":"implementation", "brief":"Bounded work", "workspace":"/owned/work",
        "route":{"harness":"pi", "provider":"openai-codex", "model":"selected", "effort":"high"},
        "checks":[], "outputs":[]
    })).unwrap()
}
#[test]
fn frozen_context_defaults_are_distinct_from_explicit_none_and_no_tracker_is_required() {
    let default = task();
    default.validate().unwrap();
    let mut none = default.clone();
    none.context = Some(Context {
        instructions: Some(vec![]),
        skills: Some(vec![]),
    });
    let run = Run::intake(Intake {
        task: default.clone(),
        initial_input_id: "initial".into(),
    })
    .unwrap();
    assert_eq!(
        run.same_intake(&Intake {
            task: none,
            initial_input_id: "initial".into()
        })
        .unwrap_err()
        .code,
        "intake_conflict"
    );
    let roundtrip: Run = serde_json::from_slice(&serde_json::to_vec(&run).unwrap()).unwrap();
    assert_eq!(roundtrip.status(), run.status());
    assert!(
        serde_json::from_value::<TaskSpec>(serde_json::json!({"permissions":"override"})).is_err()
    );
}
#[test]
fn canonical_storage_reserves_terminal_bytes_and_restores_legacy_replays() {
    let mut run = Run::intake(Intake {
        task: task(),
        initial_input_id: "initial".into(),
    })
    .unwrap();
    let claim = ClaimRequest {
        claim_id: "claim".into(),
        runner_id: "runner".into(),
        expected_revision: run.revision,
    };
    let d = run.claim(claim.clone()).unwrap().0;
    let mut legacy = serde_json::to_value(&run).unwrap();
    legacy["claims"]["claim"] = serde_json::json!({"request":claim,"dispatch":d});
    let mut restored = storage::decode(&serde_json::to_vec(&legacy).unwrap()).unwrap();
    assert_eq!(restored.claim(claim.clone()).unwrap(), (d.clone(), true));
    assert_eq!(
        restored
            .claim(ClaimRequest {
                runner_id: "different".into(),
                ..claim.clone()
            })
            .unwrap_err()
            .code,
        "claim_conflict"
    );
    let snapshot = storage::encode(&run).unwrap();
    assert!(storage::fits(&run, &snapshot, true));
    assert!(snapshot.len() < serde_json::to_vec(&run).unwrap().len());
    assert_eq!(storage::decode(&snapshot).unwrap(), run);
    // Maximum validated refs, ACK, one lost-ACK event, termination, then a final
    // answer with worst JSON escape expansion. All facts remain byte-exact.
    let receipt = NativeReceipt {
        session: NativeSession {
            runtime: "pi".into(),
            host: "h".repeat(4096),
            session_id: "s".repeat(4096),
            session_file: "/".repeat(4096),
        },
        native_message_ref: "m".repeat(4096),
        evidence_ref: "e".repeat(4096),
    };
    let mut used_before = snapshot.len() + storage::reserved_bytes(&run, false);
    for (n, observation) in [
        Observation::Acknowledged {
            receipt: receipt.clone(),
        },
        Observation::Uncertain {
            reason: "\u{1}".repeat(65536),
            evidence_ref: "u".repeat(4096),
        },
        Observation::Terminated {
            termination: Termination {
                session: receipt.session.clone(),
                evidence_ref: "t".repeat(4096),
            },
        },
        Observation::Answered {
            receipt,
            text: "\u{1}".repeat(65536),
            answer_ref: "a".repeat(4096),
        },
    ]
    .into_iter()
    .enumerate()
    {
        let request = ObserveRequest {
            event_id: format!("{n}{}", "v".repeat(4095)),
            input_id: d.input_id.clone(),
            attempt_id: d.attempt_id.clone(),
            text_sha256: d.text_sha256.clone(),
            expected_revision: run.revision,
            observation,
        };
        let reconcile = n == 3;
        run.observe(request.clone(), reconcile).unwrap();
        assert!(run.observe(request.clone(), reconcile).unwrap());
        let bytes = storage::encode(&run).unwrap();
        assert!(storage::fits(&run, &bytes, false), "native transition {n}");
        let recovered = storage::decode(&bytes).unwrap();
        assert_eq!(recovered, run);
        if n != 1 {
            assert!(
                bytes.len() + storage::reserved_bytes(&run, false) <= used_before,
                "terminal reservation covers transition {n}"
            );
        }
        used_before = bytes.len() + storage::reserved_bytes(&run, false);
        // Convert observation back to the old payload-copy cache format as well.
        let mut old = serde_json::to_value(&run).unwrap();
        old["observations"][&request.event_id] = serde_json::to_value(&request).unwrap();
        let mut recovered = storage::decode(&serde_json::to_vec(&old).unwrap()).unwrap();
        assert!(recovered.observe(request, reconcile).unwrap());
        assert_eq!(
            recovered.claim(claim.clone()).unwrap().0.native_session,
            None
        );
    }
    assert_eq!(run.inputs[0].answer.as_ref().unwrap().len(), 65536);
}

#[test]
fn old_unreserved_saturation_remains_readable_but_does_not_gain_terminal_room() {
    let mut run = Run::intake(Intake {
        task: task(),
        initial_input_id: "initial".into(),
    })
    .unwrap();
    let claim = ClaimRequest {
        claim_id: "old-claim".into(),
        runner_id: "runner".into(),
        expected_revision: run.revision,
    };
    let d = run.claim(claim.clone()).unwrap().0;
    // Reproduce the old, unreserved admission, not the new Worker admission path.
    for n in 0..8 {
        run.input(InputRequest {
            input_id: format!("old-{n}"),
            text: "x".repeat(64000),
        })
        .unwrap();
    }
    let mut legacy = serde_json::to_value(&run).unwrap();
    legacy["claims"]["old-claim"] = serde_json::json!({"request":claim,"dispatch":d});
    let old_bytes = serde_json::to_vec(&legacy).unwrap();
    assert!(old_bytes.len() <= storage::MAX_BYTES);
    let mut restored = storage::decode(&old_bytes).unwrap();
    let before = restored.status();
    assert_eq!(before.inputs.len(), 9);
    assert!(!storage::fits(
        &restored,
        &storage::encode(&restored).unwrap(),
        true
    ));
    restored
        .observe(
            ObserveRequest {
                event_id: "legacy-final".into(),
                input_id: d.input_id,
                attempt_id: d.attempt_id,
                text_sha256: d.text_sha256,
                expected_revision: restored.revision,
                observation: Observation::Answered {
                    receipt: NativeReceipt {
                        session: NativeSession {
                            runtime: "pi".into(),
                            host: "fixture".into(),
                            session_id: "legacy".into(),
                            session_file: "/fixture/session".into(),
                        },
                        native_message_ref: "fixture-user".into(),
                        evidence_ref: "fixture-native".into(),
                    },
                    text: "a".repeat(64000),
                    answer_ref: "fixture-answer".into(),
                },
            },
            false,
        )
        .unwrap();
    assert!(
        !storage::fits(&restored, &storage::encode(&restored).unwrap(), false),
        "old unsafe saturation cannot be retrospectively promised completion"
    );
    assert_eq!(
        storage::decode(&old_bytes).unwrap().status(),
        before,
        "original accepted inputs are retained, never silently migrated/truncated"
    );
}

#[test]
fn guards_refuse_without_mutation_and_zero_checks_never_verify() {
    let mut run = Run::intake(Intake {
        task: task(),
        initial_input_id: "initial".into(),
    })
    .unwrap();
    let claim = ClaimRequest {
        claim_id: "claim".into(),
        runner_id: "runner".into(),
        expected_revision: 1,
    };
    let (dispatch, replayed) = run.claim(claim.clone()).unwrap();
    assert!(!replayed);
    assert!(run.claim(claim).unwrap().1);
    let before = run.clone();
    let observe = ObserveRequest {
        event_id: "bad".into(),
        input_id: dispatch.input_id.clone(),
        attempt_id: "wrong".into(),
        text_sha256: dispatch.text_sha256.clone(),
        expected_revision: run.revision,
        observation: Observation::Uncertain {
            reason: "loss".into(),
            evidence_ref: "observed".into(),
        },
    };
    assert_eq!(
        run.observe(observe, false).unwrap_err().code,
        "native_mismatch"
    );
    assert_eq!(run, before);
    let receipt = NativeReceipt {
        session: NativeSession {
            runtime: "pi".into(),
            host: "host".into(),
            session_id: "session".into(),
            session_file: "/native/session".into(),
        },
        native_message_ref: "user-1".into(),
        evidence_ref: "receipt".into(),
    };
    run.observe(
        ObserveRequest {
            event_id: "answer".into(),
            input_id: dispatch.input_id.clone(),
            attempt_id: dispatch.attempt_id.clone(),
            text_sha256: dispatch.text_sha256.clone(),
            expected_revision: run.revision,
            observation: Observation::Answered {
                receipt,
                text: "final answer".into(),
                answer_ref: "assistant-1".into(),
            },
        },
        false,
    )
    .unwrap();
    run.observe(
        ObserveRequest {
            event_id: "snapshot".into(),
            input_id: dispatch.input_id,
            attempt_id: dispatch.attempt_id,
            text_sha256: dispatch.text_sha256,
            expected_revision: run.revision,
            observation: Observation::Delivery {
                delivery: Delivery {
                    workspace_sha256: sha256(b"entire tree"),
                    revision: None,
                    artifacts: vec![],
                    evidence_ref: "materialized snapshot".into(),
                },
            },
        },
        false,
    )
    .unwrap();
    assert!(run.coverage().is_some());
    assert_eq!(run.phase(), Phase::AwaitingReview);
}
