"use strict";
window.PkaGuildDailyUI = {
  create(e) {
    const { guildDailyTiers: i, guildDailyElements: t } = window.PkaSchema,
      a = (e) => e[0].toUpperCase() + e.slice(1);
    let l = null,
      n = !1,
      o = 0,
      d = "",
      s = !1,
      u = 0,
      r = null;
    const c = () => e.getConfig().walker,
      g = (e) =>
        e?.online &&
        !e.stale &&
        !e.authExpired &&
        (e.ageMs ?? 0) <= 1e3 &&
        e.telemetry?.nativeVerified &&
        3 === e.telemetry.pulseVersion &&
        !0 === e.telemetry.guildDailyAvailable;
    function p() {
      if (!l) return;
      const i = window.PkaUI.set,
        t = e.getSession(),
        r = t?.pid || 0;
      (r !== u && ((d = ""), (s = !1), (u = r), (o = 0)),
        i(l.tier, "value", c().guildDailyTier),
        i(l.element, "value", c().guildDailyElement),
        i(l.auto, "checked", !!c().guildDailyAutoEnabled),
        i(l.ticket, "checked", !!c().guildDailyUseTicket),
        document.activeElement !== l.hotkey &&
          i(l.hotkey, "value", c().guildDailyTicketHotkey),
        document.activeElement !== l.limit &&
          i(l.limit, "value", String(c().guildDailyTicketAmount)),
        i(l.hotkey, "disabled", !c().guildDailyUseTicket),
        i(l.limit, "disabled", !c().guildDailyUseTicket),
        i(l.tier, "disabled", n),
        i(l.element, "disabled", n),
        i(l.take, "disabled", n || Date.now() < o || !g(t) || !e.api?.command),
        i(l.take, "textContent", n ? "Enviando…" : "Pegar daily"));
      const p = c().guildDailyAutoEnabled ? e.getRuntime?.().guildDaily : null,
        m = n
          ? "Enviando a seleção…"
          : d ||
            p?.status ||
            (!t?.online || t.stale
              ? "Entre no jogo para pegar a missão."
              : g(t)
                ? `${a(c().guildDailyTier)} / ${a(c().guildDailyElement)}`
                : "Reinicie o cliente com a build atualizada para usar a daily guild.");
      (i(l.status, "textContent", m),
        l.status.classList.toggle("error", s || !!p?.error),
        i(
          l.budget,
          "textContent",
          c().guildDailyUseTicket
            ? `Limite: ${c().guildDailyTicketAmount} ticket(s) por 24 horas${void 0 !== p?.used ? ` · Usados: ${p.used}` : ""}`
            : "",
        ));
    }
    async function m() {
      const l = e.getSession();
      if (n || Date.now() < o || !g(l)) return;
      const u = l.pid,
        m = `${c().guildDailyTier}:${c().guildDailyElement}`;
      if (i.includes(c().guildDailyTier) && t.includes(c().guildDailyElement)) {
        ((n = !0), (d = ""), (s = !1), p());
        try {
          if (
            (await e.save?.(),
            e.getSession()?.pid !== u ||
              !g(e.getSession()) ||
              m !== `${c().guildDailyTier}:${c().guildDailyElement}`)
          )
            throw Error(
              "O personagem ou a seleção mudou. Confira a daily e tente novamente.",
            );
          const i = await e.api.command(u, "guildDaily", m);
          if (0 !== i?.status)
            throw Error("Não foi possível enviar a escolha da daily guild.");
          e.getSession()?.pid === u &&
            ((d = `Enviado: ${a(m.split(":")[1])} / ${a(m.split(":")[0])}. Confira a missão no jogo.`),
            e.log(d, "info"));
        } catch (i) {
          e.getSession()?.pid === u &&
            ((d = i.message), (s = !0), e.log(d, "error"));
        } finally {
          ((n = !1),
            (o = Date.now() + 2e3),
            clearTimeout(r),
            (r = setTimeout(p, 2001)),
            p());
        }
      }
    }
    return {
      render: function (n) {
        const o = e.node,
          u = o("section", "walker-section walker-guild-daily");
        u.append(
          o("h2", "", "Daily guild"),
          o(
            "p",
            "hint",
            "Escolha o tier e o elemento. A escolha só muda ao reiniciar a daily no jogo.",
          ),
        );
        const r = o("div", "walker-row");
        (u.append(r), (l = {}));
        for (const [n, u, g] of [
          ["tier", "Tier", i],
          ["element", "Elemento", t],
        ]) {
          const i = o("label", "walker-input", u),
            t = o("select");
          t.setAttribute("aria-label", `${u} da daily guild`);
          for (const e of g) {
            const i = o("option", "", a(e));
            ((i.value = e), t.append(i));
          }
          (t.addEventListener("change", () => {
            ((c()["tier" === n ? "guildDailyTier" : "guildDailyElement"] =
              t.value),
              (d = ""),
              (s = !1),
              e.changed(),
              p());
          }),
            i.append(t),
            r.append(i),
            (l[n] = t));
        }
        for (const [i, t] of [
          ["auto", "Pegar daily ao iniciar o bot"],
          ["ticket", "Resetar com ticket ao concluir"],
        ]) {
          const a = o("label", "walker-check", t),
            n = o("input");
          ((n.type = "checkbox"),
            n.addEventListener("change", () => {
              ((c()[
                "auto" === i ? "guildDailyAutoEnabled" : "guildDailyUseTicket"
              ] = n.checked),
                (d = ""),
                e.changed(),
                p());
            }),
            a.append(n),
            u.append(a),
            (l[i] = n));
        }
        const g = o("div", "walker-row");
        u.append(g);
        const y = o("label", "walker-input", "Hotkey do ticket de reset");
        ((l.hotkey = o("input")),
          (l.hotkey.type = "text"),
          (l.hotkey.placeholder = "Ex.: F9"),
          (l.hotkey.maxLength = 40),
          l.hotkey.addEventListener("input", () => {
            ((c().guildDailyTicketHotkey = l.hotkey.value), e.changed());
          }),
          y.append(l.hotkey),
          g.append(y));
        const k = o("label", "walker-input", "Limite de tickets / 24 h");
        ((l.limit = o("input")),
          (l.limit.type = "number"),
          (l.limit.min = 1),
          (l.limit.max = 1e3),
          l.limit.addEventListener("input", () => {
            Number.isInteger(l.limit.valueAsNumber) &&
              l.limit.valueAsNumber >= 1 &&
              l.limit.valueAsNumber <= 1e3 &&
              ((c().guildDailyTicketAmount = l.limit.valueAsNumber),
              e.changed());
          }),
          k.append(l.limit),
          g.append(k),
          u.append(
            o(
              "p",
              "hint",
              "Com o automático ligado, o bot consulta a guild ao iniciar. Para resetar ao concluir, coloque o ticket em uma hotkey da action bar com Usar ou Usar em si.",
            ),
          ),
          (l.budget = o("p", "hint")),
          u.append(l.budget),
          (l.take = o("button", "primary", "Pegar daily")),
          (l.take.type = "button"),
          l.take.addEventListener("click", m),
          u.append(l.take),
          (l.status = o("p", "hint guild-daily-status")),
          l.status.setAttribute("role", "status"),
          u.append(l.status),
          n.append(u),
          p());
      },
      refresh: p,
      hide() {
        l = null;
      },
      reset() {
        ((d = ""), (s = !1), (o = 0), (u = 0), p());
      },
    };
  },
};
