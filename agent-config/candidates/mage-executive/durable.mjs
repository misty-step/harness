// The unavoidable Pi Durable SDK boundary. No stock Pi agent/session loop.
import { createHash } from 'node:crypto';
import { Type } from '@earendil-works/pi-ai';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { configure, defineDoc, defineDocFamily, defineExtension, defineTask, defineTool, section, LiveDoc, InboxDoc } from '@earendil-works/pi-durable';

export const canonical = value => JSON.stringify(value, (_key, v) => v && !Array.isArray(v) && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
export const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
const context = BACKGROUND_CONTEXT;
const ensure = (condition, reason) => { if (!condition) throw new Error(reason); };
const text = message => typeof message?.content === 'string' ? message.content : (message?.content ?? []).filter(p => p.type === 'text').map(p => p.text).join('');
const Index = defineDoc({ kind:'mage.instances',version:1,scope:'session',initial:()=>({instances:{}}),checkpointWhen:()=>true });
const Binding = defineDoc({ kind:'mage.binding',version:1,scope:'conversation',history:'latest',fork:'initial',initial:()=>({instance:'',role:'',config_sha256:''}),checkpointWhen:()=>true });
// Native delivery identity guard: upstream requestId dedup does NOT check text.
const Input = defineDocFamily({ kind:'mage.input',version:1,family:true,scope:'conversation',history:'latest',fork:'initial',initial:seed=>seed,checkpointWhen:()=>true });
const Commissions = defineDocFamily({ kind:'mage.commission',version:1,family:true,scope:'conversation',history:'latest',fork:'initial',initial:seed=>seed,checkpointWhen:()=>true });

/** Register the executive behavior into Summon's SHARED durable registry.
 * The supplied broker/host owns actual admission, authenticated ports and effects.
 * Neither this extension nor its reporter task owns a commissioned engineer run.
 */
export function installMage(registry, { config, broker }) {
  ensure(typeof broker==='function','executive broker capability must be supplied by the shared host');
  ensure(config.schema === 'mage-executive/1','unsupported executive schema');
  ensure(config.instances.length===2 && config.instances.filter(i=>i.role==='coo').length===1 && config.instances.filter(i=>i.role==='cto').length===1,'one COO and one CTO required');
  const extensions = new Map();
  let attached;
  const instanceFor = async (api, expected, ctx) => {
    const binding = await api.snapshot(Binding,api.conversationId,ctx);
    ensure(binding?.instance===expected.id && binding.role===expected.role && binding.config_sha256===digest(expected),'wrong_role_capability_refused');
  };
  const guard = async (conversation, input, ctx, writer=conversation) => {
    ensure(typeof input.requestId==='string' && input.requestId.length>0 && input.requestId.length<=256,'stable original input ID required');
    const hash = digest(input);
    await writer.commit(async tx=>{
      // Read native facts first, including f764 internal deliveries that predate
      // this shared guard. Never bind a new hash over a different existing input.
      const prior=await tx.submissionByRequest(conversation.id,input.requestId);
      let proven=!prior;
      if(prior) {
        ensure(prior.type==='input','input_identity_conflict');
        if(prior.entry!==undefined) {
          const entry=await tx.entry(prior.entry);
          const message=entry?.model?.[0];
          ensure(message?.role==='user' && text(message)===input.content,'input_identity_conflict');
          proven=true;
        } else if(prior.status==='queued') {
          const item=(await tx.doc(InboxDoc,conversation.id)).items.find(i=>i.id===prior.id);
          ensure(item && item.content===input.content && item.mode===input.whenBusy,'input_identity_conflict');
          proven=true;
        }
      }
      const saved = await tx.doc(Input,conversation.id,input.requestId,{sha256:null});
      ensure(saved.sha256===null || saved.sha256===hash,'input_identity_conflict');
      if(saved.sha256===null) {
        ensure(proven,'input_identity_unverifiable: original native payload unavailable');
        saved.sha256=hash;
      }
    },ctx);
    return conversation.submit(input,ctx);
  };
  const Reporter = defineTask({
    name:'mage.commission-reporter',version:1,initial:()=>({phase:'deliver'}),
    phases:{
      deliver:async(task,runtime,ctx)=>{
        const target = await runtime.conversation(task.input.target,ctx);
        ensure(target,'executive target unavailable');
        // Invocation-bound handles submit; the task runtime supplies the SAME
        // guard's commit. Identity validation stays outside native admission.
        const delivered = await guard(target,{type:'input',content:task.input.text,requestId:`mage-commission:${task.input.commission_id}`,whenBusy:'followUp'},ctx,runtime);
        const result = await delivered.wait(ctx);
        let report;
        if (result.status==='done' && result.type==='input') {
          const entry = await runtime.entry(result.answer,ctx);
          report={commission_id:task.input.commission_id,target:task.input.target,submission:result,answer_entry:result.answer,text:text(entry?.model?.[0]),acceptance:'not_verified'};
        } else report={commission_id:task.input.commission_id,target:task.input.target,submission:result,acceptance:'not_verified'};
        await runtime.commit(()=>({status:'running',checkpoint:{phase:'report',report}}),ctx);
      },
      report:async(task,runtime,ctx)=>{
        const parent = await runtime.conversation(runtime.conversationId,ctx);
        ensure(parent,'executive reporter parent unavailable');
        await guard(parent,{type:'input',content:`CTO execution report (independent acceptance still required):\n${JSON.stringify(task.state.checkpoint.report)}`,requestId:`mage-report:${task.id}`,whenBusy:'followUp'},ctx,runtime);
        await runtime.commit(()=>({status:'terminal',outcome:{status:'completed',result:task.state.checkpoint.report}}),ctx);
      },
    },
    abort:(_task,runtime,ctx)=>runtime.commit(()=>({status:'terminal',outcome:{status:'aborted'}}),ctx),
  });
  // A separate extension carries task code so a host can always reinstall it;
  // permission hooks selected by a role are never the sole enforcement boundary.
  registry.install(defineExtension({name:'mage-runtime',tasks:[Reporter]}));
  for (const instance of config.instances) {
    const tools=[];
    const add = (capability,description,parameters,replay='safe') => {
      tools.push(defineTool({name:`mage_${capability}`,description,parameters,replay,execute:async(args,api,ctx)=>{
        await instanceFor(api,instance,ctx);
        const result = await broker({instance:instance.id,capability,operation_id:args.operation_id ?? `native:${api.taskId}`,arguments:args.arguments ?? args,grant_id:args.grant_id ?? null},ctx.abortSignal);
        return {content:[{type:'text',text:JSON.stringify(result)}],details:result};
      }}));
    };
    add('memory_recall','Recall this role’s source-backed notes. Memory is not authority.',Type.Object({query:Type.String({maxLength:256})},{additionalProperties:false}));
    add('memory_write','Save/correct one note with source and expected revision.',Type.Object({operation_id:Type.String(),arguments:Type.Object({key:Type.String(),expected_revision:Type.Integer({minimum:0}),text:Type.String({maxLength:8192}),source:Type.String()},{additionalProperties:false})},{additionalProperties:false}));
    add('skill_read','Load one skill body selected for this role.',Type.Object({name:Type.String()},{additionalProperties:false}));
    add('factory_read','Read Summon’s canonical status/view/packet/authority; no local phase copy.',Type.Object({run:Type.String(),endpoint:Type.Union(['status','view','packet','authority'].map(v=>Type.Literal(v)))},{additionalProperties:false}));
    const external=(capability,description)=>add(capability,description,Type.Object({operation_id:Type.String(),arguments:Type.Unknown(),grant_id:Type.Optional(Type.String())},{additionalProperties:false}),'unsafe');
    if (instance.role==='cto') {
      for (const capability of ['factory_intake','factory_steer','factory_cancel']) external(capability,'Submit original canonical Summon command once; unknown acceptance holds, no automatic resend.');
    }
    const ports=instance.role==='coo' ? ['schedule_read','schedule_request','schedule_cancel','mail_read','mail_send','voice_speak','glass_read','glass_write'] : ['glass_read'];
    for (const cap of ports) if ((config.integrations??[]).some(i=>i.capability===cap)) external(cap,'Use the existing owner-bound integration. Effects require an exact external authority grant; role instructions cannot authorize them.');
    tools.push(defineTool({name:'mage_context_search',description:'Search this conversation’s original stored messages, including pre-compaction history; source entry IDs retained.',parameters:Type.Object({query:Type.String({maxLength:256})},{additionalProperties:false}),replay:'safe',execute:async(args,api,ctx)=>{
      await instanceFor(api,instance,ctx);
      // The host read is conversation-bound; no model-supplied conversation ID.
      const c=await attached.harness.conversation(api.conversationId,ctx);
      let cursor; const hits=[]; let scanned=0;
      do { const page=await c.entries({},100,cursor,ctx); for(const entry of page.items) { scanned++; const t=entry.model?.map(text).join('\n')??''; if(t.toLowerCase().includes(args.query.toLowerCase()) && hits.length<10) hits.push({entry_id:entry.id,kind:entry.kind,text:t.slice(0,4096)}); } cursor=page.next; } while(cursor && scanned<1000 && hits.length<10);
      const result={instance:instance.id,hits,scanned,more:cursor!==undefined};
      return {content:[{type:'text',text:JSON.stringify(result)}],details:result};
    }}));
    if(instance.role==='coo') tools.push(defineTool({name:'mage_delegate',description:'Commission the separate persisted CTO in the background. Returns a durable receipt immediately; completion wakes this COO. It does not start an engineer or grant external authority.',parameters:Type.Object({commission_id:Type.String({maxLength:128}),text:Type.String({maxLength:65536})},{additionalProperties:false}),replay:'safe',execute:async(args,api,ctx)=>{
      await instanceFor(api,instance,ctx);
      const target=config.instances.find(i=>i.role==='cto');
      const targetId=attached.instances[target.id];
      const payload={commission_id:args.commission_id,text:args.text,target:targetId};
      const hash=digest(payload);
      const taskId=await api.commit(async tx=>{
        const saved=await tx.doc(Commissions,api.conversationId,args.commission_id,{sha256:hash});
        ensure(saved.sha256===hash,'commission_identity_conflict');
        if(saved.task_id!==undefined) return saved.task_id;
        const id=await tx.createTask(Reporter,payload,{ownership:{kind:'conversation'},background:true});
        saved.task_id=id; return id;
      },ctx);
      const result={commission_id:args.commission_id,reporter_task:taskId,target_instance:target.id,target_conversation:targetId,acceptance:'not_verified'};
      return {content:[{type:'text',text:JSON.stringify(result)}],details:result};
    }}));
    const extension=defineExtension({name:`mage-${instance.id}`,tools,sections:[
      section('role',()=>`Executive instance ${instance.id}; role ${instance.role}. Commissioned engineer run facts belong only to Summon. Decisions/commitments belong to Glass. A settled answer is not independent acceptance.`,{tag:false}),
      section('skills',()=>instance.skills.map(s=>`${s.name}: ${s.description}`).join('\n')||undefined),
    ]});
    registry.install(extension); extensions.set(instance.id,extension);
  }
  return {
    async attach(harness,ctx=context) {
      ensure(!attached,'Mage already attached to an open host');
      const instances=await harness.commit(async tx=>{
        const index=await tx.doc(Index);
        const result={};
        for(const instance of config.instances) {
          let found=index.instances[instance.id];
          const hash=digest(instance);
          if(found) { ensure(found.config_sha256===hash,'instance_config_changed: negotiated handoff required'); }
          else {
            const c=await tx.createConversation({ownership:{kind:'ownerless'}});
            const ext=extensions.get(instance.id);
            await configure(tx,c.id,{model:{provider:instance.provider,modelId:instance.model},thinkingLevel:instance.thinking,extensions:[ext],tools:ext.tools,instructions:instance.instructions});
            Object.assign(await tx.doc(Binding,c.id),{instance:instance.id,role:instance.role,config_sha256:hash});
            found={conversation_id:c.id,config_sha256:hash}; index.instances[instance.id]=found;
          }
          result[instance.id]=found.conversation_id;
        }
        return result;
      },ctx);
      const inspection=await harness.inspect(ctx);
      const recoveryHolds=inspection.tasks.filter(t=>t.record.state.status==='pending' && ((t.record.kind==='pi.generation' && ['request','poll'].includes(t.record.state.checkpoint.phase)) || (t.record.kind==='pi.compaction' && t.record.state.checkpoint.phase==='summarize'))).map(t=>({task_id:t.record.id,conversation_id:t.record.conversationId,phase:t.record.state.checkpoint.phase,reason:'possibly_sent_provider_request'}));
      attached={harness,instances,recoveryHolds};
      return attached;
    },
    assertProgress() {
      ensure(attached,'Mage not attached');
      ensure(attached.recoveryHolds.length===0,`provider_recovery_hold: ${JSON.stringify(attached.recoveryHolds)}; host/provider owner must reconcile before any resume/progress call`);
    },
    async command(request,ctx=context) {
      ensure(attached,'Mage not attached');
      const instance=config.instances.find(i=>i.id===request.instance);
      ensure(instance,'unknown executive instance');
      const c=await attached.harness.conversation(attached.instances[instance.id],ctx);
      if(['submit','steer','completion','wait','cancel','compact'].includes(request.action)) this.assertProgress();
      const original=async()=>{
        ensure(typeof request.input_id==='string','original input identity required');
        const record=await attached.harness.commit(tx=>tx.submissionByRequest(c.id,request.input_id),ctx);
        ensure(record,'original input unknown'); return attached.harness.submission(record.id,ctx);
      };
      switch(request.action) {
        case 'submit': case 'steer': case 'completion': {
          ensure(typeof request.text==='string' && request.text.length<=65536,'bounded input text required');
          const input={type:'input',content:request.text,requestId:request.input_id,whenBusy:request.action==='steer'?'steer':'followUp'};
          const s=await guard(c,input,ctx); return {instance:instance.id,conversation:c.id,submission:await s.status(ctx)};
        }
        case 'status': return {instance:instance.id,conversation:c.id,submission:await (await original()).status(ctx)};
        case 'wait': {
          const s=await original(); const result=await s.wait(ctx);
          const answer=result.status==='done'&&result.type==='input' ? await attached.harness.commit(tx=>tx.entry(result.answer),ctx) : undefined;
          return {instance:instance.id,conversation:c.id,submission:result,answer,acceptance:'not_verified'};
        }
        case 'cancel': {
          const s=await original(); const state=await s.status(ctx);
          if(state.status==='queued') return {withdrawal:await s.abort(ctx),submission:await s.status(ctx)};
          const live=await attached.harness.snapshot(LiveDoc,c.id,ctx);
          // Original submission membership, not elapsed lease/last-seen state.
          // A duplicate cancel can never abort a later run on this conversation.
          if(live?.run?.inputs.includes(s.id)) await c.abort(ctx);
          return {submission:await s.status(ctx),cancelled_original:s.id};
        }
        case 'capabilities': { const agent=await c.agent(ctx); return {instance:instance.id,role:instance.role,conversation:c.id,config_sha256:digest(instance),model:agent.model,thinking:agent.thinkingLevel,tools:agent.tools.map(t=>t.name),skills:instance.skills.map(s=>({name:s.name,description:s.description}))}; }
        case 'view': { const v=await c.viewState(ctx); try{return {instance:instance.id,view:v.value};}finally{v.dispose();} }
        case 'tasks': { const inspection=await attached.harness.inspect(ctx); return {instance:instance.id,recovery_holds:attached.recoveryHolds,tasks:inspection.tasks.filter(t=>t.record.conversationId===c.id),submissions:inspection.submissions.filter(s=>s.conversationId===c.id)}; }
        case 'recall': return broker({instance:instance.id,capability:'memory_recall',operation_id:'host-recall',arguments:{query:request.query??''},grant_id:null},ctx.abortSignal);
        case 'compact': return {task_id:await c.compact(request.instructions,ctx),acceptance:'not_verified'};
        default: throw new Error('unsupported executive command');
      }
    },
  };
}
