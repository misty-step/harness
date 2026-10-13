//! Merge policy: reduce-review-verify-ship gates mapped onto Kent's risk tiers,
//! with Maren's 2026-10-13 calls (Powder init-kent-autopilot-flow).
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, clap::ValueEnum)]
#[serde(rename_all = "snake_case")]
pub enum Risk {
    /// composes: wires existing primitives.
    Low,
    /// extends: changes a primitive's behavior or contract.
    Medium,
    /// adds: introduces, removes, or reshapes a primitive.
    High,
}

/// What a risk tier requires before the agent may merge.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Gates {
    pub green_ci: bool,
    /// AI reviewer bots whose review must have landed (Bugbot only for now;
    /// paid reviewers need Phaedrus's OK).
    pub bots: Vec<&'static str>,
    /// Cross-vendor agent review (Codex + Claude) recorded on the PR.
    pub cross_vendor_review: bool,
    /// Evidence packet: screenshots for medium; video walkthrough only for high.
    pub screenshots: bool,
    pub video: bool,
    /// The agent may merge without a human.
    pub agent_may_merge: bool,
}

pub fn gates(risk: Risk) -> Gates {
    match risk {
        Risk::Low => Gates {
            green_ci: true,
            bots: vec![],
            cross_vendor_review: true,
            screenshots: false,
            video: false,
            agent_may_merge: true,
        },
        Risk::Medium => Gates {
            green_ci: true,
            bots: vec!["cursor"],
            cross_vendor_review: true,
            screenshots: true,
            video: false,
            agent_may_merge: true,
        },
        Risk::High => Gates {
            green_ci: true,
            bots: vec!["cursor"],
            cross_vendor_review: true,
            screenshots: true,
            video: true,
            agent_may_merge: false,
        },
    }
}
