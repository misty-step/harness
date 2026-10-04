mod transport;

use anyhow::{bail, Context, Result};
use serde_json::{json, Value};
use std::path::Path;
use transport::{Envelope, Request};

#[tokio::main(flavor = "current_thread")]
async fn main() {
    if let Err(error) = run().await {
        eprintln!("{}", json!({"ok":false,"error":error.to_string()}));
        std::process::exit(1);
    }
}

async fn run() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let get = |i: usize| args.get(i).context("missing argument").map(String::as_str);
    let result: Value = match get(0)? {
        "factory" => summon_http_client::cli(&args[1..])?,
        "serve" if args.len() == 5 => {
            transport::serve(get(1)?, get(2)?, get(3)?, get(4)?).await?;
            return Ok(());
        }
        "queue" if args.len() == 3 => {
            let envelope = transport::read_envelope(Path::new(get(2)?))?;
            let root = transport::private_dir(get(1)?)?;
            transport::queue(&root, &envelope)?;
            json!({"state": if transport::attempted(&root, &envelope) {"uncertain"} else {"queued"}, "deliveryId":envelope.delivery_id})
        }
        "send" | "inspect" if args.len() == 3 => {
            let envelope: Envelope = transport::read_envelope(Path::new(get(2)?))?;
            transport::client(get(1)?, &Request { op: if get(0)? == "send" { "deliver" } else { "inspect" }.into(), envelope: Some(envelope) }).await?
        }
        "recover" if args.len() == 2 => {
            transport::client(get(1)?, &Request { op: "recover".into(), envelope: None }).await?
        }
        "inbox-put" if args.len() == 3 => {
            let envelope = transport::read_envelope(Path::new(get(2)?))?;
            let root = transport::private_dir(get(1)?)?;
            transport::queue(&root, &envelope)?;
            json!({"state":"queued","deliveryId":envelope.delivery_id})
        }
        "inbox-pull" if args.len() == 2 => {
            let root = transport::private_dir(get(1)?)?;
            json!({"messages":transport::pending_inbox(&root)?})
        }
        "inbox-ack" if args.len() == 4 => {
            let root = transport::private_dir(get(1)?)?;
            transport::ack_inbox(&root, get(2)?, get(3)?)?;
            json!({"state":"consumer_acknowledged","deliveryId":get(2)?})
        }
        _ => bail!("usage: mage factory CONFIG read RUN_ID ENDPOINT | factory CONFIG send RUN_ID ENDPOINT BODY.json | serve SOCKET SPOOL SESSION_ID SESSION_FILE | queue SPOOL ENVELOPE | send|inspect SOCKET ENVELOPE | recover SOCKET | inbox-put DIR ENVELOPE | inbox-pull DIR | inbox-ack DIR DELIVERY_ID PAYLOAD_DIGEST"),
    };
    println!("{result}");
    Ok(())
}
