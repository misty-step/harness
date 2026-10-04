// Real local workerd SQLite; EVERY allocation/outcome/Jev response below is a
// synthetic loopback fixture. No native turn, provider request, paid call or grant.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const hash=x=>createHash('sha256').update(x).digest('hex');
export async function admissionFixtureProof({root,scratch,base,task,boot,stop,t}) {
 const template=JSON.parse((await readFile(resolve(root,'wrangler.canary.jsonc'),'utf8')).split('\n').filter(l=>!l.trim().startsWith('//')).join('\n'));
 const config=resolve(scratch,'account-fixture.json');
 const now=Date.now(), expiry=now+120000;
 const source={owner:'fixture-meter-owner',reference:'fixture-dedicated-reserve-NOT-paid-headroom',sha256:hash('fixture'),observed_at_ms:now,usage_through_ms:now,valid_until_ms:expiry,basis:'dedicated_reserve'};
 const meter=(kind,account,unit,allocated)=>({kind,billing_account:account,unit,allocated,period_id:'fixture-window',period_start_ms:now-1000,period_end_ms:expiry+1000,authority:source});
 const native={operation:'native_turn',route:task.route,provider_account:'fixture-native-account',entitlement:'native_subscription',entitlement_ref:source,runtime_compatibility:source,capabilities:['native_turn'],approval_scope:'fixture-only-bounded-dispatch',approval:source,projects:['a','b'],actors:['loopback-fixture-owner'],meters:['subscription','capacity','resource_cash'],outcome_owner:'fixture-independent-outcome-owner'};
 const policy={account:'b069014f6a46558ea9146fb6c4ff8f6c',policy_id:'fixture-policy',revision:1,meters:{subscription:meter('subscription_quota','fixture-native-account','native_turns',2),api:meter('api_usd_micros','fixture-openrouter-account','usd_micros',100),capacity:meter('resource_capacity','fixture-cf-account','instance_slots',1),resource_cash:meter('resource_usd_micros','fixture-cf-account','usd_micros',50)},seats:{native,jev:{...native,operation:'jev_decision',route:{harness:'summon-system-one',provider:'openrouter-decisions',model:'typesafe/jev-1.13',effort:'fixed-decisions'},provider_account:'fixture-openrouter-account',entitlement:'third_party_api',capabilities:['clarify'],meters:['api','capacity','resource_cash']}}};
 const configure=async(vars)=>{await stop();await writeFile(config,JSON.stringify({...template,name:'summon-factory-account-fixture',main:resolve(root,template.main),vars}));await boot(config);};
 const vars={FACTORY_ADMISSION_FIXTURE:JSON.stringify(policy)};
 const receipts=[];
 const api=async(label,path,body,expected=200,headers={})=>{const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});const value=await response.json();receipts.push({label,status:response.status,code:value.code??null,revision:value.account?.revision??value.revision??null});await writeFile(resolve(scratch,'admission-http.json'),JSON.stringify({fixture_only:true,provider_execution:false,receipts},null,2));assert.equal(response.status,expected,JSON.stringify(value));return value;};
 await configure({});await api('admission default OFF','/v1/admission',undefined,403);
 await configure({...vars,FACTORY_MODE:'hosted'});await api('hosted cannot activate fixture admission','/v1/admission',{},403);await api('hosted cannot claim before shared account authority','/v1/runs/cf1:account-off/claim',{},403);
 await configure({...vars,FACTORY_MODE:'fixture'});await api('authenticated fixture cannot promote account owner assertions','/v1/admission',{},403);
 await configure(vars);
 const snapshots={};for(const suffix of ['a','b','j']){const frozen={...task,id:`cf1:account-${suffix}`,checks:[],outputs:[]};snapshots[suffix]=(await api('owned queued intake '+suffix,'/v1/intake',{task:frozen,initial_input_id:'initial'})).run;}
 const req=(suffix,project,seat='native')=>({reservation_id:'r-'+suffix,operation_id:'op-'+suffix,run_id:`cf1:account-${suffix}`,input_id:'initial',project,seat_id:seat,capabilities:seat==='native'?['native_turn']:['clarify'],amounts:seat==='native'?{subscription:1,capacity:1,resource_cash:10}:{api:20,capacity:1,resource_cash:10}});
 const candidates=[req('a','a'),req('b','b')];
 const raw=await Promise.all(candidates.map(async request=>{const response=await fetch(base+'/v1/admission',{method:'POST',body:JSON.stringify({operation:'reserve',request})});return {status:response.status,value:await response.json(),request};}));
 assert.deepEqual(raw.map(r=>r.status).sort(),[200,409]);
 const win=raw.find(r=>r.status===200), lose=raw.find(r=>r.status===409);assert.equal(lose.value.code,'budget_unavailable');
 receipts.push({label:'two projects race one physical account capacity',statuses:raw.map(r=>r.status),winner:win.request.reservation_id});
 assert.equal((await api('stable reserve replay','/v1/admission',{operation:'reserve',request:win.request})).replayed,true);
 const before=await api('account original reservation snapshot','/v1/admission');
 const frozen=before.reservations[win.request.reservation_id].frozen;assert.equal(frozen.task_route.provider,task.route.provider);assert.equal(frozen.actor,'loopback-fixture-owner');assert.equal(frozen.seat.entitlement,'native_subscription');
 await api('uncertain does not mean released','/v1/admission',{operation:'uncertain',reservation_id:win.request.reservation_id,evidence_ref:'fixture-lost-ACK-NOT-process-death'});
 const unknown=await api('uncertain original snapshot','/v1/admission');await stop();await boot(config);assert.deepEqual(await api('restart retains reservation and uncertainty','/v1/admission'),unknown);
 await api('other project still cannot reserve','/v1/admission',{operation:'reserve',request:lose.request},409);
 const final=request=>({receipt_id:'fixture-final-'+request.reservation_id,reservation_id:request.reservation_id,operation_id:request.operation_id,disposition:'owner_final',owner:'fixture-independent-outcome-owner',evidence_ref:'fixture-independent-final-not-operator-permission',evidence_sha256:hash('fixture-final'),actual:{...request.amounts,capacity:0}});
 const wrong={...final(win.request),owner:'granted-operator-NOT-outcome-owner'};await api('permission is not final receipt authority','/v1/admission',{operation:'reconcile',receipt:wrong},409);assert.deepEqual(await api('wrong receipt left snapshot unchanged','/v1/admission'),unknown);
 await api('fixture verified-owner final usage','/v1/admission',{operation:'reconcile',receipt:final(win.request)});
 await api('second project uses same freed capacity','/v1/admission',{operation:'reserve',request:lose.request});await api('second fixture final usage','/v1/admission',{operation:'reconcile',receipt:final(lose.request)});
 const jr=req('j','b','jev');await api('Jev separate finite API/resource reserve','/v1/admission',{operation:'reserve',request:jr});
 const planned=(await api('Jev typed SOURCE plan only no request sent','/v1/admission',{operation:'plan_jev',reservation_id:jr.reservation_id})).account;
 const key=Object.keys(planned.judgments)[0], judgment=planned.judgments[key];assert.equal(judgment.request.model,'typesafe/jev-1.13');assert.deepEqual(Object.keys(judgment.eligible).sort(),['clarify','escalate']);
 assert.equal((await api('unchanged semantic revision caches plan','/v1/admission',{operation:'plan_jev',reservation_id:jr.reservation_id})).replayed,true);
 const simulated={model:'typesafe/jev-1.13-20260917',answers:{next_action:{type:'choice',choice:'clarify',confidence:1,probabilities:{clarify:1,escalate:0}},context_sufficient:{type:'noul',noul:0.2},unresolved_material_uncertainty:{type:'noul',noul:0.9}},usage:{input_tokens:123,output_tokens:17,cost:0.0000011}};
 await api('synthetic response source fixture NOT actual inference','/v1/admission',{operation:'jev_response',key,response:simulated});
 const retained=await api('raw response/model/usage/cost retained','/v1/admission');assert.deepEqual(retained.judgments[key].response,simulated);assert.equal(retained.reservations[jr.reservation_id].final_receipt,null);await stop();await boot(config);assert.deepEqual(await api('cache and pending meters survive restart','/v1/admission'),retained);
 // Changing caller labels or environment namespace cannot create another owner.
 await configure({...vars,FACTORY_NAMESPACE:'client-new-namespace'});assert.deepEqual(await api('caller namespace cannot split account meter','/v1/admission',undefined,200,{'x-summon-actor':'untrusted-actor'}),retained);
 await configure({FACTORY_ADMISSION_FIXTURE:JSON.stringify({...policy,revision:2})});await api('policy replacement cannot reset durable usage','/v1/admission',undefined,409);
 await configure(vars);for(const suffix of ['a','b','j']) assert.deepEqual(await api('budget facts never mutate run phases '+suffix,`/v1/runs/cf1:account-${suffix}/status`),snapshots[suffix]);
 await writeFile(resolve(scratch,'admission-fixture-policy.json'),JSON.stringify(policy,null,2));await writeFile(resolve(scratch,'account-original-retained.json'),JSON.stringify(retained,null,2));
 await stop();await boot();
 t.diagnostic('Shared account: actual SQLite two-project race, restart/uncertainty retention, owner-final settlement, separate subscription/API/resource meters and typed Jev SOURCE cache. ALL allocations/outcomes/response costs synthetic; no provider/native execution.');
}
