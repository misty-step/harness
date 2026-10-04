//! Private, reversible run storage, not a client schema or a second run ledger.
//! One immutable task/input/session/answer owns each payload. CBOR keeps the
//! accepted UTF-8 bound meaningful even for JSON-escaped text. SQLite owns bytes;
//! the shared transition core owns facts. Public Status/Reply stay unchanged.
use crate::{ClaimRequest, DeliveryState, ObserveRequest, Run, hash};
use serde_json::{Value, json};

pub const MAX_BYTES: usize = 512 * 1024;
const MAGIC: &[u8] = b"SUMMON2\0";
const REF: usize = 4096;
const TEXT: usize = 65536;
// One maximum-size lost-ACK observation (reason, reference, event ID and framing).
const RECOVERY: usize = TEXT + 2 * REF + 1024;

pub fn encode(run: &Run) -> Result<Vec<u8>, String> {
    let mut v = serde_json::to_value(run).map_err(|e| e.to_string())?;
    let original = v.clone();
    let mut uncertainties = std::collections::BTreeMap::new();
    let mut delivery_position = None;
    for (position, event) in original["observations"]
        .as_object()
        .unwrap()
        .values()
        .enumerate()
    {
        let fact = &event["fact"];
        if fact["kind"] == "uncertain" {
            uncertainties
                .entry(event["input_index"].as_u64().unwrap() as usize)
                .or_insert_with(std::collections::BTreeMap::new)
                .insert(
                    format!(
                        "{} [{}]",
                        fact["reason"].as_str().unwrap(),
                        fact["evidence_ref"].as_str().unwrap()
                    ),
                    position,
                );
        }
        if fact["kind"] == "delivery" && fact["delivery"] == original["delivery"] {
            delivery_position = Some(position);
        }
    }
    for (index, input) in v["inputs"].as_array_mut().unwrap().iter_mut().enumerate() {
        if input["input_id"] == original["initial_input_id"] {
            input["text"] = Value::Null;
        }
        for receipt in ["acknowledged", "termination"] {
            if input[receipt].is_object() {
                input[receipt]["session"] = Value::Null;
            }
        }
        if let Some(position) = input["uncertainty"].as_str().and_then(|reason| {
            uncertainties
                .get(&index)
                .and_then(|facts| facts.get(reason))
        }) {
            input["uncertainty"] = json!({"observation": position});
        }
    }
    for event in v["observations"].as_object_mut().unwrap().values_mut() {
        match event["fact"]["kind"].as_str() {
            Some("acknowledged") => {
                event["fact"]["receipt"]["session"] = Value::Null;
                event["fact"]["receipt"]["native_message_ref"] = Value::Null;
            }
            Some("terminated") => event["fact"]["termination"]["session"] = Value::Null,
            _ => (),
        }
    }
    if let Some(position) = delivery_position {
        v["delivery"] = Value::Null;
        v["delivery_observation"] = json!(position);
    }
    let mut bytes = MAGIC.to_vec();
    ciborium::ser::into_writer(&v, &mut bytes).map_err(|e| e.to_string())?;
    Ok(bytes)
}

