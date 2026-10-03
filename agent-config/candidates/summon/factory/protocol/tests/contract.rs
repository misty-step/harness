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
