(function (root) {
  'use strict';
  const model = typeof module !== 'undefined' && module.exports ? module.exports : root.PkaDiagnostics;
  const originalTargetStartIssues = model.targetStartIssues;
  const keyboardUnsupported = new Set([
    'target.combo.medicineHotkey',
    'target.combo.usePokeStop',
    'target.autoRevive.hotkey',
  ]);
  const applicable = issues => issues.filter(issue => issue.action !== 'connection'
    && !keyboardUnsupported.has(issue.path));
  model.targetStartIssues = (config, session, options = {}) => {
    const issues = originalTargetStartIssues(config, session, options);
    if (options.blocked || options.apiAvailable === false || session?.source !== 'rpm'
        || !session.online || session.stale || session.ageMs > 1000 || session.error
        || session.authExpired || session.telemetryError) return issues;
    if (session.capabilities?.targetKeyboard === true) return applicable(issues);
    if (session.capabilities?.targetKeyboardIssue) return [{ action: 'connection', message: 'Target RPM: '
      + session.capabilities.targetKeyboardIssue }, ...applicable(issues)];
    const message = 'Backend teclado/RPM ativo: somente Walker está disponível. '
      + 'O Target ainda precisa de um backend de combate com telemetria e envio de comandos; '
      + 'reiniciar o jogo não adiciona esse suporte.';
    return [{ action: 'connection', message }, ...issues.filter(issue => issue.action !== 'connection')];
  };
})(typeof window === 'undefined' ? globalThis : window);
