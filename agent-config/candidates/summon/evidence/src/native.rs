//! Select observable native facts without exporting transcript bodies/private thinking.
//! This is an internal source reader, NOT a second Agent/Run/Attempt/Packet schema.
use anyhow::{ensure, Context, Result};
use serde_json::{Map, Value};
use std::{fs::File, io::Read, path::Path};
use summon_protocol::sha256;

pub struct NativeSnapshot {
    pub header: Value,
    pub source_sha256: String,
    pub source_bytes: u64,
    /// Original native entry ID, exact original line-byte digest, filtered facts.
    /// Originals remain at the native owner; no raw transcript is relocated.
    pub entries: Vec<(String, String, Value)>,
    /// Internal commissioning inputs/dispatches, used only to bind original lineage.
    pub inputs: Vec<(String, String, String)>,
    pub commissions: Vec<(String, String, String, String)>,
}

pub fn read_native(path: &Path) -> Result<NativeSnapshot> {
    let file = File::open(path)?;
    let bytes = file.metadata()?.len();
    ensure!(
        bytes > 0 && bytes <= 64 * 1024 * 1024,
        "native snapshot exceeds 64MiB bound or is empty"
    );
    // Read the captured prefix only. Concurrent append is later source staleness,
    // not permission to substitute a newer body under this digest.
    let mut snapshot = Vec::with_capacity(bytes as usize);
    file.take(bytes).read_to_end(&mut snapshot)?;
    ensure!(
        snapshot.len() as u64 == bytes && snapshot.last() == Some(&b'\n'),
        "native snapshot incomplete; preserve inaccessible/uncertain source state"
    );
    let mut lines = snapshot
        .split(|b| *b == b'\n')
        .filter(|line| !line.is_empty());
    let header: Value = serde_json::from_slice(lines.next().context("native header missing")?)?;
    ensure!(
        header["type"] == "session" && header["id"].is_string(),
        "native session header required"
    );
    let mut entries = Vec::new();
    let mut inputs = Vec::new();
    let mut commissions = Vec::new();
    for line in lines {
        ensure!(
            line.len() <= 4 * 1024 * 1024,
            "native entry exceeds 4MiB bound"
        );
        let entry: Value = serde_json::from_slice(line)?;
        let id = entry["id"]
            .as_str()
            .context("original native entry ID missing")?;
        let original_sha = sha256(line);
        let message = &entry["message"];
        if message["role"] == "user" {
            let text = if let Some(s) = message["content"].as_str() {
                s.to_owned()
            } else {
                message["content"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|b| {
                        if b["type"] == "text" {
                            b["text"].as_str()
                        } else {
                            None
                        }
                    })
                    .collect::<Vec<_>>()
                    .join("\n")
            };
            // Keep the original input position even if its body cannot be retained.
            // A later safe message must never replace the frozen original acceptance.
            let text = if public_authored_text(&text).is_some() {
                text
            } else {
                String::new()
            };
            inputs.push((id.to_owned(), original_sha.clone(), text));
        }
        if message["role"] == "assistant" {
            for call in message["content"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|b| b["type"] == "toolCall")
            {
                if let Some(command) = call["arguments"]["command"].as_str() {
                    if let Some(words) = shlex::split(command) {
                        for words in words.windows(5) {
                            if words[0] == "herdr"
                                && words[1] == "agent"
                                && words[2] == "prompt"
                                && public_authored_text(&words[4]).is_some()
                            {
                                commissions.push((
                                    id.to_owned(),
                                    original_sha.clone(),
                                    words[3].clone(),
                                    words[4].clone(),
                                ));
                            }
                        }
                    }
                }
            }
        }
        entries.push((id.to_owned(), original_sha, observable(&entry)));
    }
    Ok(NativeSnapshot {
        header: Value::Object(selected(
            &header,
            &["type", "version", "id", "timestamp", "cwd", "parentSession"],
        )),
        source_sha256: sha256(&snapshot),
        source_bytes: bytes,
        entries,
        inputs,
        commissions,
    })
}

