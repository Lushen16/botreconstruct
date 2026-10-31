!(function (e) {
  "use strict";
  const t = (e) =>
    String(e ?? "")
      .trim()
      .toLowerCase();
  function n(e) {
    const n = new Set(),
      r = [];
    for (const o of [...(e || [])]
      .filter((e) => Number.isInteger(e.slot) && e.slot >= 1 && e.slot <= 6)
      .sort((e, t) => e.slot - t.slot)) {
      const e = String(o.name ?? "").trim(),
        i = t(e);
      e && !n.has(i) && (n.add(i), r.push(e));
    }
    return r;
  }
  function r(e, n, r, { paused: o = !1 } = {}) {
    const i = n?.telemetry,
      l = e.healer,
      s = r.modules.includes("healer");
    if (
      o ||
      r.paused ||
      !n?.online ||
      n.stale ||
      n.error ||
      n.authExpired ||
      n.ageMs > 1e3 ||
      !i?.nativeVerified ||
      3 !== i.pulseVersion ||
      1 !== i.automationVersion
    )
      return null;
    if (r.modules.length && r.pid !== n.pid) return null;
    if (!s && l.healHpPercent <= 0) return null;
    const u = (e) =>
      !!t(e) && 1 === (i.roster || []).filter((n) => t(n.name) === t(e)).length;
    if (
      l.healHpPercent > 0 &&
      (!u(l.healPokemonName) || !u(l.returnPokemonName))
    )
      return null;
    const a = JSON.stringify([n.pid, l, e.tools]);
    return { pid: n.pid, signature: a };
  }
  const o = {
    pokebarNames: n,
    cycleName: function (e, r, o) {
      const i = n(e);
      if (!i.length) return null;
      let l = i.findIndex((e) => t(e) === t(r));
      return (l < 0 && (l = o > 0 ? -1 : 0), i[(l + o + i.length) % i.length]);
    },
    autoPlan: r,
    createAutomatic: function ({
      start: e,
      onError: t = () => {},
      now: n = Date.now,
    }) {
      let o = !1,
        i = !1,
        l = "",
        s = 0;
      return {
        get paused() {
          return o;
        },
        get pending() {
          return i;
        },
        pause() {
          o = !0;
        },
        resume() {
          ((o = !1), (l = ""));
        },
        defer(e = 350) {
          s = n() + e;
        },
        async sync(u, a, d) {
          if (i || n() < s) return;
          const c = r(u, a, d, { paused: o });
          if (c) {
            if (l !== c.signature) {
              ((l = c.signature), (i = !0));
              try {
                await e(c.pid, structuredClone(u));
              } catch (e) {
                o || t(e);
              } finally {
                i = !1;
              }
            }
          } else o || (a?.online && !a.stale) || (l = "");
        },
      };
    },
  };
  "undefined" != typeof module && module.exports
    ? (module.exports = o)
    : (e.PkaHealerModel = o);
})("undefined" != typeof window ? window : globalThis);
