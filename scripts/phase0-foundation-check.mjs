import { loadConfig } from '../src/config.mjs';
import {
  buildRuntimeStatePacket,
  validateCanonicalRuntimeState
} from '../src/core/runtime-state-contract.mjs';
import { buildConfigParityReport } from '../src/core/config-parity-check.mjs';

function printSection(title, payload) {
  console.log(`\n=== ${title} ===`);
  console.log(JSON.stringify(payload, null, 2));
}

async function main() {
  const config = loadConfig();

  const runtimeState = buildRuntimeStatePacket({
    sessionId: 'phase0-bootstrap',
    goal: 'Establish Phase 0 runtime foundations',
    phase: 'phase0',
    nextAction: 'Run parity and contract checks',
    verifiedObservations: ['config loaded'],
    permissions: {
      shell: Boolean(config.runtime?.shellEnabled),
      network: true,
      browser: Boolean(config.browser),
      fileWrite: true
    },
    blockers: [],
    activeArtifacts: ['docs/PHASE0_EXECUTION_PLAN.md']
  });

  const stateValidation = validateCanonicalRuntimeState(runtimeState.state);
  const parity = buildConfigParityReport(config, process.env);

  printSection('runtime_state_validation', stateValidation);
  printSection('config_parity_report', parity);

  if (!stateValidation.ok || !parity.ok) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('phase0-foundation-check failed:', err?.stack || err?.message || String(err));
  process.exit(1);
});
