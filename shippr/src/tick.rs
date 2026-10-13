//! The tick: a pure function from PR state + risk to the one focused next step.
//! The agent acts on the step, then ticks again. `Waiting` means come back after
//! `poll_after_seconds`; never tight-loop.
use crate::policy::{gates, Risk};
use crate::state::{Ci, Pr};
use serde::Serialize;

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "focus", rename_all = "snake_case")]
pub enum Step {
    Waiting { reason: String, poll_after_seconds: u64 },
    FixChecks { failed: Vec<String> },
    Review { missing: Vec<String> },
    Evidence { needs: Vec<String> },
    Merge,
    Park { reason: String },
    Friction,
    Done { merged: bool },
}

pub const POLL_SECONDS: u64 = 120;
pub const EVIDENCE_LABEL: &str = "evidence:attached";

pub fn tick(pr: &Pr, risk: Risk) -> Step {
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
        Ci::Green => {}
    }
    let mut missing = vec![];
    if g.cross_vendor_review {
        let (codex, claude) = pr.cross_vendor_verdicts();
        if !codex { missing.push("Codex review".to_string()); }
        if !claude { missing.push("Claude review".to_string()); }
    }
    let bots_pending: Vec<String> = g.bots.iter().filter(|b| !pr.reviewed_by(b)).map(|b| b.to_string()).collect();
    if !missing.is_empty() {
        return Step::Review { missing };
    }
    if !bots_pending.is_empty() {
        return Step::Waiting { reason: format!("waiting for {}", bots_pending.join(", ")), poll_after_seconds: POLL_SECONDS };
    }
    if (g.screenshots || g.video) && !pr.has_label(EVIDENCE_LABEL) {
        let mut needs = vec!["screenshots".to_string()];
        if g.video { needs.push("video walkthrough".to_string()); }
        return Step::Evidence { needs };
    }
    if !g.agent_may_merge {
        return Step::Park { reason: "high risk: parked for human review".into() };
    }
    if pr.mergeable == "CONFLICTING" {
        return Step::FixChecks { failed: vec!["merge conflict".into()] };
    }
    Step::Merge
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::{Author, Check, Label, Review};

    fn green() -> Vec<Check> {
        vec![Check { name: "check".into(), status: "COMPLETED".into(), conclusion: "SUCCESS".into(), ..Default::default() }]
    }
    fn review(login: &str, body: &str) -> Review {
        Review { author: Author { login: login.into() }, body: body.into() }
    }
    fn ready() -> Pr {
        Pr {
            state: "OPEN".into(),
            mergeable: "MERGEABLE".into(),
            status_check_rollup: green(),
            reviews: vec![review("moomooskycow", "Codex review: APPROVE\nClaude review: APPROVE"), review("cursor", "")],
            labels: vec![Label { name: EVIDENCE_LABEL.into() }],
            ..Default::default()
        }
    }

    #[test]
    fn low_risk_merges_on_green_ci_and_cross_vendor_review() {
        let mut pr = ready();
        pr.reviews.truncate(1);
        pr.labels.clear();
        assert_eq!(tick(&pr, Risk::Low), Step::Merge);
    }

    #[test]
    fn medium_waits_for_bugbot_then_merges() {
        let mut pr = ready();
        pr.reviews.truncate(1);
        assert!(matches!(tick(&pr, Risk::Medium), Step::Waiting { .. }));
        assert_eq!(tick(&ready(), Risk::Medium), Step::Merge);
    }

    #[test]
    fn high_risk_parks_even_when_everything_is_green() {
        assert!(matches!(tick(&ready(), Risk::High), Step::Park { .. }));
    }

    #[test]
    fn video_is_required_only_for_high() {
        let mut pr = ready();
        pr.labels.clear();
        assert_eq!(tick(&pr, Risk::Medium), Step::Evidence { needs: vec!["screenshots".into()] });
        assert_eq!(
            tick(&pr, Risk::High),
            Step::Evidence { needs: vec!["screenshots".into(), "video walkthrough".into()] }
        );
    }

    #[test]
    fn failing_and_pending_checks_come_first() {
        let mut pr = ready();
        pr.status_check_rollup[0].conclusion = "FAILURE".into();
        assert_eq!(tick(&pr, Risk::Low), Step::FixChecks { failed: vec!["check".into()] });
        pr.status_check_rollup[0].status = "IN_PROGRESS".into();
        pr.status_check_rollup[0].conclusion = String::new();
        assert!(matches!(tick(&pr, Risk::Low), Step::Waiting { .. }));
    }

    #[test]
    fn missing_cross_vendor_review_is_named() {
        let mut pr = ready();
        pr.reviews = vec![review("moomooskycow", "Codex review: APPROVE")];
        assert_eq!(tick(&pr, Risk::Low), Step::Review { missing: vec!["Claude review".into()] });
    }

    #[test]
    fn merged_pr_moves_to_friction() {
        let mut pr = ready();
        pr.state = "MERGED".into();
        assert_eq!(tick(&pr, Risk::Low), Step::Friction);
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
