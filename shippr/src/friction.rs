//! Friction to Powder (Kent's file-friction, with Powder as the sink).
//! Qualify first: durable, recurring, owned, a reproducible contract gap, and it cost time.
//! One-offs soft-skip. Dedupe is by id: `friction-<repo>-<slug>`; a repeat adds a note.
use anyhow::{bail, Context, Result};
use serde_json::{json, Value};
use std::process::Command;

pub const MIN_COST_MINUTES: u32 = 5;

#[derive(Debug, Clone)]
pub struct Friction {
    pub repo: String,
    pub title: String,
    /// The contract gap: what the system should have offered.
    pub reason: String,
    pub cost_minutes: u32,
    pub fix: String,
    pub one_off: bool,
    pub product_decision: bool,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Qualify {
    File,
    Skip(String),
}

pub fn qualify(f: &Friction) -> Qualify {
    if f.one_off {
        return Qualify::Skip("one-off: not durable or recurring".into());
    }
    if f.cost_minutes < MIN_COST_MINUTES {
        return Qualify::Skip(format!("cost {}m < {MIN_COST_MINUTES}m", f.cost_minutes));
    }
    if f.reason.trim().is_empty() || f.fix.trim().is_empty() {
        return Qualify::Skip("no contract gap or suggested fix stated".into());
    }
    Qualify::File
}

pub fn slug(s: &str) -> String {
    let mut out = String::new();
    for w in s.to_ascii_lowercase().split(|c: char| !c.is_ascii_alphanumeric()).filter(|w| !w.is_empty()) {
        if out.len() + w.len() + 1 > 48 {
            break;
        }
        if !out.is_empty() {
            out.push('-');
        }
        out.push_str(w);
    }
    out
}

pub fn item_id(f: &Friction) -> String {
    let repo = f.repo.rsplit('/').next().unwrap_or(&f.repo);
    format!("friction-{}-{}", slug(repo), slug(&f.title))
}

pub fn body(f: &Friction) -> String {
    format!(
        "Tags: friction\nRepo: {}\nCost: {}m\nProduct decision: {}\n\nContract gap: {}\n\nSuggested fix: {}\n\nFiled by shippr friction (file-friction). Repeats are added as notes.",
        f.repo, f.cost_minutes, if f.product_decision { "yes (park for Maren)" } else { "no" }, f.reason, f.fix
    )
}

pub fn create_request(f: &Friction, actor: &str) -> Value {
    let id = item_id(f);
    json!({
        "request_id": format!("{actor}/create/{id}"),
        "actor": actor,
        "id": id,
        "expected_revision": "0",
        "change": {"kind": "create", "fields": {
            "scope": f.repo,
            "title": format!("[Friction] {}", f.title),
            "body": body(f),
            "rank": 60,
            "references": [{"kind": "repo", "repo": f.repo}],
        }}
    })
}

pub fn note_request(id: &str, revision: &str, f: &Friction, actor: &str, nonce: u128) -> Value {
    json!({
        "request_id": format!("{actor}/note/{id}/{nonce}"),
        "actor": actor,
        "id": id,
        "expected_revision": revision,
        "change": {"kind": "note", "comment": format!("Seen again: {}m lost. {}", f.cost_minutes, f.reason)}
    })
}

/// `powder-curl METHOD PATH [body-file]` prints the body then `HTTP <code>`.
fn powder(method: &str, path: &str, body: Option<&Value>) -> Result<(u16, Value)> {
    let bin = std::env::var("POWDER_CURL").unwrap_or_else(|_| "powder-curl".into());
    let mut cmd = Command::new(&bin);
    cmd.args([method, path]);
    let tmp;
    if let Some(b) = body {
        tmp = std::env::temp_dir().join(format!("shippr-friction-{}.json", std::process::id()));
        std::fs::write(&tmp, serde_json::to_vec(b)?)?;
        cmd.arg(&tmp);
    }
    let out = cmd.output().with_context(|| format!("running {bin}"))?;
    if !out.status.success() {
        bail!("{bin} failed: {}", String::from_utf8_lossy(&out.stderr).trim());
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let (json_part, code) = text.trim_end().rsplit_once("\nHTTP ").context("no HTTP status from powder-curl")?;
    let code: u16 = code.trim().parse()?;
    Ok((code, serde_json::from_str(json_part.trim()).unwrap_or(Value::Null)))
}

pub enum Outcome {
    Skipped(String),
    Created(String),
    Noted(String),
}

pub fn file(f: &Friction, actor: &str) -> Result<Outcome> {
    if let Qualify::Skip(why) = qualify(f) {
        return Ok(Outcome::Skipped(why));
    }
    let id = item_id(f);
    let (code, existing) = powder("GET", &format!("/items/{id}"), None)?;
    match code {
        200 => {
            let rev = existing["revision"].as_str().context("item has no revision")?.to_string();
            let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)?.as_millis();
            let (code, _) = powder("POST", &format!("/items/{id}/changes"), Some(&note_request(&id, &rev, f, actor, nonce)))?;
            if code >= 300 { bail!("powder note failed: HTTP {code}"); }
            Ok(Outcome::Noted(id))
        }
        404 => {
            let (code, _) = powder("POST", "/items", Some(&create_request(f, actor)))?;
            if code >= 300 { bail!("powder create failed: HTTP {code}"); }
            Ok(Outcome::Created(id))
        }
        other => bail!("powder lookup failed: HTTP {other}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn f() -> Friction {
        Friction {
            repo: "misty-step/glass".into(),
            title: "No way to seed a review user in preview".into(),
            reason: "ctl-glass has no login --seed".into(),
            cost_minutes: 20,
            fix: "add ctl-glass login --seed".into(),
            one_off: false,
            product_decision: false,
        }
    }

    #[test]
    fn qualifies_durable_costly_gaps_and_skips_noise() {
        assert_eq!(qualify(&f()), Qualify::File);
        assert!(matches!(qualify(&Friction { one_off: true, ..f() }), Qualify::Skip(_)));
        assert!(matches!(qualify(&Friction { cost_minutes: 2, ..f() }), Qualify::Skip(_)));
        assert!(matches!(qualify(&Friction { fix: " ".into(), ..f() }), Qualify::Skip(_)));
    }

    #[test]
    fn id_is_stable_for_dedupe() {
        assert_eq!(item_id(&f()), "friction-glass-no-way-to-seed-a-review-user-in-preview");
        assert_eq!(item_id(&Friction { title: "No way to SEED a review-user in preview!".into(), ..f() }), item_id(&f()));
    }

    #[test]
    fn create_request_matches_powder_shape() {
        let r = create_request(&f(), "Chips");
        assert_eq!(r["expected_revision"], "0");
        assert_eq!(r["change"]["fields"]["scope"], "misty-step/glass");
        assert!(r["change"]["fields"]["body"].as_str().unwrap().starts_with("Tags: friction"));
        assert_eq!(r["change"]["fields"]["title"], "[Friction] No way to seed a review user in preview");
    }
}
