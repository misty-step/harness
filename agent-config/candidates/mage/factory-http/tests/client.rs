//! TCP/CLI transport fixtures, NOT gateway auth, native ACK or cloud admission.
use anyhow::Result;
use serde_json::{json, Value};
use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    process::Command,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    thread,
    time::{Duration, Instant},
};
use summon_http_client::{Client, Config};
use summon_protocol::{
    authority::*,
    visibility::{AgentRunAttemptV1, Management, MetadataRequest, RunMetadata},
    *,
};
fn binding() -> AuthorityBinding {
    AuthorityBinding {
        instance: "factory-fixture".into(),
        namespace: "native-fixture".into(),
        account_id: "fixture-account".into(),
        project_id: "fixture-project".into(),
    }
}
fn run() -> Run {
    Run::intake(Intake {
        initial_input_id: "original-input".into(),
        task: TaskSpec {
            id: "cf1:client-fixture".into(),
            kind: TaskKind::Research,
            brief: "Explicit transport fixture; no native/provider task".into(),
            workspace: "/fixture".into(),
            route: Route {
                harness: "fixture".into(),
                provider: "no-provider".into(),
                model: "no-model".into(),
                effort: "none".into(),
            },
            checks: vec![],
            outputs: vec![],
            source: None,
            commission_ref: None,
            context: None,
        },
    })
    .unwrap()
}
fn config(origin: String) -> Config {
    Config {
        origin,
        binding: binding(),
        assertion_env: None,
        loopback_fixture: true,
    }
}
fn request(stream: &mut TcpStream) -> (String, Vec<u8>) {
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .unwrap();
    let mut raw = Vec::new();
    let mut b = [0];
    while !raw.ends_with(b"\r\n\r\n") {
        assert!(raw.len() < 65536);
        stream.read_exact(&mut b).unwrap();
        raw.push(b[0]);
    }
    let headers = String::from_utf8(raw).unwrap();
    let length = headers
        .lines()
        .find_map(|l| {
            l.to_ascii_lowercase()
                .strip_prefix("content-length: ")
                .and_then(|n| n.parse::<usize>().ok())
        })
        .unwrap_or(0);
    let mut body = vec![0; length];
    stream.read_exact(&mut body).unwrap();
    (headers, body)
}
fn response(stream: &mut TcpStream, status: u16, headers: &str, body: &[u8]) {
    write!(stream,"HTTP/1.1 {status} Fixture\r\n{headers}Content-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",body.len()).unwrap();
    stream.write_all(body).unwrap();
}
fn scope(scope: AuthorityBinding) -> String {
    format!(
        "x-summon-authority: {}\r\nx-summon-actor: reader-actor\r\n",
        serde_json::to_string(&scope).unwrap()
    )
}
fn once(f: impl FnOnce(TcpStream) + Send + 'static) -> (String, thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let handle = thread::spawn(move || {
        listener.set_nonblocking(true).unwrap();
        let until = Instant::now() + Duration::from_secs(6);
        loop {
            match listener.accept() {
                Ok((stream, _)) => {
                    f(stream);
                    break;
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock && Instant::now() < until => {
                    thread::sleep(Duration::from_millis(5))
                }
                Err(e) => panic!("fixture request never arrived: {e}"),
            }
        }
    });
    (origin, handle)
}
#[test]
fn scoped_reads_original_body_and_no_automatic_post_retry() -> Result<()> {
    // Different creator and reader actors are real, allowed owner facts; same
    // account/project binding is required, not invented actor equivalence.
    let (origin, h) = once(|mut stream| {
        let (head, body) = request(&mut stream);
        assert!(head.starts_with("GET /v1/runs/cf1:client-fixture/authority HTTP/1.1"));
        assert!(body.is_empty());
        assert!(head.contains(&format!(
            "x-summon-authority: {}",
            serde_json::to_string(&binding()).unwrap()
        )));
        assert!(!head.contains("x-summon-verified") && !head.contains("cf-access-jwt-assertion"));
        response(
            &mut stream,
            200,
            &scope(binding()),
            &serde_json::to_vec(&AttributedAuthority {
                binding: binding(),
                actor_id: "original-creator".into(),
            })
            .unwrap(),
        );
    });
    let result = Client::new(config(origin))?.read("cf1:client-fixture", "authority")?;
    assert_eq!(result.body["actor_id"], "original-creator");
    assert_eq!(result.authority.actor_id, "reader-actor");
    h.join().unwrap();
    let original =
        b"{ \"input_id\":\"immutable-steer\", \"text\":\"LF and Unicode \\u2028 retained\" }";
    let (origin, h) = once(move |mut stream| {
        let (head, body) = request(&mut stream);
        assert!(head.starts_with("POST /v1/runs/cf1:client-fixture/input HTTP/1.1"));
        assert_eq!(body, original);
        let mut run = run();
        run.input(serde_json::from_slice(&body).unwrap()).unwrap();
        response(
            &mut stream,
            200,
            &scope(binding()),
            &serde_json::to_vec(&run.reply(None, false)).unwrap(),
        );
    });
    let result = Client::new(config(origin))?.send("cf1:client-fixture", "input", original)?;
    assert_eq!(result.body["run"]["revision"], 2);
    assert!(result.body["dispatch"].is_null());
    h.join().unwrap();
    let (origin, h) = once(move |mut stream| {
        request(&mut stream);
        response(
            &mut stream,
            200,
            &scope(binding()),
            b"{\"not_a_reply\":true}",
        );
    });
    let e = Client::new(config(origin))?
        .send("cf1:client-fixture", "input", original)
        .err()
        .unwrap();
    assert!(format!("{e:#}").contains("acceptance UNKNOWN"));
    h.join().unwrap();
    // Acceptance could precede a lost response. Observe ONE request/no retry,
    // retain uncertainty; never fabricate a native ACK or replace an input ID.
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let origin = format!("http://{}", listener.local_addr()?);
    let count = Arc::new(AtomicUsize::new(0));
    let c = count.clone();
    let h = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let (_, body) = request(&mut stream);
        assert_eq!(body, original);
        c.fetch_add(1, Ordering::SeqCst);
        drop(stream);
        listener.set_nonblocking(true).unwrap();
        let until = Instant::now() + Duration::from_millis(250);
        while Instant::now() < until {
            if let Ok((stream, _)) = listener.accept() {
                c.fetch_add(1, Ordering::SeqCst);
                drop(stream);
            }
            thread::sleep(Duration::from_millis(5));
        }
    });
    let e = Client::new(config(origin))?
        .send("cf1:client-fixture", "input", original)
        .err()
        .unwrap();
    assert!(format!("{e:#}").contains("acceptance UNKNOWN"));
    h.join().unwrap();
    assert_eq!(count.load(Ordering::SeqCst), 1);
    Ok(())
}
#[test]
fn scope_redirect_refusal_and_origin_guards() -> Result<()> {
    let (origin, h) = once(|mut stream| {
        request(&mut stream);
        let mut wrong = binding();
        wrong.project_id = "other-project".into();
        response(
            &mut stream,
            200,
            &scope(wrong),
            &serde_json::to_vec(&run().status()).unwrap(),
        );
    });
    assert!(Client::new(config(origin))?
        .read("cf1:client-fixture", "status")
        .err()
        .unwrap()
        .to_string()
        .contains("different account/project"));
    h.join().unwrap();
    let trap = TcpListener::bind("127.0.0.1:0")?;
    trap.set_nonblocking(true)?;
    let location = format!(
        "Location: http://{}/credential-trap\r\n",
        trap.local_addr()?
    );
    let (origin, h) = once(move |mut stream| {
        request(&mut stream);
        response(&mut stream, 302, &location, b"{}");
    });
    assert!(Client::new(config(origin))?
        .read("cf1:client-fixture", "status")
        .err()
        .unwrap()
        .to_string()
        .contains("HTTP 302"));
    h.join().unwrap();
    assert!(trap.accept().is_err());
    let (origin, h) = once(|mut stream| {
        request(&mut stream);
        response(
            &mut stream,
            403,
            "",
            br#"{"code":"capability_refused","message":"fixture action denied"}"#,
        );
    });
    assert!(Client::new(config(origin))?
        .read("cf1:client-fixture", "status")
        .err()
        .unwrap()
        .to_string()
        .contains("capability_refused"));
    h.join().unwrap();
    let (origin, h) = once(|mut stream| {
        request(&mut stream);
        response(
            &mut stream,
            200,
            &scope(binding()),
            &vec![b'a'; 4 * 1024 * 1024 + 1],
        );
    });
    assert!(Client::new(config(origin))?
        .read("cf1:client-fixture", "status")
        .err()
        .unwrap()
        .to_string()
        .contains("4MiB bound"));
    h.join().unwrap();
    let mut credentialed = url::Url::parse("https://example.invalid")?;
    credentialed.set_username("user").unwrap();
    credentialed.set_password(Some("credential")).unwrap();
    for origin in [
        "http://external.invalid",
        credentialed.as_str(),
        "https://example.invalid/?token=x",
        "https://example.invalid/path",
        "https://example.invalid/#secret",
    ] {
        assert!(Client::new(config(origin.into())).is_err());
    }
    let client = Client::new(config("https://example.invalid".into()))?;
    assert!(client.read("cf1:x/../wrong", "status").is_err());
    assert!(client.send("cf1:client-fixture", "proof", b"{}").is_err());
    assert!(client.send("cf1:client-fixture", "archive", b"{}").is_err());
    Ok(())
}
#[test]
fn canonical_view_and_metadata_replies_are_validated() -> Result<()> {
    let valid = AgentRunAttemptV1::from_status(run().status(), None, 1);
    valid.validate().unwrap();
    let original = serde_json::to_vec(&MetadataRequest {
        expected_run_revision: 1,
        expected_metadata_sha256: None,
        metadata: RunMetadata {
            origin: valid.origin.clone(),
            native: valid.native.clone(),
            lineage: valid.lineage.clone(),
            evidence: vec![],
            child_packets: vec![],
            decisions: vec![],
        },
    })?;
    let mut cases = vec![("unchanged", valid.clone())];
    let mut management = valid.clone();
    management.management = Management::ObservedOnly;
    let mut source = valid;
    source.source.sha256 = Some("0".repeat(64));
    cases.extend([("management", management), ("source", source)]);
    let mut wrongly_accepted = vec![];
    for (case, record) in cases {
        if case != "unchanged" {
            assert_eq!(record.validate().unwrap_err().code, "identity_conflict");
        }
        for endpoint in ["view", "metadata"] {
            let reply = serde_json::to_vec(&record)?;
            let expected = original.clone();
            let (origin, h) = once(move |mut stream| {
                let (head, body) = request(&mut stream);
                if endpoint == "view" {
                    assert!(head.starts_with("GET /v1/runs/cf1:client-fixture/view HTTP/1.1"));
                    assert!(body.is_empty());
                } else {
                    assert!(head.starts_with("POST /v1/runs/cf1:client-fixture/metadata HTTP/1.1"));
                    assert_eq!(body, expected);
                }
                response(&mut stream, 200, &scope(binding()), &reply);
            });
            let client = Client::new(config(origin))?;
            let result = if endpoint == "view" {
                client.read("cf1:client-fixture", endpoint)
            } else {
                client.send("cf1:client-fixture", endpoint, &original)
            };
            h.join().unwrap();
            if case == "unchanged" {
                assert!(result.is_ok(), "unchanged canonical record refused");
            } else {
                match result {
                    Ok(_) => wrongly_accepted.push(format!("{endpoint}:{case}")),
                    Err(e) => {
                        let error = format!("{e:#}");
                        assert!(error.contains("identity_conflict"));
                        if endpoint == "metadata" {
                            assert!(error.contains("acceptance UNKNOWN"));
                        }
                    }
                }
            }
        }
    }
    assert!(
        wrongly_accepted.is_empty(),
        "contradictory canonical replies accepted: {wrongly_accepted:?}"
    );
    Ok(())
}

