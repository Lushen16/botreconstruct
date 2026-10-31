!(function (e) {
  "use strict";
  const o =
      "undefined" != typeof module && module.exports
        ? require("./schema.js")
        : e.PkaSchema,
    a = "Não foi possível concluir. Tente novamente.";
  function n(e) {
    if ("string" != typeof e) return null;
    const a = e
        .replace(/\[(\d+)\]/gu, (e, o) => "." + (Number(o) - 1))
        .split("."),
      n = o.tabs.find(
        (e) =>
          e.key === a[0].toLowerCase() ||
          e.label.toLowerCase() === a[0].toLowerCase(),
      );
    if (!n) return null;
    let t = n.fields;
    const i = [
        "target" === n.key
          ? "Targeting"
          : "alerts" === n.key
            ? "Alertas"
            : n.label,
      ],
      r = [n.key];
    for (const e of a.slice(1)) {
      if (/^\d+$/u.test(e)) {
        (i.push(`Item ${Number(e) + 1}`), r.push(e));
        continue;
      }
      const o = t?.find((o) => o.key === e);
      if (!o) return null;
      (i.push(o.label), r.push(e), (t = o.fields));
    }
    return { tab: n.key, path: r.join("."), location: i.join(" > ") };
  }
  function t(e, o) {
    const t = n(e);
    return t ? `Confira ${t.location}: ${o}` : a;
  }
  function i(e) {
    const a = e.match(/Confira ([^:]+):/u);
    if (!a) return null;
    const t = a[1].split(" > "),
      i = o.tabs.find(
        (e) =>
          ("target" === e.key
            ? "Targeting"
            : "alerts" === e.key
              ? "Alertas"
              : e.label) === t[0],
      );
    if (!i) return null;
    let r = i.fields;
    const s = [i.key];
    for (const e of t.slice(1)) {
      const o = e.match(/^Item (\d+)$/u);
      if (o) {
        s.push(String(Number(o[1]) - 1));
        continue;
      }
      const a = r?.find((o) => o.label === e);
      if (!a) return null;
      (s.push(a.key), (r = a.fields));
    }
    return n(s.join("."));
  }
  const r =
    /C\+\+|std::|falha (?:interna|inesperada)|\b(?:DLL|IPC|UUID|RVA|offsets?|telemetria|nativ[oa]s?|Electron|nlohmann|exception|stack|HRESULT|ENOENT|EACCES|EPERM|EBUSY|TypeError|SyntaxError|ReferenceError)\b|\.(?:cpp|hpp)\b|0x[\da-f]+|[a-z]:[\\/]|(?:^|\s)at\s+\S+\s*\(/iu;
  function s(e, o = "info") {
    if ("string" != typeof e || !e.trim()) return a;
    const n = e.trim(),
      l = n.match(
        /^((?:Scripts|Target|Healer|Walker|Looting|CAPTURE|Alerts|Hoenn|Tools|scripts|target|healer|walker|looting|alerts|hoenn|tools)(?:\.[a-zA-Z][a-zA-Z0-9]*|\[\d+\])+)\s*:\s*(objeto inválido\.|lista inválida ou muito grande\.|use verdadeiro ou falso\.|use um inteiro entre -?\d+ e -?\d+\.|opção inválida\.|texto inválido ou muito grande\.|use texto ou número\.|valor inválido\.)$/u,
      );
    if (l) return t(l[1], l[2]);
    const u = n.match(
      /^(Target|Healer|Walker|Hoenn|Captura|Conexão|Comando) > (Verificar perfil|Verificar sessão|Carregar rota|Iniciar|Pausar|Pausar\/retomar|Estado do bot|Atualização do bot|Versão do bot|Enviar pedido|Confirmar pedido): (.+)$/u,
    );
    if (u) return `${u[1]} > ${u[2]}: ${s(u[3], o)}`;
    const d = i(n);
    if (d)
      return r.test(n.slice(n.indexOf(":") + 1))
        ? t(d.path, a)
        : n.slice(0, 600);
    if (/^Modo instância ainda não disponível\./u.test(n))
      return t(
        "target.instanceModeEnabled",
        "desative o modo instância para iniciar o Target.",
      );
    if ("Monitor de PokeStop indisponível." === n)
      return t(
        "target.combo.usePokeStop",
        "o jogo não disponibilizou o estado do PokeStop. Desative PokeStop para iniciar ou reabra o jogo pelo PokeAlliance.exe.",
      );
    if ("Configure a hotkey de Medicine ou desative Medicine." === n)
      return t(
        "target.combo.medicineHotkey",
        "informe a hotkey de Medicine ou desligue “Medicine antes” e “Medicine em debuff” em Antes do combo.",
      );
    if ("Configure a hotkey de Revive." === n)
      return t(
        "target.autoRevive.hotkey",
        "informe a hotkey de Revive em Finalização / Revive ou desative Revive.",
      );
    if ("Adicione uma criatura ao Target." === n)
      return t(
        "target.monsters",
        "adicione pelo menos uma criatura no formulário Adicionar monstro.",
      );
    if (
      /^(?:A área da skill não pode incluir o centro|A área da skill contém tiles repetidos|Área da skill inválida)/u.test(
        n,
      )
    )
      return t(
        "target.combo.perfectingSkillMask",
        "retire o tile central e os tiles repetidos do desenho da área da skill.",
      );
    if (
      "Intervalo aleatório inválido." === n ||
      "O mínimo do lure aleatório deve ser menor ou igual ao máximo." === n
    )
      return t(
        "target.luring.randomMinSeconds",
        "o mínimo deve ser menor ou igual ao máximo.",
      );
    if ("Escolha captura após combate ou aleatória." === n)
      return t(
        "looting.captureRandomMode",
        "escolha captura após combate ou aleatória; os dois modos não podem ficar ativos juntos.",
      );
    if (
      "DLL incompatível ou telemetria indisponível. Reinicie e reinjete." === n
    )
      return "Cliente sem os dados necessários para iniciar. Feche o jogo e abra novamente pelo PokeAlliance.exe.";
    if ("Cliente offline ou sem atualização recente." === n)
      return "Cliente offline ou sem atualização recente. Entre no personagem e confira a conexão no topo do menu.";
    const c = n.match(/^([^:]+): aguardando · (.+)$/u);
    if (c) return `${c[1]}: ${s(c[2], "error")}`;
    const m =
      "error" === o &&
      n.match(/^(Hoenn|Healer|Target|Walker|Revive|Captura):\s*(.+)$/iu);
    if (m) return `${m[1]}: ${s(m[2], "error")}`;
    const f = n.match(/^Ação rejeitada pelo cliente \((\d+)\)\.$/u);
    return f
      ? {
          1: "Confira a configuração da ação: o jogo rejeitou os parâmetros enviados.",
          2: "Cliente offline. Entre no personagem antes de iniciar novamente.",
          3: "Cliente sem as funções necessárias para esta ação. Feche o jogo e abra novamente pelo PokeAlliance.exe.",
          4: "O Pokémon ativo mudou. Aguarde a atualização da pokebar.",
          5: "Aguarde o cooldown da ação ou da action bar.",
          6: "Confira as hotkeys na action bar do jogo: Medicine deve usar Usar no Pokémon e Revive deve usar Auto Revive. Use os mesmos atalhos configurados no Target.",
        }[f[1]] ||
          "Cliente rejeitou a ação solicitada. Confira a conexão e a configuração do módulo."
      : /negou a sessão|sessão.*(?:negad|não autorizad|expirad)|licença.*(?:negad|expirad)/iu.test(
            n,
          )
        ? "Sessão indisponível. Entre novamente e tente outra vez."
        : /precisa dos seis Pokémon/iu.test(n)
          ? "Hoenn não está configurado. Selecione os seis Pokémon do time."
          : /UUID|identidade do Pokémon/iu.test(n)
            ? "O Pokémon mudou. Confira o time e tente novamente."
            : r.test(n)
              ? /configur|hotkey|action bar/iu.test(n)
                ? "Esta opção não está configurada corretamente. Confira o perfil e tente novamente."
                : a
              : "error" !== o ||
                  /^(?:configure|adicione|ative|desative|selecione|salve|pause|aguarde|confira|corrija|abra|reinicie|não foi possível|não existe|não há|nenhum|nenhuma|sem |sessão|cliente|perfil|arquivo|atalho|hotkey|rota|waypoint|wait|box|hoenn|healer|target|walker|pokémon|nome|posição|quantidade|limite|o arquivo|o perfil|a rota|a configuração|esta opção|este recurso)/iu.test(
                    n,
                  )
                ? n
                    .slice(0, 600)
                    .replace(/\bdeploy\b/gu, "troca de Pokémon")
                    .replace(/\bprepare\b/gu, "preparação")
                    .replace(/\bgate\b/gu, "recuperação do time")
                    .replace(/\brecover\b/gu, "recuperação")
                    .replace(/\bdwell\b/gu, "permanência")
                    .replace(/\bidle\b/gu, "aguardando")
                    .replace(/\bloot\b/gu, "coleta")
                : a;
  }
  const l = {
    message: s,
    details: function (e, o = "error") {
      const a = s(e, o);
      return { message: a, ...(i(a) || {}) };
    },
    fieldInfo: n,
    fieldMessage: t,
    retry: a,
  };
  "undefined" != typeof module && module.exports
    ? (module.exports = l)
    : (e.PkaMessages = l);
})("undefined" != typeof window ? window : globalThis);
