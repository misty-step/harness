// Opt-in child of the offline contract suite; no production/provider credentials.
import { join } from 'node:path';
import { BACKGROUND_CONTEXT as ctx } from '@earendil-works/chord/context';
import { createModels } from '@earendil-works/pi-ai/models';
import { fauxProvider, fauxAssistantMessage as answer, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { Harness, createRegistry } from '@earendil-works/pi-durable';
import { openNodeSqliteDatabase } from '@earendil-works/pi-durable/storage/sqlite/node';
import { SqliteStorage } from '@earendil-works/pi-durable/storage/sqlite';
import { installMage } from '../durable.mjs';
const [directory,mode]=process.argv.slice(2);
const config={schema:'mage-executive/1',instances:[{id:'coo',role:'coo',instructions:'Crash-test COO',skills:[],provider:'openai-codex',model:'gpt-6.1-sol',thinking:'xhigh'},{id:'cto',role:'cto',instructions:'Crash-test CTO',skills:[],provider:'openai-codex',model:'gpt-6.1-sol',thinking:'xhigh'}]};
globalThis.fetch=async()=>{throw new Error('offline test network refused');};
const faux=fauxProvider(mode==='request'?{tokensPerSecond:1}:{});const base=createModels();base.setProvider(faux.provider);
faux.setResponses([()=>answer([fauxToolCall('mage_factory_read',{run:'cf1:long',endpoint:'status'})],{stopReason:'toolUse'})]);
const models=new Proxy(base,{get(target,key){
  if(key==='getModel')return()=>target.getModel('faux','faux-1');
  if(key==='streamSimple'&&mode==='request')return(...args)=>{
    // Request checkpoint is already committed before this provider boundary.
    console.log(JSON.stringify({event:'kill-ready',mode}));
    // An actual pi-ai stream whose answer never arrives before SIGKILL.
    faux.setResponses([()=>answer('unfinished '.repeat(100), { stopReason:'stop' })]);
    return target.streamSimple(args[0],args[1],{...args[2],signal:args[2]?.signal});
  };
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
}});
const registry=createRegistry();
const broker=async(_request,signal)=>{
  console.log(JSON.stringify({event:'kill-ready',mode}));
  await new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('closed')),{once:true}));
};
const mage=installMage(registry,{config,broker});
const database=await openNodeSqliteDatabase(join(directory,'engine.sqlite'));await database.exec('PRAGMA synchronous=FULL');
const harness=await Harness.open(await SqliteStorage.open(database),{models,registry,settings:{retry:{enabled:false},stream:{maxRetries:0},compaction:{enabled:false}}},ctx);
await mage.attach(harness,ctx);
await mage.command({action:'submit',instance:'cto',input_id:'crash-1',text:'long work'},ctx);
// Keep the child owned and alive until its parent observes and kills it.
await new Promise(()=>{});
