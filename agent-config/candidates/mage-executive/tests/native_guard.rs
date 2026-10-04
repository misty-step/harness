use mage_executive::{
    native_guard::{stage_tools, Request},
    Broker, Config, Role, ToolRequest,
};
use serde_json::{json, Value};
use std::{
    fs,
    os::unix::fs::PermissionsExt,
    time::{SystemTime, UNIX_EPOCH},
};
fn setup() -> (tempfile::TempDir, Value) {
    let dir = tempfile::Builder::new()
        .prefix("mage-native-policy-")
        .tempdir_in(
            std::env::var_os("TMPDIR")
                .unwrap_or_else(|| format!("{}/.cache/tmp", std::env::var("HOME").unwrap()).into()),
        )
        .unwrap();
    fs::set_permissions(dir.path(), fs::Permissions::from_mode(0o700)).unwrap();
    let quota = json!({"schema":"mage-native-quota/1","owner_ref":"fixture:owned-quota-read","account_ref":"acct-0123456789","provider":"openai-codex","model":"gpt-6.1-sol","effort":"xhigh","auth_type":"oauth","auth_source":"stored","billing":"plan","verdict":"usable","observed_at_ms":SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis()as u64,"remaining_percent":75.0,"extra_usage_enabled":false,"degraded":null});
    let c = json!({"schema":"mage-executive/1","state_dir":dir.path(),"node":"/usr/bin/node","adapter":"/host/runtime.mjs","native_models_entry":"/host/models.mjs","native_staging":{"admission_ref":"fixture-stage-1","account_ref":"acct-0123456789","coo_input_id":"root-input","commission_id":"commission-1","quota_reader":{"executable":"/usr/bin/printf","args":[quota.to_string()]}},"instances":[{"id":"coo","role":"coo","instructions":"Fixture COO","skills":[],"provider":"openai-codex","model":"gpt-6.1-sol","thinking":"xhigh"},{"id":"cto","role":"cto","instructions":"Fixture CTO","skills":[],"provider":"openai-codex","model":"gpt-6.1-sol","thinking":"xhigh"}]});
    (dir, c)
}
fn config(v: Value) -> Config {
    let c: Config = serde_json::from_value(v).unwrap();
    c.validate().unwrap();
    c
}
fn request(class: &str) -> Request {
    let cto = class == "cto_commission";
    Request {
        instance: if cto { "cto" } else { "coo" }.into(),
        input_class: class.into(),
        input_id: match class {
            "coo_input" => "root-input",
            "cto_commission" => "mage-commission:commission-1",
            _ => "mage-report:37",
        }
        .into(),
        account_ref: "acct-0123456789".into(),
        body_sha256: "a".repeat(64),
        body_bytes: 2000,
        tools: stage_tools(if cto { Role::Cto } else { Role::Coo }),
    }
}
#[test]
fn physical_budget_is_shared_durable_and_never_reset_by_new_input_or_admission() {
    let (_dir, v) = setup();
    let c = config(v.clone());
    let mut b = Broker::open(&c).unwrap();
    for class in ["coo_input", "cto_commission", "coo_wake"] {
        for n in 1..=4 {
            assert_eq!(
                b.native_admit(&c, &request(class)).unwrap()["input_reserved"],
                n
            );
        }
        assert!(b
            .native_admit(&c, &request(class))
            .unwrap_err()
            .to_string()
            .contains("budget_exhausted"));
    }
    drop(b);
    let mut b = Broker::open(&c).unwrap();
    assert!(b.native_admit(&c, &request("coo_input")).is_err());
    let mut another = request("coo_wake");
    another.input_id = "mage-report:38".into();
    assert!(b
        .native_admit(&c, &another)
        .unwrap_err()
        .to_string()
        .contains("identity_changed"));
    let mut changed = v;
    changed["native_staging"]["admission_ref"] = json!("changed-admission");
    let changed = config(changed);
    assert!(b
        .native_admit(&changed, &request("coo_input"))
        .unwrap_err()
        .to_string()
        .contains("no_budget_reset"));
}
#[test]
fn exact_account_route_fresh_quota_and_explicit_extra_usage_are_required() {
    let (_dir, v) = setup();
    for (field, bad) in [
        ("account_ref", json!("another-pool-member")),
        ("billing", json!("credits")),
        ("verdict", json!("unknown")),
        ("remaining_percent", json!(0)),
        ("degraded", json!("refresh failed")),
        ("observed_at_ms", json!(0)),
        ("extra_usage_enabled", Value::Null),
        ("extra_usage_enabled", json!(true)),
    ] {
        let mut c = v.clone();
        let mut quota: Value = serde_json::from_str(
            c["native_staging"]["quota_reader"]["args"][0]
                .as_str()
                .unwrap(),
        )
        .unwrap();
        quota[field] = bad;
        c["native_staging"]["quota_reader"]["args"][0] = json!(quota.to_string());
        let c = config(c);
        let mut b = Broker::open(&c).unwrap();
        assert!(
            b.native_admit(&c, &request("coo_input")).is_err(),
            "{field}"
        );
    }
}
#[test]
fn staging_refuses_unbounded_body_tool_offer_and_external_capabilities() {
    let (_dir, v) = setup();
    let c = config(v);
    let mut b = Broker::open(&c).unwrap();
    let mut r = request("coo_input");
    r.body_bytes = 96 * 1024 + 1;
    assert!(b.native_admit(&c, &r).is_err());
    r.body_bytes = 1000;
    r.tools.push("bash".into());
    assert!(b.native_admit(&c, &r).is_err());
    for capability in [
        "factory_intake",
        "factory_cancel",
        "factory_steer",
        "mail_send",
    ] {
        let r = ToolRequest {
            instance: "cto".into(),
            capability: capability.into(),
            operation_id: "refused".into(),
            arguments: json!({}),
            grant_id: None,
        };
        assert!(b.execute(&c, &r).is_err());
    }
}
