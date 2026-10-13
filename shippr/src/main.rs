//! shippr: risk-gated PR ship loop. `tick` prints the one focused next step as JSON.
mod policy;
mod state;
mod tick;

use anyhow::{bail, Context, Result};
use clap::{Parser, Subcommand};
use policy::Risk;
use std::process::Command;

#[derive(Parser)]
#[command(version, about)]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Read the PR and print the focused next step (JSON).
    Tick {
        #[arg(long)]
        pr: String,
        #[arg(long, value_enum)]
        risk: Risk,
        /// The repo proves changes locally and runs no pull_request CI.
        #[arg(long)]
        allow_no_ci: bool,
    },
    /// Print the gates a risk tier requires (JSON).
    Policy {
        #[arg(long, value_enum)]
        risk: Risk,
    },
    /// Ask Bugbot to review the current head (posts `bugbot run`).
    Bugbot {
        #[arg(long)]
        pr: String,
    },
    /// Squash-merge when tick says Merge.
    Merge {
        #[arg(long)]
        pr: String,
        #[arg(long, value_enum)]
        risk: Risk,
        #[arg(long)]
        allow_no_ci: bool,
    },
}

const FIELDS: &str = "state,isDraft,mergeable,headRefOid,statusCheckRollup,reviews,comments,labels";

fn view(pr: &str) -> Result<state::Pr> {
    let out = Command::new("gh").args(["pr", "view", pr, "--json", FIELDS]).output().context("running gh")?;
    if !out.status.success() {
        bail!("gh pr view failed: {}", String::from_utf8_lossy(&out.stderr).trim());
    }
    serde_json::from_slice(&out.stdout).context("parsing gh pr view JSON")
}

fn main() -> Result<()> {
    match Cli::parse().cmd {
        Cmd::Tick { pr, risk, allow_no_ci } => println!("{}", serde_json::to_string_pretty(&tick::tick(&view(&pr)?, risk, allow_no_ci))?),
        Cmd::Policy { risk } => println!("{}", serde_json::to_string_pretty(&policy::gates(risk))?),
        Cmd::Bugbot { pr } => {
            let body = state::bugbot_comment(&view(&pr)?.head_ref_oid);
            if !Command::new("gh").args(["pr", "comment", &pr, "--body", &body]).status()?.success() {
                bail!("gh pr comment failed");
            }
        }
        Cmd::Merge { pr, risk, allow_no_ci } => {
            let state = view(&pr)?;
            let step = tick::tick(&state, risk, allow_no_ci);
            if step != tick::Step::Merge {
                bail!("refusing to merge: tick says {}", serde_json::to_string(&step)?);
            }
            let status = Command::new("gh")
                .args(["pr", "merge", &pr, "--squash", "--match-head-commit", &state.head_ref_oid])
                .status()?;
            if !status.success() {
                bail!("gh pr merge failed");
            }
        }
    }
    Ok(())
}