#[test]
#[ignore = "explicit actual Pi CLI path; ordinary refusal only, no native/model start"]
fn factory_cli_errors_do_not_claim_native_delivery() -> Result<()> {
    let bin = std::env::var("PI_RUNTIME_BIN").expect("provide exact built Pi CLI path");
    let dir = tempfile::tempdir()?;
    let cfg = dir.path().join("client.json");
    let body = dir.path().join("original.json");
    std::fs::write(
        &body,
        br#"{"input_id":"immutable-steer","text":"explicit fixture"}"#,
    )?;
    let mut wrongly_attributed = vec![];
    for case in ["302", "404", "timeout", "unsupported", "lost-post"] {
        let (origin, handle) = if case == "unsupported" {
            ("http://127.0.0.1:1".to_owned(), None) // pre-send guard, no connection
        } else {
            let (origin, h) = once(move |mut stream| {
                request(&mut stream);
                match case {
                    "302" => response(
                        &mut stream,
                        302,
                        "Location: https://example.invalid/\r\n",
                        b"{}",
                    ),
                    "404" => response(
                        &mut stream,
                        404,
                        "",
                        br#"{"code":"not_found","message":"fixture"}"#,
                    ),
                    "timeout" => thread::sleep(Duration::from_secs(6)),
                    "lost-post" => (), // accepted bytes, no response; no resend
                    _ => unreachable!(),
                }
            });
            (origin, Some(h))
        };
        std::fs::write(
            &cfg,
            serde_json::to_vec(
                &json!({"origin":origin,"binding":binding(),"assertion_env":null,"loopback_fixture":true}),
            )?,
        )?;
        let mut args = vec!["factory", cfg.to_str().unwrap()];
        args.extend(if case == "unsupported" {
            vec![
                "send",
                "cf1:client-fixture",
                "proof",
                body.to_str().unwrap(),
            ]
        } else if case == "lost-post" {
            vec![
                "send",
                "cf1:client-fixture",
                "input",
                body.to_str().unwrap(),
            ]
        } else {
            vec!["read", "cf1:client-fixture", "status"]
        });
        let out = Command::new(&bin).args(args).output()?;
        if let Some(h) = handle {
            h.join().unwrap();
        }
        assert!(!out.status.success());
        assert!(
            out.stdout.is_empty(),
            "factory refusal emits no native facts"
        );
        let value: Value = serde_json::from_slice(&out.stderr)?;
        println!("factory:{case} actual stderr={value}");
        if value.get("native_delivery").is_some() {
            wrongly_attributed.push(case);
        }
        assert!(value["error"].is_string());
        if case == "lost-post" {
            assert!(value["error"]
                .as_str()
                .unwrap()
                .contains("acceptance UNKNOWN"));
        }
    }
    // Existing native-mode error attribution is NOT removed globally. This
    // malformed local request refuses before native startup, not a native task.
    let local = dir.path().join("invalid-native.json");
    std::fs::write(&local, b"{}")?;
    let out = Command::new(&bin).arg(local).output()?;
    assert!(!out.status.success());
    let value: Value = serde_json::from_slice(&out.stderr)?;
    assert_eq!(value["native_delivery"], "uncertain_unless_reconciled");
    assert!(
        wrongly_attributed.is_empty(),
        "factory-only failures claimed native delivery: {wrongly_attributed:?}"
    );
    Ok(())
}

