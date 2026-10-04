use mage_executive::*;
use serde_json::{json, Value};
use std::{fs, os::unix::fs::PermissionsExt};

fn config() -> (tempfile::TempDir, Config) {
    let dir = tempfile::Builder::new()
        .prefix("mage-broker-")
        .tempdir_in(
            std::env::var_os("TMPDIR")
                .unwrap_or_else(|| format!("{}/.cache/tmp", std::env::var("HOME").unwrap()).into()),
        )
        .unwrap();
    fs::set_permissions(dir.path(), fs::Permissions::from_mode(0o700)).unwrap();
    let config: Config=serde_json::from_value(json!({"schema":"mage-executive/1","state_dir":dir.path(),"node":"/usr/bin/node","adapter":"/host/runtime.mjs","native_models_entry":"/host/native-models.js","instances":[{"id":"coo","role":"coo","instructions":"Strategy.","skills":[{"name":"operate","description":"Run operations","body":"Recall sources."}],"provider":"openai-codex","model":"gpt-6.1-sol","thinking":"xhigh"},{"id":"cto","role":"cto","instructions":"Engineering.","skills":[],"provider":"openai-codex","model":"gpt-6.1-sol","thinking":"xhigh"}]})).unwrap();
    config.validate().unwrap();
    (dir, config)
}
fn request(instance: &str, capability: &str, id: &str, args: Value) -> ToolRequest {
    ToolRequest {
        instance: instance.into(),
        capability: capability.into(),
        operation_id: id.into(),
        arguments: args,
        grant_id: None,
    }
}

#[test]
fn role_tools_refuse_before_any_effect_or_cross_role_context() {
    let (_dir, c) = config();
    let mut b = Broker::open(&c).unwrap();
    assert!(b
        .execute(&c, &request("coo", "factory_intake", "bad", json!({})))
        .unwrap_err()
        .to_string()
        .contains("wrong_role"));
    assert!(b
        .execute(&c, &request("cto", "mail_send", "bad", json!({})))
        .unwrap_err()
        .to_string()
        .contains("wrong_role"));
    assert_eq!(b.effects("coo").unwrap(), json!([]));
    assert!(b
        .execute(
            &c,
            &request("cto", "skill_read", "read", json!({"name":"operate"}))
        )
        .is_err());
    assert_eq!(
        b.execute(
            &c,
            &request("coo", "skill_read", "read", json!({"name":"operate"}))
        )
        .unwrap()["body"],
        "Recall sources."
    );
    assert!(b
        .execute(
            &c,
            &request("coo", "bash", "bad", json!({"command":"true"}))
        )
        .is_err());
    assert!(b
        .execute_for(
            &c,
            "coo",
            &request("cto", "factory_intake", "forged-instance", json!({}))
        )
        .unwrap_err()
        .to_string()
        .contains("instance_scope_refused"));
    assert_eq!(b.effects("cto").unwrap(), json!([]));
    // An internal run command must not poison the unique external-grant slot,
    // even before a gateway binding or valid command body is available.
    for capability in ["factory_intake", "factory_steer", "factory_cancel"] {
        let mut r = request("cto", capability, "poison-grant", json!({}));
        r.grant_id = Some("coo-effect-approval".into());
        assert!(b
            .execute(&c, &r)
            .unwrap_err()
            .to_string()
            .contains("cannot_consume_external_grant"));
    }
    assert_eq!(b.effects("cto").unwrap(), json!([]));
}
#[test]
fn memory_is_persisted_sourced_correctable_and_role_scoped() {
    let (_dir, c) = config();
    let mut b = Broker::open(&c).unwrap();
    let first = request(
        "coo",
        "memory_write",
        "m1",
        json!({"key":"deadline","expected_revision":0,"text":"Correct deadline Friday","source":"glass:decision-1"}),
    );
    assert_eq!(b.execute(&c, &first).unwrap()["revision"], 1);
    assert_eq!(b.execute(&c, &first).unwrap()["revision"], 1);
    let mut changed = first;
    changed.arguments["text"] = json!("Contradict same ID");
    assert!(b.execute(&c, &changed).is_err());
    let stale = request(
        "coo",
        "memory_write",
        "m2",
        json!({"key":"deadline","expected_revision":0,"text":"New date","source":"glass:decision-2"}),
    );
    assert!(b.execute(&c, &stale).is_err());
    let updated = request(
        "coo",
        "memory_write",
        "m2",
        json!({"key":"deadline","expected_revision":1,"text":"Corrected to Monday","source":"glass:decision-2"}),
    );
    assert_eq!(b.execute(&c, &updated).unwrap()["revision"], 2);
    drop(b);
    let mut b = Broker::open(&c).unwrap();
    let recall = b
        .execute(
            &c,
            &request("coo", "memory_recall", "r", json!({"query":"Monday"})),
        )
        .unwrap();
    assert_eq!(recall["notes"][0]["source"], "glass:decision-2");
    assert_eq!(recall["notes"][0]["revision"], 2);
    assert_eq!(
        b.execute(
            &c,
            &request("cto", "memory_recall", "r", json!({"query":"Monday"}))
        )
        .unwrap()["notes"],
        json!([])
    );
}
#[test]
fn ambiguous_effects_hold_across_reopen_and_new_call_ids_cannot_reuse_grant() {
    let (dir, mut c) = config();
    // A real owner appends an effect, then exits without a reply. The broker
    // must never infer not-applied from that loss or run it a second time.
    let effect = dir.path().join("owner-effects");
    c.integrations.push(Integration {
        capability: "mail_send".into(),
        executable: "/bin/sh".into(),
        args: vec![
            "-c".into(),
            format!("printf applied >> '{}'; exit 1", effect.display()),
        ],
        env_names: vec![],
    });
    let mut r = request(
        "coo",
        "mail_send",
        "send-1",
        json!({"to":"test-only","body":"report"}),
    );
    c.grants.push(Grant {
        id: "approval-1".into(),
        instance: "coo".into(),
        capability: "mail_send".into(),
        arguments_sha256: digest(&r.arguments),
        authority_ref: "operator:isolated-effect-test".into(),
    });
    let mut b = Broker::open(&c).unwrap();
    assert!(b
        .execute(&c, &r)
        .unwrap_err()
        .to_string()
        .contains("requires_exact_grant"));
    assert!(!effect.exists());
    r.grant_id = Some("approval-1".into());
    assert!(b.execute(&c, &r).is_err());
    assert_eq!(fs::read_to_string(&effect).unwrap(), "applied");
    drop(b);
    let mut b = Broker::open(&c).unwrap();
    assert!(b
        .execute(&c, &r)
        .unwrap_err()
        .to_string()
        .contains("ambiguous_effect_hold"));
    r.operation_id = "send-new-call".into();
    assert!(b.execute(&c, &r).is_err());
    assert_eq!(fs::read_to_string(&effect).unwrap(), "applied");
    assert!(b.effects("coo").unwrap()[0]["owner_receipt"].is_null());
}
#[test]
fn unsupported_route_and_missing_schedule_binding_are_explicit() {
    let (_dir, mut c) = config();
    c.instances[0].provider = "openrouter".into();
    assert!(c
        .validate()
        .unwrap_err()
        .to_string()
        .contains("unsupported route"));
    c.instances[0].provider = "openai-codex".into();
    let mut b = Broker::open(&c).unwrap();
    assert!(b
        .execute(
            &c,
            &request("coo", "schedule_request", "occurrence-1", json!({}))
        )
        .unwrap_err()
        .to_string()
        .contains("unsupported_integration"));
    assert_eq!(b.effects("coo").unwrap(), json!([]));
}
