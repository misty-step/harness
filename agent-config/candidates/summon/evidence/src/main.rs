use anyhow::{bail, ensure, Context, Result};
use std::{
    env,
    fs::{self, OpenOptions},
    io::Write,
    os::unix::fs::OpenOptionsExt,
    path::Path,
};
use summon_evidence::{
    archive,
    source::{self, Sources},
};
use summon_protocol::visibility::{AgentRunAttemptV1, PageCursor, VisibilityGraph};
fn records(path: &str) -> Result<Vec<AgentRunAttemptV1>> {
    Ok(serde_json::from_slice(&fs::read(path)?)?)
}
fn run() -> Result<()> {
    let args: Vec<_> = env::args().skip(1).collect();
    let result = match args.first().map(String::as_str) {
        Some("native-refs") if args.len() == 2 => {
            let native = summon_evidence::native::read_native(Path::new(&args[1]))?;
            serde_json::json!({"native_header":native.header,
                "first_input":native.inputs.first().map(|(id,sha,text)| serde_json::json!({"entry_id":id,"original_sha256":sha,"public_text_available":!text.is_empty(),"text_sha256":summon_protocol::sha256(text.as_bytes())})),
                "dispatches":native.commissions.iter().map(|(id,sha,target,text)|serde_json::json!({"entry_id":id,"original_sha256":sha,"target":target,"text_sha256":summon_protocol::sha256(text.as_bytes())})).collect::<Vec<_>>(),
                "tool_names":native.entries.iter().flat_map(|(_,_,v)| v["message"]["content"].as_array().into_iter().flatten()).filter_map(|b|b["name"].as_str()).collect::<std::collections::BTreeSet<_>>()})
        }
        Some("snapshot") if args.len() == 4 => {
            let config: Sources = serde_json::from_slice(&fs::read(&args[1])?)?;
            let records = source::snapshot(&config, Path::new(&args[2]))?;
            let mut out = OpenOptions::new().write(true).create_new(true).mode(0o600).open(&args[3])?;
            out.write_all(&serde_json::to_vec(&records)?)?; out.sync_all()?;
            serde_json::json!({"records_file":args[3],"record_count":records.len(),"root":config.root,"verification_claim":false})
        }
        Some("page") if (3..=5).contains(&args.len()) => {
            let graph = VisibilityGraph::new(records(&args[1])?).map_err(summon_evidence::refused)?;
            let limit = args.get(3).map(|n| n.parse()).transpose()?.unwrap_or(128);
            let cursor: Option<PageCursor> = args.get(4).map(|p| fs::read(p)).transpose()?.map(|b| serde_json::from_slice(&b)).transpose()?;
            serde_json::to_value(graph.page(&args[2], cursor.as_ref(), limit).map_err(summon_evidence::refused)?)?
        }
        Some("export") if args.len() == 4 => archive::export(records(&args[1])?, &args[2], Path::new(&args[3]))?,
        Some("reopen") if (3..=4).contains(&args.len()) => {
            let fresh = args.get(3).map(|p| records(p)).transpose()?;
            archive::reopen(Path::new(&args[1]), &args[2], fresh)?
        }
        Some("object") if args.len() == 3 => {
            let bytes = summon_evidence::retention::load(Path::new(&args[1]), &args[2])?;
            // Drill down retained, filtered evidence; never dump original raw native transcript.
            ensure!(bytes.len() <= 4 * 1024 * 1024, "drill-down exceeds output bound");
            serde_json::from_slice(&bytes).context("retained object is not JSON")?
        }
        _ => bail!("usage: summon-evidence snapshot SOURCES.json ARCHIVE_ABSOLUTE RECORDS_NEW.json | page RECORDS.json ROOT [LIMIT [CURSOR.json]] | export RECORDS.json ROOT ARCHIVE | reopen ARCHIVE BUNDLE_SHA [FRESH_RECORDS.json] | object ARCHIVE SHA"),
    };
    println!("{}", serde_json::to_string_pretty(&result)?);
    Ok(())
}
fn main() {
    if let Err(error) = run() {
        eprintln!("{error:#}");
        std::process::exit(1);
    }
}
