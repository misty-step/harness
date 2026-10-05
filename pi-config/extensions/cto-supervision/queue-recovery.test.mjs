// Real installed queue/clear + source controller, isolated fake helper/sink.
// No agent run/model input/provider/auth/network; NOT production lost-queue proof.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const SESSION = '01a103e1-9423-76a3-9ec0-17d2b0bad325';
const PRIMARY = 'K-20261004-coo-stays-conversational-while-cto-owns';
const EVENT = 'cto-supervision.event.v1', PASS = 'cto-supervision.intent.v1', WAKE = 'cto-supervision.wake.v1', TIMER = 'cto-supervision.timer.v1';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(predicate, message) {
  for (let n = 0; n < 100; n++) { if (predicate()) return; await sleep(10); }
  assert.fail(message);
}
function event(id, commission_id = PRIMARY) {
  return { op: 'event', event: { schema: 'cto-supervision.event/1', event_id: id, target_session_id: SESSION, kind: 'completion', worker: 'original-worker', commission_id, source_ref: 'original-native-source:' + id, summary: 'Original owner remains at its approved boundary' } };
}

for (const cause of ['heartbeat', 'event']) test(`installed queue clear -> idle -> NEW ${cause}, no resend/effect (offline)`, { skip: !process.env.CTO_PI_SDK_ENTRY }, async () => {
  assert(process.env.TMPDIR, 'run-scoped scratch required');
  const root = mkdtempSync(join(process.env.TMPDIR, `cto-queue-${cause}-`)); chmodSync(root, 0o700);
  const oldDir = process.env.PI_CODING_AGENT_DIR, oldOffline = process.env.PI_OFFLINE;
  process.env.PI_CODING_AGENT_DIR = root; process.env.PI_OFFLINE = '1';
  const oldFetch = globalThis.fetch; let networkCalls = 0, agentRuns = 0;
  globalThis.fetch = async () => { networkCalls++; throw new Error('network prohibited'); };
  const sdk = await import(process.env.CTO_PI_SDK_ENTRY);
  const credentials = { read: async () => undefined, list: async () => [], modify: async () => { throw new Error('credential write prohibited'); }, delete: async () => { throw new Error('credential write prohibited'); } };
  const runtime = await sdk.ModelRuntime.create({ credentials, modelsPath: null, modelsStorePath: join(root, 'models-store.json'), refreshOnCreate: false, allowModelNetwork: false });
  const model = runtime.getModel('openai-codex', 'gpt-6.1-sol'); assert(model);
  const source = process.env.CTO_SUPERVISION_SOURCE || fileURLToPath(new URL('./index.ts', import.meta.url));
  const loader = new sdk.DefaultResourceLoader({ cwd: root, agentDir: root, noExtensions: true, additionalExtensionPaths: [source], noSkills: true, noPromptTemplates: true, noThemes: true, agentsFilesOverride: () => ({ agentsFiles: [] }) });
  await loader.reload(); assert.deepEqual(loader.getExtensions().errors, []);
  const manager = sdk.SessionManager.create(root, root, { id: SESSION });
  manager.appendMessage({ role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(), stopReason: 'stop', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
  chmodSync(manager.getSessionFile(), 0o600);
  const { session } = await sdk.createAgentSession({ cwd: root, agentDir: root, modelRuntime: runtime, model, thinkingLevel: 'xhigh', tools: ['read', 'cto_supervision_inspect', 'cto_supervision_ack'], sessionManager: manager, settingsManager: sdk.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, quietStartup: true }), resourceLoader: loader });
  const errors = [], sends = []; session.subscribe(e => { if (e.type === 'agent_start') agentRuns++; });
  const nativeSend = session.sendCustomMessage;
  // Inject only a synthetic BUSY receiver. Run the ORIGINAL installed method's
  // queue branch against the real Agent. Idle -> model input is never invoked.
  // No private SDK fields, source patch, provider wrapper or live queue mutation.
  session.sendCustomMessage = async (message, options) => {
    sends.push({ message, options });
    return nativeSend.call({ isStreaming: true, agent: session.agent }, message, options);
  };
  await session.bindExtensions({ onError: e => errors.push(e.error) });
  const inbox = join(root, 'inbox'), returns = join(root, 'returns');
  for (const p of [inbox, returns]) { mkdirSync(p); chmodSync(p, 0o700); }
  const driver = join(inbox, 'driver.jsonl'); writeFileSync(driver, '', { mode: 0o600 });
  const helper = join(root, 'fixture-helper');
  // Source-controller protocol fixture, NOT Rust timer/fire evidence.
  writeFileSync(helper, `#!${process.execPath}\n` + `
const fs = require('node:fs');
const path = require('node:path');
const driver = path.join(process.argv[2], 'driver.jsonl');
let offset = 0;
const watch = fs.watch(driver, () => {
  const bytes = fs.readFileSync(driver);
  const chunk = bytes.subarray(offset); offset = bytes.length;
  process.stdout.write(chunk);
});
process.stdin.resume();
process.stdin.on('end', () => { watch.close(); });
process.stdout.write(JSON.stringify({op:'ready',pid:process.pid,period_ms:300000})+'\\n');
`, { mode: 0o700 });
  const binding = { schema: 'cto-supervision.binding/1', sessionId: SESSION, sessionFile: manager.getSessionFile(), cwd: root, runtimeBinary: helper, runtimeSha256: createHash('sha256').update(readFileSync(helper)).digest('hex'), inboxDir: inbox, returnDir: returns };
  const bindingFile = join(root, 'binding.json'); writeFileSync(bindingFile, JSON.stringify(binding), { mode: 0o600 });
  const feed = record => appendFileSync(driver, JSON.stringify(record) + '\n');
  const custom = type => manager.getBranch().filter(e => e.type === 'custom' && e.customType === type);
  const original = event('original-uncertain-input');
  const oldProof = () => JSON.stringify(manager.getBranch().filter(e => (e.type === 'custom' && e.customType === EVENT && e.data.event_id === original.event.event_id) || (e.type === 'custom' && e.customType === PASS && e.data.event_ids.includes(original.event.event_id))));
  const boundary = () => session.extensionRunner.emitBoundary({ type: 'agent_before_settle', outcome: 'aborted' }, () => ({ contextEntries: [], contextMessages: [], llmMessages: [], pendingMessages: session.agent.peekQueuedMessages(), canContinue: false }));
  try {
    await session.prompt('/cto-supervision-bind ' + bindingFile); // extension command, not model input
    await waitFor(() => custom('cto-supervision.runtime.v1').length === 1, 'fixture helper not ready');
    feed(original);
    await waitFor(() => sends.length === 1, 'original source intent did not enter real SDK queue');
    const oldPass = custom(PASS)[0]; assert.deepEqual(oldPass.data.event_ids, [original.event.event_id]);
    assert.equal(session.agent.peekQueuedMessages()[0].details.pass_id, oldPass.data.pass_id);
    assert.equal(session.pendingMessageCount, 0, 'UI text count excludes queued custom messages; not a queue guard');
    assert(!manager.getBranch().some(e => e.type === 'custom_message' && e.customType === WAKE));
    await boundary();
    const originalProof = oldProof();
    session.clearQueue(); // ACTUAL installed public clearQueue -> Agent.clearAllQueues
    assert.deepEqual(session.agent.peekQueuedMessages(), []);
    assert(session.isIdle);
    await boundary();
    await session.extensionRunner.emit({ type: 'agent_settled' });
    const pulse = { op: 'heartbeat', period_ms: 300000, scheduled_at_ms: 1791130000000, fired_at_ms: 1791130000000, elapsed_since_boot_ms: 300000 };
    const next = cause === 'heartbeat' ? pulse : event('new-secondary-advisory-fact', 'secondary-source-advisory');
    feed(next);
    await waitFor(() => cause === 'heartbeat' ? custom(TIMER).length === 1 : custom(EVENT).length === 2, 'new cause did not reach source controller');
    await sleep(120); // bounded > source coalescing window, NOT a shortened heartbeat proof
    console.log(JSON.stringify({ cause, source, originalPassId: oldPass.data.pass_id, originalNativeQueueCleared: session.agent.peekQueuedMessages().every(m => m.details.pass_id !== oldPass.data.pass_id), sourceSendCount: sends.length, nativeIntents: custom(PASS).length, originalOutcome: 'UNKNOWN', agentRuns, networkCalls }));
    assert.equal(sends.length, 2, `material c6: NEW ${cause} suppressed by original missing WAKE marker`);
    const previews = custom('cto-supervision.queue-preview.v1').filter(e => e.data.pass_id === oldPass.data.pass_id);
    assert.deepEqual(previews.map(e => e.data.present), [true, false], 'exact supported preview facts distinguish observed queue from missing marker, never ACK');
    const newPass = custom(PASS)[1]; assert.notEqual(newPass.data.pass_id, oldPass.data.pass_id);
    assert.deepEqual(newPass.data.event_ids, cause === 'heartbeat' ? [] : [next.event.event_id]);
    assert.equal(oldProof(), originalProof, 'original intent/event IDs and objects must remain byte-identical');
    assert.equal(sends.filter(s => s.message.details.event_ids.includes(original.event.event_id)).length, 1, 'no blind resend of original input');
    feed(next); feed(original); await sleep(120);
    assert.equal(sends.length, 2, 'matching duplicate cause cannot admit another pass/action');
    const ackTool = session.extensionRunner.getToolDefinition('cto_supervision_ack');
    const ctx = session.extensionRunner.createToolContext('offline-control-proof', undefined);
    const params = { pass_id: oldPass.data.pass_id, action_entry_ids: ['unknown-effect'], source_refs: ['original-source'], summary: 'Original outcome remains unknown' };
    await assert.rejects(ackTool.execute('old-ack', params, undefined, undefined, ctx), /queued\/busy is not ACK/);
    // Finalization/ACK idempotency on ONLY the new pass. All entries synthetic;
    // no worker/business tool executes in this fixture, hence no duplicated effect.
    session.clearQueue();
    await nativeSend.call(session, sends[1].message, { triggerTurn: false });
    const actionId = manager.appendMessage({ role: 'toolResult', toolName: 'read', toolCallId: 'offline-fixture-action', content: [{ type: 'text', text: 'synthetic offline readback' }], isError: false, timestamp: Date.now() });
    const newParams = { ...params, pass_id: newPass.data.pass_id, action_entry_ids: [actionId] };
    const first = await ackTool.execute('new-ack', newParams, undefined, undefined, ctx);
    const ackId = manager.appendMessage({ role: 'toolResult', toolName: 'cto_supervision_ack', toolCallId: 'new-ack', content: first.content, details: first.details, isError: false, timestamp: Date.now() });
    const duplicate = await ackTool.execute('duplicate-ack', newParams, undefined, undefined, ctx);
    assert.equal(duplicate.details.prior_ack_entry_id, ackId);
    assert.equal(first.details.closes_primary, false);
    assert.equal(first.details.primary_commission, PRIMARY);
    const inspect = await session.extensionRunner.getToolDefinition('cto_supervision_inspect').execute('inspect-after-secondary', {}, undefined, undefined, ctx);
    const retained = JSON.parse(inspect.content[0].text);
    assert.deepEqual(retained.passes.map(p => p.pass_id), [oldPass.data.pass_id]);
    assert.equal(retained.passes[0].delivery, 'uncertain');
    assert.equal(retained.closes_primary, false);
    assert.equal(manager.getBranch().filter(e => e.type === 'message' && e.message.role === 'toolResult' && e.message.toolName === 'read').length, 1);
    assert.equal(manager.getBranch().filter(e => e.type === 'message' && e.message.role === 'toolResult' && e.message.toolName === 'cto_supervision_ack').length, 1);
    assert.equal(oldProof(), originalProof);
    console.log(JSON.stringify({ cause, newPassId: newPass.data.pass_id, originalInputSends: sends.filter(s => s.message.details.event_ids.includes(original.event.event_id)).length,
      admittedPassesAfterDuplicate: custom(PASS).length, queuePreviewPresence: previews.map(e => e.data.present), originalOutcome: 'UNKNOWN',
      actionEntries: 1, originalAckEntries: 0, newAckEntries: 1, duplicateAckRef: duplicate.details.prior_ack_entry_id, closesPrimary: first.details.closes_primary,
      realWorkerEffects: 0, agentRuns, networkCalls, syntheticTimerOnly: cause === 'heartbeat' }));
    assert.equal(agentRuns, 0); assert.equal(networkCalls, 0); assert.deepEqual(errors, []);
  } finally {
    session.clearQueue(); await session.prompt('/cto-supervision-stop'); session.dispose();
    globalThis.fetch = oldFetch;
    if (oldDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = oldDir;
    if (oldOffline === undefined) delete process.env.PI_OFFLINE; else process.env.PI_OFFLINE = oldOffline;
  }
});