#[test]
#[ignore = "explicit actual Mage/Pi CLI paths; no native Pi/model launched"]
fn both_owned_cli_read_paths() -> Result<()> {
    for name in ["MAGE_BIN", "PI_RUNTIME_BIN"] {
        let bin = std::env::var(name).expect("provide exact built CLI path");
        let (origin, h) = once(|mut stream| {
            let (head, body) = request(&mut stream);
            assert!(head.starts_with("GET /v1/runs/cf1:client-fixture/status HTTP/1.1"));
            assert!(body.is_empty());
            response(
                &mut stream,
                200,
                &scope(binding()),
                &serde_json::to_vec(&run().status()).unwrap(),
            );
        });
        let dir = tempfile::tempdir()?;
        let path = dir.path().join("client.json");
        std::fs::write(
            &path,
            serde_json::to_vec(
                &json!({"origin":origin,"binding":binding(),"assertion_env":null,"loopback_fixture":true}),
            )?,
        )?;
        let out = Command::new(bin)
            .args([
                "factory",
                path.to_str().unwrap(),
                "read",
                "cf1:client-fixture",
                "status",
            ])
            .output()?;
        assert!(
            out.status.success(),
            "{}",
            String::from_utf8_lossy(&out.stderr)
        );
        h.join().unwrap();
        let value: Value = serde_json::from_slice(&out.stdout)?;
        assert_eq!(value["gateway"]["body"]["run_id"], "cf1:client-fixture");
        assert_eq!(value["native_ack"], "not_inferred");
        assert_eq!(value["native_execution"], "not_invoked");
        assert_eq!(value["task_admission"], "not_inferred");
    }
    Ok(())
}
