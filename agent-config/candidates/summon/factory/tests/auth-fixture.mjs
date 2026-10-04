// Invoked by the existing exact-head real workerd proof, not a mock auth server.
// Ephemeral RSA keys/AUD/user grants are fixtures, NOT allocated Access authority.
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';

export async function authFixtureProof({ root, scratch, base, task, boot, stop, t }) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const wrongKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  const kid = 'ephemeral-fixture-key';
  const issuer = 'https://misty-step-pantry.cloudflareaccess.com';
  const audience = 'fixture-only-not-an-allocated-Access-AUD';
  const binding = { instance: 'fixture-fresh-instance', namespace: 'fixture-fresh-namespace', account_id: 'b069014f6a46558ea9146fb6c4ff8f6c', project_id: 'fixture-project-A' };
  const policy = { issuer, audience, binding, native_enabled: false, grants: [
    ...['client-one', 'client-two'].map(user_sub => ({ user_sub, actor_id: `fixture-${user_sub}`, binding, actions: ['read', 'intake', 'steer', 'hold', 'claim', 'native_facts'] })),
    { user_sub: 'reader', actor_id: 'fixture-reader', binding, actions: ['read'] },
  ] };
  const template = JSON.parse((await readFile(resolve(root, 'wrangler.canary.jsonc'), 'utf8')).split('\n').filter(l => !l.trim().startsWith('//')).join('\n'));
  const config = resolve(scratch, 'auth-fixture.json');
  const jwks = { keys: [{ ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' }] };
  const configure = async (vars) => {
    await stop();
    await writeFile(config, JSON.stringify({ ...template, name: 'summon-factory-auth-fixture', main: resolve(root, template.main), vars }));
    await boot(config);
  };
  const vars = { FACTORY_MODE: 'fixture', FACTORY_AUTH_POLICY: JSON.stringify(policy), FACTORY_FIXTURE_JWKS: JSON.stringify(jwks) };
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: issuer, aud: [audience], sub: 'client-one', type: 'app', iat: now - 1, nbf: now - 1, exp: now + 3600 };
  const jwt = (changes = {}, header = {}, key = privateKey) => {
    const encode = v => Buffer.from(JSON.stringify(v)).toString('base64url');
    const signed = `${encode({ alg: 'RS256', typ: 'JWT', kid, ...header })}.${encode({ ...claims, ...changes })}`;
    return `${signed}.${sign('RSA-SHA256', Buffer.from(signed), key).toString('base64url')}`;
  };
  const clientOne = jwt(), clientTwo = jwt({ sub: 'client-two' });
  const receipts = [];
  const call = async (label, path, body, expected = 200, token = clientOne, scope = binding, extra = {}) => {
    const headers = { 'content-type': 'application/json', 'x-summon-authority': JSON.stringify(scope), ...extra };
    if (token !== null) headers['cf-access-jwt-assertion'] = token;
    const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const value = await response.json();
    receipts.push({ label, path, status: response.status, code: value.code ?? null, revision: (value.run ?? value).revision ?? null, actor: response.headers.get('x-summon-actor') });
    await writeFile(resolve(scratch, 'auth-http.json'), JSON.stringify({ fixture: true, not_live_Access: true, receipts }, null, 2));
    assert.equal(response.status, expected, `${label}: ${JSON.stringify(value)}`);
    return { value, response };
  };
  const p = '/v1/runs/cf1:auth-fixture';
  const intake = { task: { ...task, id: 'cf1:auth-fixture' }, initial_input_id: 'fixture-initial' };
  // Production mode is denied even on localhost when actual policy is missing.
  await configure({ FACTORY_MODE: 'hosted' });
  assert.equal((await call('hosted missing policy', '/v1/intake', intake, 403)).value.code, 'auth_unconfigured');
  // No production fallback to fixture keys, even with a valid fixture token.
  await configure({ ...vars, FACTORY_MODE: 'hosted' });
  assert.equal((await call('hosted forbids fixture JWKS', '/v1/intake', intake, 403)).value.code, 'auth_config');
  await configure(vars);
  await call('missing JWT', '/v1/intake', intake, 403, null);
  const accepted = await call('genuine RS256 signature intake', '/v1/intake', intake);
  assert.equal(accepted.response.headers.get('x-summon-actor'), 'fixture-client-one');
  assert.deepEqual(accepted.value.run.task, intake.task);
  const origin = { binding, actor_id: 'fixture-client-one' };
  assert.deepEqual((await call('frozen run scope/creator', p + '/authority')).value, origin);
  const retry = await call('other authenticated device exact retry', '/v1/intake', intake, 200, clientTwo);
  assert.equal(retry.value.replayed, true); assert.deepEqual(retry.value.run, accepted.value.run);
  await call('changed immutable intake conflict', '/v1/intake', { ...intake, task: { ...intake.task, brief: 'changed' } }, 409, clientTwo);
  const steering = { input_id: 'fixture-steering', text: 'Exact steering from a second authenticated device.' };
  const steered = (await call('device handoff steering', p + '/input', steering, 200, clientTwo)).value;
  assert.equal(steered.run.inputs.length, 2);
  assert.equal((await call('stable steering retry', p + '/input', steering)).value.replayed, true);
  await call('changed same-ID steering conflict', p + '/input', { ...steering, text: 'changed' }, 409);
  const before = (await call('read before refusals', p + '/status')).value;
  // A local trap proves unverified issuer/key URLs never choose a fetch target.
  let trapHits = 0;
  const trap = createServer((req, res) => { trapHits++; res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(jwks)); });
  trap.listen(0, '127.0.0.1'); await once(trap, 'listening');
  const trapUrl = `http://127.0.0.1:${trap.address().port}/keys`;
  try {
    const negatives = [
      ['wrong signature', jwt({}, {}, wrongKey)], ['unknown kid', jwt({}, { kid: 'unknown' })],
      ['wrong algorithm', jwt({}, { alg: 'HS256' })], ['issuer SSRF', jwt({ iss: trapUrl }, { jku: trapUrl, x5u: trapUrl })],
      ['wrong audience', jwt({ aud: ['other-application'] })], ['expired', jwt({ exp: now - 1 })],
      ['future nbf', jwt({ nbf: now + 3600 })], ['future iat', jwt({ iat: now + 3600 })],
      ['unknown principal', jwt({ sub: 'ungranted-user' })], ['unknown service shape', jwt({ type: 'service' })],
    ];
    for (const [label, token] of negatives) await call(label, p + '/input', { input_id: `refused-${label}`, text: 'must not be accepted' }, 403, token);
    await call('key URL ignored with valid signature', p + '/status', undefined, 200, jwt({}, { jku: trapUrl, x5u: trapUrl }));
    assert.equal(trapHits, 0, 'unverified issuer/JWK URLs must never cause a subrequest');
  } finally { await new Promise(r => trap.close(r)); }
  for (const field of ['account_id', 'project_id', 'instance', 'namespace']) {
    await call(`wrong ${field} authority`, p + '/input', { input_id: `refused-${field}`, text: 'must not be accepted' }, 403, clientOne, { ...binding, [field]: 'other-scope' });
  }
  await call('ungranted action', p + '/input', steering, 403, jwt({ sub: 'reader' }));
  await call('native dispatch disabled', p + '/claim', { claim_id: 'not-authorized', runner_id: 'fixture-runner', expected_revision: before.revision }, 403);
  await call('native session facts disabled', p + '/observe', { event_id: 'not-authorized', observation: { kind: 'acknowledged', receipt: { session: { runtime: 'pi', host: 'other-owner', session_id: 'other-session', session_file: '/other' } } } }, 403);
  const spoof = { binding: { ...binding, project_id: 'attacker' }, actor_id: 'attacker' };
  const spoofed = await call('client identity headers discarded', p + '/authority', undefined, 200, clientTwo, binding, { 'x-summon-verified': JSON.stringify(spoof), 'x-summon-actor': 'attacker' });
  assert.deepEqual(spoofed.value, origin); assert.equal(spoofed.response.headers.get('x-summon-actor'), 'fixture-client-two');
  await call('spoof header cannot grant unknown principal', p + '/status', undefined, 403, jwt({ sub: 'attacker' }), binding, { 'x-summon-verified': JSON.stringify(origin) });
  await call('supplied cross-scope record/packet is not collector', '/v1/visibility/reopen', { packet: { root: 'other-project' }, records: [{ identity: spoof }] }, 404);
  assert.deepEqual((await call('refusals left canonical run unchanged', p + '/status')).value, before);
  // A second server-owned scope gets a distinct DO even for the same run ID.
  const bindingB = { ...binding, project_id: 'fixture-project-B' };
  const policyB = { ...policy, binding: bindingB, grants: policy.grants.map(g => ({ ...g, binding: bindingB })) };
  await configure({ ...vars, FACTORY_AUTH_POLICY: JSON.stringify(policyB) });
  await call('other scope cannot read first scope run', p + '/status', undefined, 404, clientOne, bindingB);
  await call('other scope distinct same-ID intake', '/v1/intake', intake, 200, clientOne, bindingB);
  await configure(vars);
  assert.deepEqual((await call('restart restored original scope/run', p + '/status')).value, before);
  assert.deepEqual((await call('restart retained original creator', p + '/authority')).value, origin);
  // Offline seed only an owned disposable run with an ORIGINAL JSON snapshot.
  // The snapshot stays byte-for-byte present after read/replay refusal; no unsafe adoption.
  const legacyIntake = { ...intake, task: { ...intake.task, id: 'cf1:unbound-legacy-fixture' } };
  const legacyStatus = (await call('owned disposable legacy fixture intake', '/v1/intake', legacyIntake)).value.run;
  const legacy = { protocol_version: legacyStatus.protocol_version, revision: legacyStatus.revision, task: legacyStatus.task, manifest_sha256: legacyStatus.manifest_sha256, initial_input_id: legacyIntake.initial_input_id, inputs: legacyStatus.inputs, native_session: null, delivery: null, holds: {}, cancellations: {}, proofs: [], claims: {}, observations: {} };
  await stop();
  const snapshot = JSON.stringify(legacy);
  const seed = String.raw`
import sqlite3, pathlib, json, sys
root, snapshot = sys.argv[1:]; found = []
for path in pathlib.Path(root).rglob('*.sqlite'):
  with sqlite3.connect(path) as db:
    if not db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='run'").fetchone(): continue
    row = db.execute('SELECT snapshot FROM run WHERE singleton=1').fetchone()
    if row and b'cf1:unbound-legacy-fixture' in (row[0] if isinstance(row[0], bytes) else row[0].encode()):
      db.execute('UPDATE run SET snapshot=? WHERE singleton=1', (snapshot,)); found.append(str(path))
assert len(found)==1, found
print(json.dumps(found))
`;
  const files = JSON.parse(execFileSync('python3', ['-c', seed, resolve(scratch, 'state'), snapshot], { encoding: 'utf8' }));
  await boot(config);
  assert.equal((await call('unbound legacy read refused', '/v1/runs/cf1:unbound-legacy-fixture/status', undefined, 403)).value.code, 'authority_refused');
  await call('unbound legacy intake replay refused', '/v1/intake', legacyIntake, 403);
  await stop();
  const retained = execFileSync('python3', ['-c', 'import sqlite3,sys; print(sqlite3.connect(sys.argv[1]).execute("SELECT snapshot FROM run WHERE singleton=1").fetchone()[0],end="")', files[0]], { encoding: 'utf8' });
  assert.equal(retained, snapshot);
  await writeFile(resolve(scratch, 'unbound-legacy-original.json'), snapshot);
  await writeFile(resolve(scratch, 'fixture-public-jwks.json'), JSON.stringify(jwks));
  t.diagnostic(`Authenticated boundary: genuine RSA signed JWTs, two clients/retries/restart, fail-closed negatives, scope-separated DOs and retained unbound legacy; ${receipts.length} actual HTTP receipts. FIXTURES ONLY, not live Access/provider/client entitlement.`);
}
