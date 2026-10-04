import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const hash=x=>createHash('sha256').update(x).digest('hex');
export async function jevOrderProof({root,scratch,base,task,boot,stop,t}) {
  // SYNTHETIC policy/cost/response/outcome assertions only. No inference, native
  // claim, provider credentials, cash grant or real receipt-source authority.
  const template=JSON.parse((await readFile(resolve(root,'wrangler.canary.jsonc'),'utf8')).split('\n').filter(l=>!l.trim().startsWith('//')).join('\n'));
  const now=Date.now(), end=now+180000;
  const fact={owner:'fixture-account-owner',reference:'SYNTHETIC-only-not-headroom',sha256:hash('synthetic'),observed_at_ms:now,usage_through_ms:now,valid_until_ms:end,basis:'dedicated_reserve'};
  const meter=(kind,account,unit,allocated)=>({kind,billing_account:account,unit,allocated,period_id:'fixture-window',period_start_ms:now-1000,period_end_ms:end+1000,authority:fact});
  const seat={operation:'jev_decision',route:{harness:'summon-system-one',provider:'openrouter-decisions',model:'typesafe/jev-1.13',effort:'fixed-decisions'},provider_account:'fixture-openrouter-account',entitlement:'third_party_api',entitlement_ref:fact,runtime_compatibility:fact,capabilities:['clarify'],approval_scope:'SYNTHETIC-only',approval:fact,projects:['a'],actors:['loopback-fixture-owner'],meters:['api','capacity','resource_cash'],outcome_owner:'fixture-independent-outcome-owner'};
  const policy={account:'b069014f6a46558ea9146fb6c4ff8f6c',policy_id:'SYNTHETIC-order-policy',revision:1,meters:{api:meter('api_usd_micros','fixture-openrouter-account','usd_micros',100),capacity:meter('resource_capacity','fixture-cf-account','instance_slots',20),resource_cash:meter('resource_usd_micros','fixture-cf-account','usd_micros',100)},seats:{jev:seat,'jev-alias':seat}};
  const config=resolve(scratch,'jev-order-fixture.json');await stop();await writeFile(config,JSON.stringify({...template,name:'summon-factory-jev-order-fixture',main:resolve(root,template.main),vars:{FACTORY_ADMISSION_FIXTURE:JSON.stringify(policy)}}));await boot(config);
  const receipts=[],findings=[],runs={};
  const call=async(label,path,body)=>{const r=await fetch(base+path,body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const value=await r.json();receipts.push({label,status:r.status,code:value.code??null,revision:value.account?.revision??value.revision??null,replayed:value.replayed??null});return {status:r.status,value};};
  const read=async()=>{const r=await call('read account','/v1/admission');assert.equal(r.status,200);return r.value;};
  const ok=async(label,body)=>{const r=await call(label,'/v1/admission',body);assert.equal(r.status,200,JSON.stringify({label,...r}));return r.value;};
  const intake=async(id)=>{const r=await call('queued synthetic '+id,'/v1/intake',{task:{...task,id,brief:'SYNTHETIC only; no provider/native execution',checks:[],outputs:[]},initial_input_id:'initial'});assert.equal(r.status,200);runs[id]=r.value.run;};
  const req=(id,seat_id='jev',api=20)=>({reservation_id:'r-'+id+'-'+seat_id,operation_id:'op-'+id+'-'+seat_id,run_id:id,input_id:'initial',project:'a',seat_id,capabilities:['clarify'],amounts:{api,capacity:1,resource_cash:1}});
  const final=(r,disposition='owner_final',api=0)=>({receipt_id:'final-'+r.reservation_id,reservation_id:r.reservation_id,operation_id:r.operation_id,disposition,owner:seat.outcome_owner,evidence_ref:'SYNTHETIC-independent-owner-final',evidence_sha256:hash('synthetic-final'),actual:{api,capacity:0,resource_cash:0}});
  const response=(cost,marker)=>({model:'typesafe/jev-1.13',answers:{next_action:{type:'choice',choice:'clarify',confidence:1,probabilities:{clarify:1,escalate:0}},context_sufficient:{type:'noul',noul:0.2},unresolved_material_uncertainty:{type:'noul',noul:0.9}},usage:{cost},SYNTHETIC_marker:marker});
  const plan=async(r)=>{const v=await ok('owned Jev SOURCE plan '+r.reservation_id,{operation:'plan_jev',reservation_id:r.reservation_id});return {replayed:v.replayed,record:Object.values(v.account.judgments).find(j=>j.reservation_id===r.reservation_id),account:v.account};};
  // P1A: all eight legal refs must not exclude an independently typed failure.
  const id='cf1:jev-order-full-refs';await intake(id);const r=req(id);await ok('accepted original reservation',{operation:'reserve',request:r});const p=await plan(r);
  for(let i=0;i<8;i++)await ok('original uncertainty '+i,{operation:'uncertain',reservation_id:r.reservation_id,evidence_ref:String(i)+'"'.repeat(255)});
  const before=await read(), failureBody={operation:'jev_failure',key:p.record.key,kind:'transport'};
  const f=await call('failure AFTER eight original refs','/v1/admission',failureBody);let after=await read();
  if(f.status!==200){assert.equal(f.status,409);assert.equal(f.value.code,'state_limit');assert.deepEqual(after,before);findings.push({id:'P1A',status:f.status,refusal:f.value,unchanged:true,before,after});}
  else{assert.equal(after.revision,before.revision+1);assert.equal(after.judgments[p.record.key].failure,'transport');assert.deepEqual(after.reservations[r.reservation_id].uncertain,before.reservations[r.reservation_id].uncertain);assert.equal((await ok('typed failure replay',{...failureBody})).replayed,true);}
  await stop();await boot(config);assert.deepEqual(await read(),after);
  const originalResponse=response(0,'original-after-uncertainty');await ok('original response AFTER eight refs/failure',{operation:'jev_response',key:p.record.key,response:originalResponse});await ok('settle original fixture usage',{operation:'reconcile',receipt:final(r)});
  if(f.status===200)assert.equal((await ok('failure replay AFTER response/final',failureBody)).replayed,true);
  // P1B: BOTH final dispositions first, then positive actual overrun (25 >20).
  for(const disposition of ['owner_final','proven_not_started']){
    const id='cf1:jev-order-'+disposition;await intake(id);const r=req(id);await ok('reserve late cost '+disposition,{operation:'reserve',request:r});const p=await plan(r), receipt=final(r,disposition);
    await ok('original zero final '+disposition,{operation:'reconcile',receipt});const observed=response(0.000025,'positive-overrun-'+disposition);await ok('late positive SYNTHETIC cost '+disposition,{operation:'jev_response',key:p.record.key,response:observed});
    const retained=await read();assert.deepEqual(retained.reservations[r.reservation_id].final_receipt,receipt);assert.deepEqual(retained.judgments[p.record.key].response,observed);
    const nextId='cf1:jev-order-cash-check-'+disposition;await intake(nextId);const next=req(nextId,'jev',100);const prior=await read();const admission=await call('cash MUST NOT be respent after late positive cost '+disposition,'/v1/admission',{operation:'reserve',request:next});
    if(admission.status===200){findings.push({id:'P1B',disposition,wrong_new_admission:admission.status,receipt,observed,account:admission.value.account});await ok('fixture cleanup of incorrectly accepted unsent reservation',{operation:'reconcile',receipt:final(next,'proven_not_started')});}
    else{assert.equal(admission.status,409);assert.equal(admission.value.code,'budget_unavailable');assert.deepEqual(await read(),prior);}
    assert.equal((await ok('original zero final replay remains immutable',{operation:'reconcile',receipt})).replayed,true);assert.equal((await ok('positive original response replay',{operation:'jev_response',key:p.record.key,response:observed})).replayed,true);
    const settled=await read();await stop();await boot(config);assert.deepEqual(await read(),settled);
  }
  // Response first: under-reporting final is rejected, original cost is retained.
  const firstId='cf1:jev-order-response-first';await intake(firstId);const rf=req(firstId);await ok('response-first reserve',{operation:'reserve',request:rf});const pf=await plan(rf), observed=response(0.00002,'response-first');await ok('positive response BEFORE final',{operation:'jev_response',key:pf.record.key,response:observed});const prior=await read();const low=await call('lower final cannot erase known actual cost','/v1/admission',{operation:'reconcile',receipt:final(rf)});assert.equal(low.status,409);assert.equal(low.value.code,'receipt_conflict');assert.deepEqual(await read(),prior);await ok('truthful independent final usage',{operation:'reconcile',receipt:final(rf,'owner_final',20)});
  // Missing cost is NOT zero, but independent owner-final can reconcile it.
  const missingId='cf1:jev-order-missing-cost';await intake(missingId);const rm=req(missingId,'jev',5);await ok('missing-cost reserve',{operation:'reserve',request:rm});const pm=await plan(rm);const missing={model:'typesafe/jev-1.13',usage:{},SYNTHETIC_marker:'missing NOT zero'};await ok('retain raw missing-cost response',{operation:'jev_response',key:pm.record.key,response:missing});const probeId='cf1:jev-order-unknown-probe';await intake(probeId);const unknown=await call('unknown cost before owner-final refuses','/v1/admission',{operation:'reserve',request:req(probeId,'jev',1)});assert.equal(unknown.status,409);assert.equal(unknown.value.code,'cost_unavailable');await ok('independent owner-final resolves actual missing cost',{operation:'reconcile',receipt:final(rm,'owner_final',5)});
  // P2: equal Seat VALUES do not make two owned operations the same decision.
  const aliasId='cf1:jev-order-alias';await intake(aliasId);const a=req(aliasId,'jev',5), b=req(aliasId,'jev-alias',5);await ok('alias operation A admitted',{operation:'reserve',request:a});await ok('alias operation B admitted',{operation:'reserve',request:b});const pa=await plan(a), pb=await plan(b);
  if(!pb.record){assert.equal(pb.replayed,true);findings.push({id:'P2',wrong_replayed:true,missing_reservation:b.reservation_id,returned_first_key:pa.record.key,account:pb.account});}
  else{assert.equal(pb.replayed,false);assert.notEqual(pa.record.key,pb.record.key);assert.equal(pb.record.request.state.operation.reservation_id,b.reservation_id);assert.equal(pb.record.request.state.operation.operation_id,b.operation_id);assert.equal(pb.record.request.state.operation.seat_id,b.seat_id);}
  const bkey=pb.record?.key??pa.record.key;await ok('failure on second plan key',{operation:'jev_failure',key:bkey,kind:'quota'});const bResponse=response(0.000001,'intended-only-for-B');await ok('response on second plan key',{operation:'jev_response',key:bkey,response:bResponse});after=await read();
  if(!pb.record)findings.at(-1).wrong_attribution=after.judgments[pa.record.key];else{assert.equal(after.judgments[pa.record.key].failure,null);assert.equal(after.judgments[pa.record.key].response,null);assert.deepEqual(after.judgments[bkey].response,bResponse);assert.equal(after.judgments[bkey].failure,'quota');assert.equal((await plan(a)).replayed,true);assert.equal((await plan(b)).replayed,true);}
  await stop();await boot(config);assert.deepEqual(await read(),after);
  for(const[id,status]of Object.entries(runs)){const v=await call('unchanged queued managed run '+id,`/v1/runs/${id}/status`);assert.equal(v.status,200);assert.deepEqual(v.value,status);}
  await writeFile(resolve(scratch,'jev-order-http.json'),JSON.stringify({fixture_only:true,provider_execution:false,findings,receipts},null,2));await writeFile(resolve(scratch,'jev-order-retained.json'),JSON.stringify(after));
  await stop();await boot();assert.equal(findings.length,0,'accepted outcomes lost / positive actual cash respent / cross-reservation alias: '+findings.map(f=>f.id).join(','));t.diagnostic('Jev order: failure after8 original refs, positive observed cash after both final forms/overrun, response-first lower-final refusal, missing-cost independent reconciliation, distinct equal-seat operation caches and exact replay/restart. ALL allocations/cost/responses SYNTHETIC; no inference/native/provider execution.');
}
