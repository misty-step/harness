// Offline fixture for the LOCAL Models transport lifecycle, never native auth.
import { createModels } from '@earendil-works/pi-ai/models';
import { registerSessionResourceCleanup } from '@earendil-works/pi-ai';
import { fauxProvider, fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux';
globalThis.fetch=async()=>{throw new Error('lifecycle fixture cannot use network');};
export class ModelRuntime {
  static async create() {
    const models=createModels();const faux=fauxProvider();models.setProvider(faux.provider);
    faux.setResponses(Array.from({length:10},()=>fauxAssistantMessage('Offline lifecycle response.')));
    let resource;
    registerSessionResourceCleanup(()=>{if(resource){clearInterval(resource);resource=undefined;}});
    const physical=models.getModel('faux','faux-1');
    return {
      isUsingSubscription:()=>true, // fixture only; NOT an entitlement receipt
      getModel:()=>({...physical,provider:'openai-codex',id:'gpt-6.1-sol'}),
      streamSimple(_model,request,options) {
        // Simulates the actual registered native provider socket keeping Node
        // alive after Harness.close. Only the supported cleanup releases it.
        resource??=setInterval(()=>{},1000);
        return models.streamSimple(physical,request,options);
      },
    };
  }
}
