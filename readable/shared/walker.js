!(function (t) {
  "use strict";
  const e = ["walk", "safespot", "box", "stairs", "wait", "say"],
    n = (t) =>
      t &&
      [t.x, t.y, t.z].every(Number.isInteger) &&
      t.x >= 0 &&
      t.x < 65535 &&
      t.y >= 0 &&
      t.y < 65535 &&
      t.z >= 0 &&
      t.z < 16,
    r = (t, e) => !!t && !!e && t.x === e.x && t.y === e.y && t.z === e.z,
    o = (t, e) =>
      t.z === e.z ? Math.max(Math.abs(t.x - e.x), Math.abs(t.y - e.y)) : 1 / 0;
  function i(t) {
    if (
      !t?.online ||
      t.stale ||
      t.ageMs > 1e3 ||
      !t.telemetry?.nativeVerified ||
      !n(t.telemetry.position)
    )
      throw new Error("Aguardando posição atual do cliente conectado.");
    return { ...t.telemetry.position };
  }
  function a(t, r, o = "", i = !1) {
    if (!e.includes(t) || !n(r))
      throw new Error("Ação ou posição do waypoint inválida.");
    if ("wait" === t && (!/^\d+$/u.test(String(o)) || Number(o) > 36e5))
      throw new Error("Wait: informe milissegundos entre 0 e 3600000.");
    if (
      "say" === t &&
      (!String(o).trim() ||
        s(String(o)) > 255 ||
        /[\x00-\x1f\x7f]/u.test(String(o)))
    )
      throw new Error("Say: informe uma mensagem de até 255 bytes.");
    return {
      action: t,
      pos: { ...r },
      param: o,
      stairCheckMonsters: "stairs" === t && i,
    };
  }
  const s = (t) => new TextEncoder().encode(t).length;
  const d = {
    ACTIONS: e,
    validPosition: n,
    equal: r,
    distance: o,
    currentPosition: i,
    waypoint: a,
    insert: function (t, e, n) {
      if (t.length >= 2e3)
        throw new Error("Limite de 2000 waypoints atingido.");
      const r =
        Number.isInteger(e) && e >= 0 && e < t.length ? e + 1 : t.length;
      return (t.splice(r, 0, n), r);
    },
    Recorder: class {
      constructor() {
        this.stop();
      }
      start(t, e = 5) {
        const n = i(t);
        if (!Number.isInteger(e) || e < 1 || e > 100)
          throw new Error("Record: use uma distância de 1 a 100 SQM.");
        return (
          (this.pid = t.pid),
          (this.step = e),
          (this.last = n),
          (this.previous = n),
          (this.active = !0),
          [a("walk", n)]
        );
      }
      stop() {
        ((this.active = !1),
          (this.pid = null),
          (this.previous = null),
          (this.last = null));
      }
      update(t) {
        if (!this.active) return [];
        if (t?.pid !== this.pid)
          throw (
            this.stop(),
            new Error("Record interrompido: o cliente selecionado mudou.")
          );
        let e;
        try {
          e = i(t);
        } catch (t) {
          throw (
            this.stop(),
            new Error(
              "Record interrompido: a posição do cliente ficou indisponível.",
            )
          );
        }
        if (r(e, this.previous)) return [];
        const n = [];
        return (
          o(e, this.previous) === 1 / 0
            ? (n.push(a("walk", this.previous, "0"), a("walk", e, "0")),
              (this.last = e))
            : o(this.last, e) >= this.step &&
              (n.push(a("walk", e)), (this.last = e)),
          (this.previous = e),
          n
        );
      }
    },
    viewport: function (t, e, n, r) {
      return {
        x: Math.floor(t.x - e / r / 2),
        y: Math.floor(t.y - n / r / 2),
        z: t.z,
        width: Math.ceil(e / r) + 1,
        height: Math.ceil(n / r) + 1,
      };
    },
    routeView: function (t, e = 380, r = 360) {
      const o = t.find((t) => n(t.pos))?.pos;
      if (!o) return null;
      const i = t.filter((t) => n(t.pos) && t.pos.z === o.z).map((t) => t.pos),
        a = i.map((t) => t.x),
        s = i.map((t) => t.y),
        d = Math.min(...a),
        u = Math.max(...a),
        l = Math.min(...s),
        h = Math.max(...s),
        p = Math.min((e - 40) / (u - d + 1), (r - 40) / (h - l + 1));
      return {
        center: p < 2 ? { ...o } : { x: (d + u) / 2, y: (l + h) / 2, z: o.z },
        scale: Math.max(2, Math.min(24, 2 * Math.floor(p / 2))),
      };
    },
    normalizeLuring: function (t) {
      if (void 0 !== t && (!t || "object" != typeof t || Array.isArray(t)))
        return t;
      const e = {
        enabled: !1,
        maxDistance: 3,
        frontEnabled: !1,
        frontRegroupMargin: 5,
        frontRegroupSteps: 3,
        randomEnabled: !1,
        randomMinSeconds: 45,
        randomMaxSeconds: 100,
        ...t,
      };
      return (
        Number.isFinite(e.frontRegroupMargin) &&
          (e.frontRegroupMargin = Math.max(
            4,
            Math.min(8, Math.floor(e.frontRegroupMargin)),
          )),
        Number.isFinite(e.frontRegroupSteps) &&
          (e.frontRegroupSteps = Math.max(
            1,
            Math.min(
              4,
              e.frontRegroupMargin - 1,
              Math.floor(e.frontRegroupSteps),
            ),
          )),
        !0 === e.randomEnabled
          ? ((e.enabled = !1), (e.frontEnabled = !1))
          : !0 === e.frontEnabled && (e.enabled = !1),
        e
      );
    },
    setLureMode: function (t, e) {
      const n = {
          distance: "enabled",
          dynamic: "frontEnabled",
          random: "randomEnabled",
        }[e],
        r = n && !t[n];
      ((t.enabled = !1),
        (t.frontEnabled = !1),
        (t.randomEnabled = !1),
        r && (t[n] = !0));
    },
  };
  "undefined" != typeof module && module.exports
    ? (module.exports = d)
    : (t.PkaWalker = d);
})("undefined" != typeof window ? window : globalThis);
