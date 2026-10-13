use std::{fs, path::PathBuf, process::Command};

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("shippr-cli-test-{}", std::process::id()));
        fs::create_dir(&path).unwrap();
        Self(path)
    }
    fn command(&self) -> Command {
        let mut cmd = Command::new(env!("CARGO_BIN_EXE_shippr"));
        cmd.current_dir(&self.0);
        cmd
    }
}
impl Drop for Fixture {
    fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); }
}

#[test]
fn recap_commands_through_real_cli() {
    let fixture = Fixture::new();
    fs::write(fixture.0.join("flow.mmd"), "graph LR\nA --> B\n").unwrap();
    let render = fixture.command().args([
        "recap", "render", "--primitives", "one,two", "--risk", "medium",
        "--flow", "flow.mmd", "--summary", "CLI summary",
    ]).output().unwrap();
    assert!(render.status.success(), "{}", String::from_utf8_lossy(&render.stderr));
    let block = String::from_utf8(render.stdout).unwrap();
    assert!(block.contains("Risk tier: medium"));
    assert!(block.contains("CLI summary"));
    fs::write(fixture.0.join("block.md"), &block).unwrap();
    fs::write(fixture.0.join("body.md"), "Original\r\n").unwrap();
    let result = fixture.command().args([
        "recap", "upsert", "--body-file", "body.md", "--block-file", "block.md",
        "-o", "updated.md",
    ]).output().unwrap();
    assert!(result.status.success());
    let updated = fs::read(fixture.0.join("updated.md")).unwrap();
    assert!(updated.starts_with(b"Original\r\n\n<!-- shippr:recap:start -->"));
    let again = fixture.command().args([
        "recap", "upsert", "--body-file", "updated.md", "--block-file", "block.md",
    ]).output().unwrap();
    assert!(again.status.success());
    assert_eq!(again.stdout, updated);
    for risk in ["invalid", "LOW"] {
        assert!(!fixture.command().args([
            "recap", "render", "--primitives", "one", "--risk", risk,
            "--flow", "flow.mmd",
        ]).output().unwrap().status.success());
    }
    fs::write(fixture.0.join("flow.mmd"), "graph LR\nA[broken").unwrap();
    let bad = fixture.command().args([
        "recap", "render", "--primitives", "one", "--risk", "low", "--flow", "flow.mmd",
    ]).output().unwrap();
    assert!(!bad.status.success());
    assert!(String::from_utf8_lossy(&bad.stderr).contains("unbalanced Mermaid brackets"));

    // Exercise the apply boundary using a local fake, never the installed gh or a PR.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::write(fixture.0.join("flow.mmd"), "graph LR\nA --> B").unwrap();
        let fake = fixture.0.join("gh");
        fs::write(&fake, r#"#!/bin/sh
printf '%s\n' "$*" >> calls
if [ "$1 $2" = 'pr view' ]; then
    if [ -f view.json ]; then cat view.json; else printf '{"body":"Original\\r\\n"}'; fi
elif [ "$1 $2" = 'pr edit' ]; then
    cp "$5" applied.md
    printf '%s' "$5" > temporary-path
else
    exit 9
fi
"#).unwrap();
        fs::set_permissions(&fake, fs::Permissions::from_mode(0o755)).unwrap();
        let result = fixture.command().env("PATH", format!("{}:/usr/bin:/bin", fixture.0.display())).args([
            "recap", "apply", "--pr", "42", "--repo", "owner/name",
            "--primitives", "one", "--risk", "high", "--flow", "flow.mmd",
        ]).output().unwrap();
        assert!(result.status.success(), "{}", String::from_utf8_lossy(&result.stderr));
        let calls = fs::read_to_string(fixture.0.join("calls")).unwrap();
        assert!(calls.contains("pr view 42 --json body --repo owner/name"));
        assert!(calls.contains("pr edit 42 --body-file"));
        assert!(calls.lines().last().unwrap().ends_with("--repo owner/name"));
        let applied = fs::read_to_string(fixture.0.join("applied.md")).unwrap();
        assert!(applied.contains("Risk tier: high"));
        assert!(applied.starts_with("Original\r\n"));
        let temporary = fs::read_to_string(fixture.0.join("temporary-path")).unwrap();
        assert!(!PathBuf::from(temporary).exists());
        fs::write(fixture.0.join("view.json"), serde_json::json!({"body": applied}).to_string()).unwrap();
        fs::write(fixture.0.join("calls"), "").unwrap();
        let unchanged = fixture.command().env("PATH", format!("{}:/usr/bin:/bin", fixture.0.display())).args([
            "recap", "apply", "--pr", "42", "--repo", "owner/name",
            "--primitives", "one", "--risk", "high", "--flow", "flow.mmd",
        ]).output().unwrap();
        assert!(unchanged.status.success());
        assert_eq!(fs::read_to_string(fixture.0.join("calls")).unwrap().lines().count(), 1);
    }
}
