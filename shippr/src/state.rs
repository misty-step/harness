//! PR state as read from `gh pr view --json`. Only the fields the tick needs.
use serde::Deserialize;

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pr {
    pub number: u64,
    pub url: String,
    pub state: String,
    #[serde(default)]
    pub is_draft: bool,
    #[serde(default)]
    pub mergeable: String,
    #[serde(default)]
    pub head_ref_oid: String,
    #[serde(default)]
    pub status_check_rollup: Vec<Check>,
    #[serde(default)]
    pub reviews: Vec<Review>,
    #[serde(default)]
    pub labels: Vec<Label>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Check {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub context: String,
    /// CheckRun: QUEUED | IN_PROGRESS | COMPLETED; StatusContext uses `state`.
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub conclusion: String,
    #[serde(default)]
    pub state: String,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct Review {
    #[serde(default)]
    pub author: Author,
    #[serde(default)]
    pub state: String,
    #[serde(default)]
    pub body: String,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct Author {
    #[serde(default)]
    pub login: String,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct Label {
    pub name: String,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Ci {
    Green,
    Pending(Vec<String>),
    Failed(Vec<String>),
}

impl Check {
    fn label(&self) -> String {
        if self.name.is_empty() { self.context.clone() } else { self.name.clone() }
    }
}

impl Pr {
    pub fn ci(&self) -> Ci {
        let mut pending = vec![];
        let mut failed = vec![];
        for c in &self.status_check_rollup {
            let outcome = if c.state.is_empty() { c.conclusion.as_str() } else { c.state.as_str() };
            match (c.status.as_str(), outcome) {
                ("QUEUED" | "IN_PROGRESS" | "PENDING" | "WAITING", _) | (_, "PENDING" | "EXPECTED") => pending.push(c.label()),
                (_, "SUCCESS" | "NEUTRAL" | "SKIPPED") => {}
                (_, "") => pending.push(c.label()),
                _ => failed.push(c.label()),
            }
        }
        if !failed.is_empty() {
            Ci::Failed(failed)
        } else if !pending.is_empty() {
            Ci::Pending(pending)
        } else {
            Ci::Green
        }
    }

    pub fn reviewed_by(&self, login: &str) -> bool {
        self.reviews.iter().any(|r| r.author.login == login)
    }

    /// Cross-vendor review is recorded as a PR review or comment whose body carries
    /// both `Codex review:` and `Claude review:` verdict lines (any author).
    pub fn cross_vendor_verdicts(&self) -> (bool, bool) {
        let has = |tag: &str| self.reviews.iter().any(|r| r.body.contains(tag));
        (has("Codex review:"), has("Claude review:"))
    }

    pub fn has_label(&self, name: &str) -> bool {
        self.labels.iter().any(|l| l.name == name)
    }
}
