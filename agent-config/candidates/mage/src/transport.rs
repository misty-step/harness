use anyhow::{ensure, Context, Result};
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    os::unix::fs::{FileTypeExt, MetadataExt, OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
    sync::Arc,
};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    net::{UnixListener, UnixStream},
    sync::{mpsc, watch, Mutex},
    time::{timeout, Duration},
};

const MAX_RECORD: usize = 256 * 1024;
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Envelope {
    pub delivery_id: String,
    pub session_id: String,
    pub session_file: String,
    pub kind: String,
    pub payload: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commission_ref: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_id: Option<String>,
}
impl Envelope {
    fn validate(&self) -> Result<()> {
        ensure!(
            !self.delivery_id.is_empty() && self.delivery_id.len() <= 200,
            "invalid delivery ID"
        );
        ensure!(
            !self.session_id.is_empty() && Path::new(&self.session_file).is_absolute(),
            "exact native session binding required"
        );
        ensure!(
            ["commission", "completion", "decision"].contains(&self.kind.as_str()),
            "invalid kind"
        );
        ensure!(
            !self.payload.is_empty() && self.payload.len() < MAX_RECORD / 2,
            "invalid payload size"
        );
        Ok(())
    }
    fn key(&self) -> String {
        digest(self.delivery_id.as_bytes())
    }
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub op: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub envelope: Option<Envelope>,
}
fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn uid() -> u32 {
    unsafe { libc::getuid() }
}

