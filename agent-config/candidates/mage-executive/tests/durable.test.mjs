import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { BACKGROUND_CONTEXT as ctx } from '@earendil-works/chord/context';
import { createModels } from '@earendil-works/pi-ai/models';
import { fauxProvider, fauxAssistantMessage as answer, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { Harness, createRegistry } from '@earendil-works/pi-durable';
import { openNodeSqliteDatabase } from '@earendil-works/pi-durable/storage/sqlite/node';
import { SqliteStorage } from '@earendil-works/pi-durable/storage/sqlite';
import { installMage } from '../durable.mjs';

// These exercise the real Durable engine/storage/permission path with a faux
// provider. They are NOT admitted native subscription or deployed factory proof.
const text=m=>typeof m?.content==='string'?m.content:(m?.content??[]).filter(p=>p.type==='text').map(p=>p.text).join('');
const call=(name,args)=>answer([fauxToolCall(name,args)],{stopReason:'toolUse'});
const until=async(check)=>{for(let n=0;n<500;n++){if(await check())return;await new Promise(r=>setTimeout(r,5));}throw new Error('native boundary not reached');};
const configuration=()=>({schema:'mage-executive/1',instances:[
  {id:'coo',role:'coo',instructions:'Own strategy and source-based acceptance. Never claim engineering settlement means acceptance.',skills:[{name:'operations',description:'Operations skill',body:'Recall original decisions.'}],provider:'openai-codex',model:'gpt-6.1-sol',thinking:'xhigh'},
  {id:'cto',role:'cto',instructions:'Own technical engineering commissions. Report receipts, not unsupported success.',skills:[{name:'engineering',description:'Engineering skill',body:'Summon owns engineer runs.'}],provider:'openai-codex',model:'gpt-6.1-sol',thinking:'xhigh'},
]});
async function setup({directory,route,broker=async()=>({read:true}),config=configuration(),extraSettings={}}={}) {
  directory??=await mkdtemp(join(process.env.TMPDIR??`${process.env.HOME}/.cache/tmp`,'mage-durable-'));
  await chmod(directory,0o700);
  const faux=fauxProvider();const models=createModels();models.setProvider(faux.provider);
  faux.setResponses(Array.from({length:100},()=>route??((request)=>answer(`answer: ${text(request.messages.findLast(m=>m.role!=='system'))}`))));
  const fixtureModels=new Proxy(models,{get(target,key){
    if(key==='getModel')return(provider,id)=>provider==='openai-codex'&&id==='gpt-6.1-sol'?target.getModel('faux','faux-1'):undefined;
    const v=Reflect.get(target,key);return typeof v==='function'?v.bind(target):v;
  }});
  const registry=createRegistry();const mage=installMage(registry,{config,broker});
  const db=await openNodeSqliteDatabase(join(directory,'engine.sqlite'));await db.exec('PRAGMA synchronous=FULL');
  const harness=await Harness.open(await SqliteStorage.open(db),{models:fixtureModels,registry,settings:{retry:{enabled:false},stream:{maxRetries:0},compaction:{enabled:false,keepRecentTokens:100,reserveTokens:1024,backgroundTokens:0},...extraSettings}},ctx);
  let binding;
  try{binding=await mage.attach(harness,ctx);}catch(error){await harness.close(ctx);throw error;}
  return {harness,mage,binding,directory,faux};
}
const command=(mage,action,instance='coo',rest={})=>mage.command({action,instance,...rest},ctx);
const crashConfig=()=>({schema:'mage-executive/1',instances:[{id:'coo',role:'coo',instructions:'Crash-test COO',skills:[],provider:'openai-codex',model:'gpt-6.1-sol',thinking:'xhigh'},{id:'cto',role:'cto',instructions:'Crash-test CTO',skills:[],provider:'openai-codex',model:'gpt-6.1-sol',thinking:'xhigh'}]});
async function killAfterCommittedBoundary(directory,mode){
  const child=spawn(process.execPath,[new URL('crash-worker.mjs',import.meta.url).pathname,directory,mode],{env:{PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR},stdio:['ignore','pipe','pipe']});
  let output='',errors='';child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>errors+=c);
  const exit=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));});
  try {await until(()=>Promise.resolve(output.includes('kill-ready')));child.kill('SIGKILL');const observed=await exit;assert.equal(observed.signal,'SIGKILL');}
  catch(error){child.kill('SIGKILL');await exit;throw new Error(`${error}; ${errors}`);}
}

