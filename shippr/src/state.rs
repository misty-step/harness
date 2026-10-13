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
    #[serde(default)]
    pub commits: Vec<CommitInfo>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitInfo {
    #[serde(default)]
    pub oid: String,
    #[serde(default)]
    pub committed_date: String,
}

/// Only repository insiders may post verdicts or trigger bots.
pub fn trusted(association: &str) -> bool {
    matches!(association, "OWNER" | "MEMBER" | "COLLABORATOR")
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Comment {
    #[serde(default)]
    pub author_association: String,
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
    #[serde(default)]
    pub started_at: String,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Review {
    #[serde(default)]
    pub author: Author,
    #[serde(default)]
    pub author_association: String,
    #[serde(default)]
    pub submitted_at: String,
    #[serde(default)]
    pub commit: Option<CommitRef>,
    #[serde(default)]
    pub body: String,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct Author {
    #[serde(default)]
    pub login: String,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct CommitRef {
    #[serde(default)]
    pub oid: String,
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
        // Only a review of the current head counts; a push after the review needs a new one.
        self.reviews.iter().any(|r| r.author.login == login && r.commit.as_ref().is_some_and(|c| c.oid == self.head_ref_oid))
    }

    /// Cross-vendor verdicts are lines `Codex review: <VERDICT>` / `Claude review: <VERDICT>`
    /// in any PR review or comment, e.g. `Codex review: APPROVE @abc1234`. The line must name
    /// the current head SHA (7+ hex chars), so a push after a verdict needs a new verdict.
    /// The latest line per vendor wins; only APPROVE passes.
    pub fn verdict(&self, vendor: &str) -> Verdict {
        let tag = format!("{vendor} review:");
        let mut posts: Vec<(&str, &str)> = self.reviews.iter().filter(|r| trusted(&r.author_association)).map(|r| (r.submitted_at.as_str(), r.body.as_str()))
            .chain(self.comments.iter().filter(|c| trusted(&c.author_association)).map(|c| (c.created_at.as_str(), c.body.as_str())))
            .collect();
        posts.sort_by_key(|p| p.0);
        let mut verdict = Verdict::Missing;
        for (_, body) in posts {
            for line in body.lines() {
                if let Some(rest) = line.trim().strip_prefix(&tag) {
                    let names_head = rest.split(|c: char| !c.is_ascii_hexdigit()).any(|w| {
                        w.len() >= 7 && !self.head_ref_oid.is_empty() && self.head_ref_oid.starts_with(&w.to_ascii_lowercase())
                    });
                    if !names_head {
                        continue;
                    }
                    verdict = if rest.trim().to_ascii_uppercase().starts_with("APPROVE") { Verdict::Approve } else { Verdict::Rejected };
                }
            }
        }
        verdict
    }

    /// When the head arrived, by GitHub's clock: the earliest check run on it. Falls back to the
    /// commit date only when no check has started. None when the head is unknown.
    pub fn head_arrived_at(&self) -> Option<&str> {
        let started = self.status_check_rollup.iter().map(|c| c.started_at.as_str()).filter(|t| !t.is_empty()).min();
        started.or_else(|| self.commits.iter().find(|c| c.oid == self.head_ref_oid).map(|c| c.committed_date.as_str()))
    }

    /// Some(true) if a trusted `bugbot run` comment came after the head arrived; None if unknown.
    pub fn bugbot_triggered_for_head(&self) -> Option<bool> {
        let arrived = self.head_arrived_at()?;
        Some(self.comments.iter().any(|c| {
            trusted(&c.author_association) && c.body.trim().eq_ignore_ascii_case("bugbot run") && c.created_at.as_str() > arrived
        }))
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
