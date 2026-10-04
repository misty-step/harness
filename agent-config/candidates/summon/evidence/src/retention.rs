//! Immutable byte retention only. Shared PacketManifestV1 owns semantic bindings;
//! archive byte integrity is NOT proof that current candidate/child sources are fresh.
use anyhow::{ensure, Context, Result};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
};
use summon_protocol::sha256;
const MAX_OBJECT: usize = 64 * 1024 * 1024;

fn directory(path: &Path, create: bool) -> Result<PathBuf> {
    ensure!(path.is_absolute(), "retention directory must be absolute");
    if !path.exists() {
        ensure!(
            create,
            "retained archive directory unavailable; reopen is read-only"
        );
        fs::create_dir_all(path)?;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    }
    let meta = fs::symlink_metadata(path)?;
    ensure!(
        meta.is_dir()
            && meta.uid() == unsafe_uid()
            && meta.mode() & 0o077 == 0
            && fs::canonicalize(path)? == path,
        "retention must be owned canonical owner-only directory"
    );
    Ok(path.to_owned())
}
fn unsafe_uid() -> u32 {
    // Source permissions have one actual OS owner; environment names cannot assert it.
    #[cfg(unix)]
    {
        unsafe { libc::getuid() }
    }
}
fn validate_digest(digest: &str) -> Result<()> {
    ensure!(
        digest.len() == 64
            && digest
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)),
        "lowercase SHA-256 object reference required"
    );
    Ok(())
}
pub fn retain(root: &Path, bytes: &[u8]) -> Result<String> {
    ensure!(
        bytes.len() <= MAX_OBJECT,
        "retained object exceeds 64MiB bound"
    );
    let root = directory(root, true)?;
    let objects = directory(&root.join("objects"), true)?;
    let digest = sha256(bytes);
    let dest = objects.join(&digest);
    if dest.exists() {
        ensure!(load(&root, &digest)? == bytes, "immutable object conflict");
        return Ok(digest);
    }
    let temp = objects.join(format!("{digest}.tmp-{}", std::process::id()));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW)
        .open(&temp)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    let published = fs::hard_link(&temp, &dest);
    fs::remove_file(temp)?;
    match published {
        Ok(()) => (),
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            ensure!(load(&root, &digest)? == bytes, "immutable object conflict")
        }
        Err(error) => return Err(error.into()),
    }
    File::open(objects)?.sync_all()?;
    Ok(digest)
}
pub fn load(root: &Path, digest: &str) -> Result<Vec<u8>> {
    validate_digest(digest)?;
    let root = directory(root, false)?;
    let objects = directory(&root.join("objects"), false)?;
    let file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW)
        .open(objects.join(digest))
        .context("retained evidence unavailable; not a green packet")?;
    ensure!(
        file.metadata()?.len() <= MAX_OBJECT as u64,
        "retained object exceeds bound"
    );
    let mut bytes = Vec::new();
    file.take((MAX_OBJECT + 1) as u64).read_to_end(&mut bytes)?;
    ensure!(
        bytes.len() <= MAX_OBJECT && sha256(&bytes) == digest,
        "retained evidence digest mismatch"
    );
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn immutable_objects_reopen_by_bytes_and_reject_corruption_or_missing_sources() -> Result<()> {
        let root = tempfile::tempdir()?;
        fs::set_permissions(root.path(), fs::Permissions::from_mode(0o700))?;
        let digest = retain(
            root.path(),
            b"authored rationale and observable receipt fixture",
        )?;
        assert_eq!(
            retain(
                root.path(),
                b"authored rationale and observable receipt fixture"
            )?,
            digest
        );
        assert_eq!(
            load(root.path(), &digest)?,
            b"authored rationale and observable receipt fixture"
        );
        fs::write(root.path().join("objects").join(&digest), b"changed")?;
        assert!(load(root.path(), &digest).is_err());
        assert!(load(root.path(), &sha256(b"missing child fixture")).is_err());
        assert!(load(root.path(), "../traversal").is_err());
        Ok(())
    }
}
