// Real consumer boundary: Wrangler -> Rust Worker -> workerd DO SQLite, not a mock server.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = value => createHash('sha256').update(value).digest('hex');
const delay = ms => new Promise(r => setTimeout(r, ms));

test('exact source: local DO input/claim races, native ambiguity/cancel, scoped holds, proof and restart', { timeout: 120000 }, async t => {
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
  const boot = async () => {
    child = spawn(process.execPath, [process.env.WRANGLER_BIN ?? resolve(root, 'node_modules/wrangler/bin/wrangler.js'), 'dev', '--local', '--ip', '127.0.0.1', '--port', String(port), '--persist-to', resolve(scratch, 'state')], {
      cwd: root, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, TMPDIR: scratch, WRANGLER_SEND_METRICS: 'false', BROWSER: 'none' },
    });
    child.stdout.on('data', b => { output += b; });
    child.stderr.on('data', b => { output += b; });
    for (let i = 0; i < 300; i++) {
      if (child.exitCode !== null) throw new Error(`Wrangler exited: ${output}`);
      try { const r = await fetch(`${base}/v1/runs/cf1:absent/status`); if (r.status === 404) return; } catch {}
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
  const beforeRestart = status;
  await stop();
  await boot();
  assert.deepEqual(await api(prefix + '/status'), beforeRestart); // SQLite durability through real runtime restart
  assert.equal((await api(prefix + '/claim', winner.request)).replayed, true);
  status = (await api(prefix + '/input', { input_id: 'new-generation', text: 'New steering invalidates all old proof.' })).run;
  assert.equal(status.coverage_sha256, null);
  assert.equal(status.phase, 'researching');
  const dispatchHold = { hold_id: 'dispatch', action: 'dispatch', reason: 'Needs scope', authority_ref: 'owner', active: true, expected_revision: status.revision };
  status = (await api(prefix + '/hold', dispatchHold)).run;
  await api(prefix + '/claim', { claim_id: 'held-dispatch', runner_id: 'runner', expected_revision: status.revision }, 409);
  assert.equal((await api(prefix + '/status')).inputs[2].state, 'queued');
  t.diagnostic(`Actual Wrangler/workerd SQLite evidence: ${scratch}`);
});