pub fn private_dir(path: &str) -> Result<PathBuf> {
    let root = Path::new(path);
    ensure!(root.is_absolute(), "spool must be absolute");
    if !root.exists() {
        fs::DirBuilder::new().recursive(true).create(root)?;
        fs::set_permissions(root, fs::Permissions::from_mode(0o700))?;
    }
    let meta = fs::symlink_metadata(root)?;
    ensure!(
        meta.is_dir()
            && !meta.file_type().is_symlink()
            && meta.uid() == uid()
            && meta.mode() & 0o077 == 0,
        "spool must be owner-only, owned, non-symlink directory"
    );
    ensure!(
        fs::canonicalize(root)? == root,
        "spool path must be canonical without symlink ancestors"
    );
    Ok(root.to_owned())
}
fn write_once(path: &Path, bytes: &[u8]) -> Result<()> {
    // Atomic publication: readers never observe a partially written envelope/marker.
    let temp = path.with_extension(format!("tmp-{}", std::process::id()));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW)
        .open(&temp)?;
    let result = (|| {
        file.write_all(bytes)?;
        file.sync_all()?;
        match fs::hard_link(&temp, path) {
            Ok(()) => (),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                ensure!(fs::read(path)? == bytes, "immutable delivery conflict")
            }
            Err(e) => return Err(e.into()),
        }
        File::open(path.parent().context("missing parent")?)?.sync_all()?;
        Ok(())
    })();
    fs::remove_file(temp)?;
    result
}
pub fn read_envelope(path: &Path) -> Result<Envelope> {
    let bytes = fs::read(path)?;
    ensure!(bytes.len() <= MAX_RECORD, "envelope too large");
    let envelope: Envelope = serde_json::from_slice(&bytes)?;
    envelope.validate()?;
    Ok(envelope)
}
pub fn queue(root: &Path, envelope: &Envelope) -> Result<()> {
    envelope.validate()?;
    let path = root.join(format!("{}.json", envelope.key()));
    let bytes = serde_json::to_vec(envelope)?;
    if path.exists() {
        ensure!(
            read_envelope(&path)? == *envelope,
            "delivery ID reused with changed payload, identity, kind or correlation"
        );
    } else {
        write_once(&path, &bytes)?;
    }
    Ok(())
}
pub fn attempted(root: &Path, envelope: &Envelope) -> bool {
    root.join(format!("{}.attempt", envelope.key())).exists()
}
fn envelopes(root: &Path) -> Result<Vec<Envelope>> {
    let mut paths: Vec<_> = fs::read_dir(root)?
        .map(|e| e.map(|e| e.path()))
        .collect::<std::io::Result<_>>()?;
    paths.sort();
    paths
        .into_iter()
        .filter(|p| p.extension().is_some_and(|e| e == "json"))
        .map(|p| read_envelope(&p))
        .collect()
}
pub fn pending_inbox(root: &Path) -> Result<Vec<Value>> {
    envelopes(root)?
        .into_iter()
        .filter(|e| !root.join(format!("{}.ack", e.key())).exists())
        .map(|e| Ok(json!({"digest":digest(&serde_json::to_vec(&e)?),"envelope":e})))
        .collect()
}
pub fn ack_inbox(root: &Path, delivery_id: &str, expected: &str) -> Result<()> {
    let key = digest(delivery_id.as_bytes());
    let e = read_envelope(&root.join(format!("{key}.json")))?;
    ensure!(
        e.delivery_id == delivery_id && digest(&serde_json::to_vec(&e)?) == expected,
        "inbox ACK identity/digest mismatch"
    );
    write_once(&root.join(format!("{key}.ack")), expected.as_bytes())
}
pub async fn record<R: tokio::io::AsyncBufRead + Unpin>(reader: &mut R) -> Result<Option<Value>> {
    let mut buffer = Vec::new();
    loop {
        let available = reader.fill_buf().await?;
        if available.is_empty() {
            ensure!(buffer.is_empty(), "truncated record");
            return Ok(None);
        }
        let n = available
            .iter()
            .position(|b| *b == b'\n')
            .map(|i| i + 1)
            .unwrap_or(available.len());
        ensure!(buffer.len() + n <= MAX_RECORD, "record too large");
        let done = available[n - 1] == b'\n';
        buffer.extend_from_slice(&available[..n]);
        reader.consume(n);
        if done {
            return Ok(Some(serde_json::from_slice(&buffer)?));
        }
    }
}
pub async fn client(socket: &str, request: &Request) -> Result<Value> {
    let mut stream = UnixStream::connect(socket).await?;
    stream.write_all(&serde_json::to_vec(request)?).await?;
    stream.write_all(b"\n").await?;
    timeout(Duration::from_secs(15), record(&mut BufReader::new(stream)))
        .await
        .context("no receipt; dispatch is uncertain, do not resend")??
        .context("transport closed without receipt")
}
struct Bridge {
    replies: mpsc::Receiver<Value>,
}
impl Bridge {
    async fn call(&mut self, op: &str, envelope: &Envelope) -> Result<Value> {
        let mut output = tokio::io::stdout();
        let bytes = serde_json::to_vec(&Request {
            op: op.into(),
            envelope: Some(envelope.clone()),
        })?;
        output.write_all(&bytes).await?;
        output.write_all(b"\n").await?;
        output.flush().await?;
        // No deadline that could consume a late ACK as the next request's response.
        self.replies
            .recv()
            .await
            .context("native bridge closed; ACK uncertain")
    }
}
async fn inspect(bridge: &mut Bridge, root: &Path, e: &Envelope) -> Result<Value> {
    let mut reply = bridge.call("inspect", e).await?;
    if reply["ok"] == true && reply["data"]["state"] == "absent" {
        reply["data"]["state"] = json!(if attempted(root, e) {
            "uncertain"
        } else {
            "queued"
        });
    }
    Ok(reply)
}
async fn handle(
    request: Request,
    root: &Path,
    id: &str,
    file: &str,
    bridge: &mut Bridge,
) -> Result<Value> {
    if request.op == "recover" {
        let mut results = Vec::new();
        for e in envelopes(root)? {
            ensure!(
                e.session_id == id && e.session_file == file,
                "foreign session in spool; reconcile native owner"
            );
            results.push(
                json!({"deliveryId":e.delivery_id,"receipt":inspect(bridge, root, &e).await?}),
            );
        }
        return Ok(json!({"ok":true,"deliveries":results}));
    }
    ensure!(
        ["deliver", "inspect"].contains(&request.op.as_str()),
        "unsupported operation"
    );
    let e = request.envelope.context("envelope required")?;
    ensure!(
        e.session_id == id && e.session_file == file,
        "wrong native session binding"
    );
    queue(root, &e)?;
    if request.op == "inspect" || attempted(root, &e) {
        return inspect(bridge, root, &e).await;
    }
    // Durable send-intent precedes any native call. Crash here stays uncertain; never
    // convert absent native evidence into permission for a second attempt.
    write_once(
        &root.join(format!("{}.attempt", e.key())),
        b"may-have-dispatched",
    )?;
    bridge.call("deliver", &e).await
}

