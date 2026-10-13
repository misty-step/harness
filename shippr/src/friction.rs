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
        if out.len() + w.len() + 1 > 40 {
            if out.is_empty() {
                out.push_str(&w[..w.len().min(40)]);
            }
            break;
        }
        if !out.is_empty() {
            out.push('-');
        }
        out.push_str(w);
    }
    out
}

/// FNV-1a over the normalized title: a stable, dependency-free disambiguator.
fn title_hash(title: &str) -> String {
    let norm: Vec<String> = title.to_lowercase().split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).map(str::to_string).collect();
    let mut h: u32 = 0x811c9dc5;
    for b in norm.join(" ").bytes() {
        h ^= b as u32;
        h = h.wrapping_mul(0x01000193);
    }
    format!("{h:08x}")
}

/// `friction-<owner>-<repo>-<slug>-<hash>`: the owner keeps same-named repos apart and the
/// hash keeps titles that share a long prefix (or slug to nothing) apart.
pub fn item_id(f: &Friction) -> String {
    let readable = slug(&f.title);
    let tail = if readable.is_empty() { title_hash(&f.title) } else { format!("{readable}-{}", title_hash(&f.title)) };
    format!("friction-{}-{tail}", slug(&f.repo))
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
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)?.as_nanos();
    let tmp = std::env::temp_dir().join(format!("shippr-friction-{}-{nanos}.json", std::process::id()));
    if let Some(b) = body {
        use std::io::Write;
        // create_new refuses an existing path or symlink.
        std::fs::OpenOptions::new().write(true).create_new(true).open(&tmp)?.write_all(&serde_json::to_vec(b)?)?;
        cmd.arg(&tmp);
    }
    let out = cmd.output().with_context(|| format!("running {bin}"));
    if body.is_some() {
        let _ = std::fs::remove_file(&tmp);
    }
    let out = out?;
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

fn is_open(item: &Value) -> bool {
    item["state"]["kind"].as_str() == Some("open")
}

fn add_note(id: &str, item: &Value, f: &Friction, actor: &str) -> Result<Outcome> {
    let rev = item["revision"].as_str().context("item has no revision")?;
    let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)?.as_millis();
    let (code, resp) = powder("POST", &format!("/items/{id}/changes"), Some(&note_request(id, rev, f, actor, nonce)))?;
    if code >= 300 { bail!("powder note failed: HTTP {code}: {resp}"); }
    Ok(Outcome::Noted(id.to_string()))
}

fn create(id: &str, f: &Friction, actor: &str, supersedes: Option<&str>) -> Result<Outcome> {
    let mut req = create_request(f, actor);
    req["id"] = json!(id);
    req["request_id"] = json!(format!("{actor}/create/{id}"));
    if let Some(old) = supersedes {
        let b = req["change"]["fields"]["body"].as_str().unwrap_or_default().to_string();
        req["change"]["fields"]["body"] = json!(format!("{b}\nRecurs after closed item: {old}"));
    }
    let (code, resp) = powder("POST", "/items", Some(&req))?;
    if code >= 300 { bail!("powder create failed: HTTP {code}: {resp}"); }
    Ok(Outcome::Created(id.to_string()))
}

/// Open item: note it. Closed item (fixed or dropped): the friction recurred, so file a fresh
/// item `<id>-r<N>` that points at the closed one, instead of a note nobody sees.
pub fn file(f: &Friction, actor: &str) -> Result<Outcome> {
    if let Qualify::Skip(why) = qualify(f) {
        return Ok(Outcome::Skipped(why));
    }
    let base = item_id(f);
    let mut previous: Option<String> = None;
    for n in 1..=20 {
        let id = if n == 1 { base.clone() } else { format!("{base}-r{n}") };
        let (code, item) = powder("GET", &format!("/items/{id}"), None)?;
        match code {
            200 if is_open(&item) => return add_note(&id, &item, f, actor),
            200 => previous = Some(id),
            404 => return create(&id, f, actor, previous.as_deref()),
            other => bail!("powder lookup failed: HTTP {other}: {item}"),
        }
    }
    bail!("friction {base} recurred more than 20 times; triage it by hand")
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
        let id = item_id(&f());
        assert!(id.starts_with("friction-misty-step-glass-no-way-to-seed-a-review-user-in-"), "{id}");
        assert_eq!(item_id(&Friction { title: "No way to SEED a review-user in preview!".into(), ..f() }), id);
    }

    #[test]
    fn ids_do_not_collide() {
        let a = Friction { title: "No seeded review user in preview for the billing flow".into(), ..f() };
        let b = Friction { title: "No seeded review user in preview for the settings flow".into(), ..f() };
        assert_ne!(item_id(&a), item_id(&b));
        assert_ne!(item_id(&f()), item_id(&Friction { repo: "other-org/glass".into(), ..f() }));
        let long = Friction { title: "x".repeat(60), ..f() };
        let unicode = Friction { title: "проблема с входом".into(), ..f() };
        assert!(!item_id(&long).ends_with('-'));
        assert_ne!(item_id(&unicode), item_id(&Friction { title: "другая проблема".into(), ..f() }));
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
