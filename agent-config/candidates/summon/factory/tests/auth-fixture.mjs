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
    ...['client-one', 'client-two'].map(user_sub => ({ user_sub, actor_id: `fixture-${user_sub}`, binding, actions: ['read', 'intake', 'steer', 'hold', 'claim', 'native_facts', 'proof'] })),
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
  assert.equal((await call('hosted proof endpoint disabled', '/v1/runs/cf1:auth-fixture/proof', {}, 403)).value.code, 'capability_refused');
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
  // Defensive maintenance only: no native facts or completed delivery are made
  // for this refusal check. A generic grant cannot enable the disabled endpoint.
  const proofBefore = (await call('status before disabled proof endpoint', p + '/status')).value;
  const refusedProof = await call('authenticated proof endpoint disabled', p + '/proof', { proof_id: 'ordinary-refusal', check_id: 'review', coverage_sha256: '0'.repeat(64), issuer: 'fixture-claimed-issuer', verdict: 'pass', evidence_ref: 'fixture-refusal-only', expected_revision: proofBefore.revision }, 403, clientTwo);
  assert.equal(refusedProof.value.code, 'capability_refused');
  assert.deepEqual((await call('disabled proof endpoint left run unchanged', p + '/status')).value, proofBefore);
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
  t.diagnostic(`Authenticated boundary: genuine RSA signed JWTs, two clients/retries/restart, fail-closed negatives, scope-separated DOs, disabled proof endpoint and retained unbound legacy; ${receipts.length} original HTTP receipts. FIXTURES ONLY, not live Access/provider/client entitlement.`);

  // Shape observed in the hosted owner's verified service JWT (scalar AUD,
  // empty sub, client ID common_name, no nbf). Public client ID is NOT a secret.
  // These signatures/grants are EPHEMERAL fixtures, never live Access receipts.
  const serviceClient = '64d67c747434df523cf97c187736e960.access';
  const serviceGrant = { service_client_id: serviceClient, actor_id: 'fixture-explicit-service', binding, actions: ['read', 'intake', 'steer', 'hold', 'cancel', 'metadata'] };
  const servicePolicy = { ...policy, grants: [...policy.grants, serviceGrant] };
  const serviceToken = (changes = {}, header = {}, key = privateKey) => jwt({ sub: '', common_name: serviceClient, aud: audience, nbf: undefined, h_INTERNAL_DO_NOT_USE: 'fixture-hostname-NEVER-an-identity-grant', ...changes }, header, key);
  const service = serviceToken(), serviceReceipts = [];
  const serviceCall = async (...args) => {
    const start = receipts.length;
    try { return await call(...args); }
    finally {
      serviceReceipts.push(...receipts.slice(start));
      await writeFile(resolve(scratch, 'auth-service-http.json'), JSON.stringify({ fixture: true, not_live_Access: true, observed_shape_not_real_token: true, receipts: serviceReceipts }, null, 2));
    }
  };
  await configure(vars);
  assert.equal((await serviceCall('signed service without explicit selector refuses', p + '/status', undefined, 403, service)).value.code, 'principal_refused');
  await configure({ ...vars, FACTORY_AUTH_POLICY: JSON.stringify(servicePolicy) });
  const sp = '/v1/runs/cf1:auth-service-fixture';
  const serviceIntake = { ...intake, task: { ...intake.task, id: 'cf1:auth-service-fixture' } };
  const created = await serviceCall('configured exact service scalar-AUD absent-nbf intake', '/v1/intake', serviceIntake, 200, service);
  assert.equal(created.response.headers.get('x-summon-actor'), serviceGrant.actor_id);
  const serviceOrigin = { binding, actor_id: serviceGrant.actor_id };
  assert.deepEqual((await serviceCall('service creator is frozen canonical attribution', sp + '/authority', undefined, 200, service)).value, serviceOrigin);
  assert.equal((await serviceCall('same service exact intake retry', '/v1/intake', serviceIntake, 200, service)).value.replayed, true);
  const si = { input_id: 'service-steer', text: 'SYNTHETIC authenticated service steering only; no native action.' };
  let serviceStatus = (await serviceCall('explicit service steering', sp + '/input', si, 200, service)).value.run;
  assert.equal((await serviceCall('service steering exact replay', sp + '/input', si, 200, service)).value.replayed, true);
  const sh = { hold_id: 'service-hold', action: 'release', reason: 'SYNTHETIC service hold', authority_ref: 'fixture-service-policy', active: true, expected_revision: serviceStatus.revision };
  serviceStatus = (await serviceCall('explicit service hold', sp + '/hold', sh, 200, service)).value.run;
  const missingFact = owner => ({ source: { owner, reference: 'fixture-fact-unavailable', read_at_unix_ms: now * 1000, sha256: null, state: 'missing', detail: 'No native/commission/lineage observation invented' }, value: null });
  const serviceMetadata = { origin: missingFact('fixture-origin'), native: missingFact('fixture-native'), lineage: missingFact('summon_do:cf1:auth-service-fixture'), evidence: [], child_packets: [] };
  const serviceView = (await serviceCall('explicit service metadata (native remains missing)', sp + '/metadata', { expected_run_revision: serviceStatus.revision, expected_metadata_sha256: null, metadata: serviceMetadata }, 200, service)).value;
  assert.equal(serviceView.managed.revision, serviceStatus.revision);
  const cancellation = { cancel_id: 'service-cancel', input_id: 'service-steer', attempt_id: 'no-active-native-attempt', reason: 'SYNTHETIC service cancellation', authority_ref: 'fixture-service-policy', expected_revision: serviceStatus.revision };
  assert.equal((await serviceCall('service cancel authorized BUT no active attempt invented', sp + '/cancel', cancellation, 409, service)).value.code, 'cancel_refused');
  await serviceCall('service docs array-AUD form also exact audience', sp + '/status', undefined, 200, serviceToken({ aud: [audience] }));
  await serviceCall('service supplied valid not-before honored', sp + '/status', undefined, 200, serviceToken({ nbf: now - 1 }));
  await serviceCall('internal hostname irrelevant to authenticated service', sp + '/status', undefined, 200, serviceToken({ h_INTERNAL_DO_NOT_USE: 'other-irrelevant-host' }));
  const serviceNegatives = [
    ['service wrong signature', serviceToken({}, {}, wrongKey)],
    ['service wrong kid', serviceToken({}, { kid: 'unknown' })],
    ['service wrong issuer', serviceToken({ iss: 'https://other.cloudflareaccess.com' })],
    ['service wrong scalar audience', serviceToken({ aud: 'wrong-application' })],
    ['service wrong array audience', serviceToken({ aud: ['wrong-application'] })],
    ['service audience unknown object shape', serviceToken({ aud: { value: audience } })],
    ['service expired', serviceToken({ exp: now - 1 })],
    ['service future iat without nbf', serviceToken({ iat: now + 3600 })],
    ['service future supplied nbf', serviceToken({ nbf: now + 3600 })],
    ['service null supplied nbf', serviceToken({ nbf: null })],
    ['service supplied string nbf', serviceToken({ nbf: String(now) })],
    ['service missing iat', serviceToken({ iat: undefined })],
    ['service missing expiry', serviceToken({ exp: undefined })],
    ['service wrong principal', serviceToken({ common_name: 'other-client.access' })],
    ['service resource UUID NOT client selector', serviceToken({ common_name: 'cb635290-c03d-451a-aff7-3d0501f94237' })],
    ['service wildcard is not a grant', serviceToken({ common_name: '*' })],
    ['service missing common_name even with internal hostname', serviceToken({ common_name: undefined })],
    ['service null common_name', serviceToken({ common_name: null })],
    ['service numeric common_name', serviceToken({ common_name: 1 })],
    ['service empty common_name', serviceToken({ common_name: '' })],
    ['service missing sub', serviceToken({ sub: undefined })],
    ['service null sub', serviceToken({ sub: null })],
    ['service mixed user/service identity', serviceToken({ sub: 'client-one' })],
    ['service unknown token type', serviceToken({ type: 'service' })],
    ['service email cannot grant identity', serviceToken({ common_name: undefined, email: serviceClient })],
    ['service client header cannot grant identity', jwt({ sub: '', aud: audience, nbf: undefined })],
    ['user scalar AUD remains refused', jwt({ aud: audience })],
    ['user missing nbf remains refused', jwt({ nbf: undefined })],
    ['user null nbf remains refused', jwt({ nbf: null })],
  ];
  for (const [label, token] of serviceNegatives) await serviceCall(label, sp + '/input', { input_id: label.replaceAll(' ', '-'), text: 'Must remain refused' }, 403, token, binding, { 'CF-Access-Client-Id': serviceClient, 'x-summon-actor': serviceGrant.actor_id });
  for (const field of ['account_id', 'project_id', 'instance', 'namespace']) await serviceCall('service wrong ' + field, sp + '/input', si, 403, service, { ...binding, [field]: 'other' });
  await serviceCall('service no claim grant/native permission', sp + '/claim', {}, 403, service);
  await serviceCall('service no native fact grant', sp + '/observe', {}, 403, service);
  await serviceCall('service proof endpoint CLOSED unchanged', sp + '/proof', {}, 403, service);
  await serviceCall('service no supplied archive/collector authority', '/v1/visibility/export', {}, 404, service);
  await configure({ ...vars, FACTORY_AUTH_POLICY: JSON.stringify({ ...servicePolicy, grants: [...policy.grants, { ...serviceGrant, actions: ['read'] }] }) });
  assert.equal((await serviceCall('service wrong action with otherwise valid identity', sp + '/input', si, 403, service)).value.code, 'capability_refused');
  for (const grants of [
    [...policy.grants, { ...serviceGrant, user_sub: 'client-one' }],
    [...policy.grants, serviceGrant, serviceGrant],
    [...policy.grants, { ...serviceGrant, binding: { ...binding, project_id: 'other-project' } }],
  ]) {
    await configure({ ...vars, FACTORY_AUTH_POLICY: JSON.stringify({ ...servicePolicy, grants }) });
    assert.equal((await serviceCall('invalid mixed/duplicate/wrong-bound service policy refuses', sp + '/status', undefined, 403, service)).value.code, 'auth_config');
  }
  await configure({ ...vars, FACTORY_AUTH_POLICY: JSON.stringify(servicePolicy) });
  assert.deepEqual((await serviceCall('service restart/refusals preserve exact canonical run', sp + '/status', undefined, 200, service)).value, serviceStatus);
  assert.equal((await serviceCall('service restart retains metadata unchanged', sp + '/view', undefined, 200, service)).value.metadata_sha256, serviceView.metadata_sha256);
  assert.deepEqual((await serviceCall('user handoff cannot rewrite original service creator', sp + '/authority')).value, serviceOrigin);
  assert.deepEqual((await serviceCall('service can read but not rewrite original user creator', p + '/authority', undefined, 200, service)).value, origin);
  assert.equal((await serviceCall('service original intake replay after restart', '/v1/intake', serviceIntake, 200, service)).value.replayed, true);
  assert.equal((await serviceCall('service original steering replay after restart', sp + '/input', si, 200, service)).value.replayed, true);
  t.diagnostic(`Service boundary: ${serviceReceipts.length} actual RSA/workerd HTTP fixtures; observed scalar-AUD/empty-sub/common_name/no-nbf shape, exact selector and frozen attribution, user contract retained, wrong signature/principal/scope/action/time/shape refused; proof/native/collector unchanged. NOT real Access admission or receipt-source verification.`);
}
