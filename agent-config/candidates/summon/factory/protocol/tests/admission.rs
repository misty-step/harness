use std::collections::{BTreeMap, BTreeSet};
use summon_protocol::{admission::*, judgment, *};
fn set(values: &[&str]) -> BTreeSet<String> {
    values.iter().map(|s| s.to_string()).collect()
}
fn fact() -> OwnerFact {
    OwnerFact {
        owner: "fixture-account-owner".into(),
        reference: "fixture-dedicated-allocation-NOT-paid-headroom".into(),
        sha256: sha256(b"fixture"),
        observed_at_ms: 1000,
        usage_through_ms: 1000,
        valid_until_ms: 5000,
        basis: FactBasis::DedicatedReserve,
    }
}
fn status(id: &str) -> Status {
    Run::intake(Intake {
        task: TaskSpec {
            id: id.into(),
            kind: TaskKind::Research,
            brief: "Fixture only; no model or native execution".into(),
            workspace: "/synthetic/workspace".into(),
            route: Route {
                harness: "pi".into(),
                provider: "fixture-native".into(),
                model: "fixture-model".into(),
                effort: "high".into(),
            },
            checks: vec![],
            outputs: vec![],
            source: None,
            commission_ref: None,
            context: None,
        },
        initial_input_id: "first".into(),
    })
    .unwrap()
    .status()
}
fn policy() -> AccountPolicy {
    let mut meters = BTreeMap::new();
    for (id, kind, account, unit, amount) in [
        (
            "subscription",
            MeterKind::SubscriptionQuota,
            "fixture-native-account",
            "native_turns",
            2,
        ),
        (
            "api",
            MeterKind::ApiUsdMicros,
            "fixture-openrouter-account",
            "usd_micros",
            100,
        ),
        (
            "capacity",
            MeterKind::ResourceCapacity,
            "fixture-cf-account",
            "instance_slots",
            1,
        ),
        (
            "resource_cash",
            MeterKind::ResourceUsdMicros,
            "fixture-cf-account",
            "usd_micros",
            50,
        ),
    ] {
        meters.insert(
            id.into(),
            MeterGrant {
                billing_account: account.into(),
                kind,
                unit: unit.into(),
                period_id: "fixture-window".into(),
                period_start_ms: 0,
                period_end_ms: 6000,
                allocated: amount,
                authority: fact(),
            },
        );
    }
    let native = Seat {
        operation: Operation::NativeTurn,
        route: status("cf1:native").task.route,
        provider_account: "fixture-native-account".into(),
        entitlement: Entitlement::NativeSubscription,
        entitlement_ref: fact(),
        runtime_compatibility: fact(),
        capabilities: set(&["native_turn"]),
        approval_scope: "fixture-dispatch-scope".into(),
        approval: fact(),
        projects: set(&["a", "b"]),
        actors: set(&["loopback-fixture-owner"]),
        meters: set(&["subscription", "capacity", "resource_cash"]),
        outcome_owner: "fixture-independent-outcome-owner".into(),
    };
    let jev = Seat {
        operation: Operation::JevDecision,
        route: judgment::route(),
        provider_account: "fixture-openrouter-account".into(),
        entitlement: Entitlement::ThirdPartyApi,
        capabilities: set(&["clarify"]),
        meters: set(&["api", "capacity", "resource_cash"]),
        ..native.clone()
    };
    AccountPolicy {
        account: authority::CANARY_ACCOUNT.into(),
        policy_id: "fixture-policy".into(),
        revision: 1,
        meters,
        seats: BTreeMap::from([("native".into(), native), ("jev".into(), jev)]),
    }
}
fn request(id: &str, run: &str, project: &str, seat: &str) -> ReserveRequest {
    ReserveRequest {
        reservation_id: id.into(),
        operation_id: format!("op-{id}"),
        run_id: run.into(),
        input_id: "first".into(),
        project: project.into(),
        seat_id: seat.into(),
        capabilities: if seat == "native" {
            set(&["native_turn"])
        } else {
            set(&["clarify"])
        },
        amounts: if seat == "native" {
            BTreeMap::from([
                ("subscription".into(), 1),
                ("capacity".into(), 1),
                ("resource_cash".into(), 10),
            ])
        } else {
            BTreeMap::from([
                ("api".into(), 20),
                ("capacity".into(), 1),
                ("resource_cash".into(), 10),
            ])
        },
    }
}
fn final_receipt(r: &ReserveRequest) -> FinalReceipt {
    FinalReceipt {
        receipt_id: format!("final-{}", r.reservation_id),
        reservation_id: r.reservation_id.clone(),
        operation_id: r.operation_id.clone(),
        disposition: FinalDisposition::OwnerFinal,
        owner: "fixture-independent-outcome-owner".into(),
        evidence_ref: "fixture-native/external-final-evidence-NOT-permission".into(),
        evidence_sha256: sha256(b"fixture-final"),
        actual: r
            .amounts
            .iter()
            .map(|(id, v)| (id.clone(), if id == "capacity" { 0 } else { *v }))
            .collect(),
    }
}

