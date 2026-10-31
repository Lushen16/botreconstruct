"use strict";
window.PkaLootingUI = {
  create(e) {
    const o = window.PkaUI.create(e),
      { n: t, button: a, section: n, row: r, input: i, toggle: c, tip: s } = o;
    let l = null,
      p = null,
      d = null,
      u = -1,
      m = null,
      I = { name: "", corpseId: 0, ballId: 0, fallbackBallId: 0 };
    const g = () => e.getConfig().looting,
      f = () => e.getSession(),
      b = (e) =>
        "item" === e?.kind
          ? (
              g().captureEntries.find((o) => o.corpseId === e.id)?.name || ""
            ).trim()
          : "",
      k = {
        corpseId: "corpo",
        ballId: "ball principal",
        fallbackBallId: "ball reserva",
      },
      h = () => {
        const e = f();
        return (
          e?.online &&
          !e.stale &&
          e.ageMs <= 1e3 &&
          e.telemetry?.nativeVerified &&
          1 === e.telemetry.captureVersion &&
          e.telemetry.itemInspectorAvailable
        );
      };
    function x() {
      if (!l) return;
      const o = f(),
        t = e.getRuntime().modules.includes("looting"),
        a = o?.telemetry?.inspection,
        n = window.PkaUI.set;
      (n(l.start, "textContent", t ? "Pausar captura" : "Iniciar captura"),
        n(
          l.start,
          "disabled",
          !t &&
            (!o?.online ||
              o.stale ||
              1 !== o.telemetry?.captureVersion ||
              !g().captureEnabled),
        ),
        n(
          l.status,
          "textContent",
          t
            ? e.getRuntime().phases?.looting ||
                "Captura: aguardando corpos próximos"
            : "Captura pausada · usa as opções da tela",
        ));
      const r = a ? String(a.id) : "—",
        i = a
          ? "item" === a.kind
            ? a.container
              ? "Item com espaço (container)"
              : "Item"
            : "Criatura"
          : "";
      l.lookId.textContent !== r && (l.lookId.textContent = r);
      const c = b(a),
        s = p
          ? `Agora dê Shift + clique no jogo para escolher ${k[p.key]}…`
          : a
            ? `${c ? `${c} · ` : ""}${i}${a.pos ? ` · ${a.pos.x}, ${a.pos.y}, ${a.pos.z}` : ""}`
            : h()
              ? "Dê Shift + clique (look) em um item no jogo: o ID aparece aqui e numa caixa na frente do jogo."
              : "Entre no jogo para ver o ID dos itens com Shift + clique.";
      (l.lookInfo.textContent !== s && (l.lookInfo.textContent = s),
        l.lookBox.classList.toggle("waiting", !!p),
        n(l.cancel, "hidden", !p),
        n(l.use, "disabled", !h() || "item" !== a?.kind),
        n(l.copy, "disabled", !a),
        (l.pickers = l.pickers.filter((e) => e.isConnected)));
      for (const e of l.pickers) n(e, "disabled", !h());
      for (const e of l.bodies) {
        const o = (e.entry.name || "").trim(),
          t = String(e.entry.corpseId);
        (e.name.textContent !== o && (e.name.textContent = o),
          n(e.name, "hidden", !o),
          e.id.textContent !== t && (e.id.textContent = t),
          n(e.button, "title", o ? `${o} · ID ${t}` : `ID ${t}`));
      }
    }
    function v(o, t) {
      if (!h()) return;
      const a = f();
      p = {
        entry: o,
        key: t,
        pid: a.pid,
        revision: a.telemetry.inspection?.revision || 0,
        expires: Date.now() + 6e4,
      };
      const n = p;
      (clearTimeout(m),
        (m = setTimeout(() => {
          p === n && ((p = null), e.log("Seleção de item cancelada."), x());
        }, 60001)),
        x(),
        e.api
          .command(a.pid, "focus", 0)
          .catch((o) => e.log(o.message, "error")));
    }
    function C(d) {
      l = { pickers: [], bodies: [], container: d };
      const m = t("div", "bot-workspace capture-workspace"),
        b = t("div", "bot-editor"),
        h = t("aside", "bot-aside");
      (m.append(b, h), d.append(m));
      const C = n(
          b,
          "Captura",
          "Configure um corpo e as balls que serão usadas para capturá-lo.",
        ),
        D = r(C);
      (s(
        c(D, "Ativar captura", g(), "captureEnabled", () => {
          (e.changed(), x());
        }),
        "Liga a captura neste perfil. Depois clique em Iniciar captura.",
      ),
        (l.start = a(
          D,
          "Iniciar captura",
          () => e.run(!e.getRuntime().modules.includes("looting")),
          "primary",
        )),
        (l.start.title =
          "Começa a jogar balls nos corpos da lista que estiverem perto."),
        (l.status = t("p", "hint")),
        C.append(l.status));
      const $ = {
        value: g().captureRandomMode
          ? "random"
          : g().captureAfterCombat
            ? "combat"
            : "continuous",
      };
      s(
        o.select(
          r(C),
          "Quando capturar",
          $,
          "value",
          [
            ["continuous", "Continuamente"],
            ["combat", "Após o combate"],
            ["random", "Aleatório por combate"],
          ],
          () => {
            ((g().captureAfterCombat = "combat" === $.value),
              (g().captureRandomMode = "random" === $.value),
              e.changed());
          },
        ),
        "Continuamente: joga ball durante a caça e repete nos corpos que continuam no chão. Após o combate: tenta uma vez cada corpo quando o Target ou Hoenn encerra a luta. Aleatório: sorteia uma vez por combate entre esses dois modos e mantém a escolha até a próxima luta.",
      );
      const E = r(C);
      (s(
        i(E, "Intervalo entre balls (ms)", g(), "captureDelay", {
          type: "number",
          min: 50,
        }),
        "Espera entre uma ball e a próxima, com mínimo de 50 ms.",
      ),
        s(
          i(E, "Alcance (SQM)", g(), "maxCaptureDist", {
            type: "number",
            min: 1,
            max: 30,
          }),
          "Distância máxima do corpo para tentar a captura, a partir do treinador.",
        ));
      const S = n(b, "Selecionar no jogo");
      ((l.lookBox = t("div", "look-box")),
        l.lookBox.setAttribute("aria-live", "polite"),
        S.append(l.lookBox));
      const B = t("div", "look-head");
      (B.append(t("span", "look-label", "ID do último look")),
        (l.lookId = t("strong", "look-id", "—")),
        B.append(l.lookId),
        (l.lookInfo = t("p", "look-info")),
        l.lookBox.append(B, l.lookInfo));
      const A = t("div", "look-actions");
      (l.lookBox.append(A),
        (l.copy = a(A, "Copiar ID", () => {
          const o = f()?.telemetry?.inspection;
          o &&
            e.api
              ?.copyText?.(String(o.id))
              .then(() => e.log(`ID ${o.id} copiado.`))
              .catch((o) => e.log(o.message, "error"));
        })),
        (l.copy.title = "Copia o número do ID."),
        (l.use = a(A, "Usar como corpo", () => {
          const e = f()?.telemetry?.inspection;
          if ("item" !== e?.kind) return;
          const o = g().captureEntries.findIndex((o) => o.corpseId === e.id);
          (o >= 0 ? (u = o) : ((u = -1), (I.corpseId = e.id)), y());
        })),
        (l.use.title = "Coloca este ID no campo “ID do corpo” abaixo."),
        (l.cancel = a(A, "Cancelar seleção", () => {
          ((p = null), x());
        })));
      const q = n(b, u < 0 ? "Adicionar corpo" : "Editar corpo"),
        j = u < 0 ? I : g().captureEntries[u],
        w = i(r(q), "Nome do corpo (opcional)", j, "name", {
          change: () => {
            (u >= 0 && e.changed(), x());
          },
        });
      ((w.maxLength = 120),
        (w.placeholder = "Ex.: Pidgey"),
        s(
          w,
          "Digite um nome para identificar este corpo na lista. Ele fica salvo no perfil.",
        ));
      const L = r(q);
      for (const [o, n] of [
        ["corpseId", "ID do corpo"],
        ["ballId", "Ball principal"],
        ["fallbackBallId", "Ball reserva"],
      ]) {
        const r = t("div", "capture-picker");
        L.append(r);
        const c = i(r, n, j, o, {
          type: "number",
          min: 0,
          max: 65535,
          change: () => {
            u >= 0 && e.changed();
          },
        });
        (j[o] || (c.value = ""),
          l.pickers.push(a(r, "Selecionar", () => v(j, o))),
          l.pickers
            .at(-1)
            .setAttribute("aria-label", `Selecionar ${k[o]} no jogo`),
          (l.pickers.at(-1).title =
            "Clique aqui e depois dê Shift + clique no item dentro do jogo. O ID dele preenche este campo."));
      }
      q.append(
        t(
          "p",
          "hint",
          "Informe o ID da ball principal. A reserva é opcional e será usada quando a principal acabar.",
        ),
      );
      const P = r(q);
      (a(
        P,
        u < 0 ? "+ Adicionar corpo" : "Concluir edição",
        () => {
          if (
            !Number.isInteger(j.corpseId) ||
            j.corpseId < 1 ||
            j.corpseId > 65535
          )
            return e.log(
              "Selecione ou informe um ID de corpo válido.",
              "error",
            );
          if (
            g().captureEntries.some((e) => e !== j && e.corpseId === j.corpseId)
          )
            return e.log("Esse corpo já está configurado.", "error");
          if (u < 0) {
            if (g().captureEntries.length >= 2e3) return;
            g().captureEntries.push({ ...j });
          }
          (e.changed(),
            (u = -1),
            (I = {
              name: "",
              corpseId: 0,
              ballId: j.ballId,
              fallbackBallId: j.fallbackBallId,
            }),
            y());
        },
        "primary",
      ),
        u >= 0 &&
          a(P, "Novo corpo", () => {
            ((u = -1), y());
          }));
      const R = n(h, `Corpos configurados · ${g().captureEntries.length}`),
        T = t("div", "capture-head");
      (T.append(
        t("span", "", "Corpo"),
        t("span", "", "Principal"),
        t("span", "", "Reserva"),
        t("span"),
      ),
        R.append(T),
        g().captureEntries.length ||
          R.append(
            t(
              "p",
              "empty-list",
              "Adicione um corpo usando Shift + clique no jogo.",
            ),
          ),
        g().captureEntries.forEach((o, n) => {
          const r = t("div", "capture-line" + (n === u ? " selected" : ""));
          R.append(r);
          const i = a(
              r,
              "",
              () => {
                ((u = n), y());
              },
              "capture-body",
            ),
            c = t("span", "capture-name"),
            s = t("span", "capture-id");
          (i.append(c, s),
            l.bodies.push({ entry: o, button: i, name: c, id: s }));
          for (const e of ["ballId", "fallbackBallId"]) {
            const t = a(
              r,
              o[e] ? String(o[e]) : "—",
              () => v(o, e),
              "ball-slot",
            );
            (t.setAttribute(
              "aria-label",
              `Selecionar ${k[e]} do corpo ${o.corpseId}`,
            ),
              l.pickers.push(t));
          }
          a(r, "×", () => {
            (g().captureEntries.splice(n, 1),
              (u = -1),
              (p = null),
              e.changed(),
              y());
          }).setAttribute("aria-label", `Excluir corpo ${o.corpseId}`);
        }),
        x());
    }
    function y() {
      if (!l) return;
      const e = l.container;
      (e.replaceChildren(), C(e));
    }
    return {
      render: C,
      refresh: x,
      update: function () {
        const o = f(),
          t = o?.telemetry?.inspection;
        if (
          (p &&
            (!h() || p.pid !== o?.pid || Date.now() > p.expires) &&
            ((p = null), e.log("Seleção de item cancelada.")),
          t && o.online && !o.stale && d !== `${o.pid}:${t.revision}`)
        ) {
          const a = null === d;
          ((d = `${o.pid}:${t.revision}`),
            !a &&
              l?.lookBox &&
              (l.lookBox.classList.remove("fresh"),
              l.lookBox.offsetWidth,
              l.lookBox.classList.add("fresh")));
          const n = !!p && t.revision !== p.revision;
          let r = "";
          if (n)
            if ("item" !== t.kind)
              ((r =
                "Isso é uma criatura. Dê Shift + clique em um item ou corpo."),
                e.log("Selecione um item ou corpo no jogo.", "error"));
            else {
              const { entry: o, key: a } = p;
              "corpseId" === a &&
              g().captureEntries.some((e) => e !== o && e.corpseId === t.id)
                ? ((r = "Esse corpo já está na lista."),
                  e.log("Esse corpo já está configurado.", "error"))
                : ((o[a] = t.id),
                  (p = null),
                  (r = `Pronto: definido como ${k[a]} da captura.`),
                  g().captureEntries.includes(o) && e.changed(),
                  y());
            }
          a ||
            (!n && !l) ||
            (function (o, t, a) {
              const n =
                  "item" === o.kind
                    ? o.container
                      ? "Item com espaço (container)"
                      : "Item"
                    : "Criatura",
                r = o.pos ? ` · ${o.pos.x}, ${o.pos.y}, ${o.pos.z}` : "";
              e.api
                ?.showLook?.(
                  {
                    id: o.id,
                    title:
                      b(o) ||
                      ("item" === o.kind ? "ID do item" : "ID da criatura"),
                    detail: n + r,
                    note: t,
                  },
                  a,
                )
                .catch((o) => e.log(o.message, "error"));
            })(t, r, n);
        }
        x();
      },
      hide() {
        (clearTimeout(m), (l = null), (p = null));
      },
      reset() {
        (clearTimeout(m),
          (p = null),
          (u = -1),
          (I = { name: "", corpseId: 0, ballId: 0, fallbackBallId: 0 }));
      },
    };
  },
};
