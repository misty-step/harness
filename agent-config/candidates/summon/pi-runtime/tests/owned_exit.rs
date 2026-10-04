//! Installed native Pi, zero model prompts. Delayed extension cleanup is an explicit
//! fault fixture; it is not authenticated task execution or provider-error proof.
use anyhow::{Context, Result};
use fs2::FileExt;
use serde_json::json;
use std::{
    fs,
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::Path,
    time::Duration,
};
use summon_pi_runtime::{Config, NativePi};
use summon_protocol::{sha256, Dispatch};
fn identity(pid: u32) -> Result<String> {
    let stat = fs::read_to_string(format!("/proc/{pid}/stat"))?;
    let fields: Vec<_> = stat
        .rsplit_once(')')
        .context("owned stat")?
        .1
        .split_whitespace()
        .collect();
    Ok(format!(
        "boot={}:pid={pid}:start={}:state={}",
        fs::read_to_string("/proc/sys/kernel/random/boot_id")?.trim(),
        fields[19],
        fields[0]
    ))
}
fn live(pid: u32) -> bool {
    identity(pid).is_ok_and(|s| !s.ends_with("state=Z"))
}
fn dispatch(root: &Path) -> Dispatch {
    serde_json::from_value(json!({"run_id":"cf1:owned-exit-fixture","input_id":"fixture-input","attempt_id":"fixture-attempt","runner_id":"fixture-runner","text":"Never sent to model.","text_sha256":sha256(b"Never sent to model."),"native_session":null,"task":{"id":"cf1:owned-exit-fixture","kind":"research","brief":"Zero-model native ownership proof.","workspace":root,"route":{"harness":"pi","provider":"openai-codex","model":std::env::var("NATIVE_PI_MODEL").expect("explicit existing native model"),"effort":"high"},"context":{"instructions":[],"skills":[]},"checks":[],"outputs":[]}})).unwrap()
}
async fn proof(mode: &str) -> Result<()> {
    let scratch = std::env::var("TMPDIR")?;
    let root = tempfile::Builder::new()
        .prefix("owned-exit-native-")
        .tempdir_in(scratch)?
        .keep();
    fs::set_permissions(&root, fs::Permissions::from_mode(0o700))?;
    let extension = root.join("ownership-fixture.js");
    let pid_file = root.join("native.pid");
    let identity_file = root.join("native.start-fact");
    let commands = if mode == "startup" {
        ""
    } else {
        "for(const name of ['summon-native-input','summon-native-receipt']) pi.registerCommand(name,{handler:async()=>{}});"
    };
    let malformed = if mode == "shutdown" {
        "writeSync(1,'MALFORMED_SHUTDOWN_FIXTURE\\n');"
    } else {
        ""
    };
    fs::write(&extension,format!("import {{writeFileSync,readFileSync,writeSync}} from 'node:fs'; export default function(pi){{ {commands} pi.on('session_start',()=>{{writeFileSync({},String(process.pid));writeFileSync({},readFileSync('/proc/'+process.pid+'/stat'));}}); pi.on('session_shutdown',async()=>{{{malformed} await new Promise(r=>setTimeout(r,3000));}}); }}",serde_json::to_string(&pid_file)?,serde_json::to_string(&identity_file)?))?;
    let config = Config {
        host: "owned-exit-native-proof".into(),
        state_dir: root.to_string_lossy().into(),
        extension: extension.to_string_lossy().into(),
    };
    let d = dispatch(&root);
    let result = if mode == "cli" {
        use tokio::io::AsyncWriteExt;
        let mut run = summon_protocol::Run::intake(summon_protocol::Intake {
            task: d.task.clone(),
            initial_input_id: d.input_id.clone(),
        })
        .map_err(|e| anyhow::anyhow!("{}", e.message))?;
        let (claim, _) = run
            .claim(summon_protocol::ClaimRequest {
                claim_id: d.attempt_id.clone(),
                runner_id: d.runner_id.clone(),
                expected_revision: run.revision,
            })
            .map_err(|e| anyhow::anyhow!("{}", e.message))?;
        let request = root.join("cli-fixture-request.json");
        fs::write(
            &request,
            serde_json::to_vec(
                &json!({"reply":run.reply(Some(claim),false),"config":{"host":config.host,"state_dir":config.state_dir,"extension":config.extension},"mode":"invoke","admission_ref":"fixture-stub-extension-never-starts-provider"}),
            )?,
        )?;
        let mut cli = tokio::process::Command::new(env!("CARGO_BIN_EXE_summon-pi-runtime"))
            .arg(request)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()?;
        cli.stdin
            .take()
            .unwrap()
            .write_all(b"MALFORMED_CONTROL_FIXTURE\n")
            .await?;
        let output = cli.wait_with_output().await?;
        fs::write(root.join("cli.stdout"), &output.stdout)?;
        fs::write(root.join("cli.stderr"), &output.stderr)?;
        assert!(
            !output.status.success(),
            "malformed control must not become success"
        );
        Err(anyhow::anyhow!(
            "CLI control failure: {}",
            String::from_utf8_lossy(&output.stderr)
        ))
    } else {
        match NativePi::start(&d, &config).await {
            Ok(mut native) if mode == "command" => {
                let failed = native
                    .command(json!({"type":"owned-fixture-unknown-command"}))
                    .await;
                drop(native);
                failed.map(|_| ())
            }
            Ok(native) => native.shutdown().await.map(|_| ()),
            Err(error) => Err(error),
        }
    };
    let pid: u32 = fs::read_to_string(&pid_file)
        .with_context(|| {
            format!(
                "fixture did not start; owner result={:?}",
                result.as_ref().err()
            )
        })?
        .parse()?;
    let alive = live(pid);
    let lock = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .custom_flags(libc::O_NOFOLLOW)
        .open(root.join(sha256(d.run_id.as_bytes())).join("native.lock"))?;
    let second_lock = lock.try_lock_exclusive().is_ok();
    if second_lock {
        FileExt::unlock(&lock)?;
    }
    // Guard API must refuse replacement while native exit is unobserved. Missing
    // transcript alone is not used as evidence that the ownership guard is safe.
    let recovery = NativePi::recover(&d, &config).await;
    let refused = recovery.is_err();
    let recovery_reason = recovery.as_ref().err().map(|e| e.to_string());
    if let Ok(native) = recovery {
        native.shutdown().await?;
    }
    println!(
        "{}",
        json!({"proof":"installed-pi-zero-model-delayed-shutdown-fixture","mode":mode,"root":root,"pid":pid,"start_fact":fs::read_to_string(identity_file)?,"after_error_identity":identity(pid).ok(),"error":result.err().map(|e|e.to_string()),"native_still_alive":alive,"second_owner_lock_acquired":second_lock,"recovery_refused":refused,"recovery_reason":recovery_reason})
    );
    // Preserve fixture + native PID facts. Allow owned delayed cleanup to complete
    // before failing the baseline assertion; do not leave a test-created live child.
    std::thread::sleep(Duration::from_secs(4));
    if mode == "command" {
        let after = NativePi::recover(&d, &config).await;
        let reason = after
            .as_ref()
            .err()
            .map(|e| e.to_string())
            .unwrap_or_default();
        println!(
            "{}",
            json!({"proof":"post-native-exit-without-owner-wait","pid":pid,"still_alive":live(pid),"recovery_reason":reason})
        );
        if let Ok(native) = after {
            native.shutdown().await?;
        }
        assert!(
            reason.contains("exit unobserved"),
            "elapsed time/process absence is not an owned exit receipt"
        );
    }
    assert!(
        !(alive && second_lock),
        "BASELINE: native still alive while another owner acquires lock"
    );
    assert!(
        refused,
        "replacement must be refused absent proven original exit/session"
    );
    Ok(())
}
#[tokio::test]
#[ignore = "explicit installed zero-model native failure/exit proof"]
async fn installed_startup_failure_never_releases_before_exit() -> Result<()> {
    proof("startup").await
}
#[tokio::test]
#[ignore = "explicit installed zero-model malformed shutdown proof"]
async fn installed_malformed_shutdown_never_releases_before_exit() -> Result<()> {
    proof("shutdown").await
}
#[tokio::test]
#[ignore = "explicit installed zero-model command failure/drop proof"]
async fn installed_command_failure_drop_refuses_replacement() -> Result<()> {
    proof("command").await
}
#[tokio::test]
#[ignore = "explicit installed zero-provider stub-command CLI control failure proof"]
async fn installed_cli_control_failure_closes_and_observes_exit() -> Result<()> {
    proof("cli").await
}
