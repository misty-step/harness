use anyhow::{ensure, Context, Result};
use serde::Deserialize;
use serde_json::json;
use std::fs;
use summon_pi_runtime::{record, Config, NativePi};
use summon_protocol::{CancelRequest, Reply};
use tokio::io::BufReader;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    reply: Reply,
    config: Config,
    mode: String,
    admission_ref: Option<String>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Control {
    cancel: CancelRequest,
}

#[tokio::main(flavor = "current_thread")]
async fn main() {
    if let Err(error) = run().await {
        eprintln!(
            "{}",
            json!({"error":error.to_string(),"native_delivery":"uncertain_unless_reconciled"})
        );
        std::process::exit(1);
    }
}
async fn run() -> Result<()> {
    let file = std::env::args().nth(1).context("usage: summon-pi-runtime REQUEST.json; optional stdin JSONL {cancel: shared CancelRequest}")?;
    let bytes = fs::read(file)?;
    ensure!(bytes.len() <= 1024 * 1024, "request exceeds 1MiB");
    let request: Request = serde_json::from_slice(&bytes)?;
    ensure!(
        request.reply.run.authority == "summon_do"
            && request.reply.run.protocol_version == summon_protocol::VERSION,
        "one supported Summon authority required"
    );
    let dispatch = request
        .reply
        .dispatch
        .context("exact native dispatch required")?;
    ensure!(
        dispatch.run_id == request.reply.run.run_id
            && dispatch.task == request.reply.run.task
            && dispatch.native_session == request.reply.run.native_session
            && request
                .reply
                .run
                .inputs
                .iter()
                .any(|input| input.input_id == dispatch.input_id
                    && input.attempt_id.as_deref() == Some(dispatch.attempt_id.as_str())
                    && input.text_sha256 == dispatch.text_sha256
                    && input.text == dispatch.text),
        "dispatch must match the exact authoritative task/input/attempt/native-session snapshot"
    );
    ensure!(
        ["invoke", "observe"].contains(&request.mode.as_str()),
        "mode must be invoke or observe"
    );
    if request.mode == "invoke" {
        ensure!(
            !request.reply.replayed
                && request
                    .admission_ref
                    .as_ref()
                    .is_some_and(|r| !r.is_empty()),
            "only fresh admitted claim may dispatch; replay requires observe/reconcile"
        );
    }
    let mut native = if request.mode == "observe" {
        NativePi::recover(&dispatch, &request.config).await?
    } else {
        NativePi::start(&dispatch, &request.config).await?
    };
    println!(
        "{}",
        json!({"native_session":native.session,"scope":"native-read-only-tools; trusted local configuration, not filesystem/credential isolation"})
    );
    let before = native.settled_count;
    if request.mode == "invoke" && native.deliver(&dispatch).await? {
        let mut stdin = BufReader::new(tokio::io::stdin());
        let mut closed = false;
        while native.settled_count <= before {
            tokio::select! {
                event = native.next_event() => { event?.context("native exited before settled; reconcile input")?; }
                value = record(&mut stdin), if !closed => {
                    if let Some(value) = value? {
                        let control: Control = serde_json::from_value(value)?;
                        native.request_abort(&control.cancel, &dispatch).await?;
                        println!("{}", json!({"native_abort_requested":control.cancel.cancel_id,"termination":"not_inferred"}));
                    } else { closed = true; } // no EOF/lease-based cancellation
                }
            }
        }
        println!(
            "{}",
            json!({"native_execution":"settled","verified_delivery":false})
        );
    }
    let observations = native
        .observe(&dispatch, request.reply.run.revision)
        .await?;
    println!(
        "{}",
        json!({"observations":observations,"authority":"submit to existing DO observe/reconcile; not a local phase write"})
    );
    let termination = native.shutdown().await?;
    println!("{}", json!({"owned_process_termination":termination}));
    Ok(())
}
