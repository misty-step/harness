// Standalone LOCAL host. Production Cloudflare host supplies its proven storage,
// admission and Models to installMage; it must not run this Node/SQLite wrapper.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { BACKGROUND_CONTEXT as ctx } from '@earendil-works/chord/context';
import { createRegistry, Harness } from '@earendil-works/pi-durable';
import { openNodeSqliteDatabase } from '@earendil-works/pi-durable/storage/sqlite/node';
import { SqliteStorage } from '@earendil-works/pi-durable/storage/sqlite';
import { installMage } from './durable.mjs';
import { processBroker } from './local-broker.mjs';

const [configPath,binary]=process.argv.slice(2);
const config=JSON.parse(readFileSync(configPath,'utf8'));
// Only the existing native credential/model consumer is reused. No Pi
// AgentSession, agent loop, SessionManager, discovery or coding tools exists.
const {ModelRuntime}=await import(pathToFileURL(config.native_models_entry).href);
const native=await ModelRuntime.create({allowModelNetwork:false});
if(!native.isUsingSubscription('openai-codex')) throw new Error('unsupported_route: existing native included-subscription binding unavailable');
const models=new Proxy(native,{get(target,key){
  if(key==='getModel') return (provider,id)=>provider==='openai-codex'&&id==='gpt-6.1-sol'?target.getModel(provider,id):undefined;
  if(key==='streamSimple') return (model,messages,options)=>{
    if(model.provider!=='openai-codex'||model.id!=='gpt-6.1-sol') throw new Error('unsupported_route: no cash/model/account fallback');
    return target.streamSimple(model,messages,{...options,maxRetries:0});
  };
  const value=Reflect.get(target,key); return typeof value==='function'?value.bind(target):value;
}});
for(const instance of config.instances) if(!models.getModel(instance.provider,instance.model)) throw new Error('unsupported_route: exact native model unavailable');
const registry=createRegistry();
const mage=installMage(registry,{config,broker:processBroker(binary,configPath)});
const database=await openNodeSqliteDatabase(join(config.state_dir,'engine.sqlite'));
// The upstream Node helper chooses NORMAL. This local host explicitly needs FULL.
await database.exec('PRAGMA synchronous=FULL');
const harness=await Harness.open(await SqliteStorage.open(database),{models,registry,settings:{retry:{enabled:false},stream:{maxRetries:0},compaction:{enabled:false,backgroundTokens:0},toolExecution:'sequential'}},ctx);
await mage.attach(harness,ctx);
// Reading startup state does not resume possibly sent work. Operator must submit
// a supported original input or explicitly request resume after reconciliation.
const emit=value=>process.stdout.write(`${JSON.stringify(value)}\n`);
emit({event:'ready',engine:'pi-durable',version:'1.0.2',scheduling:(await harness.inspect(ctx)).scheduling});
let buffer=Buffer.alloc(0), closing=false;
const pending=new Set();
async function close(){if(closing)return;closing=true;process.stdin.pause();await harness.close(ctx);await Promise.allSettled([...pending]);}
const respond=async record=>{
  try {
    if(record.action==='resume') {mage.assertProgress();harness.resume();return emit({id:record.id,result:{scheduling:'running'}});}
    const result=await mage.command(record,ctx);emit({id:record.id,result});
  }catch(error){emit({id:record.id,error:String(error)});}
};
process.stdin.on('data',chunk=>{
  if(closing)return;
  buffer=Buffer.concat([buffer,chunk]);
  let boundary;
  while((boundary=buffer.indexOf(10))>=0){
    const frame=buffer.subarray(0,boundary);buffer=buffer.subarray(boundary+1);
    if(frame.length>512*1024){void close();return;}
    try {
      const record=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(frame));
      if(typeof record.id!=='string')throw new Error('correlation ID required');
      const task=respond(record);pending.add(task);task.finally(()=>pending.delete(task));
    }catch(error){emit({error:String(error)});void close();return;}
  }
  if(buffer.length>512*1024){emit({error:'frame exceeds bound'});void close();}
});
process.stdin.on('end',()=>{if(buffer.length)emit({error:'truncated JSONL frame'});void close();});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>void close());
