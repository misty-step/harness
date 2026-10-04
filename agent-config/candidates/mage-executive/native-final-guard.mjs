// Minimal public NativeModelRuntime/provider callback boundary. No auth/token
// extraction, custom endpoint, second model loop or stock AgentSession.
import { createHash } from 'node:crypto';
import { zstdDecompressSync } from 'node:zlib';
import { canonical, digest } from './durable.mjs';
const URL = 'https://chatgpt.com/backend-api/codex/responses';
export const MAX_BODY = 96 * 1024;
const assert=(value,reason)=>{if(!value)throw new Error(reason);};
export const accountRef = value=>'acct-'+createHash('sha256').update('ai-usage:'+value).digest('hex').slice(0,10);
const modelAllowed=m=>m?.provider==='openai-codex'&&m.id==='gpt-6.1-sol'&&m.api==='openai-codex-responses';

function finalBody(init) {
  const encoding=new Headers(init.headers).get('content-encoding');
  let bytes;
  if(typeof init.body==='string')bytes=Buffer.from(init.body,'utf8');
  else if(init.body instanceof Uint8Array)bytes=Buffer.from(init.body);
  else throw new Error('native_final_body_unavailable');
  assert(bytes.length<=MAX_BODY+1024,'native_wire_body_exceeds_bound');
  if(encoding==='zstd')bytes=zstdDecompressSync(bytes,{maxOutputLength:MAX_BODY+1});
  else assert(encoding===null,'native_body_encoding_unsupported');
  assert(bytes.length<=MAX_BODY,'native_final_body_exceeds_96KiB');
  const body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  return {body,bytes,wire:typeof init.body==='string'?init.body:new Uint8Array(init.body)};
}
function physical(body, expectedTools) {
  assert(body?.model==='gpt-6.1-sol'&&body.reasoning?.effort==='xhigh','native_physical_model_or_effort_refused');
  assert(canonical(body.tools??[])===canonical(expectedTools),'native_physical_tool_schema_refused');
}

/** contextFor is an owned native-document read, not model/caller metadata.
 * admit is the Rust final-request policy + fresh quota reader + durable counter.
 * fetch is captured from the owner transport; request options cannot replace it.
 */
export function installNativeFinalGuard(native,{contextFor,admit,toolsApi,fetch=globalThis.fetch}) {
  assert(typeof contextFor==='function'&&typeof admit==='function','native_final_admission_capabilities_required');
  const provider=native.getProvider('openai-codex');
  assert(provider && provider.auth?.oauth?.isSubscription===true,'unsupported_native_subscription_provider');
  const authAllowed=()=>native.getProviderAuthStatus('openai-codex')?.source==='stored'&&native.isUsingOAuth('openai-codex')&&native.isUsingSubscription('openai-codex');
  assert(authAllowed(),'native_stored_oauth_source_required');
  const bound=(model,context,options={})=>{
    assert(modelAllowed(model),'native_model_route_refused');
    let prepared,expectedPhysicalTools;
    return {...options,transport:'sse',maxRetries:0,deferred:false,
      onPayload:async(payload,target)=>{
        assert(modelAllowed(target)&&authAllowed(),'native_route_or_auth_source_changed');
        prepared=await contextFor(options.sessionId);
        assert(prepared && typeof prepared.input_id==='string' && prepared.tools.length>0,'native_original_input_binding_required');
        const offered=toolsApi.getCurrentTools(context.messages).slice().sort((a,b)=>a.name.localeCompare(b.name));
        const expected=prepared.tools.slice().sort((a,b)=>a.name.localeCompare(b.name));
        assert(offered.length===expected.length&&offered.every((t,i)=>toolsApi.declarationsEqual(t,expected[i])),'native_stage_tool_offer_refused');
        const names=expected.map(t=>t.name);
        const raw=payload?.tools??[];
        assert(Array.isArray(raw)&&raw.length===names.length&&raw.every(t=>t.type==='function'&&names.includes(t.name))&&new Set(raw.map(t=>t.name)).size===names.length,'native_unsupported_or_missing_physical_tools');
        expectedPhysicalTools=JSON.parse(canonical(raw)); // before caller mutation
        const changed=await options.onPayload?.(payload,target);
        const body=changed===undefined?payload:changed;
        physical(body,expectedPhysicalTools);
        assert(Buffer.byteLength(JSON.stringify(body),'utf8')<=MAX_BODY,'native_postcallback_body_exceeds_96KiB');
        return body;
      },
      fetch:async(input,init)=>{
        assert((typeof input==='string'||input instanceof globalThis.URL)&&String(input)===URL&&init?.method==='POST'&&!init.signal?.aborted,'native_final_transport_refused');
        assert(prepared&&authAllowed(),'native_unprepared_or_changed_auth_source');
        // Copy final native OAuth headers/body before any asynchronous reader.
        // Authorization stays opaque and is forwarded only to the ORIGINAL sink.
        const headers=new Headers(init.headers),account=headers.get('chatgpt-account-id');
        assert(account,'native_final_account_header_missing');
        const decoded=finalBody({...init,headers});physical(decoded.body,expectedPhysicalTools);
        const current=await contextFor(options.sessionId);
        assert(digest(current)===digest(prepared),'native_input_or_loadout_changed_at_final_fetch');
        assert(!init.signal?.aborted,'native_request_aborted_before_admission');
        await admit({instance:prepared.instance,input_id:prepared.input_id,input_class:prepared.input_class,account_ref:accountRef(account),body_sha256:createHash('sha256').update(decoded.bytes).digest('hex'),body_bytes:decoded.bytes.length,tools:prepared.tools.map(t=>t.name).sort()},init.signal);
        assert(!init.signal?.aborted&&authAllowed(),'native_request_aborted_or_auth_changed_after_admission');
        assert(digest(await contextFor(options.sessionId))===digest(prepared),'native_input_or_loadout_changed_after_admission');
        return fetch(input,{...init,headers,body:decoded.wire});
      },
    };
  };
  // SAME provider/auth/catalog and its ORIGINAL request conversion/streaming.
  // Both entrypoints are guarded; deferred/image/classifier bypasses removed.
  const guarded={...provider,
    stream:(model,context,options)=>provider.stream(model,context,bound(model,context,options)),
    streamSimple:(model,context,options)=>provider.streamSimple(model,context,bound(model,context,options)),
    fetchDeferred:undefined,cancelDeferred:undefined,generateImages:undefined,classify:undefined,
  };
  native.registerNativeProvider(guarded);
  return {provider:guarded,output_token_bound:'not proven',transport:'sse',retry_budget:0};
}