pub fn decode(bytes: &[u8]) -> Result<Run, String> {
    let mut v: Value = if let Some(body) = bytes.strip_prefix(MAGIC) {
        ciborium::de::from_reader(body).map_err(|e| e.to_string())?
    } else {
        // Original pilot JSON is readable; reads do not rewrite its authority.
        serde_json::from_slice(bytes).map_err(|e| e.to_string())?
    };
    compact_legacy(&mut v)?;
    let original = v.clone();
    let session = original["native_session"].clone();
    let events: Vec<_> = original["observations"]
        .as_object()
        .ok_or("missing observations")?
        .values()
        .collect();
    for input in v["inputs"].as_array_mut().ok_or("missing inputs")? {
        if input["text"].is_null() {
            if input["input_id"] != original["initial_input_id"] {
                return Err("invalid task text reference".into());
            }
            input["text"] = original["task"]["brief"].clone();
        }
        for receipt in ["acknowledged", "termination"] {
            if input[receipt].is_object() && input[receipt]["session"].is_null() {
                if session.is_null() {
                    return Err("missing canonical native session".into());
                }
                input[receipt]["session"] = session.clone();
            }
        }
        if let Some(position) = input["uncertainty"]["observation"].as_u64() {
            let event = events
                .get(position as usize)
                .ok_or("missing uncertainty fact")?;
            let fact = &event["fact"];
            if fact["kind"] != "uncertain" {
                return Err("wrong uncertainty fact".into());
            }
            input["uncertainty"] = json!(format!(
                "{} [{}]",
                fact["reason"].as_str().ok_or("missing reason")?,
                fact["evidence_ref"].as_str().ok_or("missing evidence")?
            ));
        }
    }
    let inputs = v["inputs"].clone();
    for event in v["observations"]
        .as_object_mut()
        .ok_or("missing observations")?
        .values_mut()
    {
        let index = event["input_index"]
            .as_u64()
            .ok_or("missing fact input reference")? as usize;
        let input = inputs
            .as_array()
            .unwrap()
            .get(index)
            .ok_or("invalid fact input reference")?;
        match event["fact"]["kind"].as_str() {
            Some("acknowledged") => {
                if event["fact"]["receipt"]["session"].is_null() {
                    event["fact"]["receipt"]["session"] = session.clone();
                }
                if event["fact"]["receipt"]["native_message_ref"].is_null() {
                    event["fact"]["receipt"]["native_message_ref"] =
                        input["acknowledged"]["native_message_ref"].clone();
                }
            }
            Some("terminated") if event["fact"]["termination"]["session"].is_null() => {
                event["fact"]["termination"]["session"] = session.clone()
            }
            _ => (),
        }
    }
    if let Some(position) = original["delivery_observation"].as_u64() {
        let event = events
            .get(position as usize)
            .ok_or("missing delivery fact")?;
        if event["fact"]["kind"] != "delivery" {
            return Err("wrong delivery fact".into());
        }
        v["delivery"] = event["fact"]["delivery"].clone();
    }
    v.as_object_mut().unwrap().remove("delivery_observation");
    serde_json::from_value(v).map_err(|e| e.to_string())
}

fn compact_legacy(v: &mut Value) -> Result<(), String> {
    let inputs = v["inputs"].as_array().ok_or("missing inputs")?.clone();
    let index = |id: &Value| {
        inputs
            .iter()
            .position(|i| &i["input_id"] == id)
            .ok_or("legacy replay has no canonical input")
    };
    for claim in v["claims"]
        .as_object_mut()
        .ok_or("missing claims")?
        .values_mut()
    {
        if claim["request"].is_object() {
            let d = &claim["dispatch"];
            let i = index(&d["input_id"])?;
            if d["text"] != inputs[i]["text"] || d["text_sha256"] != inputs[i]["text_sha256"] {
                return Err("legacy dispatch payload conflict".into());
            }
            *claim = json!({"fingerprint":hash(&serde_json::from_value::<ClaimRequest>(claim["request"].clone()).map_err(|e| e.to_string())?),"input_index":i,"runner_id":d["runner_id"],"session_bound":!d["native_session"].is_null()});
        }
    }
    for event in v["observations"]
        .as_object_mut()
        .ok_or("missing observations")?
        .values_mut()
    {
        if event["observation"].is_object() {
            let i = index(&event["input_id"])?;
            let fact = if event["observation"]["kind"] == "answered" {
                Value::Null
            } else {
                event["observation"].clone()
            };
            *event = json!({"fingerprint":hash(&serde_json::from_value::<ObserveRequest>(event.clone()).map_err(|e| e.to_string())?),"input_index":i,"fact":fact});
        }
    }
    Ok(())
}

/// Maximum remaining terminal bytes per accepted input. Not a quota on receipts
/// or on workflows: bounds come from the existing text/reference validation.
/// Native observations may spend the recovery margin, but never final-answer
/// capacity; intake/input/claim/hold/proof/cancel cannot spend either reservation.
pub fn reserved_bytes(run: &Run, admission: bool) -> usize {
    let mut reserved = 0;
    let mut pending = false;
    for i in &run.inputs {
        if i.state == DeliveryState::Answered {
            continue;
        }
        pending = true;
        // Answer text/ref + event key/hash/framing. Input/session payloads occur once.
        reserved += TEXT + 3 * REF + 1024;
        if i.acknowledged.is_none() {
            reserved += 4 * REF + 1024;
        }
        if i.attempt_id.is_none() {
            reserved += 3 * REF + 1024;
        }
        if i.termination.is_none() {
            reserved += 3 * REF + 1024;
        }
    }
    if pending && run.native_session.is_none() {
        reserved += 4 * REF + 1024;
    }
    if pending && admission {
        reserved += RECOVERY;
    }
    reserved
}

pub fn fits(run: &Run, snapshot: &[u8], admission: bool) -> bool {
    snapshot
        .len()
        .checked_add(reserved_bytes(run, admission))
        .is_some_and(|n| n <= MAX_BYTES)
}
