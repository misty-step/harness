// Original installed SDK/provider/auth conversion with synthetic in-memory
// credentials and a fake transport. ZERO real provider/key/quota API calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { findPackageJSON } from 'node:module';
import { readFileSync } from 'node:fs';
import { pathToFileURL,fileURLToPath } from 'node:url';
import { zstdCompressSync } from 'node:zlib';
import { installNativeFinalGuard,accountRef } from '../native-final-guard.mjs';
import { stageTools } from '../native-stage.mjs';
import { processBroker } from '../local-broker.mjs';
const sdkEntry=process.env.NATIVE_PI_SDK_ENTRY,binary=process.env.MAGE_NATIVE_GUARD_BINARY;
const enabled=Boolean(sdkEntry&&binary);
const actor='isolated-native-stage-owner';
const credential=id=>({type:'oauth',accountId:id,expires:Date.now()+86_400_000,refresh:'unused-synthetic-fixture',access:['opaque',Buffer.from(JSON.stringify({'https://api.openai.com/auth':{chatgpt_account_id:id}})).toString('base64url'),'opaque'].join('.')});
async function setup({wireMutation,quotaMutation}={}) {
 const dir=await mkdtemp(join(process.env.TMPDIR??`${process.env.HOME}/.cache/tmp`,'mage-final-native-'));await chmod(dir,0o700);
 const sdk=await import(sdkEntry);const manifest=findPackageJSON('@earendil-works/pi-ai',sdkEntry);const pkg=JSON.parse(readFileSync(manifest,'utf8'));const api=await import(new URL(pkg.main,pathToFileURL(manifest)).href);
 const saved=new Map([['openai-codex',credential(actor)]]);
 const credentials={read:async id=>saved.get(id),list:async()=>[...saved].map(([providerId,c])=>({providerId,type:c.type})),modify:async(id,fn)=>{const c=await fn(saved.get(id));if(c)saved.set(id,c);return c;},delete:async id=>saved.delete(id)};
 const native=await sdk.ModelRuntime.create({credentials,modelsPath:null,modelsStorePath:join(dir,'models.json'),refreshOnCreate:false,allowModelNetwork:false});await native.refresh({allowNetwork:false});
 const model=native.getModel('openai-codex','gpt-6.1-sol');assert(model);
 const initial=native.getProvider('openai-codex');const catalog=native.getModels('openai-codex').map(m=>m.id);
 if(wireMutation)native.registerNativeProvider({...initial,streamSimple:(m,c,o)=>initial.streamSimple(m,c,{...o,fetch:(url,init)=>o.fetch(url,wireMutation(init))})});
 const quota={schema:'mage-native-quota/1',owner_ref:'fixture:fresh-owned-reader',account_ref:accountRef(actor),provider:'openai-codex',model:'gpt-6.1-sol',effort:'xhigh',auth_type:'oauth',auth_source:'stored',billing:'plan',verdict:'usable',remaining_percent:75,extra_usage_enabled:false,degraded:null,...quotaMutation};
 const instances=['coo','cto'].map(role=>({id:role,role,instructions:`Fixture ${role}`,skills:[],provider:'openai-codex',model:'gpt-6.1-sol',thinking:'xhigh'}));
 const config={schema:'mage-executive/1',state_dir:dir,node:process.execPath,adapter:new URL('../runtime.mjs',import.meta.url).pathname,native_models_entry:sdkEntry.startsWith('file:')?fileURLToPath(sdkEntry):sdkEntry,instances,native_staging:{admission_ref:'zero-provider-source-fixture',account_ref:accountRef(actor),coo_input_id:'root-input',commission_id:'commission-1',quota_reader:{executable:process.execPath,args:['-e',`console.log(JSON.stringify({...${JSON.stringify(quota)},observed_at_ms:Date.now()}))`]}}};
 const configPath=join(dir,'config.json');await writeFile(configPath,JSON.stringify(config),{mode:0o600});
 let selected={instance:'coo',input_id:'root-input',input_class:'coo_input'};let sinkCalls=0;const seen=[];
 const declarations=role=>stageTools(role).map(name=>({name,description:`Fixture declaration ${name}`,parameters:api.Type.Object({})}));
 const contextFor=async()=>({...selected,tools:declarations(selected.instance)});
 const guarded=installNativeFinalGuard(native,{contextFor,admit:processBroker(binary,configPath,'native-admit'),toolsApi:api,fetch:async(url,init)=>{
   assert.equal(String(url),'https://chatgpt.com/backend-api/codex/responses');assert.equal(new Headers(init.headers).get('chatgpt-account-id'),actor);assert(!init.signal?.aborted);sinkCalls++;seen.push({account:accountRef(actor),bodyType:typeof init.body});
   return new Response('data: '+JSON.stringify({type:'response.completed',response:{id:'synthetic-response',status:'completed',output:[],usage:{input_tokens:1,output_tokens:0,total_tokens:1}}})+'\n\n',{status:200,headers:{'content-type':'text/event-stream'}});
 }});
 assert.equal(guarded.provider.auth,initial.auth);assert.deepEqual(native.getModels('openai-codex').map(m=>m.id),catalog);
 const invoke=async(options={},raw=false)=>{
   const tools=declarations(selected.instance);const context={messages:[{role:'system',content:'',toolsAdded:tools,timestamp:0},{role:'user',content:'Zero-provider contract only',timestamp:0}]};
   return (raw?native.stream(model,context,{reasoningEffort:'xhigh',headers:{'chatgpt-account-id':'before-final-spoof'},...options}):native.streamSimple(model,context,{reasoning:'xhigh',headers:{'chatgpt-account-id':'before-final-spoof'},...options})).result();
 };
 return {native,model,invoke,api,configPath,contextFor,setInput:v=>{selected=v;},count:()=>sinkCalls,seen};
}

