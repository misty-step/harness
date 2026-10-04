//! One account partition owns only reservations/usage, never run phases or sessions.
//! Its only current transport is explicitly loopback FIXTURE, not receipt verification.
use crate::{Action, DeliveryState, Result, Route, Status, digest, hash, nonempty, refuse};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

pub const MAX_ACCOUNT_BYTES: usize = 512 * 1024;
// Covers bounded response (8KiB), all final meter keys/IDs even JSON-escaped,
// and eight uncertainty references; never truncate accepted facts to make room.
const TERMINAL_BYTES: usize = 32 * 1024;

pub fn account_object_key(account: &str) -> Result<String> {
    if account != crate::authority::CANARY_ACCOUNT {
        return refuse("account_refused", "server account authority is unsupported");
    }
    // NO project, actor, instance or user-selected namespace: they must not split
    // a physical shared account. This prefix cannot collide with either run prefix.
    Ok(format!("summon-account-admission-v1:{account}"))
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MeterKind {
    SubscriptionQuota,
    ApiUsdMicros,
    ResourceUsdMicros,
    ResourceCapacity,
    ResourceUsage,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Entitlement {
    NativeSubscription,
    ThirdPartyApi,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Operation {
    NativeTurn,
    JevDecision,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FactBasis {
    DedicatedReserve,
    PlanMaximum,
    PaidPlan,
    BillingReport,
    Unsupported,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct OwnerFact {
    pub owner: String,
    pub reference: String,
    pub sha256: String,
    pub observed_at_ms: u64,
    pub usage_through_ms: u64,
    pub valid_until_ms: u64,
    pub basis: FactBasis,
}
impl OwnerFact {
    fn validate(&self) -> Result<()> {
        for s in [&self.owner, &self.reference] {
            short(s)?;
        }
        digest(&self.sha256)?;
        Ok(())
    }
    pub(crate) fn current(&self, now: u64) -> Result<()> {
        self.validate()?;
        if self.basis != FactBasis::DedicatedReserve
            || self.observed_at_ms > now
            || self.usage_through_ms < self.observed_at_ms
            || now >= self.valid_until_ms
        {
            return refuse(
                "authority_unavailable",
                "missing, lagged, expired or non-dedicated authority is not spendable headroom",
            );
        }
        Ok(())
    }
}
fn short(s: &str) -> Result<()> {
    nonempty(s)?;
    if s.len() > 256 {
        return refuse(
            "invalid_input",
            "account references are bounded to 256 bytes",
        );
    }
    Ok(())
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct MeterGrant {
    pub billing_account: String,
    pub kind: MeterKind,
    pub unit: String,
    pub period_id: String,
    pub period_start_ms: u64,
    pub period_end_ms: u64,
    /// Finite capacity ALLOCATED to Summon, never a published quota/plan ceiling.
    pub allocated: u64,
    pub authority: OwnerFact,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Seat {
    pub operation: Operation,
    pub route: Route,
    pub provider_account: String,
    pub entitlement: Entitlement,
    pub entitlement_ref: OwnerFact,
    pub runtime_compatibility: OwnerFact,
    pub capabilities: BTreeSet<String>,
    pub approval_scope: String,
    pub approval: OwnerFact,
    pub projects: BTreeSet<String>,
    pub actors: BTreeSet<String>,
    pub meters: BTreeSet<String>,
    pub outcome_owner: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct AccountPolicy {
    pub account: String,
    pub policy_id: String,
    pub revision: u64,
    pub meters: BTreeMap<String, MeterGrant>,
    pub seats: BTreeMap<String, Seat>,
}
impl AccountPolicy {
    pub fn validate(&self) -> Result<()> {
        account_object_key(&self.account)?;
        short(&self.policy_id)?;
        if self.revision == 0 || self.meters.len() > 16 || self.seats.len() > 16 {
            return refuse("invalid_policy", "bounded explicit account policy required");
        }
        for (id, m) in &self.meters {
            if self.meters.iter().any(|(other_id, other)| {
                other_id != id
                    && other.billing_account == m.billing_account
                    && other.kind == m.kind
                    && other.unit == m.unit
                    && other.period_start_ms < m.period_end_ms
                    && m.period_start_ms < other.period_end_ms
            }) {
                return refuse(
                    "invalid_policy",
                    "overlapping aliases cannot create a second authoritative physical meter allocation",
                );
            }
            for s in [id, &m.billing_account, &m.unit, &m.period_id] {
                short(s)?;
            }
            m.authority.validate()?;
            if m.allocated == 0
                || m.period_start_ms >= m.period_end_ms
                || m.authority.observed_at_ms < m.period_start_ms
                || m.authority.valid_until_ms > m.period_end_ms
                || (matches!(
                    m.kind,
                    MeterKind::ApiUsdMicros | MeterKind::ResourceUsdMicros
                ) && m.unit != "usd_micros")
            {
                return refuse(
                    "invalid_policy",
                    "finite exact-account/window/unit allocation required",
                );
            }
        }
        for (id, s) in &self.seats {
            for v in [
                id,
                &s.provider_account,
                &s.approval_scope,
                &s.outcome_owner,
                &s.route.harness,
                &s.route.provider,
                &s.route.model,
                &s.route.effort,
            ] {
                short(v)?;
            }
            for v in s.capabilities.iter().chain(&s.projects).chain(&s.actors) {
                short(v)?;
            }
            s.entitlement_ref.validate()?;
            s.runtime_compatibility.validate()?;
            s.approval.validate()?;
            if s.projects.is_empty()
                || s.actors.is_empty()
                || s.meters.is_empty()
                || s.meters.iter().any(|m| !self.meters.contains_key(m))
            {
                return refuse(
                    "invalid_policy",
                    "seat requires explicit action/account/project/actor/meter authority",
                );
            }
            let kinds: Vec<_> = s.meters.iter().map(|m| &self.meters[m].kind).collect();
            let resource = kinds
                .iter()
                .any(|k| matches!(k, MeterKind::ResourceCapacity | MeterKind::ResourceUsage));
            let account_meter = s.meters.iter().any(|m| {
                self.meters[m].billing_account == s.provider_account
                    && match s.entitlement {
                        Entitlement::NativeSubscription => {
                            self.meters[m].kind == MeterKind::SubscriptionQuota
                        }
                        Entitlement::ThirdPartyApi => {
                            self.meters[m].kind == MeterKind::ApiUsdMicros
                        }
                    }
            });
            if !resource
                || !kinds.contains(&&MeterKind::ResourceUsdMicros)
                || !account_meter
                || (s.entitlement == Entitlement::ThirdPartyApi
                    && s.meters
                        .iter()
                        .filter(|id| self.meters[*id].kind == MeterKind::ApiUsdMicros)
                        .count()
                        != 1)
                || (s.operation == Operation::JevDecision
                    && (s.route != crate::judgment::route()
                        || s.entitlement != Entitlement::ThirdPartyApi))
            {
                return refuse(
                    "invalid_policy",
                    "native/API entitlement and separate actual resource meter required; Jev route is fleet-pinned",
                );
            }
        }
        Ok(())
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ReserveRequest {
    pub reservation_id: String,
    pub operation_id: String,
    pub run_id: String,
    pub input_id: String,
    pub project: String,
    pub seat_id: String,
    pub capabilities: BTreeSet<String>,
    pub amounts: BTreeMap<String, u64>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ExecutionFreeze {
    pub project: String,
    pub actor: String,
    pub run_id: String,
    pub input_id: String,
    pub manifest_sha256: String,
    pub input_sha256: String,
    pub run_revision: u64,
    pub task_route: Route,
    pub seat: Seat,
    pub policy_sha256: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FinalDisposition {
    OwnerFinal,
    ProvenNotStarted,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct FinalReceipt {
    pub receipt_id: String,
    pub reservation_id: String,
    pub operation_id: String,
    pub disposition: FinalDisposition,
    pub owner: String,
    pub evidence_ref: String,
    pub evidence_sha256: String,
    pub actual: BTreeMap<String, u64>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Reservation {
    pub request: ReserveRequest,
    pub frozen: ExecutionFreeze,
    pub uncertain: Vec<String>,
    pub final_receipt: Option<FinalReceipt>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct AccountLedger {
    pub version: u32,
    pub revision: u64,
    pub policy: AccountPolicy,
    pub reservations: BTreeMap<String, Reservation>,
    pub judgments: BTreeMap<String, crate::judgment::JudgmentRecord>,
}
impl AccountLedger {
    pub fn new(policy: AccountPolicy) -> Result<Self> {
        policy.validate()?;
        Ok(Self {
            version: 1,
            revision: 0,
            policy,
            reservations: BTreeMap::new(),
            judgments: BTreeMap::new(),
        })
    }
    pub fn debit(&self, meter: &str) -> Result<u64> {
        self.reservations.values().try_fold(0u64, |sum, r| {
            let mut amount = r
                .final_receipt
                .as_ref()
                .map_or_else(|| r.request.amounts.get(meter), |f| f.actual.get(meter))
                .copied()
                .unwrap_or(0);
            if self
                .policy
                .meters
                .get(meter)
                .is_some_and(|m| m.kind == MeterKind::ApiUsdMicros)
                && r.frozen.seat.operation == Operation::JevDecision
                && r.final_receipt.is_none()
            {
                for j in self
                    .judgments
                    .values()
                    .filter(|j| j.reservation_id == r.request.reservation_id)
                {
                    if let Some(response) = &j.response {
                        let cost = response["usage"]["cost"].as_number().ok_or_else(|| {
                            crate::Refusal {
                                code: "cost_unavailable".into(),
                                message:
                                    "observed response has no actual cost; account remains held"
                                        .into(),
                            }
                        })?;
                        amount = amount.max(crate::judgment::usd_micros(cost)?);
                    }
                }
            }
            sum.checked_add(amount).ok_or_else(|| crate::Refusal {
                code: "budget_overflow".into(),
                message: "account debit overflow refuses admission".into(),
            })
        })
    }
    pub fn eligible(
        &self,
        r: &ReserveRequest,
        status: &Status,
        actor: &str,
        now: u64,
    ) -> Result<ExecutionFreeze> {
        self.policy.validate()?;
        for s in [
            &r.reservation_id,
            &r.operation_id,
            &r.run_id,
            &r.input_id,
            &r.project,
            &r.seat_id,
            actor,
        ] {
            short(s)?;
        }
        let seat = self
            .policy
            .seats
            .get(&r.seat_id)
            .ok_or_else(|| crate::Refusal {
                code: "seat_unavailable".into(),
                message: "selected account/route has no seat authority".into(),
            })?;
        if !seat.projects.contains(&r.project)
            || !seat.actors.contains(actor)
            || !r.capabilities.is_subset(&seat.capabilities)
            || r.run_id != status.run_id
            || hash(&status.task) != status.manifest_sha256
        {
            return refuse(
                "scope_refused",
                "run/actor/project/task/capabilities differ from selected authority",
            );
        }
        for f in [
            &seat.entitlement_ref,
            &seat.runtime_compatibility,
            &seat.approval,
        ] {
            f.current(now)?;
        }
        let input = status
            .inputs
            .iter()
            .find(|i| i.input_id == r.input_id)
            .ok_or_else(|| crate::Refusal {
                code: "input_unavailable".into(),
                message: "no original managed input".into(),
            })?;
        if seat.operation == Operation::NativeTurn
            && (seat.route != status.task.route
                || input.state != DeliveryState::Queued
                || status
                    .inputs
                    .iter()
                    .find(|i| i.state != DeliveryState::Answered)
                    .map(|i| &i.input_id)
                    != Some(&input.input_id)
                || status
                    .holds
                    .iter()
                    .any(|h| h.active && h.action == Action::Dispatch)
                || !status.cancellations.is_empty())
        {
            return refuse(
                "dispatch_ineligible",
                "frozen native route, ordered queued input, approval/hold/cancel facts required",
            );
        }
        if r.amounts.keys().cloned().collect::<BTreeSet<_>>() != seat.meters {
            return refuse("meters_refused", "all exact separate seat meters required");
        }
        for (id, amount) in &r.amounts {
            let meter = &self.policy.meters[id];
            meter.authority.current(now)?;
            if now < meter.period_start_ms
                || now >= meter.period_end_ms
                || *amount == 0
                || self
                    .debit(id)?
                    .checked_add(*amount)
                    .is_none_or(|v| v > meter.allocated)
            {
                return refuse(
                    "budget_unavailable",
                    "finite dedicated subscription/API/resource reserve unavailable",
                );
            }
        }
        Ok(ExecutionFreeze {
            project: r.project.clone(),
            actor: actor.into(),
            run_id: r.run_id.clone(),
            input_id: r.input_id.clone(),
            manifest_sha256: status.manifest_sha256.clone(),
            input_sha256: input.text_sha256.clone(),
            run_revision: status.revision,
            task_route: status.task.route.clone(),
            seat: seat.clone(),
            policy_sha256: hash(&self.policy),
        })
    }
    pub fn reserve(
        &mut self,
        r: ReserveRequest,
        status: &Status,
        actor: &str,
        now: u64,
    ) -> Result<bool> {
        if let Some(old) = self.reservations.get(&r.reservation_id) {
            if old.request == r
                && old.frozen.actor == actor
                && old.frozen.manifest_sha256 == status.manifest_sha256
            {
                return Ok(true);
            }
            return refuse(
                "reservation_conflict",
                "stable reservation already freezes another request/actor/task",
            );
        }
        if self.reservations.values().any(|old| {
            old.request.operation_id == r.operation_id
                || (old.request.run_id == r.run_id
                    && old.request.project == r.project
                    && old.request.input_id == r.input_id
                    && old.request.seat_id == r.seat_id)
        }) {
            return refuse(
                "operation_conflict",
                "existing uncertain/completed operation must reconcile, never resend under another ID",
            );
        }
        let frozen = self.eligible(&r, status, actor, now)?;
        self.reservations.insert(
            r.reservation_id.clone(),
            Reservation {
                request: r,
                frozen,
                uncertain: Vec::new(),
                final_receipt: None,
            },
        );
        self.revision += 1;
        Ok(false)
    }
    pub fn uncertain(&mut self, id: &str, reference: String) -> Result<bool> {
        short(&reference)?;
        let r = self
            .reservations
            .get_mut(id)
            .ok_or_else(|| crate::Refusal {
                code: "reservation_missing".into(),
                message: "no owned reservation".into(),
            })?;
        if r.final_receipt.is_some() {
            return refuse(
                "outcome_conflict",
                "final owner facts cannot become unknown again",
            );
        }
        if r.uncertain.contains(&reference) {
            return Ok(true);
        }
        if r.uncertain.len() == 8 {
            return refuse(
                "state_limit",
                "bounded uncertainty refs; reservation remains retained",
            );
        }
        r.uncertain.push(reference);
        self.revision += 1;
        Ok(false)
    }
    /// Caller must be an independently verified OUTCOME SOURCE, not a permission
    /// grant. The only current Worker caller is the explicitly labeled fixture.
    pub fn reconcile_verified(&mut self, f: FinalReceipt, verified_owner: &str) -> Result<bool> {
        for s in [&f.receipt_id, &f.operation_id, &f.owner, &f.evidence_ref] {
            short(s)?;
        }
        digest(&f.evidence_sha256)?;
        let r = self
            .reservations
            .get(&f.reservation_id)
            .ok_or_else(|| crate::Refusal {
                code: "reservation_missing".into(),
                message: "no owned reservation".into(),
            })?;
        if let Some(old) = &r.final_receipt {
            if old == &f {
                return Ok(true);
            }
            return refuse(
                "receipt_conflict",
                "original final usage receipt is immutable",
            );
        }
        if f.owner != verified_owner
            || f.owner != r.frozen.seat.outcome_owner
            || f.operation_id != r.request.operation_id
            || f.actual.keys().collect::<Vec<_>>() != r.request.amounts.keys().collect::<Vec<_>>()
        {
            return refuse(
                "receipt_refused",
                "verified owner/operation/exact meter grain required",
            );
        }
        if self.reservations.values().any(|r| {
            r.final_receipt
                .as_ref()
                .is_some_and(|old| old.receipt_id == f.receipt_id)
        }) {
            return refuse("receipt_conflict", "usage ID belongs to another operation");
        }
        for (id, actual) in &f.actual {
            for j in self
                .judgments
                .values()
                .filter(|j| j.reservation_id == f.reservation_id)
            {
                if self.policy.meters[id].kind == MeterKind::ApiUsdMicros {
                    if let Some(response) = &j.response {
                        // Missing response cost is not zero; a separately verified
                        // outcome source can reconcile it without rewriting the raw
                        // response or allowing that response to supply advice.
                        if response["usage"]["cost"].as_number().is_some_and(|cost| {
                            crate::judgment::usd_micros(cost).is_ok_and(|known| *actual < known)
                        }) {
                            return refuse(
                                "receipt_conflict",
                                "final usage cannot erase observed actual provider cost",
                            );
                        }
                    }
                }
            }
            if (f.disposition == FinalDisposition::ProvenNotStarted
                || self.policy.meters[id].kind == MeterKind::ResourceCapacity)
                && *actual != 0
            {
                return refuse(
                    "receipt_refused",
                    "not-started/owner-final capacity must prove zero outstanding use",
                );
            }
        }
        // Actual overruns are retained, not truncated/rejected to make the budget
        // look green. The larger debit blocks subsequent admission.
        let id = f.reservation_id.clone();
        self.reservations.get_mut(&id).unwrap().final_receipt = Some(f);
        self.revision += 1;
        Ok(false)
    }
    pub fn fits(&self, accepting: bool) -> bool {
        let bytes = serde_json::to_vec(self).map_or(usize::MAX, |v| v.len());
        let pending = if accepting {
            self.reservations
                .values()
                .filter(|r| r.final_receipt.is_none())
                .count()
                * TERMINAL_BYTES
        } else {
            0
        };
        bytes
            .checked_add(pending)
            .is_some_and(|v| v <= MAX_ACCOUNT_BYTES)
    }
}
