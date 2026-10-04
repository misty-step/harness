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
    assert!(restored.fits());
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

#[test]
fn outcome_projection_funds_worst_escaping_and_only_consumes_its_own_components() {
    let mut p = policy();
    p.meters.get_mut("capacity").unwrap().allocated = 10;
    for i in 0..12 {
        let id = format!("{i:02}{}", "\"".repeat(254));
        let mut grant = p.meters["capacity"].clone();
        grant.kind = MeterKind::ResourceUsage;
        grant.unit = format!("synthetic-grain-{i}");
        p.meters.insert(id, grant);
    }
    p.seats.get_mut("native").unwrap().meters = p.meters.keys().cloned().collect();
    let mut l = AccountLedger::new(p).unwrap();
    let mut r = request("escaped", "cf1:escaped", "a", "native");
    r.amounts = l.policy.seats["native"]
        .meters
        .iter()
        .map(|id| (id.clone(), 1))
        .collect();
    l.reserve(
        r.clone(),
        &status("cf1:escaped"),
        "loopback-fixture-owner",
        1000,
    )
    .unwrap();
    let jr = request("late", "cf1:late", "b", "jev");
    l.reserve(
        jr.clone(),
        &status("cf1:late"),
        "loopback-fixture-owner",
        1000,
    )
    .unwrap();
    let competitor = l.reservations["late"].clone();
    let mut envelope = l.projected_bytes().unwrap();
    for i in 0..8 {
        l.uncertain("escaped", format!("{i}{}", "\\".repeat(255)))
            .unwrap();
        assert!(l.projected_bytes().unwrap() <= envelope);
        envelope = l.projected_bytes().unwrap();
        assert_eq!(l.reservations["late"], competitor);
    }
    let mut f = final_receipt(&r);
    f.receipt_id = "\"".repeat(256);
    f.evidence_ref = "\\".repeat(256);
    f.actual = r
        .amounts
        .keys()
        .map(|id| (id.clone(), if id == "capacity" { 0 } else { u64::MAX }))
        .collect();
    l.reconcile_verified(f.clone(), &f.owner).unwrap();
    assert!(l.projected_bytes().unwrap() <= envelope);
    let (j, _) = l.plan_judgment("late", &status("cf1:late"), 1000).unwrap();
    l.judgment_failure(&j.key, "unsupported").unwrap();
    let mut never_started = final_receipt(&jr);
    never_started.disposition = FinalDisposition::ProvenNotStarted;
    never_started.actual.values_mut().for_each(|v| *v = 0);
    l.reconcile_verified(never_started.clone(), &never_started.owner)
        .unwrap();
    // Final closes uncertainty/usage, NOT a still-recordable original response.
    let actual = serde_json::to_vec(&l).unwrap().len();
    assert!(l.projected_bytes().unwrap() >= actual + 8192 - 4);
    let funded = l.projected_bytes().unwrap();
    let response = serde_json::Value::String("\"".repeat(4095));
    assert_eq!(serde_json::to_vec(&response).unwrap().len(), 8192);
    l.judgment_response(&j.key, response.clone()).unwrap();
    assert!(l.projected_bytes().unwrap() <= funded);
    let before = l.clone();
    assert!(l.judgment_response(&j.key, response).unwrap());
    assert!(l.reconcile_verified(f.clone(), &f.owner).unwrap());
    assert_eq!(l, before);
}

#[test]
fn observed_cash_is_an_order_independent_lower_bound_and_final_never_advises() {
    let s = status("cf1:actual-cost");
    let r = request("cash", &s.run_id, "a", "jev");
    let observed = serde_json::json!({"model":judgment::MODEL,"answers":{"next_action":{"type":"choice","choice":"clarify","confidence":1,"probabilities":{"clarify":1,"escalate":0}},"context_sufficient":{"type":"noul","noul":1},"unresolved_material_uncertainty":{"type":"noul","noul":0}},"usage":{"cost":0.000025}});
    for disposition in [
        FinalDisposition::OwnerFinal,
        FinalDisposition::ProvenNotStarted,
    ] {
        let mut l = AccountLedger::new(policy()).unwrap();
        l.reserve(r.clone(), &s, "loopback-fixture-owner", 1000)
            .unwrap();
        let (j, _) = l.plan_judgment("cash", &s, 1000).unwrap();
        let mut f = final_receipt(&r);
        f.disposition = disposition;
        f.actual.values_mut().for_each(|v| *v = 0);
        l.reconcile_verified(f.clone(), &f.owner).unwrap();
        l.judgment_response(&j.key, observed.clone()).unwrap();
        assert_eq!(l.debit("api").unwrap(), 25); // overrun25 > reserved20; not clipped or added twice
        assert_eq!(l.reservations["cash"].final_receipt, Some(f.clone()));
        assert!(l.reconcile_verified(f.clone(), &f.owner).unwrap());
        let mut within = observed.clone();
        within["usage"]["cost"] = serde_json::json!(0.00001);
        let mut advice_check = AccountLedger::new(policy()).unwrap();
        advice_check
            .reserve(r.clone(), &s, "loopback-fixture-owner", 1000)
            .unwrap();
        let (advice_j, _) = advice_check.plan_judgment("cash", &s, 1000).unwrap();
        advice_check
            .reconcile_verified(f.clone(), &f.owner)
            .unwrap();
        advice_check
            .judgment_response(&advice_j.key, within)
            .unwrap();
        assert!(advice_check.judgment_advice(&advice_j.key, &s).is_err()); // also within original ceiling, finalized operation
        let mut later = request("next", "cf1:next", "b", "jev");
        later.amounts.insert("api".into(), 80);
        assert_eq!(
            l.reserve(later, &status("cf1:next"), "loopback-fixture-owner", 1000)
                .unwrap_err()
                .code,
            "budget_unavailable"
        );
    }
    let mut l = AccountLedger::new(policy()).unwrap();
    l.reserve(r.clone(), &s, "loopback-fixture-owner", 1000)
        .unwrap();
    let (j, _) = l.plan_judgment("cash", &s, 1000).unwrap();
    l.judgment_response(&j.key, observed.clone()).unwrap();
    let mut f = final_receipt(&r);
    f.actual.insert("api".into(), 0);
    assert_eq!(
        l.reconcile_verified(f.clone(), &f.owner).unwrap_err().code,
        "receipt_conflict"
    );
    f.actual.insert("api".into(), 25);
    l.reconcile_verified(f.clone(), &f.owner).unwrap();
    assert_eq!(l.debit("api").unwrap(), 25);
    let mut l = AccountLedger::new(policy()).unwrap();
    l.reserve(r.clone(), &s, "loopback-fixture-owner", 1000)
        .unwrap();
    let (j, _) = l.plan_judgment("cash", &s, 1000).unwrap();
    let missing = serde_json::json!({"usage":{}});
    l.judgment_response(&j.key, missing.clone()).unwrap();
    assert_eq!(l.debit("api").unwrap_err().code, "cost_unavailable");
    let mut f = final_receipt(&r);
    f.actual.insert("api".into(), 7);
    l.reconcile_verified(f.clone(), &f.owner).unwrap();
    assert_eq!(l.debit("api").unwrap(), 7);
    assert_eq!(l.judgments[&j.key].response, Some(missing));
}

