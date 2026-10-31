!function(e){"use strict";const o="undefined"!=typeof module&&module.exports?require("./messages.js"):e.PkaMessages,a=(e,a)=>({...o.fieldInfo(e),message:o.fieldMessage(e,a)});function n(e){return`Conexão: ${{"Contagem de itens inválida.":"A leitura do inventário está incompleta.","Pokebar inválida.":"A leitura da pokebar está incompleta.","Mapa inválido.":"A leitura do mapa está incompleta.","Estado nativo inválido.":"A leitura da posição ou dos ataques está incompleta.","Condições inválidas.":"A leitura dos estados do Pokémon está incompleta.","Criaturas inválidas.":"A leitura das criaturas no mapa está incompleta.","Itens inválidos.":"A leitura dos itens no mapa está incompleta.","Sequência nativa inválida.":"A leitura do AutoCombo está incompleta.","Identidade da movebar inválida.":"A leitura dos ataques do Pokémon está incompleta."}[e]||"O jogo não enviou todos os dados necessários."} Aguarde a atualização; se persistir, feche o jogo e abra novamente pelo PokeAlliance.exe.`}const i={targetStartIssues:function(e,i,{blocked:t=!1,apiAvailable:s=!0}={}){const r=[],d=i?.telemetry,c=e.target,l=c.combo;return s?t?r.push({action:"profiles",message:"Corrija o arquivo de perfis que não pôde ser carregado. O aviso no topo contém o motivo."}):i?i.authExpired?r.push({action:"connection",message:"Sessão indisponível. Entre novamente pelo PokeAlliance.exe."}):i.error?r.push({action:"connection",message:`Conexão: ${o.message(i.error,"error")}`}):i.online?i.stale||i.ageMs>1e3?r.push({action:"connection",message:"Cliente sem atualização recente. Confira se o jogo está respondendo; reabra pelo PokeAlliance.exe se persistir."}):i.telemetryError?r.push({action:"connection",message:n(i.telemetryError)}):d?.nativeVerified&&3===d.pulseVersion&&1===d.automationVersion?d.position||r.push({action:"connection",message:"Posição do personagem indisponível. Entre no mapa e aguarde a atualização da conexão."}):r.push({action:"connection",message:"Cliente sem os dados necessários para iniciar. Feche o jogo e abra novamente pelo PokeAlliance.exe."}):r.push({action:"connection",message:"Cliente offline. Entre no personagem antes de iniciar o Target."}):r.push({action:"connection",message:"Selecione um cliente na conexão, no topo do menu."}):r.push({action:"connection",message:"Abra o PKA Tools para conectar ao jogo. Esta janela é uma prévia."}),c.monsters.length||r.push(a("target.monsters","adicione pelo menos uma criatura usando + Adicionar.")),c.instanceModeEnabled&&r.push(a("target.instanceModeEnabled","desative o modo instância, que ainda não está disponível.")),!l.enabled||!l.useMedicine&&!l.useMedicineBeforeCombo||l.medicineHotkey.trim()||l.medicineActionBar||r.push(a("target.combo.medicineHotkey","informe a hotkey de Medicine ou desligue “Medicine antes” e “Medicine em debuff” em Antes do combo.")),c.autoRevive.enabled&&!c.autoRevive.hotkey.trim()&&r.push(a("target.autoRevive.hotkey","informe a hotkey de Revive em Finalização / Revive ou desative Revive.")),l.enabled&&l.usePokeStop&&d?.nativeVerified&&!0!==d.conditionEvents&&r.push(a("target.combo.usePokeStop","o jogo não disponibilizou o estado do PokeStop. Desative PokeStop ou reabra o jogo pelo PokeAlliance.exe.")),r},runtimeIssue:function(e){const a=o.details(e);return a.path?a:/> Carregar rota:/u.test(a.message)?{...a,tab:"walker",path:"walker.luaProfile"}:/> Verificar perfil:/u.test(a.message)?{...a,action:"profiles"}:{...a,action:"connection"}},connectionError:n};"undefined"!=typeof module&&module.exports?module.exports=i:e.PkaDiagnostics=i}("undefined"!=typeof window?window:globalThis);

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