pub async fn serve(socket: &str, spool: &str, id: &str, session_file: &str) -> Result<()> {
    let root = private_dir(spool)?;
    ensure!(
        Path::new(socket) == root.join("relay.sock"),
        "socket must be SPOOL/relay.sock"
    );
    write_once(
        &root.join("native.binding"),
        &serde_json::to_vec(&json!({"sessionId":id,"sessionFile":session_file}))?,
    )?;
    let lock = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW)
        .open(root.join("transport.lock"))?;
    lock.try_lock_exclusive()
        .context("transport already owned; no lease takeover")?;
    if Path::new(socket).exists() {
        let m = fs::symlink_metadata(socket)?;
        ensure!(
            m.file_type().is_socket() && m.uid() == uid(),
            "refuse foreign socket path"
        );
        fs::remove_file(socket)?; // only under exclusive kernel lock; never lease expiry
    }
    let listener = UnixListener::bind(socket)?;
    fs::set_permissions(socket, fs::Permissions::from_mode(0o600))?;
    let (tx, rx) = mpsc::channel(1);
    let (shutdown_tx, mut shutdown) = watch::channel(false);
    tokio::spawn(async move {
        let mut input = BufReader::new(tokio::io::stdin());
        while let Ok(Some(value)) = record(&mut input).await {
            if tx.send(value).await.is_err() {
                break;
            }
        }
        let _ = shutdown_tx.send(true);
    });
    let bridge = Arc::new(Mutex::new(Bridge { replies: rx }));
    loop {
        tokio::select! {
            _ = shutdown.changed() => break,
            incoming = listener.accept() => {
                let (stream, _) = incoming?;
                let root = root.clone(); let id = id.to_owned(); let file = session_file.to_owned(); let bridge = bridge.clone();
                tokio::spawn(async move {
                    let mut stream = BufReader::new(stream);
                    let result = async {
                        let value = timeout(Duration::from_secs(5), record(&mut stream)).await??.context("empty request")?;
                        let request: Request = serde_json::from_value(value)?;
                        handle(request, &root, &id, &file, &mut *bridge.lock().await).await
                    }.await;
                    let response = result.unwrap_or_else(|e: anyhow::Error| json!({"ok":false,"error":e.to_string()}));
                    let _ = stream.get_mut().write_all(format!("{response}\n").as_bytes()).await;
                });
            }
        }
    }
    fs::remove_file(socket)?;
    drop(lock);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn envelope() -> Envelope {
        Envelope {
            delivery_id: "stable-1".into(),
            session_id: "native-1".into(),
            session_file: "/native/session.jsonl".into(),
            kind: "completion".into(),
            payload: "engineer finished; review required".into(),
            run_id: Some("cf1:one".into()),
            commission_ref: None,
            input_id: None,
        }
    }
    #[test]
    fn spool_refuses_identity_payload_kind_and_correlation_conflicts() -> Result<()> {
        let root = tempfile::tempdir()?;
        let e = envelope();
        queue(root.path(), &e)?;
        queue(root.path(), &e)?;
        for changed in [
            Envelope {
                payload: "changed".into(),
                ..e.clone()
            },
            Envelope {
                kind: "decision".into(),
                ..e.clone()
            },
            Envelope {
                session_id: "foreign".into(),
                ..e.clone()
            },
            Envelope {
                input_id: Some("other".into()),
                ..e.clone()
            },
        ] {
            assert!(queue(root.path(), &changed).is_err());
        }
        Ok(())
    }
    #[test]
    fn interrupted_send_stays_uncertain_and_inbox_ack_requires_exact_digest() -> Result<()> {
        let root = tempfile::tempdir()?;
        let e = envelope();
        queue(root.path(), &e)?;
        assert!(!attempted(root.path(), &e));
        write_once(
            &root.path().join(format!("{}.attempt", e.key())),
            b"may-have-dispatched",
        )?;
        assert!(attempted(root.path(), &e));
        assert!(ack_inbox(root.path(), &e.delivery_id, "wrong").is_err());
        let rows = pending_inbox(root.path())?;
        assert_eq!(rows.len(), 1);
        ack_inbox(
            root.path(),
            &e.delivery_id,
            rows[0]["digest"].as_str().unwrap(),
        )?;
        assert!(pending_inbox(root.path())?.is_empty());
        Ok(())
    }
    #[tokio::test]
    async fn framing_splits_only_lf_and_rejects_oversized_and_truncated_records() {
        let mut reader = BufReader::new(&b"{\"text\":\"a\xe2\x80\xa8b\"}\r\n"[..]);
        assert_eq!(
            record(&mut reader).await.unwrap().unwrap()["text"],
            "a\u{2028}b"
        );
        assert!(record(&mut BufReader::new(&b"{}"[..])).await.is_err());
        let bytes = vec![b' '; MAX_RECORD + 1];
        assert!(record(&mut BufReader::new(bytes.as_slice())).await.is_err());
    }
}