test('distinct persisted roles; duplicate input and completion cannot wake twice; changed payload/config refuse',async()=>{
  let s=await setup();const {directory}=s;
  try {
    assert.notEqual(s.binding.instances.coo,s.binding.instances.cto);
    const first=await command(s.mage,'submit','coo',{input_id:'input-1',text:'original'});
    await command(s.mage,'wait','coo',{input_id:'input-1'});
    const calls=s.faux.state.callCount;
    const duplicate=await command(s.mage,'submit','coo',{input_id:'input-1',text:'original'});
    assert.equal(duplicate.submission.id,first.submission.id);assert.equal(s.faux.state.callCount,calls);
    await assert.rejects(command(s.mage,'submit','coo',{input_id:'input-1',text:'different'}),/identity_conflict/);
    await command(s.mage,'completion','coo',{input_id:'completion-1',text:'owner result; review pending'});
    await command(s.mage,'wait','coo',{input_id:'completion-1'});
    await command(s.mage,'completion','coo',{input_id:'completion-1',text:'owner result; review pending'});
    assert.equal(s.faux.state.callCount,calls+1);
    const view=await command(s.mage,'view');assert.equal(view.view.docs['pi.agent'].instructions,configuration().instances[0].instructions);
    const old=s.binding.instances;await s.harness.close(ctx);
    s=await setup({directory});assert.deepEqual(s.binding.instances,old);
    assert.equal((await command(s.mage,'status','coo',{input_id:'completion-1'})).submission.status,'done');
    assert.equal((await command(s.mage,'view','cto')).view.entries.length,0);
  }finally{await s.harness.close(ctx);}
  const config=configuration();config.instances[0].instructions='Changed context';
  await assert.rejects(setup({directory,config}),/negotiated handoff/);
});

test('background COO->CTO commission produces one persisted completion wake, never self-acceptance',async()=>{
  const route=request=>{
    const last=request.messages.findLast(m=>m.role!=='system');const t=text(last);
    if(t==='commission')return call('mage_delegate',{commission_id:'commission-1',text:'technical brief'});
    if(t==='technical brief')return answer('Engineer fixture result referenced; independent check remains pending.');
    if(t.startsWith('CTO execution report'))return answer('Report received; acceptance requires independent evidence.');
    return answer('CTO commissioned; conversation remains available.');
  };
  const s=await setup({route});
  try {
    await command(s.mage,'submit','coo',{input_id:'coo-1',text:'commission'});
    await command(s.mage,'wait','coo',{input_id:'coo-1'});
    await until(async()=>{
      const v=await command(s.mage,'view');return v.view.entries.some(e=>text(e.model?.[0]).startsWith('CTO execution report'));
    });
    const coo=await command(s.mage,'view'),cto=await command(s.mage,'view','cto');
    const reports=coo.view.entries.filter(e=>e.kind==='pi.user'&&text(e.model?.[0]).startsWith('CTO execution report'));
    assert.equal(reports.length,1);assert.match(text(reports[0].model[0]),/not_verified/);
    assert.equal(cto.view.entries.filter(e=>e.kind==='pi.user'&&text(e.model?.[0])==='technical brief').length,1);
    // Different outer input requesting the SAME commission still cannot dispatch
    // another CTO message/reporter. Guard exists beyond provider call IDs.
    await command(s.mage,'submit','coo',{input_id:'coo-new-call',text:'commission'});
    await command(s.mage,'wait','coo',{input_id:'coo-new-call'});
    assert.equal((await command(s.mage,'view','cto')).view.entries.filter(e=>e.kind==='pi.user').length,1);
  }finally{await s.harness.close(ctx);}
});

