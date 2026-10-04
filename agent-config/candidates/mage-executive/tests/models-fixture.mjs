// Offline LOCAL transport-lifecycle fixture, not native auth/admission proof.
import { getCurrentTools, registerSessionResourceCleanup, createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux';
globalThis.fetch=async()=>new Response('fixture transport',{status:200});
export class ModelRuntime {
 static async create() {
  let resource;
  registerSessionResourceCleanup(()=>{if(resource){clearInterval(resource);resource=undefined;}});
  const model={provider:'openai-codex',id:'gpt-6.1-sol',api:'openai-codex-responses',contextWindow:100000,maxTokens:1000,reasoning:true,cost:{input:0,output:0,cacheRead:0,cacheWrite:0},input:['text']};
  const stream=(m,context,options)=>{
   const result=createAssistantMessageEventStream();
   void(async()=>{
    let output={...fauxAssistantMessage('Offline lifecycle response.'),provider:m.provider,model:m.id,api:m.api};
    try{
     let body={model:m.id,reasoning:{effort:options.reasoning??options.reasoningEffort},tools:getCurrentTools(context.messages).map(t=>({type:'function',name:t.name,description:t.description,parameters:t.parameters}))};
     body=(await options.onPayload?.(body,m))??body;
     resource??=setInterval(()=>{},1000);
     await options.fetch('https://chatgpt.com/backend-api/codex/responses',{method:'POST',headers:{'chatgpt-account-id':'lifecycle-fixture'},body:JSON.stringify(body),signal:options.signal??new AbortController().signal});
     result.push({type:'done',reason:'stop',message:output});
    }catch(error){output={...output,stopReason:'error',errorMessage:String(error)};result.push({type:'error',reason:'error',error:output});}
    result.end();
   })();
   return result;
  };
  let provider={id:'openai-codex',auth:{oauth:{isSubscription:true}},getModels:()=>[model],stream,streamSimple:stream};
  return {isUsingSubscription:()=>true,isUsingOAuth:()=>true,getProviderAuthStatus:()=>({source:'stored'}),getProvider:()=>provider,registerNativeProvider:p=>{provider=p;},getModel:()=>model,streamSimple:(m,c,o)=>provider.streamSimple(m,c,o)};
 }
}
