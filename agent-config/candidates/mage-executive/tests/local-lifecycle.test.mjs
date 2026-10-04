import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
test('local host releases the native Models resource registry after durable close, then exits',async()=>{
  const dir=await mkdtemp(join(process.env.TMPDIR??`${process.env.HOME}/.cache/tmp`,'mage-lifecycle-'));
  const config={schema:'mage-executive/1',state_dir:dir,native_models_entry:new URL('models-fixture.mjs',import.meta.url).pathname,instances:[{id:'coo',role:'coo',instructions:'Lifecycle test COO',skills:[],provider:'openai-codex',model:'gpt-6.1-sol',thinking:'xhigh'},{id:'cto',role:'cto',instructions:'Lifecycle test CTO',skills:[],provider:'openai-codex',model:'gpt-6.1-sol',thinking:'xhigh'}]};
  const file=join(dir,'config.json');await writeFile(file,JSON.stringify(config),{mode:0o600});
  const child=spawn(process.execPath,[new URL('../runtime.mjs',import.meta.url).pathname,file,'/unused/broker'],{env:{PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR},stdio:['pipe','pipe','pipe']});
  let bytes=Buffer.alloc(0),error='';const rows=[];const waiters=[];
  child.stdout.on('data',chunk=>{bytes=Buffer.concat([bytes,chunk]);let n;while((n=bytes.indexOf(10))>=0){const row=JSON.parse(bytes.subarray(0,n).toString('utf8'));bytes=bytes.subarray(n+1);if(waiters.length)waiters.shift()(row);else rows.push(row);}});
  child.stderr.on('data',chunk=>error+=chunk);
  const next=()=>rows.length?Promise.resolve(rows.shift()):new Promise(resolve=>waiters.push(resolve));
  const exit=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
  let timer;const deadline=new Promise((_r,reject)=>{timer=setTimeout(()=>reject(new Error(`native lifecycle deadline; ${error}`)),5000);});
  try{
    await Promise.race([next(),deadline]);
    child.stdin.write(`${JSON.stringify({id:'s',action:'submit',instance:'coo',input_id:'original',text:'one line'})}\n`);
    await Promise.race([next(),deadline]);
    child.stdin.write(`${JSON.stringify({id:'w',action:'wait',instance:'coo',input_id:'original'})}\n`);
    const result=await Promise.race([next(),deadline]);assert.equal(result.result.submission.status,'done');
    child.stdin.end();const observed=await Promise.race([exit,deadline]);
    assert.equal(observed.code,0,error);assert.equal(observed.signal,null);
  }finally{clearTimeout(timer);if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exit;}}
});
