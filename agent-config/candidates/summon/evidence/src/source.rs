//! Request-scoped factual projection. No mutable run database or invented DO phase.
use crate::{
    native::{read_native, NativeSnapshot},
    retention,
};
use anyhow::{ensure, Context, Result};
use serde::Deserialize;
use serde_json::json;
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};
use summon_protocol::{visibility::*, NativeSession};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Sources {
    pub root: String,
    pub native: Vec<NativeSource>,
    #[serde(default)]
    pub do_views: Vec<DoSource>,
    /// Explicit trusted registrar selection: child agent alias -> parent alias.
    /// No parent relationship is inferred from ordinary bidirectional messages.
    #[serde(default)]
    pub parents: BTreeMap<String, String>,
    /// Exact original dispatcher/input entry selectors. A shell-expanded/template
    /// mismatch remains uncertain; these selectors never fabricate payload equality.
    #[serde(default)]
    pub commission_entries: BTreeMap<String, (String, String)>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DoSource {
    pub run_id: String,
    pub url: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NativeSource {
    pub agent_id: String,
    pub session: NativeSession,
    pub candidate: Option<PathBuf>,
    pub herdr_reference: Option<PathBuf>,
}
pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock before epoch")
        .as_millis() as u64
}
pub fn stamp(owner: &str, reference: &str, sha: Option<String>, state: FactState) -> SourceStamp {
    SourceStamp {
        owner: owner.into(),
        reference: reference.into(),
        read_at_unix_ms: now(),
        sha256: sha,
        state,
        detail: None,
    }
}
pub fn object_ref(digest: &str) -> String {
    format!("object:{digest}")
}
pub fn object_evidence(
    root: &Path,
    kind: EvidenceKind,
    owner: &str,
    body: &[u8],
    candidate: Option<String>,
) -> Result<EvidenceRef> {
    let digest = retention::retain(root, body)?;
    Ok(EvidenceRef {
        kind,
        source: stamp(
            owner,
            &object_ref(&digest),
            Some(digest),
            FactState::Current,
        ),
        candidate_sha256: candidate,
        coverage_sha256: None,
    })
}
pub fn candidate_bytes(root: &Path) -> Result<Vec<u8>> {
    ensure!(
        root.is_absolute() && fs::canonicalize(root)? == root,
        "candidate requires canonical absolute source root"
    );
    let git = |args: &[&str]| -> Result<Vec<u8>> {
        let output = Command::new("git")
            .arg("-C")
            .arg(root)
            .args(args)
            .output()?;
        ensure!(output.status.success(), "candidate git inspection failed");
        Ok(output.stdout)
    };
    let head = String::from_utf8(git(&["rev-parse", "HEAD"])?)?
        .trim()
        .to_owned();
    let mut files = BTreeMap::new();
    for raw in git(&["ls-files", "-co", "--exclude-standard", "-z"])?
        .split(|b| *b == 0)
        .filter(|s| !s.is_empty())
    {
        let relative = std::str::from_utf8(raw)?;
        let path = root.join(relative);
        let metadata = fs::symlink_metadata(&path)?;
        ensure!(
            files.len() < MAX_RECORDS && metadata.len() <= 64 * 1024 * 1024,
            "candidate source bound exceeded"
        );
        // Preserve source symlink identity without following foreign/credential paths.
        let bytes = if metadata.file_type().is_symlink() {
            fs::read_link(&path)?
                .as_os_str()
                .as_encoded_bytes()
                .to_vec()
        } else {
            ensure!(metadata.is_file(), "candidate source is not a regular file");
            fs::read(&path)?
        };
        files.insert(relative.to_owned(), summon_protocol::sha256(&bytes));
    }
    Ok(serde_json::to_vec(
        &json!({"source_root":root,"git_head":head,"files":files}),
    )?)
}
fn authored(snapshot: &NativeSnapshot, agent: &str, file: &str) -> Vec<AuthoredRef> {
    snapshot
        .entries
        .iter()
        .filter(|(_, _, v)| {
            v["message"]["role"] == "assistant"
                && v["message"]["content"]
                    .as_array()
                    .is_some_and(|a| a.iter().any(|b| b["type"] == "text"))
        })
        .map(|(id, sha, _)| AuthoredRef {
            author: agent.into(),
            source: stamp(
                "pi-native",
                &format!("{file}#{id}"),
                Some(sha.clone()),
                FactState::Current,
            ),
        })
        .collect()
}
pub fn snapshot(config: &Sources, archive: &Path) -> Result<Vec<AgentRunAttemptV1>> {
    ensure!(
        config.native.len() + config.do_views.len() <= MAX_RECORDS,
        "source inventory exceeds bound"
    );
    let mut records = Vec::new();
    let mut native = BTreeMap::new();
    for input in &config.native {
        let session = &input.session;
        ensure!(session.runtime == "pi", "native owner must be pi");
        let path = Path::new(&session.session_file);
        let snapshot = match read_native(path) {
            Ok(s) => {
                ensure!(
                    s.header["id"] == session.session_id,
                    "exact native session identity conflict"
                );
                Some(s)
            }
            Err(_) => None,
        };
        let mut source = stamp(
            "pi-native",
            &session.session_file,
            snapshot.as_ref().map(|s| s.source_sha256.clone()),
            if snapshot.is_some() {
                FactState::Current
            } else {
                FactState::Inaccessible
            },
        );
        source.detail = Some("Persisted append facts only; active native branch/live lifecycle unobserved. Herdr display/process presence is not native settlement.".into());
        let origin = if let Some((id, _, text)) = snapshot
            .as_ref()
            .and_then(|s| s.inputs.first())
            .filter(|(_, _, text)| !text.is_empty())
        {
            Fact::current(
                "pi-native",
                &format!("{}#{id}", session.session_file),
                now(),
                Origin {
                    agent_id: Some(input.agent_id.clone()),
                    brief: text.clone(),
                    acceptance: vec![text.clone()],
                    rationale: authored(
                        snapshot.as_ref().unwrap(),
                        &input.agent_id,
                        &session.session_file,
                    ),
                    decisions: vec![],
                },
            )
        } else {
            Fact {
                source: SourceStamp::unavailable(
                    "pi-native",
                    &format!("{}/original-input", session.session_file),
                    now(),
                    FactState::Missing,
                ),
                value: None,
            }
        };
        let mut native_state = Fact::current(
            "pi-native",
            &session.session_file,
            now(),
            NativeState::Unknown,
        );
        native_state.source.state = FactState::Uncertain;
        let lineage = Fact::current("pi-native", &session.session_file, now(), Lineage { complete: false, unresolved: vec![InventoryGap { reference: session.session_file.clone(), state: FactState::Uncertain, reason: "No live branch/complete delegation inventory authority observed; only source-backed known relationships below.".into() }], edges: vec![] });
        let mut evidence = Vec::new();
        if let Some(s) = &snapshot {
            let bytes = serde_json::to_vec(
                &json!({"native_header":s.header,"source_ref":session.session_file,"source_sha256":s.source_sha256,"selected_entries":s.entries}),
            )?;
            evidence.push(object_evidence(
                archive,
                EvidenceKind::Trace,
                "pi-native",
                &bytes,
                None,
            )?);
        }
        if let Some(file) = &input.herdr_reference {
            let bytes = fs::read(file)?;
            let owner: serde_json::Value = serde_json::from_slice(&bytes)?;
            let agent = &owner["result"]["agent"];
            ensure!(
                agent["name"] == input.agent_id
                    && agent["agent"] == "pi"
                    && agent["agent_session"]["value"] == session.session_file,
                "Herdr owner identity/source conflict"
            );
            evidence.push(object_evidence(
                archive,
                EvidenceKind::Trace,
                "herdr",
                &bytes,
                None,
            )?);
        }
        if let Some(root) = &input.candidate {
            match candidate_bytes(root) {
                Ok(bytes) => {
                    let digest = summon_protocol::sha256(&bytes);
                    evidence.push(object_evidence(
                        archive,
                        EvidenceKind::Candidate,
                        "git-source",
                        &bytes,
                        Some(digest),
                    )?);
                }
                Err(_) => evidence.push(EvidenceRef {
                    kind: EvidenceKind::Candidate,
                    source: SourceStamp::unavailable(
                        "git-source",
                        &root.to_string_lossy(),
                        now(),
                        FactState::Inaccessible,
                    ),
                    candidate_sha256: None,
                    coverage_sha256: None,
                }),
            }
        }
        records.push(AgentRunAttemptV1 {
            version: READ_VERSION,
            node_id: input.agent_id.clone(),
            management: Management::ObservedOnly,
            identity: RecordIdentity {
                agent_id: Some(input.agent_id.clone()),
                run_id: None,
                attempt_id: None,
                native_session: Some(session.clone()),
            },
            source,
            managed: None,
            origin,
            native: native_state,
            lineage,
            evidence,
            // Later native user-authored steering remains a separate original ref;
            // it cannot silently replace the frozen first input/acceptance. This
            // identifies the native author role, not an inferred person/permission.
            decisions: snapshot
                .as_ref()
                .map(|s| {
                    s.inputs
                        .iter()
                        .skip(1)
                        .map(|(id, sha, _)| AuthoredRef {
                            author: "pi:user".into(),
                            source: stamp(
                                "pi-native",
                                &format!("{}#{id}", session.session_file),
                                Some(sha.clone()),
                                FactState::Current,
                            ),
                        })
                        .collect()
                })
                .unwrap_or_default(),
            child_packets: vec![],
            metadata_sha256: None,
        });
        ensure!(
            native.insert(input.agent_id.clone(), snapshot).is_none(),
            "duplicate configured native identity"
        );
    }
    // Registrar selection never disappears just because an original source or
    // selected entry is unavailable. Never substitute a matching later status.
    ensure!(
        config.parents.len() <= MAX_RECORDS,
        "parent selector inventory exceeds bound"
    );
    ensure!(
        config
            .commission_entries
            .keys()
            .all(|child| config.parents.contains_key(child)),
        "commission selector lacks parent intent"
    );
    for (child_id, parent_id) in &config.parents {
        let parent = config
            .native
            .iter()
            .find(|s| &s.agent_id == parent_id)
            .context("selected parent must have a configured native identity")?;
        let child = config.native.iter().find(|s| &s.agent_id == child_id);
        let parent_source = native.get(parent_id).and_then(Option::as_ref);
        let child_source = native.get(child_id).and_then(Option::as_ref);
        let selectors = config.commission_entries.get(child_id);
        let (dispatch_id, input_id) = selectors
            .map(|(d, i)| (d.as_str(), i.as_str()))
            .unwrap_or(("unselected-original-dispatch", "unselected-original-input"));
        let parent_ref = format!("{}#{dispatch_id}", parent.session.session_file);
        let child_ref = child
            .map(|s| format!("{}#{input_id}", s.session.session_file))
            .unwrap_or_else(|| format!("unconfigured-native:{child_id}#{input_id}"));
        let selected = parent_source.zip(child_source).and_then(|(p, c)| {
            selectors.and_then(|(dispatch, input)| {
                p.commissions
                    .iter()
                    .find(|(id, _, target, _)| id == dispatch && target == child_id)
                    .zip(c.inputs.iter().find(|(id, _, _)| id == input))
            })
        });
        let record = records
            .iter_mut()
            .find(|r| &r.node_id == parent_id)
            .unwrap();
        let lineage = record.lineage.value.as_mut().unwrap();
        if let Some(((dispatch, dispatch_sha, _, sent), (input, input_sha, received))) = selected {
            let provenance = format!("{parent_ref}@{dispatch_sha}|{child_ref}@{input_sha}");
            let ordered = parent_source
                .unwrap()
                .entries
                .iter()
                .find(|(id, _, _)| id == dispatch)
                .and_then(|(_, _, v)| v["timestamp"].as_str())
                .zip(
                    child_source
                        .unwrap()
                        .entries
                        .iter()
                        .find(|(id, _, _)| id == input)
                        .and_then(|(_, _, v)| v["timestamp"].as_str()),
                )
                .is_some_and(|(p, c)| p <= c);
            let current = sent == received
                && !received.is_empty()
                && child.is_some_and(|c| c.session.host == parent.session.host)
                && ordered;
            let mut edge = Relation {
                edge_id: format!("{parent_id}:{child_id}:{dispatch}:{input}"),
                from: parent_id.clone(),
                to: child_id.clone(),
                kind: RelationKind::Child,
                original_source_ref: provenance.clone(),
                source: stamp(
                    "pi-native",
                    &provenance,
                    None,
                    if current {
                        FactState::Current
                    } else {
                        FactState::Uncertain
                    },
                ),
            };
            edge.source.sha256 = Some(edge.fact_digest());
            if !current {
                edge.source.detail = Some("Original selected dispatch/input physically observed; payload/host/order equality not established (literal shell template is not evaluated). No fabricated exact delivery or native parentSession.".into());
            }
            lineage.edges.push(edge);
        } else {
            lineage.unresolved.push(InventoryGap {
                reference:format!("selected-commission:{parent_id}->{child_id}|{parent_ref}|{child_ref}"),
                state:if parent_source.is_none() || child_source.is_none() {FactState::Inaccessible} else {FactState::Missing},
                reason:format!("Known selected child {child_id} unresolved: original parent dispatch {parent_ref}, original child input {child_ref}; parent source {}, child source {}, selected entry pair {}. No replacement edge or later matching message substituted.",if parent_source.is_some(){"available"}else{"unavailable"},if child_source.is_some(){"available"}else{"unavailable"},if selectors.is_some(){"unavailable/no-match"}else{"not selected"}),
            });
        }
    }
    // Rebind the canonical fact digest after adding source-backed edges/gaps.
    for record in &mut records {
        let lineage = record.lineage.value.take().unwrap();
        record.lineage = Fact::current("pi-native", &record.source.reference, now(), lineage);
    }
    for input in &config.do_views {
        let url = &input.url;
        let rest = url
            .strip_prefix("http://127.0.0.1:")
            .context("only caller-admitted loopback DO read endpoint allowed")?;
        ensure!(
            !url.contains(['?', '#', '@']),
            "DO read URI cannot carry credentials/query/fragment"
        );
        let (port, _) = rest.split_once('/').context("DO read URL path required")?;
        port.parse::<u16>()?;
        let read = || -> Result<AgentRunAttemptV1> {
            let mut response = ureq::get(url)
                .config()
                .max_redirects(0)
                .timeout_global(Some(std::time::Duration::from_secs(5)))
                .build()
                .call()?;
            let body = response
                .body_mut()
                .with_config()
                .limit(4 * 1024 * 1024)
                .read_to_vec()?;
            let record: AgentRunAttemptV1 = serde_json::from_slice(&body)?;
            record.validate().map_err(crate::refused)?;
            ensure!(
                record.management == Management::Summon
                    && record.identity.run_id.as_deref() == Some(input.run_id.as_str()),
                "DO source identity conflict"
            );
            Ok(record)
        };
        match read() {
            Ok(record) => records.push(record),
            Err(error) => {
                let missing = || Fact {
                    source: SourceStamp::unavailable(
                        &format!("summon_do:{}", input.run_id),
                        url,
                        now(),
                        FactState::Inaccessible,
                    ),
                    value: None,
                };
                let mut source = SourceStamp::unavailable(
                    &format!("summon_do:{}", input.run_id),
                    url,
                    now(),
                    FactState::Inaccessible,
                );
                source.detail = Some(format!("read failed; no phase/attempt imported: {error}"));
                records.push(AgentRunAttemptV1 {
                    version: READ_VERSION,
                    node_id: input.run_id.clone(),
                    management: Management::Summon,
                    identity: RecordIdentity {
                        agent_id: None,
                        run_id: Some(input.run_id.clone()),
                        attempt_id: None,
                        native_session: None,
                    },
                    source,
                    managed: None,
                    origin: missing(),
                    native: Fact {
                        source: SourceStamp::unavailable(
                            &format!("summon_do:{}", input.run_id),
                            url,
                            now(),
                            FactState::Inaccessible,
                        ),
                        value: None,
                    },
                    lineage: Fact {
                        source: SourceStamp::unavailable(
                            &format!("summon_do:{}", input.run_id),
                            url,
                            now(),
                            FactState::Inaccessible,
                        ),
                        value: None,
                    },
                    evidence: vec![],
                    decisions: vec![],
                    child_packets: vec![],
                    metadata_sha256: None,
                });
            }
        }
    }
    VisibilityGraph::new(records.clone())
        .map_err(crate::refused)?
        .reachable(&config.root)
        .map_err(crate::refused)?;
    Ok(records)
}
