import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const hash=x=>createHash('sha256').update(x).digest('hex');
export async function accountCapacityProof({root,scratch,base,task,boot,stop,t}) {
  // All grants, outcomes, responses and costs are SYNTHETIC. No native claim,
  // provider request or actual usage/receipt-source authority is exercised.
  const template=JSON.parse((await readFile(resolve(root,'wrangler.canary.jsonc'),'utf8')).split('\n').filter(l=>!l.trim().startsWith('//')).join('\n'));
  const now=Date.now(), end=now+180000;
  const fact={owner:'fixture-meter-owner',reference:'SYNTHETIC-dedicated-reserve-not-headroom',sha256:hash('synthetic'),observed_at_ms:now,usage_through_ms:now,valid_until_ms:end,basis:'dedicated_reserve'};
  const meter=(kind,account,unit)=>({kind,billing_account:account,unit,allocated:10000,period_id:'fixture-window',period_start_ms:now-1000,period_end_ms:end+1000,authority:fact});
  const native={operation:'native_turn',route:task.route,provider_account:'fixture-native-account',entitlement:'native_subscription',entitlement_ref:fact,runtime_compatibility:fact,capabilities:['native_turn'],approval_scope:'SYNTHETIC-only',approval:fact,projects:['a','b'],actors:['loopback-fixture-owner'],meters:['subscription','capacity','resource_cash'],outcome_owner:'fixture-independent-outcome-owner'};
  const policy={account:'b069014f6a46558ea9146fb6c4ff8f6c',policy_id:'SYNTHETIC-capacity-policy',revision:1,meters:{subscription:meter('subscription_quota','fixture-native-account','native_turns'),api:meter('api_usd_micros','fixture-openrouter-account','usd_micros'),capacity:meter('resource_capacity','fixture-cf-account','instance_slots'),resource_cash:meter('resource_usd_micros','fixture-cf-account','usd_micros')},seats:{native,jev:{...native,operation:'jev_decision',route:{harness:'summon-system-one',provider:'openrouter-decisions',model:'typesafe/jev-1.13',effort:'fixed-decisions'},provider_account:'fixture-openrouter-account',entitlement:'third_party_api',capabilities:['clarify'],meters:['api','capacity','resource_cash']}}};
  const config=resolve(scratch,'account-capacity.json');
  await stop();await writeFile(config,JSON.stringify({...template,name:'summon-factory-account-capacity-fixture',main:resolve(root,template.main),vars:{FACTORY_ADMISSION_FIXTURE:JSON.stringify(policy)}}));await boot(config);
  const receipts=[];
  const call=async(label,path,body)=>{const res=await fetch(base+path,body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const value=await res.json();receipts.push({label,status:res.status,code:value.code??null,revision:value.account?.revision??value.revision??null});return {status:res.status,value};};
  const read=async()=>{const r=await call('read account','/v1/admission');assert.equal(r.status,200);return r.value;};
  const ok=async(label,body)=>{const r=await call(label,'/v1/admission',body);if(r.status!==200){const after=await read();await writeFile(resolve(scratch,'account-capacity-failure.json'),JSON.stringify({fixture_only:true,provider_execution:false,label,status:r.status,refusal:r.value,after,receipts},null,2));}assert.equal(r.status,200,JSON.stringify({label,...r}));return r.value;};
  const intake=async(id,brief='SYNTHETIC only; no native/provider execution')=>{const r=await call('queued fixture '+id,'/v1/intake',{task:{...task,id,brief,checks:[],outputs:[]},initial_input_id:'initial'});assert.equal(r.status,200);return r.value.run;};
  const request=(id,seat='native')=>({reservation_id:'reservation-'+id,operation_id:'operation-'+id,run_id:id,input_id:'initial',project:seat==='jev'?'b':'a',seat_id:seat,capabilities:[seat==='jev'?'clarify':'native_turn'],amounts:seat==='jev'?{api:20,capacity:1,resource_cash:1}:{subscription:1,capacity:1,resource_cash:1}});
  const final=(r,disposition='owner_final')=>({receipt_id:'"'.repeat(230)+r.run_id.slice(-20),reservation_id:r.reservation_id,operation_id:r.operation_id,disposition,owner:native.outcome_owner,evidence_ref:'\\'.repeat(256),evidence_sha256:hash('SYNTHETIC independent owner-final usage'),actual:Object.fromEntries(Object.keys(r.amounts).map(k=>[k,0]))});
  const pending=[],originalRuns={};
  for(let i=0;i<4;i++){
    const id='cf1:account-capacity-jev-'+i;originalRuns[id]=await intake(id,'SYNTHETIC-context '+ 'x'.repeat(5000));const r=request(id,'jev');await ok('accepted finite Jev '+i,{operation:'reserve',request:r});pending.push(r);
    if(i<3)await ok('initial bounded Jev SOURCE plan '+i,{operation:'plan_jev',reservation_id:r.reservation_id});
  }
  const nativeId='cf1:account-capacity-native';originalRuns[nativeId]=await intake(nativeId);const competitor=request(nativeId);await ok('accepted competing native accounting ONLY',{operation:'reserve',request:competitor});
  // Retained ordinary owner-final fixture history fills the SAME account. No
  // injected snapshot, cap change, pruning, authority replacement or TTL release.
  const historical=[];let refused=false;
  for(let i=0;i<160;i++){
    const id='cf1:account-capacity-fill-'+i;await intake(id);const r=request(id);const accepted=await call('fill reserve '+i,'/v1/admission',{operation:'reserve',request:r});
    if(accepted.status===413){assert.equal(accepted.value.code,'state_limit');refused=true;break;}
    assert.equal(accepted.status,200,JSON.stringify(accepted));const receipt=final(r);await ok('retained original final '+i,{operation:'reconcile',receipt});historical.push(receipt);
  }
  assert.ok(refused,'bounded fill must reach real account acceptance guard');
  const before=await read();await writeFile(resolve(scratch,'account-capacity-before.json'),JSON.stringify(before));
  await stop();await boot(config);assert.deepEqual(await read(),before);
  const outcome=async(label,body)=>{const prior=await read();const result=await call(label,'/v1/admission',body);if(result.status!==200){const after=await read();assert.deepEqual(after,prior,'failed outcome must not partially commit');await writeFile(resolve(scratch,'account-capacity-failure.json'),JSON.stringify({fixture_only:true,provider_execution:false,expected:200,label,status:result.status,refusal:result.value,unchanged:true,before:prior,after,receipts},null,2));}assert.equal(result.status,200,JSON.stringify({label,status:result.status,code:result.value.code}));return result.value;};
  const keys=Object.fromEntries(Object.values(before.judgments).map(j=>[j.reservation_id,j.key]));
  const response={model:'typesafe/jev-1.13',answers:{next_action:{type:'choice',choice:'clarify',confidence:1,probabilities:{clarify:1,escalate:0}},context_sufficient:{type:'noul',noul:0.2},unresolved_material_uncertainty:{type:'noul',noul:0.9}},usage:{cost:0},SYNTHETIC_padding:''};
  const padding=8192-Buffer.byteLength(JSON.stringify(response));response.SYNTHETIC_padding='\x01'.repeat(Math.floor(padding/6))+'x'.repeat(padding%6);assert.equal(Buffer.byteLength(JSON.stringify(response)),8192);
  for(let i=0;i<3;i++){
    const refs=async()=>{for(let u=0;u<8;u++)await outcome('accepted maximally escaped uncertainty '+i+':'+u,{operation:'uncertain',reservation_id:pending[i].reservation_id,evidence_ref:String(u)+'"'.repeat(255)});};
    if(i===1){await refs();const prior=await read();const failure={operation:'jev_failure',key:keys[pending[i].reservation_id],kind:'transport'};const saved=(await outcome('funded typed failure AFTER ALL8 refs',failure)).account;assert.equal(saved.revision,prior.revision+1);assert.deepEqual(saved.reservations[pending[i].reservation_id].uncertain,prior.reservations[pending[i].reservation_id].uncertain);assert.equal((await ok('original failure replay at capacity',failure)).replayed,true);await stop();await boot(config);assert.deepEqual(await read(),saved);}
    await outcome('accepted maximum 8KiB SOURCE response '+i,{operation:'jev_response',key:keys[pending[i].reservation_id],response});
    if(i!==1)await refs();
    if(i===0)await outcome('typed failure remains funded AFTER original response and8refs',{operation:'jev_failure',key:keys[pending[i].reservation_id],kind:'timeout'});
  }
  const planned=await outcome('remaining competing reservation still owns Jev plan room',{operation:'plan_jev',reservation_id:pending[3].reservation_id});keys[pending[3].reservation_id]=Object.values(planned.account.judgments).find(j=>j.reservation_id===pending[3].reservation_id).key;
  await outcome('deferred accepted failure',{operation:'jev_failure',key:keys[pending[3].reservation_id],kind:'unsupported'});
  const lateFinal=final(pending[3],'proven_not_started');await outcome('verified fixture not-started BEFORE late original response',{operation:'reconcile',receipt:lateFinal});
  // Refill legitimately released components, never the still-recordable response.
  let refilled=false;for(let i=0;i<20;i++){const id='cf1:account-capacity-refill-'+i;await intake(id);const r=request(id);const accepted=await call('refill after final '+i,'/v1/admission',{operation:'reserve',request:r});if(accepted.status===413){assert.equal(accepted.value.code,'state_limit');refilled=true;break;}assert.equal(accepted.status,200);const receipt=final(r);await ok('refill original owner-final history',{operation:'reconcile',receipt});historical.push(receipt);}assert.ok(refilled,'refill must reach actual acceptance boundary');
  await outcome('late accepted response still owns room AFTER final/refill',{operation:'jev_response',key:keys[pending[3].reservation_id],response});
  for(const r of pending){const receipt=r===pending[3]?lateFinal:final(r);await outcome('accepted owner-final actual usage '+r.run_id,{operation:'reconcile',receipt});assert.equal((await ok('immutable usage replay',{operation:'reconcile',receipt})).replayed,true);assert.equal((await ok('immutable response replay',{operation:'jev_response',key:keys[r.reservation_id],response})).replayed,true);if(r===pending[1])assert.equal((await ok('original failure replay AFTER final/response',{operation:'jev_failure',key:keys[r.reservation_id],kind:'transport'})).replayed,true);}
  for(let u=0;u<8;u++)await outcome('native competitor keeps all uncertainty room '+u,{operation:'uncertain',reservation_id:competitor.reservation_id,evidence_ref:String(u)+'\\'.repeat(255)});
  const notStarted=final(competitor,'proven_not_started');await outcome('native not-started releases ONLY justified final usage',{operation:'reconcile',receipt:notStarted});assert.equal((await ok('original not-started replay',{operation:'reconcile',receipt:notStarted})).replayed,true);
  const retained=await read();for(const receipt of historical)assert.deepEqual(retained.reservations[receipt.reservation_id].final_receipt,receipt);
  await stop();await boot(config);assert.deepEqual(await read(),retained);
  for(const [id,expected]of Object.entries(originalRuns)){const result=await call('budget did not mutate managed run '+id,`/v1/runs/${id}/status`);assert.equal(result.status,200);assert.deepEqual(result.value,expected);}
  await writeFile(resolve(scratch,'account-capacity-after.json'),JSON.stringify(retained));await writeFile(resolve(scratch,'account-capacity-http.json'),JSON.stringify({fixture_only:true,provider_execution:false,historical:historical.length,receipts},null,2));
  await stop();await boot();t.diagnostic('Account near-capacity: accepted bounded plans/responses/failure/escaped uncertainty/final-notstarted and competitors survive recording/replay/restart; original historical receipts retained. ALL grants/usage/cost/response SYNTHETIC; no native/provider execution.');
}
