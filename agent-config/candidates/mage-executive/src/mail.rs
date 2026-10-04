//! The actually used AgentMail inbox contract, not a wholesale Hermes harness.
//! Read only: no label ACK, send/reply/draft or caller-selected inbox/URL.
use crate::{Config, Role, ToolRequest, MAX_FRAME};
use anyhow::{ensure, Context, Result};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, BTreeSet},
    io::Read,
    time::Duration,
};
use url::Url;
const INBOX: &str = "phaedrus-kaylee@agentmail.to";
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Arguments {
    thread_id: Option<String>,
}

pub fn read(config: &Config, r: &ToolRequest) -> Result<Value> {
    ensure!(
        config.instance(&r.instance)?.role == Role::Coo
            && r.capability == "mail_read"
            && r.grant_id.is_none(),
        "wrong_role_mail_read_refused"
    );
    let a: Arguments = serde_json::from_value(r.arguments.clone())?;
    if let Some(id) = &a.thread_id {
        ensure!(
            !id.is_empty()
                && id.len() <= 4096
                && id != "."
                && id != ".."
                && !id.chars().any(|c| c.is_control() || "/\\?#%".contains(c)),
            "opaque thread ID required"
        );
    }
    let token = std::env::var("AGENTMAIL_KAYLEE_KEY")
        .context("existing scoped AgentMail consumer binding unavailable; no key fallback")?;
    ensure!(
        !token.trim().is_empty() && !token.chars().any(char::is_control),
        "invalid scoped AgentMail binding"
    );
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .http_status_as_error(false)
        .max_redirects(0)
        .max_redirects_will_error(false)
        .proxy(None)
        .timeout_global(Some(Duration::from_secs(30)))
        .build()
        .into();
    let mut url = Url::parse("https://api.agentmail.to/v0/inboxes/")?;
    {
        let mut segments = url.path_segments_mut().unwrap();
        segments.pop_if_empty().push(INBOX).push("threads");
        if let Some(id) = &a.thread_id {
            segments.push(id);
        }
    }
    let owner_ref = url.to_string();
    let mut next = None::<String>;
    let mut seen = BTreeSet::new();
    let mut threads = BTreeMap::new();
    let mut message_pages = Vec::new();
    let mut thread = None;
    let mut total = 0;
    loop {
        let mut request_url = url.clone();
        {
            let mut query = request_url.query_pairs_mut();
            query.append_pair("limit", if a.thread_id.is_some() { "100" } else { "50" });
            if a.thread_id.is_none() {
                query.append_pair("labels", "unread");
            }
            if let Some(page) = &next {
                query.append_pair("page_token", page);
            }
        }
        let mut response = agent
            .get(request_url.as_str())
            .header("Authorization", &format!("Bearer {token}"))
            .header("User-Agent", "mage-executive-scoped-mail-read")
            .call()
            .map_err(|_| anyhow::anyhow!("AgentMail unavailable; no mail action inferred"))?;
        ensure!(
            response.status().is_success(),
            "AgentMail HTTP {}; no mail action inferred",
            response.status().as_u16()
        );
        let mut bytes = Vec::new();
        response
            .body_mut()
            .as_reader()
            .take((MAX_FRAME + 1) as u64)
            .read_to_end(&mut bytes)?;
        total += bytes.len();
        ensure!(
            total <= MAX_FRAME,
            "complete mail read exceeds bound; remains unhandled"
        );
        let page: Value = serde_json::from_slice(&bytes)?;
        if let Some(id) = &a.thread_id {
            ensure!(
                page["inbox_id"] == INBOX
                    && page["thread_id"] == *id
                    && page["messages"].is_array(),
                "wrong inbox/thread response"
            );
            for message in page["messages"].as_array().unwrap() {
                ensure!(
                    message["inbox_id"] == INBOX
                        && message["thread_id"] == *id
                        && message["message_id"].is_string()
                        && message["timestamp"].is_string(),
                    "incomplete inbox message response"
                );
            }
            if thread.is_none() {
                thread = Some(page.clone());
            }
            message_pages.push(page["messages"].as_array().unwrap().clone());
        } else {
            for item in page["threads"]
                .as_array()
                .context("invalid unread thread response")?
            {
                ensure!(
                    item["inbox_id"] == INBOX
                        && item["thread_id"].is_string()
                        && item["labels"].is_array(),
                    "wrong inbox metadata response"
                );
                let labels = item["labels"].as_array().unwrap();
                ensure!(labels.iter().all(Value::is_string), "invalid inbox labels");
                if labels.contains(&json!("received")) && labels.contains(&json!("unread")) {
                    threads
                        .entry(item["thread_id"].as_str().unwrap().to_owned())
                        .or_insert(item.clone());
                }
            }
        }
        match page.get("next_page_token") {
            None | Some(Value::Null) => break,
            Some(Value::String(value)) => {
                ensure!(
                    !value.is_empty() && seen.insert(value.clone()),
                    "incomplete/cyclic mail pagination; remains unhandled"
                );
                next = Some(value.clone());
            }
            _ => anyhow::bail!("invalid mail pagination; remains unhandled"),
        }
    }
    let data = if let Some(mut thread) = thread {
        // Provider message pages are newest first; each page is ascending. Do not
        // sort timestamps lexically or silently lose pagination/duplicate IDs.
        let mut messages = Vec::new();
        let mut ids = BTreeSet::new();
        for page in message_pages.into_iter().rev() {
            for message in page {
                if ids.insert(message["message_id"].as_str().unwrap().to_owned()) {
                    messages.push(message);
                }
            }
        }
        ensure!(
            thread["message_count"].as_u64() == Some(messages.len() as u64),
            "thread incomplete; remains unhandled"
        );
        thread.as_object_mut().unwrap().remove("next_page_token");
        thread["count"] = json!(messages.len());
        thread["messages"] = json!(messages);
        thread
    } else {
        json!({"inbox_id":INBOX,"count":threads.len(),"threads":threads.into_values().collect::<Vec<_>>()})
    };
    Ok(
        json!({"operation_id":r.operation_id,"owner_ref":owner_ref,"data":data,"authority":false,"mail_acknowledged":false}),
    )
}