test('original native SDK refuses mutated postcallback model/effort/tools/body, final account and abort',{skip:!enabled},async()=>{
 const s=await setup();try{
  for(const [options,reason] of [[{reasoning:'low'},'model_or_effort'],[{onPayload:p=>({...p,model:'not-admitted'})},'model_or_effort'],[{onPayload:p=>({...p,tools:[...p.tools,{type:'function',name:'bash',parameters:{}}]})},'tool_schema'],[{onPayload:p=>({...p,tools:p.tools.map((t,i)=>i? t:{...t,parameters:{type:'object',additionalProperties:true}})})},'tool_schema'],[{onPayload:p=>({...p,instructions:'x'.repeat(96*1024)})},'body_exceeds'],[{apiKey:credential('wrong-physical-account').access},'account_refused']]){
   const result=await s.invoke(options);assert(['error','aborted'].includes(result.stopReason));assert(result.errorMessage.includes(reason),result.errorMessage);assert.equal(s.count(),0);
  }
  const abort=new AbortController();abort.abort();const stopped=await s.invoke({signal:abort.signal});assert(['error','aborted'].includes(stopped.stopReason));assert.equal(s.count(),0);
  const accepted=await s.invoke({fetch:()=>{throw new Error('caller fetch must be ignored');}});assert.equal(accepted.stopReason,'stop',accepted.errorMessage);assert.equal(s.count(),1);
 }finally{s.api.cleanupSessionResources();}
});

test('serialized final zstd body is independently checked after payload callbacks',{skip:!enabled},async()=>{
 for(const [wireMutation,reason] of [[init=>({...init,body:zstdCompressSync(JSON.stringify({model:'changed-after-callback',reasoning:{effort:'xhigh'},tools:[]}))}),'model_or_effort'],[init=>({...init,headers:{...Object.fromEntries(new Headers(init.headers)),'content-encoding':'unknown'}}),'encoding_unsupported'],[init=>({...init,body:zstdCompressSync(JSON.stringify({instructions:'x'.repeat(96*1024+1)}))}),null]]) {
  const s=await setup({wireMutation});
  try{const result=await s.invoke();assert(['error','aborted'].includes(result.stopReason));if(reason)assert(result.errorMessage.includes(reason),result.errorMessage);assert.equal(s.count(),0);}finally{s.api.cleanupSessionResources();}
 }
});

test('fresh quota extra-usage/unknown state refuses before original sink',{skip:!enabled},async()=>{
 for(const quotaMutation of [{extra_usage_enabled:true},{extra_usage_enabled:null},{billing:'credits'},{verdict:'unknown'}]){
  const s=await setup({quotaMutation});try{const result=await s.invoke();assert(['error','aborted'].includes(result.stopReason));assert(/native_(extra_usage|selected_route|quota)/.test(result.errorMessage),result.errorMessage);assert.equal(s.count(),0);}finally{s.api.cleanupSessionResources();}
 }
});

test('same original provider enforces 4/input and 12 total physical sends, raw stream included',{skip:!enabled},async()=>{
 const s=await setup();try{
  for(const input of [{instance:'coo',input_id:'root-input',input_class:'coo_input'},{instance:'cto',input_id:'mage-commission:commission-1',input_class:'cto_commission'},{instance:'coo',input_id:'mage-report:37',input_class:'coo_wake'}]){
   s.setInput(input);for(let n=0;n<4;n++){const accepted=await s.invoke();assert.equal(accepted.stopReason,'stop',accepted.errorMessage);}const before=s.count();const refused=await s.invoke({},true);assert(['error','aborted'].includes(refused.stopReason));assert(refused.errorMessage.includes('budget_exhausted'),refused.errorMessage);assert.equal(s.count(),before);
  }
  assert.equal(s.count(),12);
  console.log(JSON.stringify({class:'installed-original-SDK-synthetic-credentials/fake-transport',realProviderCalls:0,physicalFixtureCalls:12,maxPerInput:4,postcallbackAndFinalSerializedBodyGuard:true,oauthAndCatalogPreserved:true,outputCap:'not proven'}));
 }finally{s.api.cleanupSessionResources();}
});
