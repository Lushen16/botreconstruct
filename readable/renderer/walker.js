"use strict";
window.PkaWalkerUI = {
  create(e) {
    const t = window.PkaWalker,
      a = new t.Recorder(),
      o = window.PkaUI,
      { set: n, attribute: r } = o,
      i = window.PkaGuildDailyUI.create(e),
      s = {
        walk: "Walk",
        safespot: "Safe Spot",
        box: "BOX",
        stairs: "Stair",
        wait: "Wait",
        say: "Say",
      },
      l = {
        walk: "Walk: ponto de passagem. O bot anda até ele e segue para o próximo.",
        safespot:
          "Safe Spot: ponto seguro. Depois de cada lure o Hoenn corre para o próximo Safe Spot da rota para recuperar o time. Para o Walker é um ponto comum.",
        box: "BOX: lugar onde o Hoenn para e fecha a box com os monstros. Para o Walker é um ponto comum.",
        stairs:
          "Stair: escada, buraco ou rampa. O bot pisa nela (ou anda na direção escolhida) e espera trocar de andar.",
        wait: "Wait: o bot fica parado nesse ponto pelo tempo de “Wait (ms)”.",
        say: "Say: o bot escreve no chat a mensagem de “Say (mensagem)”.",
      },
      c = {
        walk: "",
        safespot: "S",
        box: "B",
        stairs: "↕",
        wait: "W",
        say: "…",
      },
      d = {
        walk: "#80b8f5",
        safespot: "#76d29f",
        box: "#f6ac70",
        stairs: "#d6a0ef",
        wait: "#e5d47a",
        say: "#b9cae1",
      },
      p = {
        selected: -1,
        center: null,
        scale: 8,
        follow: !0,
        mode: "off",
        hover: null,
        request: 0,
        expanded: !1,
      };
    let u = null,
      m = null,
      f = null,
      g = null,
      w = !1,
      h = !1,
      v = null,
      y = [],
      x = null,
      b = null,
      k = !1,
      S = "";
    const M = () => e.getConfig().walker,
      C = () => e.getSession(),
      L = () => e.getConfig().target.luring,
      R = () => e.getRuntime().modules.includes("walker"),
      P = () => {
        try {
          return t.currentPosition(C());
        } catch {
          return null;
        }
      };
    function A(t, a = !1) {
      e.log(t, a ? "error" : "info");
    }
    const E = (e, t) => {
      e.textContent !== t && (e.textContent = t);
    };
    function q() {
      ((S = ""), e.changed(), G(), Y(), Q());
    }
    function O() {
      if (a.active) throw Error("Pare a gravação antes de editar os pontos.");
      if (R()) throw Error("Pare o Walker antes de editar a rota.");
    }
    const D = () =>
      !a.active &&
      !e.getRuntime().modules.some((e) => "walker" === e || "hoenn" === e);
    function N() {
      if ((O(), !D()))
        throw Error("Pause o Hoenn antes de arrastar os pontos da rota.");
    }
    function z() {
      ((b = null),
        u?.list
          .querySelectorAll(".drop-before,.drop-after")
          .forEach((e) => e.classList.remove("drop-before", "drop-after")));
    }
    function W(e) {
      if (
        !t.validPosition(e) ||
        !g ||
        e.z !== g.z ||
        e.x < g.x ||
        e.y < g.y ||
        e.x >= g.x + g.width ||
        e.y >= g.y + g.height
      )
        throw Error("Waypoint fora do mapa conhecido.");
      const a = g.flags[(e.y - g.y) * g.width + e.x - g.x];
      if (!a) throw Error("Waypoint fora do mapa conhecido.");
      if (6 & a) throw Error("Waypoint bloqueado no mapa (parede ou água).");
    }
    function B(e, a = !1) {
      const o = M().waypoints,
        n = o.at(-1);
      (a &&
        n?.action === e.action &&
        t.equal(n.pos, e.pos) &&
        String(n.param) === String(e.param)) ||
        ((p.selected = t.insert(o, a ? null : p.selected, e)), q());
    }
    function $(t = !0) {
      a.active &&
        (a.stop(),
        Q(),
        e.viewChanged?.(),
        t && A(`Gravação parada · ${M().waypoints.length} pontos na rota.`));
    }
    function T(e) {
      return "wait" === e
        ? u.wait.value
        : "say" === e
          ? u.say.value
          : "stairs" === e
            ? u.direction.value
            : "";
    }
    function I(e, a) {
      if ("say" === e && !u.say.value.trim())
        return (
          u.say.focus(),
          A("Escreva a mensagem em “Say (mensagem)” e clique de novo.", !0)
        );
      try {
        (O(), B(t.waypoint(e, a, T(e), u.stairCheck.checked)));
      } catch (e) {
        A(e.message, !0);
      }
    }
    function H(e) {
      const t = P();
      if (!t) return A("Entre no personagem para usar a sua posição.", !0);
      I(e, t);
    }
    function j(e) {
      ((p.selected = e), G(), Y(), Q());
    }
    function G() {
      if (!u) return;
      const t = u.list.scrollTop;
      (u.list.replaceChildren(),
        M().waypoints.forEach((t, a) => {
          const o = e.node(
            "button",
            "walker-waypoint" + (a === p.selected ? " selected" : ""),
          );
          o.type = "button";
          const n = e.node("span", "wp-kind", s[t.action]);
          (n.style.setProperty("--wp-color", d[t.action]),
            o.append(
              e.node("span", "wp-number", String(a + 1).padStart(3, "0")),
              n,
              e.node(
                "span",
                "wp-coordinates",
                `${t.pos.x}, ${t.pos.y}, ${t.pos.z}`,
              ),
            ),
            "" !== t.param &&
              o.append(e.node("span", "wp-param", String(t.param))),
            (o.title =
              "Arraste para reordenar · clique para selecionar · duplo clique mostra no mapa"),
            (o.draggable = D()),
            o.addEventListener("dragstart", (e) => {
              try {
                N();
              } catch (t) {
                return (e.preventDefault(), A(t.message, !0));
              }
              ((b = { points: M().waypoints, point: t, from: a }),
                e.dataTransfer.setData("application/x-pka-waypoint", String(a)),
                (e.dataTransfer.effectAllowed = "move"));
            }),
            o.addEventListener("dragover", (e) => {
              if (!b || b.points !== M().waypoints || !D()) return;
              (e.preventDefault(),
                (e.dataTransfer.dropEffect = "move"),
                u.list
                  .querySelectorAll(".drop-before,.drop-after")
                  .forEach((e) =>
                    e.classList.remove("drop-before", "drop-after"),
                  ));
              const t = o.getBoundingClientRect();
              o.classList.add(
                e.clientY >= t.top + t.height / 2
                  ? "drop-after"
                  : "drop-before",
              );
            }),
            o.addEventListener("drop", (e) => {
              e.preventDefault();
              const n = b;
              if ((z(), n))
                try {
                  N();
                  const r = M().waypoints;
                  if (r !== n.points || r[n.from] !== n.point || r[a] !== t)
                    return;
                  const i = o.getBoundingClientRect();
                  let s = a + (e.clientY >= i.top + i.height / 2 ? 1 : 0);
                  if ((n.from < s && s--, s === n.from)) return;
                  (r.splice(n.from, 1),
                    r.splice(s, 0, n.point),
                    (p.selected = s),
                    q());
                } catch (e) {
                  A(e.message, !0);
                }
            }),
            o.addEventListener("dragend", z),
            o.setAttribute(
              "aria-label",
              `Ponto ${a + 1} ${s[t.action]} ${t.pos.x}, ${t.pos.y}, ${t.pos.z}`,
            ),
            o.addEventListener("click", () => j(a)),
            o.addEventListener("dblclick", () => {
              return (
                (e = t.pos),
                (p.center = { ...e }),
                (p.follow = !1),
                J(),
                void Q()
              );
              var e;
            }),
            u.list.append(o));
        }),
        M().waypoints.length ||
          u.list.append(
            e.node(
              "p",
              "walker-empty",
              "Sem pontos. Clique em ● Gravar e ande no jogo, ou escolha uma ação no mapa e clique onde quer o ponto.",
            ),
          ),
        (u.list.scrollTop = t),
        (u.count.textContent = ` · ${M().waypoints.length}`));
    }
    function F() {
      if (!u) return;
      const t = M().luaProfile,
        a = u.route;
      a.replaceChildren();
      const o = y.some((e) => e.id === t);
      t
        ? o ||
          a.append(
            Object.assign(e.node("option", "", t.slice(3, -4)), { value: t }),
          )
        : a.append(
            Object.assign(e.node("option", "", "Rota deste perfil"), {
              value: "",
            }),
          );
      for (const t of y)
        a.append(Object.assign(e.node("option", "", t.name), { value: t.id }));
      a.value = t;
    }
    function U(e) {
      if (!(e = e.trim()) || e.length > 60 || /[\\/<>:"|?*\x00-\x1f]/u.test(e))
        return A('Use um nome de rota sem \\ / : * ? " < > |.', !0);
      const t = `wk_${e}.lua`;
      if (y.some((e) => e.id.toLowerCase() === t.toLowerCase()))
        return A(`Já existe uma rota chamada “${e}”. Escolha outro nome.`, !0);
      try {
        O();
      } catch (e) {
        return A(e.message, !0);
      }
      ((M().waypoints = []),
        (M().luaProfile = t),
        (M().luaRevision = ""),
        (p.selected = -1),
        y.push({ id: t, name: e }),
        y.sort((e, t) =>
          e.name.localeCompare(t.name, "pt-BR", { numeric: !0 }),
        ),
        (u.newRoute.hidden = !0),
        F(),
        q(),
        A(
          `Rota “${e}” criada. Clique em ● Gravar e ande no jogo, ou adicione pontos pelo mapa.`,
        ));
    }
    function Q() {
      if ((i.refresh(), !u)) return;
      const t = P(),
        l = e.getRuntime(),
        c = R(),
        d = l.paused && l.pausedModules?.includes("walker"),
        m = a.active
          ? `Gravando: um ponto a cada ${a.step} SQM andados. Clique em ■ Parar gravação quando terminar.`
          : d
            ? `Pausado no ponto ${l.walkerIndex + 1}. Use Continuar ou a tecla de pausa.`
            : M().waypoints.length
              ? t
                ? "Parado. Clique em ▶ Iniciar para andar a rota."
                : "Entre no personagem para iniciar."
              : "Esta rota ainda não tem pontos. Clique em ● Gravar e ande no jogo.";
      (o.drawCycle(u.cycle, l, m),
        E(u.status, !c && l.modules.length ? `Walker: ${m}` : ""),
        n(u.status, "hidden", !u.status.textContent),
        u.status.classList.toggle("recording", a.active),
        n(u.start, "disabled", a.active || !t || c || !M().waypoints.length),
        n(u.stop, "disabled", !c),
        E(u.record, a.active ? "■ Parar gravação" : "● Gravar"),
        u.record.classList.toggle("recording", a.active),
        n(u.record, "disabled", c || (!a.active && !t)));
      for (const e of u.actionButtons) n(e, "disabled", !t || a.active || c);
      for (const e of u.editButtons)
        n(e, "disabled", a.active || c || p.selected < 0);
      (n(u.clear, "disabled", a.active || c || !M().waypoints.length),
        n(u.newRouteButton, "disabled", a.active || c),
        n(u.route, "disabled", a.active));
      const g = M().waypoints[p.selected];
      n(u.actionSelect, "value", g?.action || "");
      const w = u.dynamic,
        h = L().frontEnabled;
      (E(w, "Dynamic Lure: " + (h ? "ON" : "OFF")),
        w.classList.toggle("on", h),
        r(w, "aria-pressed", h));
      const v = L().enabled;
      (E(u.distance, "Lure de Acompanhamento: " + (v ? "ON" : "OFF")),
        u.distance.classList.toggle("on", v),
        r(u.distance, "aria-pressed", v),
        n(u.dynamicSettings, "hidden", !h),
        n(u.distanceSettings, "hidden", !v),
        E(
          u.lureHelp,
          v
            ? "Com monstros válidos na tela, o treinador espera se o Pokémon ficar além da distância máxima. Volta a andar assim que ele se aproxima."
            : h
              ? "O Pokémon recebe ordens três SQM à frente da rota. Se ficar para trás durante a lure, o treinador espera ou volta para buscá-lo."
              : "Escolha um modo para reunir os monstros durante a rota. Use com o Target ou o Hoenn ligado.",
        ),
        (a.active || c) && (p.mode = "off"));
      for (const [e, t] of Object.entries(u.mapModes)) {
        const o = p.mode === e;
        (t.classList.toggle("selected", o),
          r(t, "aria-pressed", o),
          n(t, "disabled", a.active || c));
      }
      (f.classList.toggle("adding-waypoint", "off" !== p.mode),
        n(u.mapHint, "hidden", "off" === p.mode),
        E(
          u.mapHint,
          "off" === p.mode
            ? ""
            : `Clique no mapa para adicionar ${s[p.mode]} · Esc ou botão direito cancela`,
        ));
      const y = p.hover || (p.follow && t) || p.center;
      (E(u.coords, y ? `${y.x}, ${y.y}, ${y.z}` : "—"),
        n(
          u.coords,
          "title",
          p.hover
            ? "Tile sob o mouse"
            : p.follow
              ? "Sua posição"
              : "Centro do mapa",
        ),
        u.followButton.classList.toggle("selected", p.follow),
        r(u.followButton, "aria-pressed", p.follow),
        n(u.zoomOut, "disabled", p.scale <= 2),
        n(u.zoomIn, "disabled", p.scale >= 24));
      const x = D();
      if (u.draggable !== x) {
        u.draggable = x;
        for (const e of u.list.querySelectorAll(".walker-waypoint"))
          e.draggable = x;
      }
      (n(u.openMap, "disabled", k),
        n(u.resetMap, "disabled", k || !u.customMap),
        r(u.expand, "aria-pressed", p.expanded),
        n(
          u.expand,
          "title",
          p.expanded ? "Voltar ao tamanho normal" : "Ampliar o mapa",
        ));
    }
    function V(e) {
      const t = f.getBoundingClientRect();
      return { x: e.clientX - t.left, y: e.clientY - t.top };
    }
    function X(e) {
      return (
        g && {
          x: g.x + Math.floor(e.x / g.scale),
          y: g.y + Math.floor(e.y / g.scale),
          z: g.z,
        }
      );
    }
    function Y() {
      if (!f || !u || !p.center) return;
      const e = JSON.stringify([
        p.request,
        f.width,
        f.height,
        p.center,
        p.selected,
        p.hover,
        p.mode,
        P(),
        x?.target,
        M().waypoints.length,
      ]);
      if (e === S) return;
      S = e;
      const t = f.getContext("2d");
      if (
        ((t.fillStyle = "#14181d"),
        t.fillRect(0, 0, f.width, f.height),
        (t.imageSmoothingEnabled = !1),
        m &&
          g &&
          g.z === p.center.z &&
          t.drawImage(m, 0, 0, m.width * g.scale, m.height * g.scale),
        !g)
      )
        return;
      const a = (e) => ({
          x: (e.x - g.x + 0.5) * g.scale,
          y: (e.y - g.y + 0.5) * g.scale,
        }),
        o = M().waypoints,
        n = (e) => (x?.point === e && x.moved && x.target ? x.target : e.pos);
      ((t.strokeStyle = "#ffffff55"),
        (t.lineWidth = Math.max(1, g.scale / 5)),
        t.setLineDash([4, 3]),
        t.beginPath());
      let r = null;
      for (const e of o) {
        if (e.pos.z !== g.z) {
          r = null;
          continue;
        }
        const o = a(n(e));
        (r ? t.lineTo(o.x, o.y) : t.moveTo(o.x, o.y), (r = o));
      }
      (t.stroke(), t.setLineDash([]));
      const i = g.scale >= 6;
      o.forEach((e, o) => {
        if (e.pos.z !== g.z) return;
        const r = a(n(e));
        if (r.x < -20 || r.y < -20 || r.x > f.width + 20 || r.y > f.height + 20)
          return;
        const s = o === p.selected,
          l = c[e.action],
          u = l
            ? Math.max(6, Math.min(10, 0.75 * g.scale))
            : Math.max(3, Math.min(6, 0.45 * g.scale));
        ((t.fillStyle = d[e.action]),
          (t.strokeStyle = s ? "#fff" : "#0b0f14"),
          (t.lineWidth = s ? 2.5 : 1.5),
          t.beginPath(),
          t.arc(r.x, r.y, u + (s ? 2 : 0), 0, 2 * Math.PI),
          t.fill(),
          t.stroke(),
          l &&
            ((t.fillStyle = "#10161d"),
            (t.font = `bold ${Math.round(1.15 * u)}px Verdana`),
            (t.textAlign = "center"),
            (t.textBaseline = "middle"),
            t.fillText(l, r.x, r.y + 0.5)),
          (i || s) &&
            ((t.font = "bold 10px Verdana"),
            (t.textAlign = "left"),
            (t.textBaseline = "alphabetic"),
            (t.lineWidth = 3),
            (t.strokeStyle = "#0b0f14"),
            t.strokeText(String(o + 1), r.x + u + 2, r.y - u + 2),
            (t.fillStyle = "#f2f4f7"),
            t.fillText(String(o + 1), r.x + u + 2, r.y - u + 2)));
      });
      const s = P();
      if (s?.z === g.z) {
        const e = a(s),
          o = Math.max(6, 0.9 * g.scale);
        ((t.lineCap = "square"),
          (t.strokeStyle = "#0b0f14"),
          (t.lineWidth = 5),
          t.beginPath(),
          t.moveTo(e.x - o, e.y),
          t.lineTo(e.x + o, e.y),
          t.moveTo(e.x, e.y - o),
          t.lineTo(e.x, e.y + o),
          t.stroke(),
          (t.strokeStyle = "#fff"),
          (t.lineWidth = 2),
          t.stroke());
      }
      if (p.hover?.z === g.z) {
        const e = a(p.hover);
        ((t.strokeStyle = "off" === p.mode ? "#ffffff99" : d[p.mode]),
          (t.lineWidth = "off" === p.mode ? 1 : 2),
          t.strokeRect(e.x - g.scale / 2, e.y - g.scale / 2, g.scale, g.scale));
      }
    }
    async function J() {
      if (!u || !f?.isConnected || !p.center) return;
      if (w) return void (h = !0);
      if (!e.api?.mapRegion) return;
      const a = Math.max(160, Math.floor(f.clientWidth)),
        o = Math.max(160, Math.floor(f.clientHeight));
      (f.width !== a && (f.width = a), f.height !== o && (f.height = o));
      const n = p.scale,
        r = t.viewport(p.center, a, o, n),
        i = ++p.request;
      w = !0;
      try {
        const t = await e.api.mapRegion(r);
        if (i !== p.request || !f) return;
        const a = document.createElement("canvas");
        ((a.width = t.width),
          (a.height = t.height),
          a
            .getContext("2d")
            .putImageData(
              new ImageData(new Uint8ClampedArray(t.pixels), t.width, t.height),
              0,
              0,
            ),
          (m = a),
          (g = { ...t, scale: n }),
          (S = ""),
          Y(),
          Q());
      } catch (e) {
        A(`Mapa: ${e.message}`, !0);
      } finally {
        ((w = !1), h && ((h = !1), J()));
      }
    }
    function _(e) {
      u &&
        ((u.customMap = !!e.custom),
        (u.mapSource.textContent = e.custom
          ? e.filename.split(/[\\/]/u).at(-1)
          : "Mapa padrão"),
        (u.mapSource.title = e.filename),
        e.error && A(e.error, !0));
    }
    async function K(t = !1) {
      if (k) return;
      const a = u;
      ((k = !0), Q());
      try {
        const o = await (t ? e.api?.resetMap() : e.api?.openMap());
        if (!o || u !== a) return;
        ((x = null),
          p.request++,
          (m = null),
          (g = null),
          _(o),
          (p.center = P() || M().waypoints[0]?.pos || o.first),
          (p.follow = !!P()),
          await J(),
          A(t ? "Mapa padrão restaurado." : "Mapa carregado."));
      } catch (e) {
        u === a && A(e.message, !0);
      } finally {
        ((k = !1), u && Q());
      }
    }
    function Z(e = 0, t = 0, a = 0) {
      p.center &&
        ((p.follow = !1),
        (p.center = {
          x: Math.max(0, Math.min(65534, Math.round(p.center.x + e))),
          y: Math.max(0, Math.min(65534, Math.round(p.center.y + t))),
          z: Math.max(0, Math.min(15, p.center.z + a)),
        }),
        J(),
        Q());
    }
    function ee(e) {
      ((p.scale = Math.max(2, Math.min(24, p.scale + e))), J(), Q());
    }
    function te() {
      p.follow = !0;
      const e = P();
      (e
        ? ((p.center = e), J())
        : A("Entre no personagem para o mapa seguir você.", !0),
        Q());
    }
    let ae = -1 / 0;
    return {
      render: function (n) {
        (v?.disconnect(),
          p.request++,
          (S = ""),
          (x = null),
          (b = null),
          (u = { actionButtons: [], editButtons: [], mapModes: {} }),
          (m = null),
          (g = null));
        const r = e.node,
          c = r(
            "div",
            "walker-workspace" + (p.expanded ? " map-expanded" : ""),
          ),
          h = r("section", "walker-sidebar"),
          k = r("section", "walker-map");
        function E(e, t = "") {
          const a = r("section", `walker-section ${t}`.trim());
          return (e && a.append(r("h2", "", e)), h.append(a), a);
        }
        function z(e, t = "") {
          const a = r("div", `walker-row ${t}`.trim());
          return (e.append(a), a);
        }
        function ae(e, t, a, o = "") {
          const n = r("button", o, t);
          return (
            (n.type = "button"),
            n.addEventListener("click", a),
            e.append(n),
            n
          );
        }
        function oe(t, o, n, i, s, l = M(), c = "") {
          const d = r("label", "walker-input", o),
            p = r("input");
          return (
            (p.type = "number"),
            (p.min = i),
            (p.max = s),
            (p.value = l[n]),
            c && (d.title = c),
            p.addEventListener("input", () => {
              Number.isInteger(p.valueAsNumber) &&
                ((l[n] = p.valueAsNumber),
                "recordStepDistance" === n && (a.step = p.valueAsNumber),
                e.changed());
            }),
            d.append(p),
            t.append(d),
            p
          );
        }
        function ne(t, a, o, n) {
          const r = ae(
            t,
            "",
            () => {
              ((M()[o] = !M()[o]), i(), e.changed());
            },
            "target-toggle",
          );
          function i() {
            ((r.textContent = `${a}: ${M()[o] ? "ON" : "OFF"}`),
              r.classList.toggle("on", !!M()[o]),
              r.setAttribute("aria-pressed", String(!!M()[o])));
          }
          return ((r.title = n), i(), r);
        }
        (c.append(h, k), n.append(c));
        const re = E("Rota", "walker-route"),
          ie = z(re, "walker-route-row");
        ((u.route = r("select")),
          u.route.setAttribute("aria-label", "Rota em uso"),
          (u.route.title =
            "A rota em uso. Cada rota fica salva na pasta do bot e pode ser usada em qualquer perfil."),
          ie.append(u.route),
          u.route.addEventListener("change", () => {
            const t = u.route.value;
            t &&
              t !== M().luaProfile &&
              (!R() ||
              window.confirm("Trocar de rota pausa o Walker. Continuar?")
                ? ($(!1), e.loadProfile?.(t))
                : F());
          }),
          (u.newRouteButton = ae(ie, "+ Nova rota", () => {
            ((u.newRoute.hidden = !u.newRoute.hidden),
              u.newRoute.hidden ||
                ((u.newRouteName.value = ""), u.newRouteName.focus()));
          })),
          (u.newRouteButton.title =
            "Cria uma rota vazia com outro nome. A rota atual continua salva."),
          (u.newRoute = r("form", "walker-new-route")),
          (u.newRoute.hidden = !0),
          re.append(u.newRoute),
          (u.newRouteName = r("input")),
          (u.newRouteName.placeholder = "Nome da nova rota"),
          (u.newRouteName.maxLength = 60),
          u.newRouteName.setAttribute("aria-label", "Nome da nova rota"),
          u.newRoute.append(u.newRouteName),
          ae(u.newRoute, "Criar", () => U(u.newRouteName.value), "primary"),
          ae(u.newRoute, "Cancelar", () => {
            u.newRoute.hidden = !0;
          }),
          u.newRoute.addEventListener("submit", (e) => {
            (e.preventDefault(), U(u.newRouteName.value));
          }));
        const se = E("", "walker-now");
        ((u.cycle = o.cycleElement(r)),
          se.append(u.cycle),
          (u.status = r("p", "walker-status")),
          se.append(u.status));
        const le = z(se, "walker-controls");
        ((u.start = ae(
          le,
          "▶ Iniciar",
          () => {
            ($(!1), e.run(!0));
          },
          "walker-start",
        )),
          (u.start.title =
            "Começa a andar a rota. Com “Ponto mais próximo: ON” começa pelo ponto mais perto de você."),
          (u.stop = ae(le, "■ Parar", () => e.run(!1), "walker-stop")),
          (u.stop.title = "Para o Walker. A rota continua salva."),
          (u.record = ae(le, "● Gravar", () => {
            try {
              if (a.active) return $();
              O();
              const t = a.start(C(), M().recordStepDistance);
              for (const e of t) B(e, !0);
              (e.viewChanged?.(),
                A(
                  "Gravando. Ande pelo jogo; cada passo da rota vira um ponto.",
                ));
            } catch (e) {
              A(e.message, !0);
            }
            Q();
          })),
          (u.record.title =
            "Grava a rota enquanto você anda no jogo: um ponto Walk a cada “Gravar um ponto a cada (SQM)”. Clique de novo para parar."),
          (u.clear = ae(
            le,
            "Limpar",
            () => {
              window.confirm("Apagar todos os pontos desta rota?") &&
                ((M().waypoints = []),
                (p.selected = -1),
                q(),
                A("Rota limpa. Grave ou adicione os pontos de novo."));
            },
            "danger",
          )),
          (u.clear.title =
            "Apaga todos os pontos desta rota (pede confirmação antes)."));
        const ce = E("Pontos da rota", "walker-points");
        ((u.count = r("span", "walker-count")),
          ce.querySelector("h2").append(u.count),
          (u.list = r("div", "walker-list")),
          ce.append(u.list));
        const de = z(ce, "walker-edit");
        (u.editButtons.push(
          ae(de, "↑", () => {
            const e = p.selected;
            if (e > 0) {
              const t = M().waypoints;
              (([t[e - 1], t[e]] = [t[e], t[e - 1]]), p.selected--, q());
            }
          }),
        ),
          (u.editButtons.at(-1).title =
            "Sobe o ponto selecionado na lista (ele passa a vir antes)."),
          u.editButtons.push(
            ae(de, "↓", () => {
              const e = p.selected,
                t = M().waypoints;
              e + 1 < t.length &&
                (([t[e + 1], t[e]] = [t[e], t[e + 1]]), p.selected++, q());
            }),
          ),
          (u.editButtons.at(-1).title =
            "Desce o ponto selecionado na lista (ele passa a vir depois)."),
          (u.actionSelect = r("select")),
          u.actionSelect.setAttribute(
            "aria-label",
            "Trocar a ação do ponto selecionado",
          ),
          (u.actionSelect.title =
            "Troca o tipo do ponto selecionado (Walk, Safe Spot, BOX, Stair, Wait ou Say) sem mudar o lugar."),
          u.actionSelect.append(
            Object.assign(r("option", "", "Trocar ação…"), {
              value: "",
              disabled: !0,
            }),
          ));
        for (const e of t.ACTIONS)
          u.actionSelect.append(
            Object.assign(r("option", "", s[e]), { value: e }),
          );
        (u.actionSelect.addEventListener("change", () => {
          const e = u.actionSelect.value,
            a = M().waypoints[p.selected];
          if (e && a)
            try {
              ((M().waypoints[p.selected] = t.waypoint(
                e,
                a.pos,
                T(e),
                u.stairCheck.checked,
              )),
                q());
            } catch (e) {
              (A(e.message, !0), Q());
            }
        }),
          de.append(u.actionSelect),
          u.editButtons.push(u.actionSelect),
          u.editButtons.push(
            ae(de, "Minha posição", () => {
              const e = P();
              if (!e)
                return A("Entre no personagem para usar a sua posição.", !0);
              ((M().waypoints[p.selected].pos = e), q());
            }),
          ),
          (u.editButtons.at(-1).title =
            "Move o ponto selecionado para o tile onde você está agora."),
          u.editButtons.push(
            ae(
              de,
              "Excluir",
              () => {
                (M().waypoints.splice(p.selected, 1),
                  (p.selected = Math.min(p.selected, M().waypoints.length - 1)),
                  q());
              },
              "danger",
            ),
          ),
          (u.editButtons.at(-1).title = "Apaga só o ponto selecionado."));
        const pe = E("Adicionar ponto onde você está", "walker-add"),
          ue = r("div", "walker-actions");
        pe.append(ue);
        for (const e of t.ACTIONS) {
          const t = ae(ue, s[e], () => H(e), "wp-action");
          (t.style.setProperty("--wp-color", d[e]),
            (t.title = `${l[e]} O ponto é criado no tile onde você está, depois do ponto selecionado.`),
            u.actionButtons.push(t));
        }
        const me = E("Ajustes de Wait, Say e Stair", "walker-param-box"),
          fe = z(me, "walker-params"),
          ge = r("label", "walker-input", "Wait (ms)");
        ((ge.title =
          "Tempo parado de cada novo ponto Wait. 1000 ms = 1 segundo."),
          (u.wait = r("input")),
          (u.wait.type = "number"),
          (u.wait.min = 0),
          (u.wait.max = 36e5),
          (u.wait.value = "1000"),
          ge.append(u.wait),
          fe.append(ge));
        const we = r("label", "walker-input", "Stair: direção");
        ((we.title =
          "Para onde o bot anda para usar a escada. “No tile”: ele só pisa no ponto (buraco, rampa)."),
          (u.direction = r("select")));
        for (const [e, t] of [
          ["", "No tile"],
          ["north", "Norte"],
          ["east", "Leste"],
          ["south", "Sul"],
          ["west", "Oeste"],
        ]) {
          const a = r("option", "", t);
          ((a.value = e), u.direction.append(a));
        }
        (we.append(u.direction), fe.append(we));
        const he = r("label", "walker-input walker-say", "Say (mensagem)");
        ((he.title = "Mensagem que cada novo ponto Say escreve no chat."),
          (u.say = r("input")),
          (u.say.type = "text"),
          (u.say.placeholder = "Texto enviado no chat"),
          he.append(u.say),
          me.append(he));
        const ve = r("label", "walker-check");
        ((ve.title =
          "Marcado: com monstros na tela, o bot espera eles morrerem (o Target luta) antes de usar a escada."),
          (u.stairCheck = r("input")),
          (u.stairCheck.type = "checkbox"),
          ve.append(
            u.stairCheck,
            document.createTextNode("Stair: limpar os monstros antes de subir"),
          ),
          me.append(ve));
        const ye = E("Opções da rota", "walker-options"),
          xe = z(ye);
        (ne(
          xe,
          "Loop",
          "loop",
          "ON: ao chegar no último ponto, volta para o primeiro e repete a rota. OFF: o Walker para no último ponto.",
        ),
          ne(
            xe,
            "Ponto mais próximo",
            "startNearestWaypoint",
            "ON: ao iniciar, começa pelo ponto mais perto de você. OFF: começa sempre pelo primeiro ponto.",
          ),
          oe(
            z(ye),
            "Gravar um ponto a cada (SQM)",
            "recordStepDistance",
            1,
            100,
            M(),
            "Distância entre os pontos criados pelo ● Gravar. Menor = rota mais detalhada.",
          ));
        const be = E("Luring", "walker-luring"),
          ke = z(be);
        ((u.dynamic = ae(
          ke,
          "Dynamic Lure",
          () => {
            (t.setLureMode(L(), "dynamic"), e.changed(), Q());
          },
          "target-toggle",
        )),
          (u.dynamic.title =
            "ON: o seu Pokémon anda três tiles à frente na rota, puxando os monstros; quando ele fica longe, o treinador espera ou volta para buscá-lo. Precisa do Target ou do Hoenn ligado."),
          (u.distance = ae(
            ke,
            "Lure de Acompanhamento",
            () => {
              (t.setLureMode(L(), "distance"), e.changed(), Q());
            },
            "target-toggle",
          )),
          (u.distance.title =
            "Com monstros válidos na tela e o Pokémon além do limite, o treinador pausa a rota e usa Order para ajudá-lo a se aproximar. Retoma ao alcançar a distância máxima. Após mais de oito segundos de espera, libera a caminhada por três segundos. Ativar este modo desliga o Dynamic Lure."),
          (u.lureHelp = r("p", "walker-lure-help")),
          be.append(u.lureHelp));
        const Se = z(be);
        ((u.dynamicSettings = Se),
          oe(
            Se,
            "Recuperar (SQM)",
            "frontRegroupMargin",
            4,
            8,
            L(),
            "Dynamic Lure: com o Pokémon a esta distância (ou mais), o treinador para e o espera. De 4 a 8.",
          ),
          oe(
            Se,
            "Liberar (SQM)",
            "frontRegroupSteps",
            1,
            4,
            L(),
            "Dynamic Lure: quando o Pokémon volta para esta distância, o treinador volta a andar. De 1 a 4.",
          ),
          (u.distanceSettings = z(be)),
          oe(
            u.distanceSettings,
            "Distância máxima (SQM)",
            "maxDistance",
            1,
            30,
            L(),
            "Distância entre treinador e Pokémon. Com limite 3, a rota pausa a partir de 4 SQM e retoma em 3 SQM ou menos. Só espera enquanto houver monstros válidos na tela.",
          ),
          i.render(h));
        const Me = r("div", "minimap-head");
        ((u.coords = r("span", "minimap-coords", "—")),
          Me.append(r("span", "minimap-title", "Minimapa"), u.coords),
          k.append(Me));
        const Ce = r("div", "minimap-body");
        (k.append(Ce),
          (f = r("canvas", "walker-map-canvas")),
          (f.tabIndex = 0),
          f.setAttribute("aria-label", "Minimapa da rota"),
          Ce.append(f));
        const Le = r("div", "minimap-palette");
        (Le.setAttribute("aria-label", "Adicionar ponto pelo mapa"),
          Ce.append(Le));
        for (const e of t.ACTIONS) {
          const t = ae(
            Le,
            s[e],
            () => {
              ((p.mode = p.mode === e ? "off" : e),
                Q(),
                f.focus({ preventScroll: !0 }));
            },
            "minimap-mode",
          );
          (t.style.setProperty("--wp-color", d[e]),
            (t.title = `${l[e]} Clique aqui e depois no mapa, onde quer o ponto. Clique de novo (ou Esc) para cancelar.`),
            t.setAttribute("aria-label", `Adicionar ${s[e]} pelo mapa`),
            (u.mapModes[e] = t));
        }
        ((u.mapHint = r("p", "minimap-hint")),
          (u.mapHint.hidden = !0),
          Ce.append(u.mapHint),
          (u.mapSource = r("p", "minimap-source", "Mapa padrão")),
          k.append(u.mapSource));
        const Re = r("div", "minimap-toolbar");
        k.append(Re);
        const Pe = (e, t, a, o = "") => {
          const n = ae(Re, e, a, `minimap-tool ${o}`.trim());
          return ((n.title = t), n.setAttribute("aria-label", t), n);
        };
        (Pe("↑", "Mostrar o andar de cima (Page Up)", () => Z(0, 0, -1)),
          Pe("↓", "Mostrar o andar de baixo (Page Down)", () => Z(0, 0, 1)),
          (u.followButton = Pe(
            "⌖",
            "Centralizar no seu personagem e seguir ele (Home)",
            te,
            "minimap-follow",
          )),
          (u.zoomOut = Pe("−", "Diminuir o zoom (−)", () => ee(-2))),
          (u.zoomIn = Pe("+", "Aumentar o zoom (+)", () => ee(2))),
          (u.expand = Pe(
            "⛶",
            "Ampliar o mapa",
            () => {
              ((p.expanded = !p.expanded),
                c.classList.toggle("map-expanded", p.expanded),
                Q(),
                requestAnimationFrame(() => J()));
            },
            "minimap-expand",
          )),
          (u.openMap = Pe(
            "Abrir mapa",
            "Carregar seu mapa .otmm/.otm",
            () => K(),
            "minimap-load",
          )),
          (u.resetMap = Pe(
            "↺",
            "Restaurar mapa padrão",
            () => K(!0),
            "minimap-reset",
          )),
          (f.title =
            "Arraste um ponto para reposicioná-lo. Arraste o fundo para mover o mapa. Roda do mouse: zoom."),
          k.addEventListener("keydown", (e) => {
            "Escape" === e.key &&
              "off" !== p.mode &&
              (e.preventDefault(), (p.mode = "off"), Q());
          }),
          f.addEventListener("keydown", (e) => {
            const t = {
              ArrowLeft: [-8, 0, 0],
              ArrowRight: [8, 0, 0],
              ArrowUp: [0, -8, 0],
              ArrowDown: [0, 8, 0],
              PageUp: [0, 0, -1],
              PageDown: [0, 0, 1],
            };
            t[e.key]
              ? (e.preventDefault(), Z(...t[e.key]))
              : ["+", "-", "=", "Home"].includes(e.key) &&
                (e.preventDefault(),
                "Home" === e.key ? te() : ee("-" === e.key ? -2 : 2));
          }),
          f.addEventListener("pointerdown", (e) => {
            if (0 !== e.button) return;
            (f.focus({ preventScroll: !0 }), f.setPointerCapture(e.pointerId));
            const t = V(e);
            if (
              ((x = {
                pixel: t,
                center: p.center && { ...p.center },
                moved: !1,
              }),
              g && "off" === p.mode && D())
            ) {
              const e = M()
                .waypoints.map((e, a) => ({
                  point: e,
                  index: a,
                  distance: Math.hypot(
                    (e.pos.x - g.x + 0.5) * g.scale - t.x,
                    (e.pos.y - g.y + 0.5) * g.scale - t.y,
                  ),
                }))
                .filter(
                  (e) =>
                    e.point.pos.z === g.z && e.distance <= Math.max(8, g.scale),
                )
                .sort(
                  (e, t) =>
                    e.distance - t.distance ||
                    Number(t.index === p.selected) -
                      Number(e.index === p.selected),
                );
              e.length &&
                (Object.assign(x, e[0], {
                  points: M().waypoints,
                  target: { ...e[0].point.pos },
                  original: { ...e[0].point.pos },
                }),
                (p.selected = x.index),
                (p.follow = !1),
                G(),
                Y(),
                Q());
            }
          }),
          f.addEventListener("pointermove", (e) => {
            const a = V(e);
            if (((p.hover = X(a)), x?.center)) {
              const e = a.x - x.pixel.x,
                o = a.y - x.pixel.y;
              if ((Math.abs(e) + Math.abs(o) > 5 && (x.moved = !0), x.moved))
                if (x.point) {
                  const e = X(a);
                  t.validPosition(e) && (x.target = e);
                } else
                  ((p.follow = !1),
                    (p.center = {
                      x: Math.max(0, Math.min(65534, x.center.x - e / p.scale)),
                      y: Math.max(0, Math.min(65534, x.center.y - o / p.scale)),
                      z: x.center.z,
                    }),
                    J());
            }
            (Y(), Q());
          }),
          f.addEventListener("pointerleave", () => {
            ((p.hover = null), Y(), Q());
          }),
          f.addEventListener("pointerup", (e) => {
            if (!x) return;
            const a = x;
            if (((x = null), a.point)) {
              if (!a.moved) return void Y();
              try {
                N();
                const o = M().waypoints;
                if (
                  o !== a.points ||
                  o[a.index] !== a.point ||
                  !t.equal(a.point.pos, a.original)
                )
                  return;
                const n = X(V(e));
                if ((W(n), t.equal(n, a.original))) return;
                ((a.point.pos = { ...n }), (p.selected = a.index), q());
              } catch (e) {
                A(e.message, !0);
              } finally {
                (Y(), Q());
              }
              return;
            }
            if (a.moved || w) return;
            const o = X(V(e));
            if (!t.validPosition(o)) return;
            const n = M().waypoints.findIndex((e) => t.equal(e.pos, o));
            if (n >= 0 && "off" === p.mode) j(n);
            else if ("off" !== p.mode)
              try {
                (W(o), I(p.mode, o));
              } catch (e) {
                A(e.message, !0);
              }
          }));
        const Ae = () => {
          ((x = null), Y(), Q());
        };
        (f.addEventListener("pointercancel", Ae),
          f.addEventListener("lostpointercapture", Ae),
          f.addEventListener("contextmenu", (e) => {
            (e.preventDefault(),
              Ae(),
              "off" !== p.mode && ((p.mode = "off"), Q()));
          }),
          f.addEventListener(
            "wheel",
            (e) => {
              (e.preventDefault(), ee(e.deltaY < 0 ? 2 : -2));
            },
            { passive: !1 },
          ),
          (v = new ResizeObserver(() => J())),
          v.observe(f),
          F(),
          (async function () {
            const t = u;
            try {
              y = (await e.api?.walkerProfiles?.()) || [];
            } catch (e) {
              ((y = []), A(e.message, !0));
            }
            u === t && F();
          })(),
          G(),
          Q(),
          (async function () {
            if (!e.api) return;
            const t = u;
            try {
              const a = await e.api.mapInfo();
              if (!a || u !== t) return;
              (_(a),
                p.center ||
                  (p.center = P() || M().waypoints[0]?.pos || a.first),
                p.center && (p.center = { ...p.center }),
                await J());
            } catch (e) {
              u === t && A(e.message, !0);
            }
          })());
      },
      refresh: Q,
      stopRecord: $,
      isRecording: () => a.active,
      hide() {
        (i.hide(),
          v?.disconnect(),
          (x = null),
          (b = null),
          (u = null),
          (f = null),
          p.request++);
      },
      reset() {
        (i.reset(),
          $(!1),
          (x = null),
          (b = null),
          (p.selected = -1),
          (p.center = null),
          (p.follow = !0),
          (p.mode = "off"));
      },
      update() {
        if (a.active)
          try {
            for (const e of a.update(C())) B(e, !0);
          } catch (e) {
            (A(e.message, !0), Q());
          }
        const e = performance.now();
        if (!u || document.hidden || e - ae < 100) return;
        ae = e;
        const o = C()?.telemetry?.position;
        (p.follow && t.validPosition(o) && !t.equal(p.center, o)
          ? ((p.center = { ...o }), J())
          : Y(),
          Q());
      },
    };
  },
};
