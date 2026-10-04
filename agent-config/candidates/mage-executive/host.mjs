// Portable composition with pi-durable-cloud/src/host.ts RuntimeInstallation.
// The same Harness owns every checkpoint. No extra executor or scheduler here.
import { createRegistry, defineDoc } from '@earendil-works/pi-durable';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { installMage, digest } from './durable.mjs';
const Scope = defineDoc({kind:'mage.host-scope',version:1,scope:'session',initial:()=>({sha256:''}),checkpointWhen:()=>true});

export function createMageInstallation(scope, hostCapabilities) {
  if(scope.kind!=='executive' || scope.run!==undefined) throw new Error('executive_scope_required: engineer runs remain Summon-owned');
  if(!hostCapabilities.models || typeof hostCapabilities.broker!=='function') throw new Error('supported_model_and_broker_admission_required');
  const registry=createRegistry();
  const mage=installMage(registry,hostCapabilities);
  let currentHarness;
  return {
    options:{
      registry,models:hostCapabilities.models,
      // No ambient filesystem/cwd, coding tools or native credentials on Workers.
      settings:{retry:{enabled:false},stream:{maxRetries:0},compaction:{enabled:false,backgroundTokens:0},toolExecution:'sequential'},
    },
    async attach(harness) {
      const hash=digest(scope);
      await harness.commit(async tx=>{
        const saved=await tx.doc(Scope);
        if(saved.sha256 && saved.sha256!==hash) throw new Error('executive_host_scope_changed');
        saved.sha256=hash;
      },BACKGROUND_CONTEXT);
      await mage.attach(harness,BACKGROUND_CONTEXT);
      currentHarness=harness;
    },
    // Mage reporter has no calendar/retry deadline of its own. Native waiting/
    // live-task checkpoints and the cloud host own engine wake mechanics.
    deadline:()=>undefined,
    /** Call only inside the authenticated host's read/execute boundary. Principal
     * to instance mapping and model/effect admission are mandatory host facts,
     * not another model-supplied JSON field. */
    async command(harness, request, context=BACKGROUND_CONTEXT) {
      if(currentHarness!==harness) throw new Error('stale_executive_handle_after_reopen');
      return mage.command(request,context);
    },
    assertProgress:()=>mage.assertProgress(),
  };
}