const reporterId = async mage => (await command(mage,'view')).view.entries.find(e=>e.kind==='pi.tool-result'&&e.model?.[0]?.toolName==='mage_delegate')?.model[0].details.reporter_task;
const collisionRoute = request => {
  const last=request.messages.findLast(m=>m.role!=='system');
  if(text(last)==='commission collision check')return call('mage_delegate',{commission_id:'cross-entry',text:'intended CTO brief'});
  if(text(last)==='intended CTO brief')return call('mage_factory_read',{run:'cf1:fixture',endpoint:'status'});
  return answer(`fixture answer: ${text(last)}`);
};

test('cross-entry commission collision refuses before an earlier different brief/answer is substituted',async()=>{
  const s=await setup({route:collisionRoute});
  try{
    await command(s.mage,'submit','cto',{input_id:'mage-commission:cross-entry',text:'earlier different CTO brief'});
    await command(s.mage,'wait','cto',{input_id:'mage-commission:cross-entry'});
    await command(s.mage,'submit','coo',{input_id:'coo-cross-entry',text:'commission collision check'});
    await command(s.mage,'wait','coo',{input_id:'coo-cross-entry'});
    const task=await s.harness.waitForTask(await reporterId(s.mage),ctx);
    assert.equal(task.state.outcome.status,'faulted','must reject the ID collision, not complete using the earlier answer');
    assert.match(task.state.outcome.error.message,/input_identity_conflict/);
    const cto=(await command(s.mage,'view','cto')).view.entries.filter(e=>e.kind==='pi.user');
    assert.deepEqual(cto.map(e=>text(e.model[0])),['earlier different CTO brief']);
    assert(!(await command(s.mage,'view')).view.entries.some(e=>text(e.model?.[0]).startsWith('CTO execution report')));
  }finally{await s.harness.close(ctx);}
});

test('cross-entry report collision refuses before the completion wake is substituted',async()=>{
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const s=await setup({route:collisionRoute,broker:async()=>{await gate;return {read:true};}});
  try{
    await command(s.mage,'submit','coo',{input_id:'coo-cross-entry',text:'commission collision check'});
    await command(s.mage,'wait','coo',{input_id:'coo-cross-entry'});
    const id=await reporterId(s.mage);
    await command(s.mage,'completion','coo',{input_id:`mage-report:${id}`,text:'earlier different completion'});
    await command(s.mage,'wait','coo',{input_id:`mage-report:${id}`});
    release();const task=await s.harness.waitForTask(id,ctx);
    assert.equal(task.state.outcome.status,'faulted','must refuse a conflicting report ID before treating its earlier input as delivery');
    assert.match(task.state.outcome.error.message,/input_identity_conflict/);
    assert(!(await command(s.mage,'view')).view.entries.some(e=>text(e.model?.[0]).startsWith('CTO execution report')));
  }finally{release();await s.harness.close(ctx);}
});

test('cross-entry internal-first matching replay is idempotent and changed commission/report text refuses after reopen',async()=>{
  let s=await setup({route:collisionRoute});
  try{
    await command(s.mage,'submit','coo',{input_id:'coo-cross-entry',text:'commission collision check'});
    await command(s.mage,'wait','coo',{input_id:'coo-cross-entry'});
    const id=await reporterId(s.mage);await s.harness.waitForTask(id,ctx);
    await command(s.mage,'wait','coo',{input_id:`mage-report:${id}`});
    const report=(await command(s.mage,'view')).view.entries.find(e=>e.kind==='pi.user'&&text(e.model?.[0]).startsWith('CTO execution report'));
    const before=s.faux.state.callCount;
    for(const [instance,input_id,content] of [['cto','mage-commission:cross-entry','intended CTO brief'],['coo',`mage-report:${id}`,text(report.model[0])]]) {
      const prior=await command(s.mage,'status',instance,{input_id});
      await assert.rejects(command(s.mage,'submit',instance,{input_id,text:'different before first external replay'}),/input_identity_conflict/);
      const replay=await command(s.mage,'completion',instance,{input_id,text:content});
      assert.equal(replay.submission.id,prior.submission.id);
      await assert.rejects(command(s.mage,'submit',instance,{input_id,text:'different collision text'}),/input_identity_conflict/);
    }
    assert.equal(s.faux.state.callCount,before);
    const directory=s.directory;await s.harness.close(ctx);s=await setup({directory,route:collisionRoute});
    await assert.rejects(command(s.mage,'submit','cto',{input_id:'mage-commission:cross-entry',text:'different after restart'}),/input_identity_conflict/);
    await assert.rejects(command(s.mage,'completion','coo',{input_id:`mage-report:${id}`,text:'different after restart'}),/input_identity_conflict/);
    assert.equal(s.faux.state.callCount,0);
  }finally{await s.harness.close(ctx);}
});