#[test]
fn shared_account_unknown_outcomes_do_not_expire_or_repartition() {
    let mut ledger = AccountLedger::new(policy()).unwrap();
    let a = status("cf1:a");
    let b = status("cf1:b");
    let ra = request("r-a", "cf1:a", "a", "native");
    let rb = request("r-b", "cf1:b", "b", "native");
    assert!(
        !ledger
            .reserve(ra.clone(), &a, "loopback-fixture-owner", 1000)
            .unwrap()
    );
    assert_eq!(
        ledger
            .reserve(rb.clone(), &b, "loopback-fixture-owner", 1000)
            .unwrap_err()
            .code,
        "budget_unavailable"
    );
    ledger
        .uncertain("r-a", "fixture-lost-ACK-not-native-death".into())
        .unwrap();
    assert_eq!(ledger.debit("capacity").unwrap(), 1);
    let bytes = serde_json::to_vec(&ledger).unwrap();
    let mut restored: AccountLedger = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(
        restored
            .reserve(rb.clone(), &b, "loopback-fixture-owner", 6000)
            .unwrap_err()
            .code,
        "authority_unavailable"
    );
    assert_eq!(restored.debit("capacity").unwrap(), 1);
    assert!(
        restored
            .reserve(ra.clone(), &a, "loopback-fixture-owner", 6000)
            .unwrap()
    ); // stable read, NOT new permission
    let mut changed = ra.clone();
    changed.amounts.insert("subscription".into(), 2);
    assert_eq!(
        restored
            .reserve(changed, &a, "loopback-fixture-owner", 1000)
            .unwrap_err()
            .code,
        "reservation_conflict"
    );
    let f = final_receipt(&ra);
    assert_eq!(
        restored
            .reconcile_verified(f.clone(), "granted-operator-not-outcome-owner")
            .unwrap_err()
            .code,
        "receipt_refused"
    );
    restored.reconcile_verified(f.clone(), &f.owner).unwrap();
    assert!(restored.reconcile_verified(f.clone(), &f.owner).unwrap());
    restored
        .reserve(rb, &b, "loopback-fixture-owner", 1000)
        .unwrap();
    assert_eq!(restored.debit("subscription").unwrap(), 2);
    assert_eq!(restored.debit("resource_cash").unwrap(), 20);
    assert!(
        account_object_key(authority::CANARY_ACCOUNT)
            .unwrap()
            .starts_with("summon-account-admission-v1:")
    );
    assert!(account_object_key("client-account-alias").is_err());
    assert!(restored.fits(true));
}
#[test]
fn account_meter_truth_and_frozen_native_route_fail_closed() {
    let mut aliased = policy();
    aliased.meters.insert(
        "project-label-alias".into(),
        aliased.meters["capacity"].clone(),
    );
    assert!(AccountLedger::new(aliased).is_err());
    let s = status("cf1:truth");
    let r = request("truth", "cf1:truth", "a", "native");
    for basis in [
        FactBasis::PlanMaximum,
        FactBasis::PaidPlan,
        FactBasis::BillingReport,
        FactBasis::Unsupported,
    ] {
        let mut p = policy();
        p.meters.get_mut("capacity").unwrap().authority.basis = basis;
        let mut l = AccountLedger::new(p).unwrap();
        assert_eq!(
            l.reserve(r.clone(), &s, "loopback-fixture-owner", 1000)
                .unwrap_err()
                .code,
            "authority_unavailable"
        );
        assert!(l.reservations.is_empty());
    }
    let mut p = policy();
    p.meters
        .get_mut("subscription")
        .unwrap()
        .authority
        .usage_through_ms = 999;
    let mut l = AccountLedger::new(p).unwrap();
    assert!(
        l.reserve(r.clone(), &s, "loopback-fixture-owner", 1000)
            .is_err()
    );
    let mut p = policy();
    p.seats.get_mut("native").unwrap().route.provider =
        "fixture-third-party-OAuth-NOT-native-entitlement".into();
    let mut l = AccountLedger::new(p).unwrap();
    assert_eq!(
        l.reserve(r.clone(), &s, "loopback-fixture-owner", 1000)
            .unwrap_err()
            .code,
        "dispatch_ineligible"
    );
    let mut l = AccountLedger::new(policy()).unwrap();
    let before = l.clone();
    assert!(l.reserve(r.clone(), &s, "ungranted-actor", 1000).is_err());
    assert_eq!(l, before);
    let mut missing = r.clone();
    missing.amounts.remove("resource_cash");
    assert_eq!(
        l.reserve(missing, &s, "loopback-fixture-owner", 1000)
            .unwrap_err()
            .code,
        "meters_refused"
    );
    l.reserve(r.clone(), &s, "loopback-fixture-owner", 1000)
        .unwrap();
    let mut final_use = final_receipt(&r);
    final_use.actual.insert("resource_cash".into(), 100);
    l.reconcile_verified(final_use.clone(), &final_use.owner)
        .unwrap();
    assert_eq!(l.debit("resource_cash").unwrap(), 100);
    assert!(
        l.reserve(
            request("later", "cf1:other", "b", "native"),
            &status("cf1:other"),
            "loopback-fixture-owner",
            1000
        )
        .is_err()
    ); // actual overrun blocks, never truncates
}
#[test]
fn jev_typed_revision_cache_keeps_actual_cost_and_never_effects_or_retries() {
    let mut l = AccountLedger::new(policy()).unwrap();
    let s = status("cf1:jev");
    let r = request("j", "cf1:jev", "a", "jev");
    l.reserve(r.clone(), &s, "loopback-fixture-owner", 1000)
        .unwrap();
    let (j, replay) = l.plan_judgment("j", &s, 1000).unwrap();
    assert!(!replay);
    assert_eq!(j.request["model"], judgment::MODEL);
    assert!(!j.eligible.contains_key("consider_reserved_turn"));
    assert!(l.plan_judgment("j", &s, 1000).unwrap().1);
    let response = serde_json::json!({"model":"typesafe/jev-1.13-20260917","answers":{"next_action":{"type":"choice","choice":"clarify","confidence":1.0,"probabilities":{"clarify":1.0,"escalate":0.0}},"context_sufficient":{"type":"noul","noul":0.2},"unresolved_material_uncertainty":{"type":"noul","noul":0.9}},"usage":{"input_tokens":123,"output_tokens":17,"cost":0.0000011}});
    l.judgment_response(&j.key, response.clone()).unwrap();
    let advice = l.judgment_advice(&j.key, &s).unwrap();
    assert_eq!(advice.proposed, judgment::EligibleAction::Clarify);
    assert_eq!(advice.usage, response["usage"]);
    assert_eq!(advice.conservative_cost_micros, 2);
    assert_eq!(l.debit("api").unwrap(), 20); // unknown resource outcome STILL reserved
    let mut newer = s.clone();
    newer.revision += 1;
    assert!(l.judgment_advice(&j.key, &newer).is_err());
    assert_eq!(
        l.plan_judgment("j", &newer, 1000).unwrap_err().code,
        "judgment_revision_conflict"
    );
    assert_eq!(
        serde_json::to_value(&l.judgments[&j.key]).unwrap()["response"],
        response
    );
    let mut other = AccountLedger::new(policy()).unwrap();
    other
        .reserve(r, &s, "loopback-fixture-owner", 1000)
        .unwrap();
    let (pending, _) = other.plan_judgment("j", &s, 1000).unwrap();
    other.judgment_failure(&pending.key, "transport").unwrap();
    assert!(other.judgment_advice(&pending.key, &s).is_err());
    assert!(
        other
            .plan_judgment("j", &s, 1000)
            .unwrap()
            .0
            .failure
            .is_some()
    );
    assert_eq!(other.debit("api").unwrap(), 20);
    for (n, expected) in [
        ("0", 0),
        ("0.00000001", 1),
        ("0.000001", 1),
        ("0.0000010000000000000001", 2), // do not round through f64 before accounting
        ("0.0000011", 2),
        ("1.2345678", 1234568),
    ] {
        assert_eq!(
            judgment::usd_micros(&serde_json::from_str(n).unwrap()).unwrap(),
            expected
        );
    }
}
