//! Native ownership facts only: durable spawn intent, kernel PID/start identity,
//! and an exit receipt written ONLY after this owner's Child::wait succeeds.
//! No run phase, lease, timeout takeover or replacement permission lives here.
use anyhow::{ensure, Context, Result};
use serde_json::{json, Value};
use std::{
    fs::{self, File},
    os::fd::AsRawFd,
    path::{Path, PathBuf},
    process::ExitStatus,
    time::{SystemTime, UNIX_EPOCH},
};
use summon_protocol::sha256;

pub(crate) struct Owner {
    root: PathBuf,
    stem: String,
    intent_sha256: String,
    pub lock: File,
}
pub(crate) fn process_identity(pid: u32) -> Result<Value> {
    let stat = fs::read_to_string(format!("/proc/{pid}/stat"))?;
    let fields: Vec<_> = stat
        .rsplit_once(')')
        .context("owned kernel stat missing")?
        .1
        .split_whitespace()
        .collect();
    Ok(
        json!({"pid":pid,"start_ticks":fields.get(19).context("owned start identity missing")?,"boot_id":fs::read_to_string("/proc/sys/kernel/random/boot_id")?.trim()}),
    )
}
impl Owner {
    pub fn check(root: &Path) -> Result<()> {
        // A released OS lock is not an exit observation. A cancelled/dropped owner
        // or a crashed adapter leaves its immutable intent unresolved, even if the
        // native child later happens to exit. Never manufacture a recovery fact.
        let mut intents = 0;
        for entry in fs::read_dir(root)? {
            let path = entry?.path();
            let name = path
                .file_name()
                .and_then(|n| n.to_str())
                .context("owner fact name")?;
            let Some(stem) = name.strip_suffix(".owner-intent") else {
                continue;
            };
            intents += 1;
            let intent = fs::read(&path)?;
            let exit = root.join(format!("{stem}.owner-exit"));
            ensure!(
                exit.is_file(),
                "native owner exit unobserved; recovery/replacement refused ({name})"
            );
            let exit: Value = serde_json::from_slice(&fs::read(exit)?)?;
            ensure!(
                exit["intent_sha256"] == sha256(&intent)
                    && ["observed_native_exit", "not_spawned"]
                        .contains(&exit["fact"].as_str().unwrap_or("")),
                "native owner exit receipt conflict; refuse replacement"
            );
        }
        ensure!(
            intents > 0 || !root.join("native.session").exists(),
            "legacy native owner exit unobserved; explicit recovery/handoff required"
        );
        Ok(())
    }
    pub fn reserve(root: &Path, lock: File) -> Result<Self> {
        let stem = format!(
            "{}-{}",
            std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos()
        );
        let intent = serde_json::to_vec(
            &json!({"fact":"native_spawn_intent","adapter":process_identity(std::process::id())?}),
        )?;
        crate::immutable(&root.join(format!("{stem}.owner-intent")), &intent)?;
        Ok(Self {
            root: root.into(),
            stem,
            intent_sha256: sha256(&intent),
            lock,
        })
    }
    pub fn inherited_fd(&self) -> i32 {
        self.lock.as_raw_fd()
    }
    pub fn birth(&self, pid: u32) -> Result<()> {
        crate::immutable(
            &self.root.join(format!("{}.owner-pid", self.stem)),
            &serde_json::to_vec(&process_identity(pid)?)?,
        )?;
        Ok(())
    }
    pub fn observed(&self, pid: u32, status: &ExitStatus) -> Result<String> {
        let birth = self.root.join(format!("{}.owner-pid", self.stem));
        let birth_sha256 = if birth.is_file() {
            Some(sha256(&fs::read(birth)?))
        } else {
            None
        };
        let path = self.root.join(format!("{}.owner-exit", self.stem));
        crate::immutable(
            &path,
            &serde_json::to_vec(
                &json!({"fact":"observed_native_exit","intent_sha256":self.intent_sha256,"pid":pid,"birth_sha256":birth_sha256,"status":status.to_string(),"exit_code":status.code()}),
            )?,
        )?;
        Ok(path.to_string_lossy().into_owned())
    }
    pub fn not_spawned(&self) -> Result<()> {
        crate::immutable(
            &self.root.join(format!("{}.owner-exit", self.stem)),
            &serde_json::to_vec(&json!({"fact":"not_spawned","intent_sha256":self.intent_sha256}))?,
        )?;
        Ok(())
    }
}
