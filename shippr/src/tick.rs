//! The tick: a pure function from PR state + risk to the one focused next step.
//! The agent acts on the step, then ticks again. `Waiting` means come back after
//! `poll_after_seconds`; never tight-loop.
use crate::policy::{gates, Risk, BUGBOT};
use crate::state::{Ci, Pr, Verdict};
use serde::Serialize;

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "focus", rename_all = "snake_case")]
pub enum Step {
    Waiting { reason: String, poll_after_seconds: u64 },
    FixChecks { failed: Vec<String> },
    Review { missing: Vec<String> },
    /// Bugbot has not reviewed the head and was not asked to: post `bugbot run` (`shippr bugbot`).
    TriggerBugbot,
    Evidence { needs: Vec<String> },
    Merge,
    Park { reason: String },
    Friction,
    Done { merged: bool },
}

pub const POLL_SECONDS: u64 = 120;
pub const SCREENSHOTS_LABEL: &str = "evidence:screenshots";
pub const VIDEO_LABEL: &str = "evidence:video";

/// `allow_no_ci`: the repo proves changes locally (no pull_request CI, e.g. harness FND-CHG-002);
/// only then may an empty check rollup pass.
pub fn tick(pr: &Pr, risk: Risk, allow_no_ci: bool) -> Step {
    match pr.state.as_str() {
        "MERGED" => return Step::Friction,
        "CLOSED" => return Step::Done { merged: false },
        _ => {}
    }
    if pr.is_draft {
        return Step::Park { reason: "PR is a draft; mark ready when the work is complete".into() };
    }
    let g = gates(risk);
    match pr.ci() {
        Ci::Failed(failed) => return Step::FixChecks { failed },
        Ci::Pending(names) => {
            return Step::Waiting { reason: format!("checks pending: {}", names.join(", ")), poll_after_seconds: POLL_SECONDS }
        }
        Ci::None if !allow_no_ci => {
            return Step::Waiting { reason: "no CI check has reported".into(), poll_after_seconds: POLL_SECONDS }
        }
        Ci::None | Ci::Green => {}
    }
    let mut missing = vec![];
    if g.cross_vendor_review {
        for vendor in ["Codex", "Claude"] {
            match pr.verdict(vendor) {
                Verdict::Approve => {}
                Verdict::Missing => missing.push(format!("{vendor} review")),
                Verdict::Rejected => missing.push(format!("{vendor} review (latest verdict is not APPROVE)")),
            }
        }
    }
    let bots_pending: Vec<String> = g.bots.iter().filter(|b| !pr.reviewed_by(b)).map(|b| b.to_string()).collect();
    if !missing.is_empty() {
        return Step::Review { missing };
    }
    if bots_pending.iter().any(|b| b == BUGBOT) && !pr.bugbot_triggered_for_head() {
        return Step::TriggerBugbot;
    }
    if !bots_pending.is_empty() {
        return Step::Waiting { reason: format!("waiting for {}", bots_pending.join(", ")), poll_after_seconds: POLL_SECONDS };
    }
    let mut needs = vec![];
    if g.screenshots && !pr.has_label(SCREENSHOTS_LABEL) { needs.push("screenshots".to_string()); }
    if g.video && !pr.has_label(VIDEO_LABEL) { needs.push("video walkthrough".to_string()); }
    if !needs.is_empty() {
        return Step::Evidence { needs };
    }
    if !g.agent_may_merge {
        return Step::Park { reason: "high risk: parked for Maren (Glass review queue)".into() };
    }
    match pr.mergeable.as_str() {
        "MERGEABLE" => Step::Merge,
        "CONFLICTING" => Step::FixChecks { failed: vec!["merge conflict".into()] },
        other => Step::Waiting { reason: format!("mergeability is {other:?}"), poll_after_seconds: POLL_SECONDS },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::{bugbot_comment, Author, Check, Comment, CommitRef, Label, Review};

    const HEAD: &str = "abc1234def5678";

    fn green() -> Vec<Check> {
        vec![Check { name: "check".into(), status: "COMPLETED".into(), conclusion: "SUCCESS".into(), ..Default::default() }]
    }
    fn review(login: &str, body: &str) -> Review {
        Review { author: Author { login: login.into() }, author_association: "MEMBER".into(), submitted_at: "2026-10-13T10:00:00Z".into(), commit: Some(CommitRef { oid: HEAD.into() }), body: body.into() }
    }
    fn ready() -> Pr {
        Pr {
            state: "OPEN".into(),
            mergeable: "MERGEABLE".into(),
            head_ref_oid: HEAD.into(),
            status_check_rollup: green(),
            reviews: vec![review("moomooskycow", "Codex review: APPROVE @abc1234\nClaude review: APPROVE @abc1234"), review("cursor", "")],
            labels: vec![Label { name: SCREENSHOTS_LABEL.into() }, Label { name: VIDEO_LABEL.into() }],
            ..Default::default()
        }
    }

    #[test]
    fn low_risk_merges_on_green_ci_and_cross_vendor_review() {
        let mut pr = ready();
        pr.reviews.truncate(1);
        pr.labels.clear();
        assert_eq!(tick(&pr, Risk::Low, false), Step::Merge);
    }

    #[test]
    fn medium_waits_for_bugbot_then_merges() {
        let mut pr = ready();
        pr.reviews.truncate(1);
        assert_eq!(tick(&pr, Risk::Medium, false), Step::TriggerBugbot);
        pr.comments.push(Comment { author_association: "MEMBER".into(), body: bugbot_comment(HEAD), created_at: "2026-10-13T11:00:00Z".into() });
        assert!(matches!(tick(&pr, Risk::Medium, false), Step::Waiting { .. }));
        pr.comments[0].author_association = "NONE".into();
        assert_eq!(tick(&pr, Risk::Medium, false), Step::TriggerBugbot, "outsider trigger does not count");
        // A trigger for an earlier head does not count for a new push, whatever the clocks say.
        pr.comments[0].author_association = "MEMBER".into();
        pr.comments[0].body = bugbot_comment("0ld0000");
        assert_eq!(tick(&pr, Risk::Medium, false), Step::TriggerBugbot);
        pr.comments[0].body = "bugbot run".into();
        assert_eq!(tick(&pr, Risk::Medium, false), Step::TriggerBugbot, "unmarked trigger is not bound to a head");
        assert_eq!(tick(&ready(), Risk::Medium, false), Step::Merge);
    }

    #[test]
    fn high_risk_parks_even_when_everything_is_green() {
        assert!(matches!(tick(&ready(), Risk::High, false), Step::Park { .. }));
    }

    #[test]
    fn video_is_required_only_for_high() {
        let mut pr = ready();
        pr.labels = vec![Label { name: SCREENSHOTS_LABEL.into() }];
        assert_eq!(tick(&pr, Risk::Medium, false), Step::Merge);
        assert_eq!(tick(&pr, Risk::High, false), Step::Evidence { needs: vec!["video walkthrough".into()] });
        pr.labels.clear();
        assert_eq!(tick(&pr, Risk::Medium, false), Step::Evidence { needs: vec!["screenshots".into()] });
        assert_eq!(
            tick(&pr, Risk::High, false),
            Step::Evidence { needs: vec!["screenshots".into(), "video walkthrough".into()] }
        );
    }

    #[test]
    fn failing_and_pending_checks_come_first() {
        let mut pr = ready();
        pr.status_check_rollup[0].conclusion = "FAILURE".into();
        assert_eq!(tick(&pr, Risk::Low, false), Step::FixChecks { failed: vec!["check".into()] });
        pr.status_check_rollup[0].status = "IN_PROGRESS".into();
        pr.status_check_rollup[0].conclusion = String::new();
        assert!(matches!(tick(&pr, Risk::Low, false), Step::Waiting { .. }));
    }

    #[test]
    fn missing_cross_vendor_review_is_named() {
        let mut pr = ready();
        pr.reviews = vec![review("moomooskycow", "Codex review: APPROVE @abc1234")];
        assert_eq!(tick(&pr, Risk::Low, false), Step::Review { missing: vec!["Claude review".into()] });
    }

    #[test]
    fn rejection_or_later_rejection_blocks_and_comments_count() {
        let mut pr = ready();
        pr.reviews = vec![review("x", "Codex review: CHANGES REQUESTED @abc1234\nClaude review: APPROVE @abc1234")];
        assert!(matches!(tick(&pr, Risk::Low, false), Step::Review { .. }));
        pr.comments = vec![Comment { author_association: "MEMBER".into(), body: "Codex review: APPROVE @abc1234".into(), created_at: "2026-10-13T11:00:00Z".into() }];
        assert_eq!(tick(&pr, Risk::Low, false), Step::Merge);
        pr.comments.push(Comment { author_association: "MEMBER".into(), body: "Codex review: CHANGES REQUESTED @abc1234".into(), created_at: "2026-10-13T12:00:00Z".into() });
        assert!(matches!(tick(&pr, Risk::Low, false), Step::Review { .. }));
    }

    #[test]
    fn no_checks_is_not_green_unless_repo_proves_locally() {
        let mut pr = ready();
        pr.status_check_rollup.clear();
        assert!(matches!(tick(&pr, Risk::Low, false), Step::Waiting { .. }));
        assert_eq!(tick(&pr, Risk::Low, true), Step::Merge);
    }

    #[test]
    fn a_push_after_review_invalidates_verdicts_and_bugbot() {
        let mut pr = ready();
        pr.head_ref_oid = "fff0000aaaa".into();
        assert_eq!(
            tick(&pr, Risk::Low, false),
            Step::Review { missing: vec!["Codex review".into(), "Claude review".into()] }
        );
        pr.comments = vec![Comment { author_association: "MEMBER".into(), body: "Codex review: APPROVE @fff0000\nClaude review: APPROVE @fff0000".into(), created_at: "2026-10-13T13:00:00Z".into() }];
        assert_eq!(tick(&pr, Risk::Low, false), Step::Merge);
        assert_eq!(tick(&pr, Risk::Medium, false), Step::TriggerBugbot, "stale Bugbot review must not count");
    }

    #[test]
    fn verdicts_from_outsiders_are_ignored() {
        let mut pr = ready();
        pr.reviews[0].author_association = "CONTRIBUTOR".into();
        assert!(matches!(tick(&pr, Risk::Low, false), Step::Review { .. }));
    }

    #[test]
    fn unknown_mergeability_waits() {
        let mut pr = ready();
        pr.mergeable = "UNKNOWN".into();
        assert!(matches!(tick(&pr, Risk::Low, false), Step::Waiting { .. }));
    }

    #[test]
    fn merged_pr_moves_to_friction() {
        let mut pr = ready();
        pr.state = "MERGED".into();
        assert_eq!(tick(&pr, Risk::Low, false), Step::Friction);
    }

    #[test]
    fn parses_gh_json() {
        let json = r#"{"number":7,"url":"u","state":"OPEN","isDraft":false,"mergeable":"MERGEABLE","headRefOid":"abc",
          "statusCheckRollup":[{"__typename":"StatusContext","context":"ci","state":"SUCCESS"}],
          "reviews":[{"author":{"login":"cursor"},"state":"COMMENTED","body":"x"}],"labels":[]}"#;
        let pr: Pr = serde_json::from_str(json).unwrap();
        assert_eq!(pr.ci(), Ci::Green);
    }
}
