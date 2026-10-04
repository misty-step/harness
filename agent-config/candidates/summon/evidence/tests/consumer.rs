//! Clearly labeled native-file fixtures. They are NOT native executions/provider work.
use anyhow::{ensure, Result};
use serde_json::{json, Value};
use std::{fs, process::Command};
use summon_evidence::{
    archive,
    source::{snapshot, Sources},
};
use summon_protocol::visibility::{FactState, VisibilityGraph};
fn session(path: &std::path::Path, id: &str, entries: Vec<Value>) -> Result<()> {
    let mut bytes = format!(
        "{}\n",
        json!({"type":"session","version":3,"id":id,"cwd":"/fixture"})
    );
    for entry in entries {
        bytes.push_str(&format!("{entry}\n"));
    }
    fs::write(path, bytes)?;
    Ok(())
}
fn user(id: &str, time: &str, text: &str) -> Value {
    json!({"type":"message","id":id,"timestamp":time,"message":{"role":"user","content":[{"type":"text","text":text}]}})
}
fn dispatch(id: &str, time: &str, target: &str, text: &str) -> Value {
    json!({"type":"message","id":id,"timestamp":time,"message":{"role":"assistant","content":[{"type":"thinking","thinking":"PRIVATE_FIXTURE_NEVER_EXPORT"},{"type":"toolCall","id":format!("call-{id}"),"name":"bash","arguments":{"command":format!("herdr agent prompt {target} '{text}'")}}]}})
}
#[test]
fn fixture_consumer_binds_original_commission_not_reply_and_reopens_without_glass() -> Result<()> {
    let root = tempfile::tempdir()?;
    let parent = root.path().join("parent.jsonl");
    let child = root.path().join("child.jsonl");
    let grandchild = root.path().join("grandchild.jsonl");
    session(
        &parent,
        "fixture-parent",
        vec![
            user(
                "p-origin",
                "2026-01-01T00:00:00.000Z",
                "Original operator commission.",
            ),
            dispatch(
                "p-dispatch",
                "2026-01-01T00:00:01.000Z",
                "child",
                "Original child commission.",
            ),
            user(
                "p-status",
                "2026-01-01T00:00:05.000Z",
                "Worker status, not a commission.",
            ),
        ],
    )?;
    session(
        &child,
        "fixture-child",
        vec![
            user(
                "c-origin",
                "2026-01-01T00:00:02.000Z",
                "Original child commission.",
            ),
            dispatch(
                "c-reply",
                "2026-01-01T00:00:04.000Z",
                "parent",
                "Worker status, not a commission.",
            ),
            dispatch(
                "c-dispatch",
                "2026-01-01T00:00:06.000Z",
                "grandchild",
                "Original grandchild commission.",
            ),
        ],
    )?;
    let grandchild_entries = vec![user(
        "g-origin",
        "2026-01-01T00:00:07.000Z",
        "Original grandchild commission.",
    )];
    session(
        &grandchild,
        "fixture-grandchild",
        grandchild_entries.clone(),
    )?;
    let candidate = root.path().join("candidate");
    fs::create_dir(&candidate)?;
    for args in [
        vec!["init", "-q"],
        vec![
            "-c",
            "user.name=fixture",
            "-c",
            "user.email=fixture@example.invalid",
            "commit",
            "-q",
            "--allow-empty",
            "-m",
            "fixture",
        ],
    ] {
        ensure!(
            Command::new("git")
                .arg("-C")
                .arg(&candidate)
                .args(args)
                .status()?
                .success(),
            "fixture git setup failed"
        );
    }
    fs::write(candidate.join("candidate.rs"), "original fixture source\n")?;
    let config: Sources = serde_json::from_value(
        json!({"root":"parent","parents":{"child":"parent","grandchild":"child"},"commission_entries":{"child":["p-dispatch","c-origin"],"grandchild":["c-dispatch","g-origin"]},"native":[{"agent_id":"parent","session":{"runtime":"pi","host":"fixture","session_id":"fixture-parent","session_file":parent},"candidate":candidate},{"agent_id":"child","session":{"runtime":"pi","host":"fixture","session_id":"fixture-child","session_file":child}},{"agent_id":"grandchild","session":{"runtime":"pi","host":"fixture","session_id":"fixture-grandchild","session_file":grandchild}}]}),
    )?;
    let archive_dir = root.path().join("archive");
    let records = snapshot(&config, &archive_dir)?;
    assert!(records.iter().all(|r| r.managed.is_none()
        && r.identity.attempt_id.is_none()
        && r.identity.run_id.is_none()));
    let graph = VisibilityGraph::new(records.clone()).map_err(summon_evidence::refused)?;
    assert_eq!(
        graph.edges.len(),
        2,
        "bidirectional status traffic cannot invent a child/reverse cycle"
    );
    let edge = graph.edges.values().find(|e| e.from == "parent").unwrap();
    assert!(
        edge.original_source_ref.contains("#p-dispatch@")
            && edge.original_source_ref.contains("#c-origin@")
    );
    let exported = archive::export(records.clone(), "parent", &archive_dir)?;
    let digest = exported["bundle_sha256"].as_str().unwrap();
    let opened = archive::reopen(&archive_dir, digest, Some(records.clone()))?;
    assert_eq!(opened["available_digests_valid"], true);
    assert_eq!(opened["archive_objects_complete"], true);
    assert_eq!(
        opened["proof"]["recursive_pass"], false,
        "observed-only must never import verified phase"
    );
    let fresh = snapshot(&config, &archive_dir)?;
    let unchanged = archive::reopen(&archive_dir, digest, Some(fresh.clone()))?;
    assert!(
        unchanged["proof"]["issues"]
            .as_array()
            .unwrap()
            .iter()
            .all(|i| i["state"] != "stale"),
        "export-derived refs must not make unchanged fresh owner facts stale at any depth"
    );
    assert_eq!(unchanged["proof"]["recursive_pass"], false);
    // A genuine leaf append must still invalidate the ORIGINAL descendant binding.
    let mut appended = grandchild_entries.clone();
    appended.push(user(
        "g-later",
        "2026-01-01T00:00:08.000Z",
        "Later steering",
    ));
    session(&grandchild, "fixture-grandchild", appended)?;
    let changed_leaf =
        archive::reopen(&archive_dir, digest, Some(snapshot(&config, &archive_dir)?))?;
    assert!(changed_leaf["proof"]["issues"]
        .as_array()
        .unwrap()
        .iter()
        .any(|i| i["node_id"] == "child"
            && i["state"] == "stale"
            && i["reason"] == "child candidate/source/packet binding changed"));
    session(&grandchild, "fixture-grandchild", grandchild_entries)?;
    // Explicit owner-provided bindings are not exporter omissions to reconstruct.
    let original_bytes = summon_evidence::retention::load(&archive_dir, digest)?;
    let frame: summon_protocol::evidence::ExportRequest = serde_json::from_slice(&original_bytes)?;
    let mut explicit = fresh;
    let parent = explicit.iter_mut().find(|r| r.node_id == "parent").unwrap();
    parent.child_packets = frame.packets[0].record.child_packets.clone();
    parent.child_packets[0].child_binding_sha256 = Some("0".repeat(64));
    let explicit_changed = archive::reopen(&archive_dir, digest, Some(explicit))?;
    assert!(explicit_changed["proof"]["issues"]
        .as_array()
        .unwrap()
        .iter()
        .any(|i| i["node_id"] == "parent"
            && i["state"] == "stale"
            && i["reason"] == "retained packet root differs from current source binding"));
    assert_eq!(
        summon_evidence::retention::load(&archive_dir, digest)?,
        original_bytes
    );
    let offline = archive::reopen(&archive_dir, digest, None)?;
    assert!(offline["proof"]["issues"]
        .as_array()
        .unwrap()
        .iter()
        .any(|i| i["reference"] == "fresh_owner_sources"));
    // Actual source bytes change in this explicitly labeled fixture, not read time.
    fs::write(candidate.join("candidate.rs"), "changed fixture source\n")?;
    let stale = archive::reopen(&archive_dir, digest, Some(records.clone()))?;
    assert!(stale["proof"]["issues"]
        .as_array()
        .unwrap()
        .iter()
        .any(|i| i["state"] == "stale"
            && i["reason"]
                .as_str()
                .is_some_and(|r| r.contains("actual candidate"))));
    // Keep bytes parked outside the package. Missing child must not be recovered
    // from a convenient inline/latest catalog or silently give the parent green.
    let root_packet: summon_protocol::evidence::ExportRequest =
        serde_json::from_slice(&summon_evidence::retention::load(&archive_dir, digest)?)?;
    let child_digest = root_packet.packets[0].record.child_packets[0]
        .packet
        .sha256
        .as_ref()
        .unwrap();
    fs::rename(
        archive_dir.join("objects").join(child_digest),
        root.path().join("parked-child-packet"),
    )?;
    let missing = archive::reopen(&archive_dir, digest, Some(records))?;
    assert_eq!(missing["archive_objects_complete"], false);
    assert_eq!(missing["proof"]["recursive_pass"], false);
    assert!(missing["proof"]["issues"]
        .as_array()
        .unwrap()
        .iter()
        .any(|i| i["reason"]
            .as_str()
            .is_some_and(|r| r.contains("child archive not present"))));
    for file in fs::read_dir(archive_dir.join("objects"))? {
        let bytes = fs::read(file?.path())?;
        assert!(!String::from_utf8_lossy(&bytes).contains("PRIVATE_FIXTURE_NEVER_EXPORT"));
    }
    Ok(())
}
#[test]
fn selected_original_template_mismatch_never_substitutes_later_matching_traffic() -> Result<()> {
    let root = tempfile::tempdir()?;
    let parent = root.path().join("parent.jsonl");
    let child = root.path().join("child.jsonl");
    session(
        &parent,
        "fixture-parent",
        vec![
            user(
                "p-origin",
                "2026-01-01T00:00:00Z",
                "Original parent commission",
            ),
            dispatch(
                "p-original",
                "2026-01-01T00:00:01Z",
                "child",
                "$literal_shell_template",
            ),
            dispatch("p-later", "2026-01-01T00:00:03Z", "child", "Later steering"),
        ],
    )?;
    session(
        &child,
        "fixture-child",
        vec![
            user(
                "c-original",
                "2026-01-01T00:00:02Z",
                "Actual delivered original child commission",
            ),
            user("c-later", "2026-01-01T00:00:04Z", "Later steering"),
        ],
    )?;
    let mut config: Sources = serde_json::from_value(
        json!({"root":"parent","parents":{"child":"parent"},"commission_entries":{"child":["p-original","c-original"]},"native":[{"agent_id":"parent","session":{"runtime":"pi","host":"fixture","session_id":"fixture-parent","session_file":parent}},{"agent_id":"child","session":{"runtime":"pi","host":"fixture","session_id":"fixture-child","session_file":child}}]}),
    )?;
    let archive_dir = root.path().join("archive");
    let original = snapshot(&config, &archive_dir)?;
    let edge = &original[0].lineage.value.as_ref().unwrap().edges[0];
    assert_eq!(edge.source.state, FactState::Uncertain);
    assert!(
        edge.original_source_ref.contains("#p-original@")
            && edge.original_source_ref.contains("#c-original@")
    );
    assert!(!edge.original_source_ref.contains("later"));
    assert_eq!(
        original[1].decisions.len(),
        1,
        "later authored steering remains separately retained"
    );
    let exported = archive::export(original, "parent", &archive_dir)?;
    assert_eq!(
        archive::reopen(
            &archive_dir,
            exported["bundle_sha256"].as_str().unwrap(),
            None
        )?["proof"]["recursive_pass"],
        false
    );
    config.commission_entries.insert(
        "child".into(),
        ("missing-original".into(), "c-original".into()),
    );
    let missing = snapshot(&config, &archive_dir)?;
    assert!(
        missing[0].lineage.value.as_ref().unwrap().edges.is_empty(),
        "no fallback to later matching traffic"
    );
    assert!(missing[0]
        .lineage
        .value
        .as_ref()
        .unwrap()
        .unresolved
        .iter()
        .any(|gap| gap.reference.contains("child") && gap.reference.contains("missing-original")));
    Ok(())
}
#[test]
fn selected_missing_commissions_remain_named_through_archive_and_recovery() -> Result<()> {
    for case in [
        "parent-unavailable",
        "child-unavailable",
        "dispatch-no-match",
        "input-no-match",
    ] {
        if std::env::var("COLLECTOR_FIXTURE_CASE").is_ok_and(|selected| selected != case) {
            continue;
        }
        let root = tempfile::tempdir()?;
        let parent = root.path().join("parent.jsonl");
        let child = root.path().join("child.jsonl");
        let parent_entries = vec![
            user(
                "p-origin",
                "2026-01-01T00:00:00Z",
                "Original parent commission",
            ),
            dispatch(
                "p-dispatch",
                "2026-01-01T00:00:01Z",
                "child",
                "Original child commission",
            ),
        ];
        let child_entries = vec![user(
            "c-origin",
            "2026-01-01T00:00:02Z",
            "Original child commission",
        )];
        session(&parent, "fixture-parent", parent_entries.clone())?;
        session(&child, "fixture-child", child_entries.clone())?;
        let config: Sources = serde_json::from_value(
            json!({"root":"parent","parents":{"child":"parent"},"commission_entries":{"child":["p-dispatch","c-origin"]},"native":[{"agent_id":"parent","session":{"runtime":"pi","host":"fixture","session_id":"fixture-parent","session_file":parent}},{"agent_id":"child","session":{"runtime":"pi","host":"fixture","session_id":"fixture-child","session_file":child}}]}),
        )?;
        match case {
            "parent-unavailable" => fs::remove_file(&parent)?,
            "child-unavailable" => fs::remove_file(&child)?,
            "dispatch-no-match" => {
                session(&parent, "fixture-parent", vec![parent_entries[0].clone()])?
            }
            _ => session(&child, "fixture-child", vec![])?,
        }
        let archive_dir = root.path().join("archive");
        let missing = snapshot(&config, &archive_dir)?;
        let lineage = missing[0].lineage.value.as_ref().unwrap();
        assert!(
            lineage.edges.is_empty(),
            "{case}: unavailable original facts cannot fabricate an edge"
        );
        assert!(
            lineage
                .unresolved
                .iter()
                .any(|gap| gap.reference.contains("child")
                    && gap.reference.contains("p-dispatch")
                    && gap.reference.contains("c-origin")
                    && gap.reason.contains(parent.to_str().unwrap())
                    && gap.reason.contains(child.to_str().unwrap())),
            "{case}: KNOWN selected child and both original references disappeared"
        );
        let exported = archive::export(missing.clone(), "parent", &archive_dir)?;
        let digest = exported["bundle_sha256"].as_str().unwrap();
        let packet: summon_protocol::evidence::ExportRequest =
            serde_json::from_slice(&summon_evidence::retention::load(&archive_dir, digest)?)?;
        assert!(packet.packets[0]
            .record
            .lineage
            .value
            .as_ref()
            .unwrap()
            .unresolved
            .iter()
            .any(|gap| gap.reference.contains("child") && gap.reference.contains("p-dispatch")));
        let reopened = archive::reopen(&archive_dir, digest, Some(missing))?;
        assert_eq!(reopened["proof"]["recursive_pass"], false);
        session(&parent, "fixture-parent", parent_entries)?;
        session(&child, "fixture-child", child_entries)?;
        let recovered = snapshot(&config, &archive_dir)?;
        assert_eq!(recovered[0].lineage.value.as_ref().unwrap().edges.len(), 1);
        let old = archive::reopen(&archive_dir, digest, Some(recovered.clone()))?;
        assert_eq!(
            old["proof"]["recursive_pass"], false,
            "recovery cannot rewrite original failed packet"
        );
        assert!(old["proof"]["issues"]
            .as_array()
            .unwrap()
            .iter()
            .any(|i| i["state"] == "stale"));
        let new_export = archive::export(recovered, "parent", &archive_dir)?;
        assert_ne!(new_export["bundle_sha256"], exported["bundle_sha256"]);
        assert_eq!(
            archive::reopen(
                &archive_dir,
                new_export["bundle_sha256"].as_str().unwrap(),
                None
            )?["proof"]["recursive_pass"],
            false
        );
    }
    Ok(())
}
#[test]
fn fixture_unavailable_do_read_retains_explicit_unknown_not_a_fake_phase() -> Result<()> {
    let root = tempfile::tempdir()?;
    let listener = std::net::TcpListener::bind("127.0.0.1:0")?;
    let address = listener.local_addr()?;
    let server = std::thread::spawn(move || -> std::io::Result<()> {
        use std::io::{Read, Write};
        let (mut socket, _) = listener.accept()?;
        let mut request = [0u8; 4096];
        socket.read(&mut request)?;
        socket.write_all(
            b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        )?;
        Ok(())
    });
    let config: Sources = serde_json::from_value(
        json!({"root":"fixture-unavailable-run","native":[],"do_views":[{"run_id":"fixture-unavailable-run","url":format!("http://{address}/v1/runs/fixture-unavailable-run/view")}]}),
    )?;
    let records = snapshot(&config, &root.path().join("archive"))?;
    assert_eq!(records.len(), 1);
    assert!(records[0].managed.is_none());
    assert_eq!(records[0].source.state, FactState::Inaccessible);
    assert!(records[0].identity.attempt_id.is_none());
    server.join().expect("owned fixture HTTP server")?;
    Ok(())
}
