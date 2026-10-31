!(function (e) {
  "use strict";
  function t({
    Audio: t = e.Audio,
    assets: n = e.PkaAlertsModel?.soundAssets || [],
    base: o = "pka://app/alerts-audio/",
    report: s = () => {},
  } = {}) {
    const r = new Set(n),
      l = [];
    let u = null,
      a = 0,
      d = !1;
    function i() {
      (a++, (l.length = 0));
      const e = u?.player;
      ((u = null), e && (e.pause(), (e.currentTime = 0)));
    }
    function p() {
      if (d || u || !l.length) return;
      const e = l.shift(),
        n = a,
        r = new t(`${o}${e}`);
      u = { asset: e, player: r };
      const i = (e) => {
        n === a &&
          u?.player === r &&
          ((u = null),
          e && s("Não foi possível reproduzir o áudio do alerta."),
          p());
      };
      (r.addEventListener("ended", () => i(), { once: !0 }),
        r.addEventListener("error", () => i(!0), { once: !0 }));
      try {
        Promise.resolve(r.play()).catch(() => i(!0));
      } catch {
        i(!0);
      }
    }
    return {
      play: (e) =>
        !(d || !r.has(e)) &&
        (u?.asset === e ||
          l.includes(e) ||
          (l.length >= 5 && l.shift(), l.push(e), p()),
        !0),
      setPaused(e) {
        ((d = !!e), d && (u || l.length) && i());
      },
      setReporter(e) {
        "function" == typeof e && (s = e);
      },
      stop: i,
    };
  }
  "undefined" != typeof module && module.exports
    ? (module.exports = { create: t })
    : (e.PkaAlertAudio = t());
})("undefined" != typeof window ? window : globalThis);
