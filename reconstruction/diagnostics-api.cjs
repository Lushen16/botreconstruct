'use strict';

// Diagnostics-only surface for the reconstruction menu.
//
// It is deliberately kept out of `renderer-api.cjs` so the recovered `pka`
// namespace stays exactly the original contract. The preload exposes it as the
// separate global `pkaDiag`, and only when the app runs in diagnostics mode
// (CLI `--pka-diagnostics` or env `PKA_DIAGNOSTICS=1`). The main process only
// registers its handler in the same mode, so it does not exist in a normal run.
//
// `simulate` starts the local simulation runtime, which is a diagnostic aid: it
// never talks to the game and must not be read as proof the bot works in-game.

function diagnosticsEnabled(env = {}, argv = []) {
  return Array.isArray(argv) && argv.includes('--pka-diagnostics')
    || Boolean(env) && env.PKA_DIAGNOSTICS === '1';
}

function createDiagnosticApis(transport) {
  const pkaDiag = {
    simulate: (enabled, options) => transport.invoke('pka-diag:simulate', enabled === true,
      options && typeof options === 'object' ? options : undefined),
    status: () => transport.invoke('pka-diag:status'),
  };
  return { pkaDiag };
}

module.exports = { createDiagnosticApis, diagnosticsEnabled };
