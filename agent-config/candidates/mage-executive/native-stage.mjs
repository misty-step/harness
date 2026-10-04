// Read/internal-commission/report-only LOCAL staging loadout on the SAME
// Pi Durable conversations. Fresh handoff required; f749 histories stay intact.
import { defineDoc, defineDocFamily, ProviderDoc, LiveDoc } from '@earendil-works/pi-durable';
import { BACKGROUND_CONTEXT as ctx } from '@earendil-works/chord/context';
import { digest } from './durable.mjs';
const Stage = defineDoc({kind:'mage.native-staging',version:1,scope:'session',initial:()=>({sha256:''}),checkpointWhen:()=>true});
// Read the original Mage-owned commission document, never a parallel registry.
const Commission = defineDocFamily({kind:'mage.commission',version:1,family:true,scope:'conversation',history:'latest',fork:'initial',initial:()=>({}),checkpointWhen:()=>true});
export const stageTools=role=>['mage_context_search','mage_factory_read','mage_memory_recall','mage_memory_write','mage_skill_read',...(role==='coo'?['mage_delegate']:[])].sort();
const requireValue=(v,reason)=>{if(!v)throw new Error(reason);};
export async function nativeStageContext(harness,binding,config) {
  const policy=config.native_staging;
  requireValue(policy,'native_staging_admission_required: inspection only');
  requireValue((config.integrations??[]).length===0&&(config.grants??[]).length===0,'native_stage_has_no_external_authority');
  const policyHash=digest({policy,instances:config.instances});
  const old=await harness.snapshot(Stage,ctx);
  requireValue(!old?.sha256||old.sha256===policyHash,'native_stage_changed_requires_new_handoff');
  const conversations=new Map(),sessions=new Map();
  for(const instance of config.instances) {
    const c=await harness.conversation(binding.instances[instance.id],ctx);
    const expected=stageTools(instance.role),agent=await c.agent(ctx);
    if(!old?.sha256) {
      requireValue((await c.entries({},1,undefined,ctx)).items.length===0,'native_stage_requires_fresh_conversation_not_old_observations');
      const tools=agent.tools.filter(t=>expected.includes(t.name));
      requireValue(tools.length===expected.length,'native_stage_tools_unavailable');
      await c.configure({tools},ctx);
    }
    const active=await c.agent(ctx);
    requireValue(JSON.stringify(active.tools.map(t=>t.name).sort())===JSON.stringify(expected),'native_stage_loadout_changed');
    requireValue(active.model?.provider==='openai-codex'&&active.model.modelId==='gpt-6.1-sol'&&active.thinkingLevel==='xhigh','native_stage_route_changed');
    const provider=await harness.snapshot(ProviderDoc,c.id,ctx);
    requireValue(provider?.sessionId&&!sessions.has(provider.sessionId),'native_stage_provider_affinity_missing_or_shared');
    conversations.set(instance.role,{instance,c});sessions.set(provider.sessionId,{instance,c});
  }
  await harness.commit(async tx=>{(await tx.doc(Stage)).sha256=policyHash;},ctx);
  return async sessionId=>{
    const bound=sessions.get(sessionId);requireValue(bound,'native_unbound_provider_session');
    const {instance,c}=bound,live=await harness.snapshot(LiveDoc,c.id,ctx);
    requireValue(live?.run?.inputs.length===1,'native_staging_requires_one_original_input');
    const s=await harness.submission(live.run.inputs[0],ctx),record=await s.status(ctx);
    requireValue(record.status==='placed'&&record.conversationId===c.id&&record.requestId,'native_original_input_receipt_missing');
    let inputClass;
    if(instance.role==='coo'&&record.requestId===policy.coo_input_id) inputClass='coo_input';
    else {
      const coo=conversations.get('coo'),cto=conversations.get('cto');
      const commission=await harness.snapshot(Commission,coo.c.id,policy.commission_id,ctx);
      requireValue(commission?.task_id,'native_original_commission_receipt_missing');
      const reporter=await harness.getTask(commission.task_id,ctx);
      requireValue(reporter?.kind==='mage.commission-reporter'&&reporter.conversationId===coo.c.id&&reporter.input?.commission_id===policy.commission_id&&reporter.input?.target===cto.c.id,'native_original_reporter_binding_changed');
      if(instance.role==='cto'&&record.requestId===`mage-commission:${policy.commission_id}`) inputClass='cto_commission';
      else if(instance.role==='coo'&&record.requestId===`mage-report:${commission.task_id}`) inputClass='coo_wake';
      else throw new Error('native_input_not_in_three_input_stage');
    }
    const agent=await c.agent(ctx);
    requireValue(agent.model?.provider==='openai-codex'&&agent.model.modelId==='gpt-6.1-sol'&&agent.thinkingLevel==='xhigh'&&JSON.stringify(agent.tools.map(t=>t.name).sort())===JSON.stringify(stageTools(instance.role)),'native_final_stage_loadout_or_route_changed');
    return {instance:instance.id,input_id:record.requestId,input_class:inputClass,tools:agent.tools};
  };
}
