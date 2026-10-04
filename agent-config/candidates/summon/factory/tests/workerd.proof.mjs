// Real consumer boundary: Wrangler -> Rust Worker -> workerd DO SQLite, not a mock server.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { authFixtureProof } from './auth-fixture.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = value => createHash('sha256').update(value).digest('hex');
// Independent HTTP fixture encoding, not another product schema. Shared Rust owns types.
const semantic = value => Array.isArray(value) ? value.map(semantic) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).filter(k => k !== 'read_at_unix_ms').sort().map(k => [k, semantic(value[k])])) : value;
const fact = (owner, reference, value, time = 1000) => ({ source: { owner, reference, read_at_unix_ms: time, sha256: hash(JSON.stringify(semantic(value))), state: 'current', detail: null }, value });
const delay = ms => new Promise(r => setTimeout(r, ms));

test('exact source: local DO input/claim races, native ambiguity/cancel, scoped holds, proof and restart', { timeout: 120000 }, async t => {
  // Reject the plausible false green: current source tested against stale generated WASM.
  const built = JSON.parse(await readFile(resolve(root, 'worker/build/source-revision.json'), 'utf8'));
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  assert.equal(built.head, head, 'Worker artifact must be built from this exact committed HEAD');
  assert.equal(execFileSync('git', ['status', '--porcelain', '--untracked-files=normal', '--', '.'], { cwd: root, encoding: 'utf8' }), '', 'Commit current factory source before claiming exact-revision proof');
  for (const [file, digest] of Object.entries(built.files)) assert.equal(hash(await readFile(resolve(root, 'worker/build', file))), digest, `Generated artifact changed: ${file}`);
  t.diagnostic(`Exact source/artifact HEAD: ${head}`);
  const scratchBase = resolve(homedir(), '.cache/tmp');
  await mkdir(scratchBase, { recursive: true });
  const scratch = await mkdtemp(resolve(scratchBase, 'summon-workerd-'));
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise(r => server.close(r));
  const base = `http://127.0.0.1:${port}`;
  let child;
  let output = '';
  const stop = async () => {
    if (!child || child.exitCode !== null) return;
    const exited = once(child, 'exit');
    process.kill(-child.pid, 'SIGTERM');
    await Promise.race([exited, delay(8000)]);
    if (child.exitCode === null) { process.kill(-child.pid, 'SIGKILL'); await exited; }
    await writeFile(resolve(scratch, 'wrangler.log'), output);
  };
  t.after(stop);
  const boot = async (config) => {
    child = spawn(process.execPath, [process.env.WRANGLER_BIN ?? resolve(root, 'node_modules/wrangler/bin/wrangler.js'), 'dev', '--local', '--ip', '127.0.0.1', '--port', String(port), '--persist-to', resolve(scratch, 'state'), ...(config ? ['--config', config] : [])], {
      cwd: root, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, TMPDIR: scratch, WRANGLER_SEND_METRICS: 'false', BROWSER: 'none' },
    });
    child.stdout.on('data', b => { output += b; });
    child.stderr.on('data', b => { output += b; });
    for (let i = 0; i < 300; i++) {
      if (child.exitCode !== null) throw new Error(`Wrangler exited: ${output}`);
      try { const r = await fetch(`${base}/v1/runs/cf1:absent/status`); if (r.status === 404 || (config && r.status === 403)) return; } catch {}
      await delay(100);
    }
    throw new Error(`Wrangler not ready: ${output}`);
  };
  const api = async (path, body, expected = 200) => {
    const response = await fetch(base + path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const json = await response.json();
    assert.equal(response.status, expected, JSON.stringify(json));
    return json;
  };
  await boot();
  const prefix = '/v1/runs/cf1:walk';
  await api(prefix + '/status', undefined, 404);
  const task = {
    id: 'cf1:walk', kind: 'research', brief: 'Read the complete supplied source.', workspace: '/owned/test',
    route: { harness: 'pi', provider: 'openai-codex', model: 'explicit-model', effort: 'high' },
    checks: [{ id: 'consumer', type: 'command', argv: ['cargo', 'test'], issuers: ['verifier'] }, { id: 'review', type: 'review', criterion: 'Supported conclusions', issuers: ['reviewer'] }],
    outputs: ['report.md'], commission_ref: 'opaque-commission', source: { adapter: 'glass', id: 'source-only' },
    context: { instructions: [], skills: [] },
  };
  const intake = { task, initial_input_id: 'initial' };
  const intakes = await Promise.all([api('/v1/intake', intake), api('/v1/intake', intake)]);
  assert.equal(intakes.filter(r => !r.replayed).length, 1);
  let status = intakes[0].run;
  assert.equal(status.inputs.length, 1);
  assert.equal(status.inputs[0].state, 'queued');
  assert.deepEqual(status.task.context, { instructions: [], skills: [] });
  await api('/v1/intake', { ...intake, task: { ...task, brief: 'conflict' } }, 409);
  await api('/v1/intake', { ...intake, task: { ...task, id: 'ts-run' } }, 400);
  const missingView = await api(prefix + '/view');
  assert.equal(missingView.management, 'summon');
  assert.equal(missingView.origin.source.state, 'missing');
  assert.equal(missingView.metadata_sha256, null);
  assert.equal((await api(prefix + '/packet')).proof.recursive_pass, false);
  const metadata = {
    origin: fact('fixture-commissioner', 'frozen-original-source', { agent_id: 'fixture-agent', brief: task.brief, acceptance: ['Original descriptive acceptance, never check override'], rationale: [], decisions: [] }),
    native: { source: { owner: 'pi', reference: 'native-state-unavailable', read_at_unix_ms: 1000, sha256: null, state: 'missing', detail: 'No native presence observation' }, value: null },
    lineage: fact('summon_do:cf1:walk', 'registered-lineage', { complete: false, unresolved: [{ reference: 'commission child inventory', state: 'missing', reason: 'Discovery not yet supplied' }], edges: [] }),
    evidence: [], child_packets: [],
  };
  let view = await api(prefix + '/metadata', { expected_run_revision: status.revision, expected_metadata_sha256: null, metadata });
  assert.equal(view.managed.revision, status.revision); // metadata never writes phase/revision
  await api(prefix + '/metadata', { expected_run_revision: status.revision, expected_metadata_sha256: null, metadata }, 409);
  const conflictingOrigin = structuredClone(metadata);
  conflictingOrigin.origin = fact('fixture-commissioner', 'frozen-original-source', { ...metadata.origin.value, acceptance: ['Replacement acceptance'] });
  await api(prefix + '/metadata', { expected_run_revision: status.revision, expected_metadata_sha256: view.metadata_sha256, metadata: conflictingOrigin }, 409);
  await api(prefix + '/input', { input_id: 'initial', text: 'different' }, 409);
  const initialRetry = await api(prefix + '/input', { input_id: 'initial', text: task.brief });
  assert.equal(initialRetry.replayed, true);
  const hold = { hold_id: 'release', action: 'release', reason: 'Separate approval', authority_ref: 'owner', active: true, expected_revision: status.revision };
  status = (await api(prefix + '/hold', hold)).run;
  const claimRequests = [1, 2].map(n => ({ claim_id: `claim-${n}`, runner_id: 'runner', expected_revision: status.revision }));
  const races = await Promise.all(claimRequests.map(async request => {
    const r = await fetch(base + prefix + '/claim', { method: 'POST', body: JSON.stringify(request) });
    return { code: r.status, json: await r.json(), request };
  }));
  assert.deepEqual(races.map(r => r.code).sort(), [200, 409]);
  const winner = races.find(r => r.code === 200);
  status = winner.json.run;
  const dispatch = winner.json.dispatch;
  assert.deepEqual(dispatch.task, task);
  assert.equal(dispatch.text_sha256, hash(task.brief));
  assert.equal(dispatch.native_session, null);
  const replay = await api(prefix + '/claim', winner.request);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.dispatch, dispatch); // observation-only, never an invoke instruction
  const session = { runtime: 'pi', host: 'native-host', session_id: 'session-1', session_file: '/owned/session.jsonl' };
  const receipt = { session, native_message_ref: 'user-entry-1', evidence_ref: 'native-receipt-1' };
  const observation = (event_id, value, d = dispatch) => ({ event_id, input_id: d.input_id, attempt_id: d.attempt_id, text_sha256: d.text_sha256, expected_revision: status.revision, observation: value });
  const ack = observation('ack', { kind: 'acknowledged', receipt });
  await api(prefix + '/observe', { ...ack, text_sha256: hash('wrong') }, 409);
  await api(prefix + '/observe', { ...ack, expected_revision: 0 }, 409);
  status = (await api(prefix + '/observe', ack)).run;
  assert.equal(status.inputs[0].state, 'acknowledged');
  assert.equal((await api(prefix + '/observe', ack)).replayed, true);
  await api(prefix + '/observe', { ...ack, event_id: 'wrong-session', expected_revision: status.revision, observation: { kind: 'acknowledged', receipt: { ...receipt, session: { ...session, session_id: 'other' } } } }, 409);
  status = (await api(prefix + '/observe', observation('lost', { kind: 'uncertain', reason: 'transport disconnected', evidence_ref: 'disconnect-observation' }))).run;
  assert.equal(status.phase, 'interrupted');
  const cancel = { cancel_id: 'cancel-1', input_id: dispatch.input_id, attempt_id: dispatch.attempt_id, reason: 'commissioner interrupt', authority_ref: 'commissioner', expected_revision: status.revision };
  status = (await api(prefix + '/cancel', cancel)).run;
  assert.equal(status.inputs[0].termination, null); // request is not termination
  assert.equal((await api(prefix + '/cancel', cancel)).replayed, true);
  status = (await api(prefix + '/observe', observation('termination', { kind: 'terminated', termination: { session, evidence_ref: 'independently-observed-exit' } }))).run;
  assert.equal(status.inputs[0].state, 'uncertain');
  assert.equal(status.phase, 'interrupted'); // actual termination is NOT delivery reconciliation
  const interruptedPacket = await api(prefix + '/packet');
  assert.equal(interruptedPacket.record.managed.phase, 'interrupted');
  assert.equal(interruptedPacket.record.managed.inputs[0].termination.evidence_ref, 'independently-observed-exit');
  assert.equal(interruptedPacket.proof.recursive_pass, false); // failed/interrupted archive remains exportable
  await api(prefix + '/claim', { claim_id: 'no-resend', runner_id: 'new-runner', expected_revision: status.revision }, 409);
  const answer = observation('recovered-answer', { kind: 'answered', receipt, text: 'Native final answer', answer_ref: 'assistant-entry-1' });
  await api(prefix + '/observe', answer, 409);
  status = (await api(prefix + '/reconcile', answer)).run;
  assert.equal(status.phase, 'awaiting_review');
  assert.equal(status.inputs[0].termination.evidence_ref, 'independently-observed-exit');
  const inputs = await Promise.all([api(prefix + '/input', { input_id: 'steer', text: 'One clarification.' }), api(prefix + '/input', { input_id: 'steer', text: 'One clarification.' })]);
  assert.equal(inputs.filter(r => !r.replayed).length, 1);
  status = (await api(prefix + '/status'));
  assert.equal(status.inputs.length, 2);
  const next = await api(prefix + '/claim', { claim_id: 'next', runner_id: 'runner', expected_revision: status.revision });
  status = next.run;
  const resumed = next.dispatch;
  assert.deepEqual(resumed.native_session, session);
  const nextReceipt = { ...receipt, native_message_ref: 'user-entry-2' };
  status = (await api(prefix + '/observe', observation('answer-2', { kind: 'answered', receipt: nextReceipt, text: 'Clarified answer', answer_ref: 'assistant-entry-2' }, resumed))).run;
  const delivery = { workspace_sha256: hash('whole isolated immutable tree including undeclared file'), revision: 'candidate-exact-revision-A', artifacts: [{ path: 'report.md', sha256: hash('report bytes') }], evidence_ref: 'snapshot-manifest' };
  status = (await api(prefix + '/observe', observation('snapshot-A', { kind: 'delivery', delivery }, resumed))).run;
  const proof = (proof_id, check_id, issuer, coverage = status.coverage_sha256) => ({ proof_id, check_id, issuer, coverage_sha256: coverage, verdict: 'pass', evidence_ref: 'actual-check-on-materialized-tree', expected_revision: status.revision });
  await api(prefix + '/proof', proof('bad-issuer', 'consumer', 'builder'), 409);
  await api(prefix + '/proof', proof('bad-coverage', 'consumer', 'verifier', hash('unrelated')), 409);
  status = (await api(prefix + '/proof', proof('command-A', 'consumer', 'verifier'))).run;
  assert.equal(status.phase, 'awaiting_review');
  status = (await api(prefix + '/proof', proof('review-A', 'review', 'reviewer'))).run;
  assert.equal(status.phase, 'verified_delivery'); // release hold did not affect unrelated artifact action
  const coverageA = status.coverage_sha256;
  // Same declared artifact, changed undeclared source: complete workspace digest invalidates checks.
  status = (await api(prefix + '/observe', observation('snapshot-B', { kind: 'delivery', delivery: { ...delivery, workspace_sha256: hash('tree with changed undeclared source'), revision: 'candidate-exact-revision-B' } }, resumed))).run;
  assert.notEqual(status.coverage_sha256, coverageA);
  assert.equal(status.phase, 'awaiting_review');
  await api(prefix + '/proof', proof('stale-A', 'review', 'reviewer', coverageA), 409);
  const verifyHold = { hold_id: 'verify', action: 'verify', reason: 'Verifier approval', authority_ref: 'verifier-owner', active: true, expected_revision: status.revision };
  status = (await api(prefix + '/hold', verifyHold)).run;
  await api(prefix + '/proof', proof('held', 'consumer', 'verifier'), 409);
  assert.equal((await api(prefix + '/status')).revision, status.revision);
  status = (await api(prefix + '/hold', { ...verifyHold, active: false, expected_revision: status.revision })).run;
  status = (await api(prefix + '/proof', proof('command-B', 'consumer', 'verifier'))).run;
  status = (await api(prefix + '/proof', proof('review-B', 'review', 'reviewer'))).run;
  assert.equal(status.phase, 'verified_delivery');
  // Actual Worker read/export path, but native/commission evidence below remains synthetic.
  view = await api(prefix + '/view');
  metadata.native = fact('pi', 'fixture-independent-native-state', 'settled');
  metadata.lineage = fact('summon_do:cf1:walk', 'registered-lineage', { complete: true, unresolved: [], edges: [] });
  view = await api(prefix + '/metadata', { expected_run_revision: status.revision, expected_metadata_sha256: view.metadata_sha256, metadata });
  // Empty/partial/unrelated/stale receipts never become complete from prose.
  const requiredEvidence = [];
  const evidence = (kind, owner, reference, sha256 = hash(`synthetic receipt bytes:${kind}:${reference}`)) => ({ kind, source: { owner, reference, read_at_unix_ms: 1000, sha256, state: 'current', detail: 'Synthetic fixture receipt; not native/independent proof' }, candidate_sha256: status.delivery.workspace_sha256, coverage_sha256: status.coverage_sha256 });
  requiredEvidence.push(evidence('candidate', 'fixture-verifier', status.delivery.evidence_ref));
  for (const artifact of status.delivery.artifacts) requiredEvidence.push(evidence('deliverable', 'fixture-verifier', artifact.path, artifact.sha256));
  for (const input of status.inputs) requiredEvidence.push(evidence('trace', status.task.route.harness, input.acknowledged.evidence_ref));
  for (const check of status.task.checks) {
    const receipt = [...status.proofs].reverse().find(p => p.check_id === check.id && p.coverage_sha256 === status.coverage_sha256);
    requiredEvidence.push(evidence(check.type === 'review' ? 'review' : 'check', receipt.issuer, receipt.evidence_ref));
  }
  for (const mode of ['empty', 'partial', 'unrelated', 'stale', 'unbound']) {
    metadata.evidence = structuredClone(requiredEvidence);
    if (mode === 'empty') metadata.evidence = [];
    if (mode === 'partial') metadata.evidence.pop();
    if (mode === 'unrelated') for (const e of metadata.evidence) e.source.reference = 'unrelated-fresh-receipt';
    if (mode === 'stale') for (const e of metadata.evidence) e.coverage_sha256 = hash('previous candidate');
    if (mode === 'unbound') for (const e of metadata.evidence) { e.coverage_sha256 = null; e.candidate_sha256 = null; }
    view = await api(prefix + '/metadata', { expected_run_revision: status.revision, expected_metadata_sha256: view.metadata_sha256, metadata });
    const incomplete = await api(prefix + '/packet');
    assert.equal(incomplete.proof.recursive_pass, false, mode);
    assert.ok(incomplete.proof.issues.some(i => ['missing', 'stale'].includes(i.state)), mode);
    assert.deepEqual(await api(prefix + '/status'), status);
    // Export remains valid and useful despite incomplete evidence.
    assert.equal((await api('/v1/visibility/reopen', { packet: incomplete, records: [view], packets: [] })).recursive_pass, false, mode);
  }
  metadata.evidence = requiredEvidence;
  view = await api(prefix + '/metadata', { expected_run_revision: status.revision, expected_metadata_sha256: view.metadata_sha256, metadata });
  const archive = await api(prefix + '/packet');
  assert.equal(archive.proof.recursive_pass, true);
  assert.equal(archive.record.origin.value.brief, task.brief);
  assert.deepEqual(archive.record.managed.task.checks, task.checks);
  const page = await api('/v1/visibility/page', { root: view.node_id, records: [view], cursor: null, limit: 1 });
  assert.equal(page.records.length, 1);
  const portable = await api('/v1/visibility/export', { root: view.node_id, records: [view], packets: [] });
  assert.equal(portable.binding_sha256, archive.binding_sha256);
  assert.equal((await api('/v1/visibility/reopen', { packet: archive, records: [view], packets: [] })).recursive_pass, true);
  // Timestamp refresh only: same semantic evidence, different actual archive snapshot bytes.
  metadata.origin.source.read_at_unix_ms += 10;
  metadata.native.source.read_at_unix_ms += 10;
  view = await api(prefix + '/metadata', { expected_run_revision: status.revision, expected_metadata_sha256: view.metadata_sha256, metadata });
  const refreshedArchive = await api(prefix + '/packet');
  assert.equal(refreshedArchive.binding_sha256, archive.binding_sha256);
  assert.equal((await api('/v1/visibility/reopen', { packet: archive, records: [view], packets: [] })).recursive_pass, true);
  metadata.native.source.state = 'failed'; metadata.native.source.detail = 'Current reader failed; retained settled fact is not current';
  view = await api(prefix + '/metadata', { expected_run_revision: status.revision, expected_metadata_sha256: view.metadata_sha256, metadata });
  const failure = await api('/v1/visibility/reopen', { packet: archive, records: [view], packets: [] });
  assert.equal(failure.recursive_pass, false);
  assert.ok(failure.issues.some(i => i.state === 'failed'));
  assert.deepEqual(await api(prefix + '/status'), status); // read/export/native read failure never writes DO phase
  const beforeRestart = status;
  const metadataBeforeRestart = view.metadata_sha256;
  await stop();
  await boot();
  assert.deepEqual(await api(prefix + '/status'), beforeRestart); // SQLite durability through real runtime restart
  assert.equal((await api(prefix + '/view')).metadata_sha256, metadataBeforeRestart);
  assert.equal((await api(prefix + '/claim', winner.request)).replayed, true);
  status = (await api(prefix + '/input', { input_id: 'new-generation', text: 'New steering invalidates all old proof.' })).run;
  assert.equal(status.coverage_sha256, null);
  assert.equal(status.phase, 'researching');
  const dispatchHold = { hold_id: 'dispatch', action: 'dispatch', reason: 'Needs scope', authority_ref: 'owner', active: true, expected_revision: status.revision };
  status = (await api(prefix + '/hold', dispatchHold)).run;
  await api(prefix + '/claim', { claim_id: 'held-dispatch', runner_id: 'runner', expected_revision: status.revision }, 409);
  assert.equal((await api(prefix + '/status')).inputs[2].state, 'queued');
  // Real SQLite state bound: failed append cannot partially commit or advance revision.
  const limitTask = { ...task, id: 'cf1:limit', checks: [], outputs: [] };
  let limited = (await api('/v1/intake', { task: limitTask, initial_input_id: 'initial' })).run;
  let rejected = false;
  for (let n = 0; n < 12; n++) {
    const response = await fetch(base + '/v1/runs/cf1:limit/input', { method: 'POST', body: JSON.stringify({ input_id: `large-${n}`, text: 'x'.repeat(64000) }) });
    const value = await response.json();
    if (response.status === 413) { rejected = true; assert.equal(value.code, 'state_limit'); break; }
    assert.equal(response.status, 200);
    limited = value.run;
  }
  assert.ok(rejected, 'run storage limit must reject oversized state');
  assert.deepEqual(await api('/v1/runs/cf1:limit/status'), limited);
  // Near the admission budget AFTER dispatch. All native facts are synthetic;
  // HTTP/SQLite/restart/capacity behavior is the real deployed local Worker.
  for (const mode of ['answer', 'lost-ack-reconcile']) {
    const id = `cf1:capacity-${mode}`, p = `/v1/runs/${id}`;
    let current = (await api('/v1/intake', { task: { ...limitTask, id }, initial_input_id: 'initial' })).run;
    const claim = { claim_id: 'native-claim', runner_id: 'fixture-runner', expected_revision: current.revision };
    const claimed = await api(p + '/claim', claim); current = claimed.run;
    const d = claimed.dispatch;
    let accepted = 0;
    for (let n = 0; n < 12; n++) {
      const before = structuredClone(current);
      const response = await fetch(base + p + '/input', { method: 'POST', body: JSON.stringify({ input_id: `accepted-${n}`, text: 'x'.repeat(64000) }) });
      const value = await response.json();
      if (response.status === 413) { assert.equal(value.code, 'state_limit'); assert.deepEqual(await api(p + '/status'), before); break; }
      assert.equal(response.status, 200); current = value.run; accepted++;
    }
    assert.ok(accepted > 0, 'normal steering must remain usable while native input is in flight');
    const steerRetry = await api(p + '/input', { input_id: 'accepted-0', text: 'x'.repeat(64000) });
    assert.equal(steerRetry.replayed, true); assert.deepEqual(steerRetry.run, current);
    await api(p + '/input', { input_id: 'accepted-0', text: 'changed' }, 409);
    // Other writes also cannot spend the reserved outcome/recovery capacity.
    for (let n = 0; n < 12; n++) {
      const response = await fetch(base + p + '/hold', { method: 'POST', body: JSON.stringify({ hold_id: `capacity-${n}`, action: 'release', reason: 'h'.repeat(64000), authority_ref: 'fixture-authority', active: true, expected_revision: current.revision }) });
      const value = await response.json();
      if (response.status === 413) { assert.equal(value.code, 'state_limit'); assert.deepEqual(await api(p + '/status'), current); break; }
      assert.equal(response.status, 200); current = value.run;
    }
    // Independent metadata storage has its own atomic bound and cannot steal it.
    const beforeMetadata = current;
    const hugeMetadata = { ...structuredClone(metadata), evidence: Array.from({length: 3000}, () => structuredClone(requiredEvidence[0])) };
    await api(p + '/metadata', { expected_run_revision: current.revision, expected_metadata_sha256: null, metadata: hugeMetadata }, 413);
    assert.deepEqual(await api(p + '/status'), beforeMetadata);
    const message = (event_id, observation) => ({ event_id, input_id: d.input_id, attempt_id: d.attempt_id, text_sha256: d.text_sha256, expected_revision: current.revision, observation });
    if (mode === 'lost-ack-reconcile') {
      current = (await api(p + '/observe', message('lost-ack', { kind: 'uncertain', reason: 'u'.repeat(64000), evidence_ref: 'fixture-native-disconnect' }))).run;
      assert.equal(current.inputs[0].state, 'uncertain');
    } else {
      current = (await api(p + '/observe', message('ack-at-budget', { kind: 'acknowledged', receipt: { ...receipt, session: { ...session, session_id: id } } }))).run;
    }
    const retained = structuredClone(current);
    await stop(); await boot();
    assert.deepEqual(await api(p + '/status'), retained);
    assert.deepEqual((await api(p + '/claim', claim)).dispatch, d);
    const final = message('final', { kind: 'answered', receipt: { ...receipt, session: { ...session, session_id: id } }, text: '\x01'.repeat(64000), answer_ref: 'fixture-actual-assistant-ref' });
    const endpoint = p + (mode === 'lost-ack-reconcile' ? '/reconcile' : '/observe');
    current = (await api(endpoint, final)).run;
    assert.equal(current.inputs[0].answer, final.observation.text);
    assert.equal(current.inputs[0].state, 'answered');
    assert.equal(current.inputs.length, accepted + 1);
    assert.equal((await api(endpoint, final)).replayed, true);
    await api(endpoint, { ...final, observation: { ...final.observation, text: 'conflicting final payload' } }, 409);
    assert.deepEqual(await api(p + '/status'), current);
    await stop(); await boot();
    assert.deepEqual(await api(p + '/status'), current);
    assert.equal((await api(endpoint, final)).replayed, true);
    t.diagnostic(`Capacity ${mode}: ${accepted} accepted steering inputs; atomic unsafe-growth refusal; full escaped 64000B final retained; restart/replay pass (native synthetic)`);
  }
  const oversized = await fetch(base + prefix + '/input', { method: 'POST', body: 'x'.repeat(512 * 1024 + 1) });
  assert.equal(oversized.status, 413);
  await stop();
  await authFixtureProof({ root, scratch, base, task, boot, stop, t });
  t.diagnostic(`Actual Wrangler/workerd SQLite evidence: ${scratch}`);
});