fn selected(value: &Value, keys: &[&str]) -> Map<String, Value> {
    keys.iter()
        .filter_map(|key| value.get(*key).map(|v| ((*key).into(), v.clone())))
        .collect()
}
fn public_authored_text(text: &str) -> Option<Value> {
    // Conservative whole-block omission when authored text could carry credentials.
    // No extraction, token logging, key relocation or private-thinking reconstruction.
    let lower = text.to_ascii_lowercase();
    let key_token = lower
        .split(|c: char| !(c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.')))
        .any(|token| {
            token.len() >= 12
                && ["sk-", "ghp_", "github_pat_", "eyj"]
                    .iter()
                    .any(|prefix| token.starts_with(prefix))
        });
    if key_token
        || [
            "bearer ",
            "authorization:",
            "access_token=",
            "refresh_token=",
            "api_key=",
            "api-key=",
            "-----begin",
        ]
        .iter()
        .any(|needle| lower.contains(needle))
    {
        return None;
    }
    Some(serde_json::json!({"type":"text","text":text}))
}
fn observable(entry: &Value) -> Value {
    let mut facts = selected(entry, &["type", "id", "parentId", "timestamp"]);
    match entry["type"].as_str() {
        Some("message") => {
            let original = &entry["message"];
            let mut message = selected(original, &["role", "timestamp"]);
            match original["role"].as_str() {
                Some("assistant") => {
                    message.extend(selected(
                        original,
                        &[
                            "api",
                            "provider",
                            "model",
                            "responseModel",
                            "thinkingLevel",
                            "usage",
                            "stopReason",
                        ],
                    ));
                    let mut blocks = Vec::new();
                    for block in original["content"].as_array().into_iter().flatten() {
                        match block["type"].as_str() {
                            Some("text") => {
                                if let Some(text) =
                                    block["text"].as_str().and_then(public_authored_text)
                                {
                                    blocks.push(text);
                                }
                            }
                            Some("toolCall") => {
                                let mut call = selected(block, &["type", "id", "name"]);
                                // Arguments may contain credentials/tool payloads; retain only
                                // their digest and original native entry reference.
                                if let Some(args) = block.get("arguments") {
                                    call.insert(
                                        "arguments_sha256".into(),
                                        Value::String(sha256(
                                            &serde_json::to_vec(args)
                                                .expect("JSON value serializes"),
                                        )),
                                    );
                                }
                                blocks.push(Value::Object(call));
                            }
                            _ => (), // thinking/signatures/deferred opaque payloads NEVER retained
                        }
                    }
                    message.insert("content".into(), Value::Array(blocks));
                }
                Some("toolResult") => {
                    message.extend(selected(
                        original,
                        &["toolCallId", "toolName", "isError", "usage"],
                    ));
                    // Raw result text/details are not copied. The source entry ID/digest
                    // supplies original drill-down, including missing/failed tool facts.
                }
                Some("user") => {
                    let blocks = if let Some(text) = original["content"].as_str() {
                        public_authored_text(text).into_iter().collect()
                    } else {
                        original["content"]
                            .as_array()
                            .into_iter()
                            .flatten()
                            .filter_map(|b| {
                                if b["type"] == "text" {
                                    b["text"].as_str().and_then(public_authored_text)
                                } else {
                                    None
                                }
                            })
                            .collect()
                    };
                    message.insert("content".into(), Value::Array(blocks));
                }
                _ => (), // system/custom bodies stay original references only
            }
            facts.insert("message".into(), Value::Object(message));
        }
        Some("custom") | Some("custom_message") => {
            facts.extend(selected(entry, &["customType"]));
            if entry["customType"]
                .as_str()
                .is_some_and(|t| t.starts_with("commission-relay.") || t.starts_with("summon.pi."))
            {
                let original = entry
                    .get("data")
                    .or_else(|| entry.get("details"))
                    .unwrap_or(&Value::Null);
                facts.insert(
                    "native_receipt_facts".into(),
                    Value::Object(selected(
                        original,
                        &[
                            "deliveryId",
                            "deliveryIds",
                            "runId",
                            "commissionRef",
                            "inputId",
                            "attemptId",
                            "textSha256",
                            "kind",
                            "sessionId",
                            "sessionFile",
                            "messageEntryId",
                            "receiptEntryId",
                        ],
                    )),
                );
            }
        }
        Some("model_change") => facts.extend(selected(entry, &["provider", "modelId"])),
        Some("thinking_level_change") => facts.extend(selected(entry, &["thinkingLevel"])),
        Some("usage") => facts.extend(selected(entry, &["kind", "provider", "model", "usage"])),
        _ => (), // unknown/compaction entries remain visible through refs, never raw bodies
    }
    Value::Object(facts)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn authored_text_tool_failure_and_original_refs_survive_without_private_bodies() -> Result<()> {
        let root = tempfile::tempdir()?;
        let path = root.path().join("native.jsonl");
        let header = json!({"type":"session","version":3,"id":"fixture-native","cwd":"/fixture"});
        let assistant = json!({"type":"message","id":"answer","parentId":null,"timestamp":"fixture","message":{"role":"assistant","provider":"fixture","model":"fixture","stopReason":"stop","content":[{"type":"thinking","thinking":"PRIVATE_INTERNAL_FIXTURE"},{"type":"text","text":"Authored rationale: required child proof is missing."},{"type":"text","text":"Authorization: Bearer OMITTED_FIXTURE"},{"type":"toolCall","id":"call-1","name":"read","arguments":{"path":"/private/fixture"}}]}});
        let failed = json!({"type":"message","id":"failed","parentId":"answer","message":{"role":"toolResult","toolCallId":"call-1","toolName":"read","isError":true,"content":[{"type":"text","text":"PRIVATE_TOOL_BODY_FIXTURE"}],"details":{"private":"OMITTED"}}});
        let body = format!("{header}\n{assistant}\n{failed}\n");
        std::fs::write(&path, &body)?;
        let native = read_native(&path)?;
        assert_eq!(native.source_sha256, sha256(body.as_bytes()));
        assert_eq!(native.entries[0].0, "answer");
        assert_eq!(
            native.entries[0].1,
            sha256(assistant.to_string().as_bytes())
        );
        let facts = serde_json::to_string(&native.entries)?;
        assert!(facts.contains("Authored rationale"));
        assert!(facts.contains("arguments_sha256"));
        for private in [
            "PRIVATE_INTERNAL_FIXTURE",
            "OMITTED_FIXTURE",
            "PRIVATE_TOOL_BODY_FIXTURE",
            "/private/fixture",
        ] {
            assert!(!facts.contains(private));
        }
        assert_eq!(native.entries[1].2["message"]["isError"], true);
        assert!(
            native.header.get("parentSession").is_none(),
            "never invent native parent links"
        );
        Ok(())
    }
    #[test]
    fn partial_native_source_is_refused_not_reinterpreted_as_completed() -> Result<()> {
        let root = tempfile::tempdir()?;
        let path = root.path().join("native.jsonl");
        std::fs::write(&path, b"{\"type\":\"session\",\"id\":\"fixture\"}")?;
        assert!(read_native(&path).is_err());
        Ok(())
    }
}
