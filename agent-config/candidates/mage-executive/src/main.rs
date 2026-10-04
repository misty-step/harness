use anyhow::{bail, ensure, Context, Result};
use fs2::FileExt;
use mage_executive::{private_dir, Broker, Config, ToolRequest, MAX_FRAME};
use serde_json::json;
use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    os::unix::fs::OpenOptionsExt,
    os::unix::io::AsRawFd,
    os::unix::process::CommandExt,
    path::Path,
    process::{Command, Stdio},
};

fn main() {
    if let Err(error) = run() {
        eprintln!("mage-executive: {error:#}");
        std::process::exit(1);
    }
}
fn run() -> Result<()> {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    ensure!(
        args.len() >= 2,
        "usage: mage-executive serve|tool|inspect|agentmail-read|native-admit CONFIG [INSTANCE]"
    );
    let path = fs::canonicalize(&args[1])?;
    let config = Config::load(&path)?;
    private_dir(&config.state_dir)?;
    match args[0].as_str() {
        "tool" => {
            ensure!(args.len() == 2, "unexpected tool arguments");
            let mut bytes = Vec::new();
            std::io::stdin()
                .take((MAX_FRAME + 1) as u64)
                .read_to_end(&mut bytes)?;
            ensure!(bytes.len() <= MAX_FRAME, "tool frame too large");
            let request: ToolRequest = serde_json::from_slice(&bytes)?;
            let result = Broker::open(&config)?.execute(&config, &request)?;
            println!("{}", serde_json::to_string(&result)?);
        }
        "native-admit" => {
            ensure!(args.len() == 2, "unexpected native admission arguments");
            let mut bytes = Vec::new();
            std::io::stdin()
                .take((MAX_FRAME + 1) as u64)
                .read_to_end(&mut bytes)?;
            ensure!(
                bytes.len() <= MAX_FRAME,
                "native admission frame exceeds bound"
            );
            let request: mage_executive::native_guard::Request = serde_json::from_slice(&bytes)?;
            println!(
                "{}",
                Broker::open(&config)?.native_admit(&config, &request)?
            );
        }
        "agentmail-read" => {
            ensure!(args.len() == 2, "unexpected mail arguments");
            let mut bytes = Vec::new();
            std::io::stdin()
                .take((MAX_FRAME + 1) as u64)
                .read_to_end(&mut bytes)?;
            ensure!(bytes.len() <= MAX_FRAME, "mail request exceeds bound");
            let request: ToolRequest = serde_json::from_slice(&bytes)?;
            println!("{}", mage_executive::mail::read(&config, &request)?);
        }
        "inspect" => {
            ensure!(args.len() == 3, "inspect needs exact instance");
            config.instance(&args[2])?;
            println!("{}", Broker::open(&config)?.effects(&args[2])?);
        }
        "serve" => serve(&config, &path)?,
        _ => bail!("unsupported command"),
    }
    Ok(())
}
fn serve(config: &Config, path: &Path) -> Result<()> {
    ensure!(
        config.adapter.is_file() && config.node.is_file(),
        "host runtime unavailable"
    );
    let engine_path = config.state_dir.join("engine.sqlite");
    if engine_path.exists() {
        ensure!(
            fs::symlink_metadata(&engine_path)?.is_file()
                && !fs::symlink_metadata(&engine_path)?.file_type().is_symlink(),
            "invalid engine storage"
        );
    }
    let owner_id = fs::read_to_string("/proc/sys/kernel/random/uuid")?
        .trim()
        .to_owned();
    let lock_path = config.state_dir.join("owner.lock");
    if lock_path.exists() {
        ensure!(
            !fs::symlink_metadata(&lock_path)?.file_type().is_symlink(),
            "invalid owner lock"
        );
    }
    let lock = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .mode(0o600)
        .open(&lock_path)?;
    lock.try_lock_exclusive()
        .context("executive storage already has an owner; no takeover")?;
    let fd = lock.as_raw_fd();
    let mut command = Command::new(&config.node);
    command
        .arg(&config.adapter)
        .arg(path)
        .arg(std::env::current_exe()?)
        .env("MAGE_OWNER_FD", "3")
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());
    // The actual child and its broker/adapter children inherit this kernel lock.
    // Losing this Rust parent cannot admit a second live Harness on the same storage.
    unsafe {
        command.pre_exec(move || {
            if libc::dup2(fd, 3) < 0 {
                return Err(std::io::Error::last_os_error());
            }
            if libc::fcntl(3, libc::F_SETFD, 0) < 0 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
    let mut child = command.spawn()?;
    let exit = child.wait()?;
    let receipt = json!({"schema":"mage-owner-exit/1","owner_id":owner_id,"native_pid":child.id(),"observed_wait":true,"exit":exit.code()});
    let receipt_path = config.state_dir.join(format!("owner-exit-{owner_id}.json"));
    let mut f = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&receipt_path)?;
    f.write_all(serde_json::to_string(&receipt)?.as_bytes())?;
    f.sync_all()?;
    ensure!(
        exit.success(),
        "durable host failed; retained state requires inspection"
    );
    drop(lock);
    Ok(())
}
