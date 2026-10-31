'use strict';

// Adds the diagnostics-only "Simulação" toggle to the reconstruction menu. The
// toggle starts a local synthetic client (reconstruction/local-runtime.cjs) so
// every module can be driven without the game. It is exposed on the separate
// `pkaDiag` surface and only exists when the app runs in diagnostics mode; the
// recovered `pka` namespace is untouched. No command leaves this machine.
(function () {
  const diag = window.pkaDiag;
  if (!diag || typeof diag.simulate !== 'function') return;
  const anchor = document.getElementById('pause-all');
  if (!anchor || !anchor.parentNode) return;

  const button = document.createElement('button');
  button.id = 'sim-mode';
  button.type = 'button';
  button.className = 'subtle';
  button.title = 'Modo diagnóstico: liga um cliente simulado para exercitar os módulos sem o jogo. '
    + 'Não é funcionamento no jogo; os comandos não saem desta máquina.';
  let enabled = false;

  function paint() {
    button.textContent = enabled ? 'Simulação ligada' : 'Simulação desligada';
    button.classList.toggle('primary', enabled);
    button.setAttribute('aria-pressed', String(enabled));
  }

  function notify(error) {
    const notice = document.getElementById('notice');
    const text = document.getElementById('notice-text');
    if (!notice || !text) return;
    text.textContent = String(error && error.message ? error.message : error)
      .replace(/^Error invoking remote method '[^']+': Error: /, '');
    notice.className = 'notice error';
  }

  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      const result = await diag.simulate(!enabled);
      enabled = Boolean(result && result.enabled === true);
    } catch (error) {
      notify(error);
    } finally {
      button.disabled = false;
      paint();
    }
  });

  paint();
  anchor.parentNode.insertBefore(button, anchor);
})();
