!(function (e) {
  "use strict";
  const t = Object.freeze({
      hp: "Vida do player",
      disconnected: "Cliente desconectado",
      chat: "Mensagem no chat",
      creature: "Criatura próxima",
      player: "Player próximo",
      gm_arrow: "Seta de GM",
      gm_message: "Mensagem de GM",
      hunt_pokemon: "Pokémon fora da hunt",
      teleport: "Teleporte",
      camera_viewers: "Espectadores",
      pokemon_capture: "Captura de Pokémon",
    }),
    n = Object.freeze(Object.keys(t)),
    r = Object.freeze([
      "chat",
      "gm_arrow",
      "gm_message",
      "camera_viewers",
      "pokemon_capture",
    ]),
    s = Object.freeze(Object.keys(t).map((e) => `${e}.mp3`)),
    o = Object.freeze({
      default: [
        [880, 250, 0],
        [880, 250, 420],
        [880, 280, 840],
      ],
      low: [
        [520, 300, 0],
        [660, 260, 430],
      ],
      high: [
        [1180, 190, 0],
        [1480, 210, 300],
        [1180, 220, 620],
      ],
      pulse: [
        [700, 130, 0],
        [980, 130, 220],
        [700, 130, 440],
        [980, 160, 660],
      ],
      urgent: [
        [1200, 80, 0],
        [700, 80, 90],
        [1200, 80, 180],
        [700, 80, 270],
        [1200, 80, 360],
        [700, 80, 450],
        [1200, 80, 540],
        [700, 80, 630],
      ],
      happy: [
        [523, 120, 0],
        [659, 120, 150],
        [784, 140, 300],
        [1047, 260, 470],
      ],
    }),
    a = Object.freeze({
      default: "Padrão",
      low: "Grave",
      high: "Agudo",
      pulse: "Pulsante",
      urgent: "Urgente",
      happy: "Alegre (captura)",
    }),
    i = Object.freeze([...s, ...Object.keys(o).map((e) => `beep-${e}.wav`)]);
  function l(e, t) {
    return n.includes(e)
      ? arguments.length > 1 && r.includes(e) && !0 !== t?.alertSignals?.[e]
        ? "Este alerta exige os dados da versão atual. Feche o jogo e abra novamente pelo PokeAlliance.exe."
        : null
      : "Tipo de alerta indisponível.";
  }
  function c(e) {
    return String(e)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/gu, "")
      .trim()
      .replace(/\s+/gu, " ")
      .toLowerCase();
  }
  function p(e) {
    const t = new Set();
    return (Array.isArray(e) ? e : [])
      .filter(
        (e) => "string" == typeof e && c(e) && !t.has(c(e)) && t.add(c(e)),
      )
      .map((e) => e.trim().replace(/\s+/gu, " "));
  }
  function u(e) {
    const t = JSON.parse(e.gmMessageProfilesJson || "{}"),
      n = Object.create(null);
    if (t && "object" == typeof t && !Array.isArray(t))
      for (const [e, r] of Object.entries(t))
        r &&
          "object" == typeof r &&
          !Array.isArray(r) &&
          (n[e] = { ...r, blacklist: p(r.blacklist), pending: p(r.pending) });
    const r = e.gmMessageActiveProfile || "default";
    return (
      Object.hasOwn(n, r) || (n[r] = { blacklist: [], pending: [] }),
      { active: r, profiles: n, profile: n[r] }
    );
  }
  function g(e, t, n = e.gmMessageActiveProfile || "default") {
    const r = JSON.stringify(t);
    if (r.length > 2e5)
      throw Error(
        "O perfil de mensagens de GM está cheio. Revise as frases antes de continuar.",
      );
    return ((e.gmMessageProfilesJson = r), (e.gmMessageActiveProfile = n), e);
  }
  const m = {
    types: t,
    supportedTypes: n,
    voiceAssets: s,
    beepPresets: o,
    beepLabels: a,
    soundAssets: i,
    typeReason: l,
    supportReason: function (e, t) {
      const n = arguments.length > 1 ? l(e.type, t) : l(e.type);
      if (n) return n;
      if (
        "hunt_pokemon" === e.type &&
        !String(e.huntPokemonNames || "")
          .split(/[,;\n]/u)
          .some((e) => e.trim())
      )
        return "Informe os nomes dos Pokémon esperados na hunt.";
      if ("creature" === e.type && !String(e.creatureName || "").trim())
        return "Informe o nome da criatura ou use * para qualquer Pokémon selvagem.";
      const r = "gm_arrow" === e.type && "walk" === e.gmArrowMode,
        s = e.talkEnabled && !["gm_arrow", "disconnected"].includes(e.type),
        o = String(r ? e.gmArrowMsg || "" : e.talkMsg || "");
      return s && !o.split(/[,;\n]/u).some((e) => e.trim())
        ? "Informe pelo menos uma mensagem para enviar no chat."
        : (s || r) &&
            o
              .split(/[,;\n]/u)
              .some(
                (e) =>
                  new TextEncoder().encode(e.trim()).length > 255 ||
                  /[\x00-\x1f\x7f]/u.test(e.trim()),
              )
          ? "Cada mensagem aceita até 255 bytes, sem caracteres de controle."
          : null;
    },
    soundAsset: function (e) {
      if (
        !e?.soundEnabled ||
        "off" === e.soundKind ||
        !Object.hasOwn(t, e.type)
      )
        return null;
      const n = e.soundMode ?? "voice";
      return "voice" === n
        ? `${e.type}.mp3`
        : "beep" === n && Object.hasOwn(o, e.soundKind)
          ? `beep-${e.soundKind}.wav`
          : null;
    },
    gmKey: c,
    gmList: p,
    gmData: u,
    gmWrite: g,
    gmRecord: function (e, t) {
      if (
        !t ||
        !["blacklist", "pending"].includes(t.action) ||
        "string" != typeof t.text ||
        !t.text.trim() ||
        new TextEncoder().encode(t.text).length > 512
      )
        return !1;
      const n = u(e);
      if (t.profile !== n.active) return !1;
      const r = c(t.text),
        s = n.profile[t.action];
      if (
        n.profile.blacklist.some((e) => c(e) === r) ||
        ("pending" === t.action && s.some((e) => c(e) === r))
      )
        return !1;
      if (s.length >= 512)
        throw Error(
          "O perfil de mensagens de GM atingiu 512 frases. Revise a lista antes de continuar.",
        );
      return (
        s.push(t.text.trim().replace(/\s+/gu, " ")),
        "blacklist" === t.action &&
          (n.profile.pending = n.profile.pending.filter((e) => c(e) !== r)),
        g(e, n.profiles),
        (e.gmMessageRevision = (e.gmMessageRevision || 0) + 1),
        !0
      );
    },
    gmMerge: function (e, t) {
      const n = { ...t };
      if ((t.gmMessageRevision || 0) >= (e.gmMessageRevision || 0)) return n;
      const r = u(e),
        s = u(t);
      for (const [e, t] of Object.entries(r.profiles)) {
        const n = Object.hasOwn(s.profiles, e)
            ? s.profiles[e]
            : { blacklist: [], pending: [] },
          r = p([...n.blacklist, ...t.blacklist]),
          o = new Set(r.map(c));
        s.profiles[e] = {
          ...n,
          blacklist: r,
          pending: p([...n.pending, ...t.pending]).filter((e) => !o.has(c(e))),
        };
      }
      return (g(n, s.profiles), (n.gmMessageRevision = e.gmMessageRevision), n);
    },
  };
  "undefined" != typeof module && module.exports
    ? (module.exports = m)
    : (e.PkaAlertsModel = m);
})("undefined" != typeof window ? window : globalThis);
