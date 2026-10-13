use crate::{mermaid, policy::Risk, upsert};
use anyhow::{bail, Context, Result};
use clap::{Args, Subcommand};
use std::{fs, io::Write, path::PathBuf, process::Command};

#[derive(Args)]
pub struct RenderArgs {
    #[arg(long)]
    primitives: String,
    #[arg(long, value_enum)]
    risk: Risk,
    #[arg(long)]
    flow: PathBuf,
    #[arg(long)]
    summary: Option<String>,
}

#[derive(Subcommand)]
pub enum RecapCmd {
    /// Print a validated Markdown recap.
    Render { #[command(flatten)] args: RenderArgs },
    /// Replace or append a recap in a local PR body.
    Upsert {
        #[arg(long)] body_file: PathBuf,
        #[arg(long)] block_file: PathBuf,
        #[arg(short = 'o', long)] output: Option<PathBuf>,
    },
    /// Update a PR body using gh.
    Apply {
        #[arg(long)] pr: u64,
        #[arg(long)] repo: Option<String>,
        #[command(flatten)] args: RenderArgs,
    },
}

pub fn render(primitives: &str, risk: Risk, flow: &str, summary: Option<&str>) -> Result<String> {
    mermaid::validate(flow)?;
    let primitives: Vec<_> = primitives.split(',').map(str::trim).collect();
    if primitives.iter().any(|p| p.is_empty() || p.contains(['\n', '\r'])) {
        bail!("primitives must be a comma-separated list of nonempty single-line names");
    }
    let tier = serde_json::to_value(risk)?.as_str().context("risk tier is not a string")?.to_owned();
    let mut block = format!("{}\n## System recap\n\n", upsert::START);
    if let Some(summary) = summary {
        if summary.contains(upsert::START) || summary.contains(upsert::END) {
            bail!("summary cannot contain recap markers");
        }
        block.push_str(summary);
        block.push_str("\n\n");
    }
    block.push_str("Primitives touched:\n");
    for primitive in primitives {
        if primitive.contains(upsert::START) || primitive.contains(upsert::END) {
            bail!("primitive names cannot contain recap markers");
        }
        block.push_str(&format!("- {primitive}\n"));
    }
    block.push_str(&format!("\nRisk tier: {tier}\n\n```mermaid\n{flow}"));
    if !flow.ends_with('\n') { block.push('\n'); }
    block.push_str(&format!("```\n{}", upsert::END));
    Ok(block)
}

fn render_file(args: RenderArgs) -> Result<String> {
    let flow = fs::read_to_string(&args.flow).with_context(|| format!("reading flow {}", args.flow.display()))?;
    render(&args.primitives, args.risk, &flow, args.summary.as_deref())
}

// All recap gh invocations go through this boundary; pure unit tests never use it.
fn gh(args: &[&str]) -> Result<Vec<u8>> {
    let out = Command::new("gh").args(args).output().context("running gh")?;
    if !out.status.success() {
        bail!("gh {} failed: {}", args.join(" "), String::from_utf8_lossy(&out.stderr).trim());
    }
    Ok(out.stdout)
}

struct BodyFile(PathBuf);
impl Drop for BodyFile {
    fn drop(&mut self) { let _ = fs::remove_file(&self.0); }
}

fn temporary_body(body: &str) -> Result<BodyFile> {
    for attempt in 0..100 {
        let path = std::env::temp_dir().join(format!("shippr-recap-{}-{attempt}.md", std::process::id()));
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        match options.open(&path) {
            Ok(mut file) => {
                let guard = BodyFile(path);
                file.write_all(body.as_bytes()).context("writing temporary PR body")?;
                return Ok(guard);
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e).context("creating temporary PR body"),
        }
    }
    bail!("could not create temporary PR body")
}

pub fn run(cmd: RecapCmd) -> Result<()> {
    match cmd {
        RecapCmd::Render { args } => println!("{}", render_file(args)?),
        RecapCmd::Upsert { body_file, block_file, output } => {
            let body = fs::read_to_string(&body_file).context("reading body file")?;
            let block = fs::read_to_string(&block_file).context("reading block file")?;
            let result = upsert::upsert(&body, &block)?;
            if let Some(path) = output { fs::write(path, result).context("writing body file")?; }
            else { std::io::stdout().write_all(result.as_bytes())?; }
        }
        RecapCmd::Apply { pr, repo, args } => {
            let block = render_file(args)?;
            let pr = pr.to_string();
            let mut args = vec!["pr", "view", &pr, "--json", "body"];
            if let Some(repo) = repo.as_deref() { args.extend(["--repo", repo]); }
            #[derive(serde::Deserialize)]
            struct PrBody { body: String }
            let body: PrBody = serde_json::from_slice(&gh(&args)?).context("parsing gh PR body JSON")?;
            let updated = upsert::upsert(&body.body, &block)?;
            if updated == body.body { return Ok(()); }
            let file = temporary_body(&updated)?;
            let path = file.0.to_str().context("temporary path is not UTF-8")?;
            let mut args = vec!["pr", "edit", &pr, "--body-file", path];
            if let Some(repo) = repo.as_deref() { args.extend(["--repo", repo]); }
            gh(&args)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn temporary_body_is_private_and_cleaned_up() {
        let file = temporary_body("private body").unwrap();
        let path = file.0.clone();
        assert_eq!(fs::read_to_string(&path).unwrap(), "private body");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        }
        drop(file);
        assert!(!path.exists());
    }
    #[test]
    fn renders_policy_tiers_and_optional_summary() {
        for (risk, tier) in [(Risk::Low,"low"),(Risk::Medium,"medium"),(Risk::High,"high")] {
            let block = render("one, two",risk,"flowchart TD\nA --> B",Some("A summary")).unwrap();
            assert_eq!(block, format!("{}\n## System recap\n\nA summary\n\nPrimitives touched:\n- one\n- two\n\nRisk tier: {tier}\n\n```mermaid\nflowchart TD\nA --> B\n```\n{}",upsert::START,upsert::END));
        }
        assert!(!render("one",Risk::Low,"sequenceDiagram\n",None).unwrap().contains("summary\n"));
    }
    #[test]
    fn rejects_invalid_render_inputs() {
        for names in ["", "one,", "one\ntwo", upsert::START] {
            assert!(render(names,Risk::Low,"graph LR",None).is_err());
        }
        assert!(render("one",Risk::Low,"bad",None).is_err());
        assert!(render("one",Risk::Low,"graph LR",Some(upsert::END)).is_err());
    }
}