test('cross-entry legacy f764 native deliveries reconcile original text; queued/withdrawn identities do not become new payloads',async()=>{
  let release;const gate=new Promise(resolve=>{release=resolve;});
  const route=request=>text(request.messages.findLast(m=>m.role!=='system'))==='legacy hold'?call('mage_factory_read',{run:'cf1:fixture',endpoint:'status'}):answer('legacy fixture answer');
  const s=await setup({route,broker:async()=>{await gate;return {read:true};}});
  try{
    for(const [instance,id] of [['cto','mage-commission:legacy'],['coo','mage-report:700']]) {
      const c=await s.harness.conversation(s.binding.instances[instance],ctx);
      // This is the exact raw native admission used by the f764 Reporter; no
      // mage.input hash exists yet. Recovery must read original native facts.
      const old=await c.submit({type:'input',requestId:id,content:'original legacy text',whenBusy:'followUp'},ctx);await old.wait(ctx);
      await assert.rejects(command(s.mage,'completion',instance,{input_id:id,text:'different legacy text'}),/input_identity_conflict/);
      assert.equal((await command(s.mage,'completion',instance,{input_id:id,text:'original legacy text'})).submission.id,old.id);
    }
    const c=await s.harness.conversation(s.binding.instances.cto,ctx);
    await c.submit({type:'input',requestId:'legacy-hold',content:'legacy hold'},ctx);
    await until(async()=>(await s.harness.inspect(ctx)).tasks.some(t=>t.record.kind==='pi.tool'&&t.record.state.status==='running'));
    const queued=await c.submit({type:'input',requestId:'mage-commission:legacy-queued',content:'original queued text',whenBusy:'followUp'},ctx);
    await assert.rejects(command(s.mage,'submit','cto',{input_id:'mage-commission:legacy-queued',text:'different queued text'}),/input_identity_conflict/);
    assert.equal((await command(s.mage,'submit','cto',{input_id:'mage-commission:legacy-queued',text:'original queued text'})).submission.id,queued.id);
    await queued.abort(ctx);
    assert.equal((await command(s.mage,'submit','cto',{input_id:'mage-commission:legacy-queued',text:'original queued text'})).submission.reason,'aborted');
    const unguarded=await c.submit({type:'input',requestId:'mage-commission:legacy-withdrawn',content:'unrecorded withdrawn text',whenBusy:'followUp'},ctx);await unguarded.abort(ctx);
    await assert.rejects(command(s.mage,'submit','cto',{input_id:'mage-commission:legacy-withdrawn',text:'cannot assert original text'}),/input_identity_unverifiable/);
  }finally{release();await s.harness.close(ctx);}
});

