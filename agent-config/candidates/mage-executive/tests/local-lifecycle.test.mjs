import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
test('local host releases the native Models resource registry after durable close, then exits',async()=>{
  const dir=await mkdtemp(join(process.env.TMPDIR??`${process.env.HOME}/.cache/tmp`,'mage-lifecycle-'));
  const config={schema:'mage-executive/1',state_dir:dir,native_models_entry:new URL('models-fixture.mjs',import.meta.url).pathname,instances:[{id:'coo',role:'coo',instructions:'Lifecycle test COO',skills:[],provider:'openai-codex',model:'gpt-6.1-sol',thinking:'xhigh'},{id:'cto',role:'cto',instructions:'Lifecycle test CTO',skills:[],provider:'openai-codex',model:'gpt-6.1-sol',thinking:'xhigh'}]};
  config.native_staging={admission_ref:'lifecycle-fixture',account_ref:'acct-0123456789',coo_input_id:'original',commission_id:'unused-fixture-commission',quota_reader:{executable:'/unused/fixture-quota',args:[]}};
  // Admission is a trusted stub ONLY in this transport-cleanup test. The real
  // Rust/native-SDK suites independently defend admission and physical limits.
  const broker=join(dir,'admission-fixture');await writeFile(broker,'#!/bin/sh\ncat >/dev/null\nprintf \'{"class":"lifecycle-only-admission-stub"}\\n\'\n');await chmod(broker,0o700);
  const file=join(dir,'config.json');await writeFile(file,JSON.stringify(config),{mode:0o600});
  const child=spawn(process.execPath,[new URL('../runtime.mjs',import.meta.url).pathname,file,broker],{env:{PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR},stdio:['pipe','pipe','pipe']});
  let bytes=Buffer.alloc(0),error='';const rows=[];const waiters=[];
  child.stdout.on('data',chunk=>{bytes=Buffer.concat([bytes,chunk]);let n;while((n=bytes.indexOf(10))>=0){const row=JSON.parse(bytes.subarray(0,n).toString('utf8'));bytes=bytes.subarray(n+1);if(waiters.length)waiters.shift()(row);else rows.push(row);}});
  child.stderr.on('data',chunk=>error+=chunk);
  const next=()=>rows.length?Promise.resolve(rows.shift()):new Promise(resolve=>waiters.push(resolve));
  const exit=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
  let timer;const deadline=new Promise((_r,reject)=>{timer=setTimeout(()=>reject(new Error(`native lifecycle deadline; ${error}`)),5000);});
  try{
    await Promise.race([next(),deadline]);
    child.stdin.write(`${JSON.stringify({id:'caps',action:'capabilities',instance:'cto'})}\n`);
    const caps=await Promise.race([next(),deadline]);
    assert.deepEqual(caps.result.tools.slice().sort(),['mage_context_search','mage_factory_read','mage_memory_recall','mage_memory_write','mage_skill_read']);
    child.stdin.write(`${JSON.stringify({id:'s',action:'submit',instance:'coo',input_id:'original',text:'one line'})}\n`);
    await Promise.race([next(),deadline]);
    child.stdin.write(`${JSON.stringify({id:'w',action:'wait',instance:'coo',input_id:'original'})}\n`);
    const result=await Promise.race([next(),deadline]);assert.equal(result.result.submission.status,'done');
    child.stdin.end();const observed=await Promise.race([exit,deadline]);
    assert.equal(observed.code,0,error);assert.equal(observed.signal,null);
  }finally{clearTimeout(timer);if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exit;}}
  delete config.native_staging;config.state_dir=await mkdtemp(join(dir,'inspect-'));
  const inspectConfig=join(dir,'inspect.json');await writeFile(inspectConfig,JSON.stringify(config),{mode:0o600});
  const viewer=spawn(process.execPath,[new URL('../runtime.mjs',import.meta.url).pathname,inspectConfig,broker],{env:{PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR},stdio:['pipe','pipe','pipe']});
  const output=[];let buffered='';let inspectTimer;
  const finished=new Promise((resolve,reject)=>{
    inspectTimer=setTimeout(()=>{viewer.kill('SIGKILL');reject(new Error('inspection-only close deadline'));},5000);
    viewer.stdout.on('data',chunk=>{buffered+=chunk;let n;while((n=buffered.indexOf('\n'))>=0){const row=JSON.parse(buffered.slice(0,n));buffered=buffered.slice(n+1);output.push(row);if(row.event==='ready'){viewer.stdin.write(`${JSON.stringify({id:'blocked',action:'submit',instance:'coo',input_id:'unadmitted',text:'must not reach provider'})}\n`);}else if(row.id==='blocked')viewer.stdin.end();}});
    viewer.on('close',code=>resolve(code));viewer.on('error',reject);
  });
  try{assert.equal(await finished,0);assert.equal(output[0].native_execution,'inspection-only');assert.match(output[1].error,/native_final_guard_required/);}finally{clearTimeout(inspectTimer);}
});
