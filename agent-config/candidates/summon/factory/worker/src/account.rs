//! Explicit loopback-only account FIXTURES. Hosted mutation is unconditionally OFF.
//! No caller permission/actor string is accepted as production receipt authority.
use crate::{error, parse, refusal};
use serde::Deserialize;
use summon_protocol::{Status, admission::*, authority::CANARY_ACCOUNT};
use worker::*;

#[derive(Deserialize)]
#[serde(tag = "operation", rename_all = "snake_case", deny_unknown_fields)]
enum Command {
    Reserve {
        request: ReserveRequest,
    },
    Uncertain {
        reservation_id: String,
        evidence_ref: String,
    },
    Reconcile {
        receipt: FinalReceipt,
    },
    PlanJev {
        reservation_id: String,
    },
    JevFailure {
        key: String,
        kind: String,
    },
    JevResponse {
        key: String,
        response: serde_json::Value,
    },
}
fn fixture(env: &Env, url: &worker::Url) -> worker::Result<Option<AccountPolicy>> {
    if env.var("FACTORY_MODE").is_ok()
        || !matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"))
    {
        return Ok(None);
    }
    let Ok(json) = env.var("FACTORY_ADMISSION_FIXTURE") else {
        return Ok(None);
    };
    let policy: AccountPolicy = serde_json::from_str(&json.to_string())?;
    policy.validate().map_err(|e| Error::from(e.message))?;
    Ok(Some(policy))
}
pub async fn gateway(mut req: Request, env: Env) -> worker::Result<Response> {
    if fixture(&env, &req.url()?)?.is_none() {
        return error(
            "admission_unavailable",
            "actual entitlement/headroom/finite budget/outcome authority unavailable; hosted admission OFF",
            403,
        );
    }
    if req.path() != "/v1/admission" || !matches!(req.method(), Method::Get | Method::Post) {
        return error("not_found", "unknown admission endpoint", 404);
    }
    let bytes = if req.method() == Method::Post {
        req.bytes().await?
    } else {
        Vec::new()
    };
    if bytes.len() > MAX_ACCOUNT_BYTES {
        return error("request_too_large", "account request exceeds bound", 413);
    }
    let mut init = RequestInit::new();
    init.with_method(req.method());
    if req.method() == Method::Post {
        init.with_body(Some(bytes.into()));
    }
    // No client-selected account key or identity header survives this boundary.
    let internal = Request::new_with_init(req.url()?.as_str(), &init)?;
    let name = account_object_key(CANARY_ACCOUNT).map_err(|e| Error::from(e.message))?;
    env.durable_object("SUMMON_RUNS")?
        .id_from_name(&name)?
        .get_stub()?
        .fetch_with_request(internal)
        .await
}
fn load(state: &State) -> worker::Result<Option<AccountLedger>> {
    let rows = state
        .storage()
        .sql()
        .exec(
            "SELECT snapshot FROM account_admission WHERE singleton=1",
            None,
        )?
        .raw()
        .collect::<worker::Result<Vec<_>>>()?;
    rows.into_iter()
        .next()
        .map(|row| match row.into_iter().next() {
            Some(SqlStorageValue::Blob(bytes)) => {
                serde_json::from_slice(&bytes).map_err(Error::from)
            }
            _ => Err(Error::from("invalid account snapshot storage type")),
        })
        .transpose()
}
pub async fn apply(
    state: &State,
    env: &Env,
    req: &Request,
    body: &str,
) -> worker::Result<Response> {
    let Some(policy) = fixture(env, &req.url()?)? else {
        return error(
            "admission_unavailable",
            "production receipt/entitlement/budget authority unavailable",
            403,
        );
    };
    state.storage().sql().exec("CREATE TABLE IF NOT EXISTS account_admission(singleton INTEGER PRIMARY KEY CHECK(singleton=1),snapshot BLOB NOT NULL)",None)?;
    let command = if req.method() == Method::Post {
        match parse::<Command>(body) {
            Ok(v) => Some(v),
            Err(e) => return refusal(e),
        }
    } else {
        None
    };
    // Any run-owner read occurs BEFORE loading the account transition. No awaits
    // between the final account load -> pure transition -> single SQL commit.
    let status_run = match &command {
        Some(Command::Reserve { request }) => Some(request.run_id.clone()),
        Some(Command::PlanJev { reservation_id }) => load(state)?.and_then(|l| {
            l.reservations
                .get(reservation_id)
                .map(|r| r.frozen.run_id.clone())
        }),
        _ => None,
    };
    let status = if let Some(id) = status_run {
        if let Err(e) = summon_protocol::validate_run_id(&id) {
            return refusal(e);
        }
        let stub = env
            .durable_object("SUMMON_RUNS")?
            .id_from_name(&format!("summon-v1:{id}"))?
            .get_stub()?;
        let mut response = stub
            .fetch_with_str(&format!("http://localhost/v1/runs/{id}/status"))
            .await?;
        if response.status_code() != 200 {
            return error(
                "run_unavailable",
                "original run owner is unavailable; no admission",
                409,
            );
        }
        Some(response.json::<Status>().await?)
    } else {
        None
    };
    let mut ledger = match load(state)? {
        Some(v) => v,
        None => AccountLedger::new(policy.clone()).map_err(|e| Error::from(e.message))?,
    };
    if ledger.version != 1 || ledger.policy != policy {
        return error(
            "authority_conflict",
            "retained account authority cannot be reinitialized, reset or silently replaced",
            409,
        );
    }
    let Some(command) = command else {
        return Response::from_json(&ledger);
    };
    let outcome: summon_protocol::Result<bool> = (|| {
        let status = || {
            status.as_ref().ok_or_else(|| summon_protocol::Refusal {
                code: "run_unavailable".into(),
                message: "original owner facts unavailable".into(),
            })
        };
        match command {
            Command::Reserve { request } => ledger.reserve(
                request,
                status()?,
                "loopback-fixture-owner",
                Date::now().as_millis(),
            ),
            Command::Uncertain {
                reservation_id,
                evidence_ref,
            } => ledger.uncertain(&reservation_id, evidence_ref),
            Command::Reconcile { receipt } => {
                // FIXTURE ONLY: real production must independently verify the
                // outcome SOURCE, not take an action grant or this owner string.
                let owner = ledger
                    .reservations
                    .get(&receipt.reservation_id)
                    .map(|r| r.frozen.seat.outcome_owner.clone())
                    .unwrap_or_default();
                ledger.reconcile_verified(receipt, &owner)
            }
            Command::PlanJev { reservation_id } => ledger
                .plan_judgment(&reservation_id, status()?, Date::now().as_millis())
                .map(|(_, replay)| replay),
            Command::JevFailure { key, kind } => ledger.judgment_failure(&key, &kind),
            Command::JevResponse { key, response } => ledger.judgment_response(&key, response),
        }
    })();
    let replayed = match outcome {
        Ok(v) => v,
        Err(e) => return refusal(e),
    };
    if !replayed {
        // New admission funds every bounded outcome. Recording consumes only
        // the changed reservation's remaining components, keeping ALL others
        // (including still-recordable late responses after final) funded.
        if !ledger.fits() {
            return error(
                "state_limit",
                "account snapshot plus outcome reservation exceeds bound; no mutation committed",
                413,
            );
        }
        let bytes = serde_json::to_vec(&ledger)?;
        state.storage().sql().exec("INSERT INTO account_admission(singleton,snapshot) VALUES(1,?) ON CONFLICT(singleton) DO UPDATE SET snapshot=excluded.snapshot",vec![bytes.into()])?;
    }
    Response::from_json(
        &serde_json::json!({"fixture_only":true,"provider_execution":false,"replayed":replayed,"account":ledger}),
    )
}
