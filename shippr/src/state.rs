//! PR state as read from `gh pr view --json`. Only the fields the tick needs.
use serde::Deserialize;

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pr {
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
    pub comments: Vec<Comment>,
    #[serde(default)]
    pub labels: Vec<Label>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Comment {
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub created_at: String,
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
#[serde(rename_all = "camelCase")]
pub struct Review {
    #[serde(default)]
    pub author: Author,
    #[serde(default)]
    pub submitted_at: String,
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
    /// No check has reported. Never treated as green.
    None,
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
        if self.status_check_rollup.is_empty() {
            return Ci::None;
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

    /// Cross-vendor verdicts are lines `Codex review: <VERDICT>` / `Claude review: <VERDICT>`
    /// in any PR review or comment. The latest line per vendor wins; only APPROVE passes.
    pub fn verdict(&self, vendor: &str) -> Verdict {
        let tag = format!("{vendor} review:");
        let mut posts: Vec<(&str, &str)> = self.reviews.iter().map(|r| (r.submitted_at.as_str(), r.body.as_str()))
            .chain(self.comments.iter().map(|c| (c.created_at.as_str(), c.body.as_str())))
            .collect();
        posts.sort_by_key(|p| p.0);
        let mut verdict = Verdict::Missing;
        for (_, body) in posts {
            for line in body.lines() {
                if let Some(rest) = line.trim().strip_prefix(&tag) {
                    verdict = if rest.trim().to_ascii_uppercase().starts_with("APPROVE") { Verdict::Approve } else { Verdict::Rejected };
                }
            }
        }
        verdict
    }

    pub fn has_label(&self, name: &str) -> bool {
        self.labels.iter().any(|l| l.name == name)
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum Verdict {
    Missing,
    Approve,
    Rejected,
}