test('wrong-role model tool call reaches native offered-set refusal, no broker invocation',async()=>{
  let brokerCalls=0;
  const s=await setup({broker:async()=>{brokerCalls++;throw new Error('must not run');},route:request=>request.messages.findLast(m=>m.role!=='system').role==='toolResult'?answer('refused'):call('mage_factory_intake',{operation_id:'forged',arguments:{}})});
  try{
    await command(s.mage,'submit','coo',{input_id:'wrong-role',text:'attempt'});
    await command(s.mage,'wait','coo',{input_id:'wrong-role'});
    assert.equal(brokerCalls,0);
    const v=await command(s.mage,'view');assert(v.view.entries.some(e=>e.kind==='pi.tool-result'&&JSON.stringify(e).includes('tool_unavailable')));
  }finally{await s.harness.close(ctx);}
});

test('safe long-work read survives close/reopen; steering is ordered; cancellation never aborts later input',async()=>{
  let hold=true;
  const route=request=>{
    const last=request.messages.findLast(m=>m.role!=='system');
    if(last.role==='toolResult')return answer('read complete with original input and steering');
    if(text(last)==='long work')return call('mage_factory_read',{run:'cf1:long',endpoint:'status'});
    return answer(`answer: ${text(last)}`);
  };
  const broker=async(_request,signal)=>{
    if(!hold)return {source:'fixture-owner',status:'observed'};
    await new Promise((_resolve,reject)=>{if(signal?.aborted)reject(new Error('stopped'));else signal?.addEventListener('abort',()=>reject(new Error('stopped')),{once:true});});
  };
  let s=await setup({route,broker});
  try{
    await command(s.mage,'submit','cto',{input_id:'long-1',text:'long work'});
    await until(async()=>(await s.harness.inspect(ctx)).tasks.some(t=>t.record.kind==='pi.tool'&&t.record.state.status==='running'));
    await command(s.mage,'steer','cto',{input_id:'steer-1',text:'preserve original source'});
    await command(s.mage,'submit','cto',{input_id:'follow-1',text:'afterward'});
    assert.equal((await command(s.mage,'status','cto',{input_id:'steer-1'})).submission.status,'queued');
    await s.harness.close(ctx);hold=false;
    s=await setup({directory:s.directory,route,broker});s.mage.assertProgress();
    assert.equal((await command(s.mage,'wait','cto',{input_id:'long-1'})).submission.status,'done');
    await command(s.mage,'wait','cto',{input_id:'follow-1'});
    const v=await command(s.mage,'view','cto');const users=v.view.entries.filter(e=>e.kind==='pi.user').map(e=>text(e.model[0]));
    assert.deepEqual(users,['long work','preserve original source','afterward']);
    await command(s.mage,'cancel','cto',{input_id:'long-1'});
    await command(s.mage,'submit','cto',{input_id:'later-1',text:'later work'});
    await command(s.mage,'cancel','cto',{input_id:'long-1'});
    assert.equal((await command(s.mage,'wait','cto',{input_id:'later-1'})).submission.status,'done');
  }finally{hold=false;await s.harness.close(ctx);}
});


test('active cancellation drains native tool work, withdraws queued input, and fences later work',async()=>{
  let abortObserved=false;
  const route=request=>text(request.messages.findLast(m=>m.role!=='system'))==='long work'?call('mage_factory_read',{run:'cf1:long',endpoint:'status'}):answer('later answer');
  const broker=async(_request,signal)=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>{abortObserved=true;reject(new Error('native read cancelled'));},{once:true}));
  const s=await setup({route,broker});
  try{
    await command(s.mage,'submit','cto',{input_id:'cancel-active',text:'long work'});
    await until(async()=>(await s.harness.inspect(ctx)).tasks.some(t=>t.record.kind==='pi.tool'&&t.record.state.status==='running'));
    await command(s.mage,'submit','cto',{input_id:'queued-after-active',text:'queued follow-up'});
    await command(s.mage,'cancel','cto',{input_id:'cancel-active'});
    assert(abortObserved);
    assert.equal((await command(s.mage,'status','cto',{input_id:'cancel-active'})).submission.reason,'aborted');
    assert.equal((await command(s.mage,'status','cto',{input_id:'queued-after-active'})).submission.reason,'aborted');
    await command(s.mage,'submit','cto',{input_id:'later-uncancelled',text:'new work'});
    await command(s.mage,'cancel','cto',{input_id:'cancel-active'});
    assert.equal((await command(s.mage,'wait','cto',{input_id:'later-uncancelled'})).submission.status,'done');
  }finally{await s.harness.close(ctx);}
});