#[test]
fn original_operation_owns_cache_including_historical_unbound_request_bytes() {
    let mut p = policy();
    p.meters.get_mut("capacity").unwrap().allocated = 3;
    p.seats
        .insert("equal-seat-alias".into(), p.seats["jev"].clone());
    let mut l = AccountLedger::new(p).unwrap();
    let s = status("cf1:alias");
    let a = request("a", &s.run_id, "a", "jev");
    let mut b = a.clone();
    b.reservation_id = "b".into();
    b.operation_id = "op-b".into();
    b.seat_id = "equal-seat-alias".into();
    l.reserve(a.clone(), &s, "loopback-fixture-owner", 1000)
        .unwrap();
    l.reserve(b.clone(), &s, "loopback-fixture-owner", 1000)
        .unwrap();
    let (ja, _) = l.plan_judgment("a", &s, 1000).unwrap();
    // Shape emitted by pre-fix32: historical key/response remain original. Only
    // its actual stored reservation owner can replay, not an equal Seat alias.
    let mut historical = ja.clone();
    historical.request["state"]
        .as_object_mut()
        .unwrap()
        .remove("operation");
    historical.key = sha256(&serde_json::to_vec(&historical.request).unwrap());
    historical.response =
        Some(serde_json::json!({"usage":{"cost":0.000001},"SYNTHETIC":"original-owned-A"}));
    l.judgments.remove(&ja.key);
    l.judgments
        .insert(historical.key.clone(), historical.clone());
    let original = serde_json::to_vec(&l).unwrap();
    assert_eq!(
        l.plan_judgment("a", &s, 1000).unwrap(),
        (historical.clone(), true)
    );
    assert_eq!(serde_json::to_vec(&l).unwrap(), original);
    let (jb, replayed) = l.plan_judgment("b", &s, 1000).unwrap();
    assert!(!replayed);
    assert_ne!(jb.key, historical.key);
    assert_eq!(jb.request["state"]["operation"]["reservation_id"], "b");
    assert_eq!(jb.request["state"]["operation"]["operation_id"], "op-b");
    assert_eq!(
        jb.request["state"]["operation"]["seat_id"],
        "equal-seat-alias"
    );
    for i in 0..8 {
        l.uncertain("b", format!("{i}{}", "\"".repeat(255)))
            .unwrap();
    }
    let refs = l.reservations["b"].uncertain.clone();
    let revision = l.revision;
    let projected = l.projected_bytes().unwrap();
    l.judgment_failure(&jb.key, "unsupported").unwrap();
    assert_eq!(l.revision, revision + 1);
    assert_eq!(l.reservations["b"].uncertain, refs);
    assert!(l.projected_bytes().unwrap() <= projected);
    assert!(l.judgment_failure(&jb.key, "unsupported").unwrap());
    let response = serde_json::json!({"usage":{"cost":0.000002},"SYNTHETIC":"only-B"});
    l.judgment_response(&jb.key, response.clone()).unwrap();
    assert!(l.judgment_failure(&jb.key, "unsupported").unwrap());
    assert_eq!(l.judgments[&historical.key], historical);
    assert_eq!(l.judgments[&jb.key].response, Some(response));
    let mut changed = s.clone();
    changed.revision += 1;
    assert_eq!(
        l.plan_judgment("b", &changed, 1000).unwrap_err().code,
        "judgment_revision_conflict"
    );
}