test('native compaction reduces context but role-scoped search retains original source entries',async()=>{
  const route=request=>{
    const last=request.messages.findLast(m=>m.role!=='system');
    if(text(last)==='search original')return call('mage_context_search',{query:'archive-marker-0'});
    if(last.role==='toolResult')return answer('Original source entry retained.');
    return answer('Summary or response preserves archive markers and source references.');
  };
  const s=await setup({route});
  try{
    for(let n=0;n<4;n++){
      await command(s.mage,'submit','coo',{input_id:`archive-${n}`,text:`archive-marker-${n}: ${'context detail '.repeat(120)}`});
      await command(s.mage,'wait','coo',{input_id:`archive-${n}`});
    }
    const before=(await command(s.mage,'view')).view.entries.length;
    const {task_id}=await command(s.mage,'compact','coo',{instructions:'Preserve source IDs and original decisions.'});
    const compacted=await s.harness.waitForTask(task_id,ctx);assert.equal(compacted.state.outcome.status,'completed');
    const coo=await s.harness.conversation(s.binding.instances.coo,ctx);
    assert.equal((await coo.context(ctx)).head.kind,'pi.compaction');
    const raw=await coo.entries({},100,undefined,ctx);assert.equal(raw.items.length,before+1);
    await command(s.mage,'submit','coo',{input_id:'search-1',text:'search original'});
    await command(s.mage,'wait','coo',{input_id:'search-1'});
    const searched=await coo.entries({},100,undefined,ctx);
    const result=searched.items.find(e=>e.kind==='pi.tool-result'&&e.model[0].toolName==='mage_context_search');
    assert(result.model[0].details.hits.some(h=>h.kind==='pi.user'&&h.text.includes('archive-marker-0')&&Number.isInteger(h.entry_id)));
    assert.equal((await command(s.mage,'view','cto')).view.entries.length,0);
  }finally{await s.harness.close(ctx);}
});

test('actual SIGKILL at safe tool intent recovers same submission; provider intent stays held',async()=>{
  const directory=await mkdtemp(join(process.env.TMPDIR??`${process.env.HOME}/.cache/tmp`,'mage-crash-'));
  await chmod(directory,0o700);
  await killAfterCommittedBoundary(directory,'tool');
  const s=await setup({directory,config:crashConfig(),route:()=>answer('Recovered safe read result'),broker:async()=>({source:'fixture-owner',observed:true})});
  try {
    assert.equal((await command(s.mage,'status','cto',{input_id:'crash-1'})).submission.status,'placed');
    s.mage.assertProgress();
    const result=await command(s.mage,'wait','cto',{input_id:'crash-1'});
    assert.equal(result.submission.status,'done');
    assert.equal((await command(s.mage,'view','cto')).view.entries.filter(e=>e.kind==='pi.user').length,1);
  }finally{await s.harness.close(ctx);}
  const held=await mkdtemp(join(process.env.TMPDIR??`${process.env.HOME}/.cache/tmp`,'mage-provider-hold-'));
  await chmod(held,0o700);await killAfterCommittedBoundary(held,'request');
  const h=await setup({directory:held,config:crashConfig()});
  try {
    assert.equal(h.faux.state.callCount,0);
    assert.throws(()=>h.mage.assertProgress(),/provider_recovery_hold/);
    await assert.rejects(command(h.mage,'wait','cto',{input_id:'crash-1'}),/provider_recovery_hold/);
    await assert.rejects(command(h.mage,'submit','coo',{input_id:'wake-new',text:'a new input must not resume charged work'}),/provider_recovery_hold/);
    assert.equal(h.faux.state.callCount,0);
    assert.equal((await command(h.mage,'tasks','cto')).recovery_holds.length,1);
  }finally{await h.harness.close(ctx);}
});
