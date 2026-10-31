"use strict";
window.PkaAlertsUI = {
  create(e) {
    const a = window.PkaUI.create(e),
      { n: n, button: o, section: s, row: t, input: r, toggle: i, tip: p } = a,
      {
        types: d,
        supportedTypes: l,
        typeReason: c,
        supportReason: m,
        soundAsset: u,
        beepLabels: g,
        gmData: f,
        gmWrite: v,
        gmKey: h,
        gmList: b,
      } = window.PkaAlertsModel,
      y = window.PkaSchema.tabs
        .find((e) => "alerts" === e.key)
        .fields.find((e) => "rules" === e.key).fields;
    let k = null,
      A = 0;
    const P = () => e.getConfig().alerts;
    function w() {
      (e.changed(), x());
    }
    function x() {
      if (!k) return;
      const a = e.getMonitor(),
        n = e.getSession(),
        o = n?.telemetry || null,
        s = P().rules.some((e) => e.enabled && m(e, o)),
        t = window.PkaUI.set;
      if (k.type)
        for (const e of k.type.options) {
          const a = c(e.value, o);
          (t(e, "disabled", !!a),
            t(e, "textContent", d[e.value] + (a ? " · indisponível" : "")));
        }
      if (
        (t(
          k.start,
          "textContent",
          a.enabled ? "Pausar monitor" : "Iniciar monitor",
        ),
        t(
          k.start,
          "disabled",
          !a.enabled &&
            (!n?.online ||
              n.stale ||
              n.authExpired ||
              s ||
              !P().rules.some((e) => e.enabled)),
        ),
        t(
          k.status,
          "textContent",
          a.enabled
            ? `Monitorando PID ${a.pid}`
            : s
              ? "Ajuste as regras marcadas antes de iniciar."
              : !n?.online || n.stale
                ? "Selecione um cliente conectado para iniciar."
                : "Monitor pausado · usa as regras da tela",
        ),
        k.reason)
      ) {
        const e = m(P().rules[A], o);
        (t(k.reason, "textContent", e || ""), t(k.reason, "hidden", !e));
      }
      if (k.gmRoot) {
        JSON.stringify([
          P().gmMessageActiveProfile,
          P().gmMessageProfilesJson,
        ]) === k.gmSignature ||
          k.gmRoot.contains(document.activeElement) ||
          E(k.gmRoot);
        const a = e.getRuntime?.()?.gmLearning,
          s = a?.active && a.ruleIndex === A;
        (t(
          k.gmLearn,
          "textContent",
          s ? `Parar (${a.remainingSeconds}s)` : "Aprender 2 min",
        ),
          t(
            k.gmLearn,
            "disabled",
            !e.learnGm ||
              !n?.online ||
              n.stale ||
              n.authExpired ||
              !!c("gm_message", o) ||
              !!e.getRuntime?.()?.paused,
          ),
          t(
            k.gmStats,
            "textContent",
            `Ignoradas: ${k.gmCounts.blacklist} · Novas: ${k.gmCounts.pending}${s ? ` · Aprendidas agora: ${a.learned}` : ""}`,
          ));
      }
    }
    function M() {
      if (!k) return;
      const e = k.container;
      (e.replaceChildren(), S(e));
    }
    function E(s) {
      (s.replaceChildren(),
        (k.gmRoot = s),
        (k.gmSignature = JSON.stringify([
          P().gmMessageActiveProfile,
          P().gmMessageProfilesJson,
        ])));
      const i = f(P()),
        p = i.profile,
        d = t(s);
      a.select(
        d,
        "Perfil de mensagens",
        P(),
        "gmMessageActiveProfile",
        Object.keys(i.profiles).map((e) => [e, e]),
        () => {
          (w(), M());
        },
      );
      const l = { name: "" };
      ((r(d, "Nome do perfil", l, "name", { change() {} }).maxLength = 80),
        o(d, "Criar perfil", () => {
          const a = l.name.trim().replace(/[\\/:*?"<>|]/gu, "_");
          if (!a || /[\x00-\x1f]/u.test(a))
            return void e.log?.(
              "Informe o nome do perfil de mensagens.",
              "error",
            );
          const n = f(P());
          (Object.hasOwn(n.profiles, a) ||
            (n.profiles[a] = { blacklist: [], pending: [] }),
            v(P(), n.profiles, a),
            w(),
            M());
        }),
        o(d, "Excluir perfil", () => {
          const e = f(P());
          (delete e.profiles[e.active],
            Object.keys(e.profiles).length ||
              (e.profiles.default = { blacklist: [], pending: [] }),
            v(P(), e.profiles, Object.keys(e.profiles)[0]),
            w(),
            M());
        }));
      const c = t(s);
      ((k.gmLearn = o(
        c,
        "Aprender 2 min",
        () => {
          const a = e.getRuntime?.()?.gmLearning;
          e.learnGm?.(A, !(a?.active && a.ruleIndex === A));
        },
        "primary",
      )),
        (k.gmStats = n("p", "hint")),
        s.append(k.gmStats),
        (k.gmCounts = {
          blacklist: p.blacklist.length,
          pending: p.pending.length,
        }),
        s.append(
          n(
            "p",
            "hint",
            "Durante 2 minutos, as falas especiais recebidas são salvas como conhecidas. Caixas pretas continuam avisando. Faça o aprendizado em um local conhecido.",
          ),
        ));
      const m = n("details", "gm-message-review"),
        u = n("summary", "", `Revisar mensagens (${p.pending.length} novas)`);
      (m.append(u),
        s.append(m),
        m.append(n("h3", "", "Novas mensagens")),
        p.pending.length ||
          m.append(n("p", "hint", "Nenhuma mensagem nova para revisar.")));
      for (const e of p.pending) {
        const a = t(m);
        (a.append(n("span", "", e)),
          o(a, "Ignorar esta fala", () => {
            const a = f(P()),
              n = h(e);
            ((a.profile.blacklist = b([...a.profile.blacklist, e])),
              (a.profile.pending = a.profile.pending.filter((e) => h(e) !== n)),
              v(P(), a.profiles),
              w(),
              M());
          }));
      }
      m.append(n("h3", "", "Falas conhecidas"));
      for (const e of p.blacklist) {
        const a = t(m);
        (a.append(n("span", "", e)),
          o(a, "Remover", () => {
            const a = f(P());
            ((a.profile.blacklist = a.profile.blacklist.filter(
              (a) => h(a) !== h(e),
            )),
              v(P(), a.profiles),
              w(),
              M());
          }));
      }
      const g = n(
          "label",
          "bot-field",
          "Falas de NPC ignoradas (uma por linha)",
        ),
        y = n("textarea");
      ((y.rows = 4),
        (y.maxLength = 32768),
        (y.value = p.blacklist.join("\n")),
        y.setAttribute("aria-label", "Falas de NPC ignoradas"),
        y.addEventListener("change", () => {
          const e = f(P());
          e.profile.blacklist = b(y.value.split(/\r?\n/u));
          const a = new Set(e.profile.blacklist.map(h));
          ((e.profile.pending = e.profile.pending.filter((e) => !a.has(h(e)))),
            v(P(), e.profiles),
            w());
        }),
        g.append(y),
        s.append(g));
    }
    function S(c) {
      k = { container: c };
      const f = n("div", "bot-workspace alerts-workspace"),
        v = n("div", "bot-editor"),
        h = n("aside", "bot-aside");
      (f.append(v, h), c.append(f));
      const b = s(
          v,
          "Monitor de alertas",
          "Monitore a vida, a conexão e o que aparece ao redor do player.",
        ),
        S = t(b);
      ((k.start = o(S, "Iniciar monitor", e.run, "primary")),
        (k.start.title = "Liga os avisos das regras ativadas."),
        p(
          i(S, "Respeitar pausa global", P(), "pauseWithHotkey", w),
          "Marcado: a tecla de pausa também pausa os alertas.",
        ),
        (k.status = n("p", "hint")),
        b.append(k.status));
      const C = s(h, `Regras · ${P().rules.length}`);
      (o(C, "+ Nova regra", () => {
        ((A = P().rules.push(window.PkaSchema.defaults(y)) - 1), w(), M());
      }),
        P().rules.forEach((e, a) => {
          const s = n("div", "alert-rule" + (A === a ? " selected" : ""));
          C.append(s);
          const t = i(s, "", e, "enabled", () => {
            (w(), M());
          });
          (t.setAttribute(
            "aria-label",
            `Ativar alerta ${e.name || "Sem nome"}`,
          ),
            t.closest("label").classList.add("alert-rule-toggle"),
            (t.closest("label").title =
              "Marcado: este alerta fica ativo no monitor."));
          o(
            s,
            e.name || "Sem nome",
            () => {
              ((A = a), M());
            },
            "rule-name",
          ).append(
            n(
              "small",
              "",
              `${d[e.type] || e.type} · ${m(e) ? "Ajustar" : e.enabled ? "Ativada" : "Pausada"}`,
            ),
          );
          const r = o(
            s,
            "×",
            () => {
              (P().rules.splice(a, 1),
                (A = Math.max(0, Math.min(A, P().rules.length - 1))),
                w(),
                M());
            },
            "alert-rule-remove",
          );
          (r.setAttribute(
            "aria-label",
            `Excluir regra ${e.name || "Sem nome"}`,
          ),
            (r.title = "Excluir alerta"));
        }));
      const R = n("details", "hint"),
        q = n("summary", "", "Disponibilidade dos alertas");
      (R.append(
        q,
        n(
          "p",
          "",
          "Chat, mensagens de GM, seta, espectadores e captura ficam disponíveis conforme a versão do cliente. As regras importadas são preservadas.",
        ),
      ),
        h.append(R));
      const O = P().rules[A];
      if (!O)
        return (
          s(
            v,
            "Sua primeira regra",
            "Clique em Nova regra e escolha quando receber um aviso.",
          ),
          void x()
        );
      const I = s(v, "Editar regra");
      if (
        (r(I, "Nome da regra", O, "name", { change: w }),
        p(
          i(t(I), "Regra ativada", O, "enabled", () => {
            (w(), M());
          }),
          "Desmarcado: a regra fica salva, mas não avisa.",
        ),
        (k.type = a.select(
          I,
          "Quando avisar",
          O,
          "type",
          Object.entries(d).map(([e, a]) => [e, a]),
          () => {
            (w(), M());
          },
        )),
        (k.reason = n("p", "inline-warning")),
        I.append(k.reason),
        "hp" === O.type)
      )
        (r(t(I), "Avisar abaixo de HP %", O, "hpThreshold", {
          type: "number",
          max: 100,
          change: w,
        }),
          i(t(I), "Uma vez por queda de HP", O, "hpOnce", () => {
            (w(), M());
          }),
          I.append(
            n(
              "p",
              "hint",
              "A regra é rearmada quando a vida volta ao limite ou fica acima dele.",
            ),
          ));
      else if ("chat" === O.type)
        (a.select(
          I,
          "Mensagens recebidas",
          O,
          "chatMode",
          [
            ["private", "Privado"],
            ["local", "Local"],
            ["party", "Party"],
            ["channel", "Canal"],
            ["all", "Todos"],
          ],
          w,
        ),
          I.append(
            n(
              "p",
              "hint",
              "Avisa sobre mensagens novas no canal escolhido. As próprias mensagens e falas de monstros não disparam este alerta.",
            ),
          ));
      else if ("gm_message" === O.type) {
        I.append(
          n(
            "p",
            "hint",
            "Avisa sobre falas especiais nos modos 43/44 e caixas pretas de texto no mapa. Ignore abaixo as falas conhecidas de NPC; caixas no mapa continuam sendo avisadas.",
          ),
        );
        const e = n("div", "gm-message-profiles");
        (I.append(e), E(e));
      } else
        "gm_arrow" === O.type
          ? I.append(
              n(
                "p",
                "hint",
                "Detecta os efeitos de seta 698, 794 e 795 perto do personagem. Repetições da mesma seta no mesmo lugar são agrupadas por 30 segundos.",
              ),
            )
          : "camera_viewers" === O.type
            ? I.append(
                n(
                  "p",
                  "hint",
                  "Avisa quando o contador da câmera recebe espectadores ou aumenta. Uma queda no contador não dispara o aviso.",
                ),
              )
            : "pokemon_capture" === O.type
              ? I.append(
                  n(
                    "p",
                    "hint",
                    "Avisa quando o cliente recebe a confirmação de captura no chat Default, em português ou inglês. Jogar uma ball não conta como captura concluída.",
                  ),
                )
              : "disconnected" === O.type
                ? I.append(
                    n(
                      "p",
                      "hint",
                      "Avisa após uma sessão online, quando o cliente fica offline, para de atualizar ou é fechado.",
                    ),
                  )
                : "creature" === O.type
                  ? (r(I, "Nome do Pokémon selvagem", O, "creatureName", {
                      change: w,
                    }),
                    r(t(I), "Distância máxima (tiles)", O, "creatureRange", {
                      type: "number",
                      min: 1,
                      max: 30,
                      change: w,
                    }),
                    I.append(
                      n(
                        "p",
                        "hint",
                        "Use * como curinga. Avisa quando um Pokémon vivo entra no alcance, no mesmo andar.",
                      ),
                    ))
                  : "player" === O.type
                    ? (r(t(I), "Distância máxima (tiles)", O, "playerRange", {
                        type: "number",
                        min: 1,
                        max: 30,
                        change: w,
                      }),
                      I.append(
                        n(
                          "p",
                          "hint",
                          "Avisa quando outro jogador entra no alcance, no mesmo andar. O seu próprio personagem é ignorado.",
                        ),
                      ))
                    : "hunt_pokemon" === O.type
                      ? (r(
                          I,
                          "Pokémon esperados na hunt",
                          O,
                          "huntPokemonNames",
                          { change: w },
                        ),
                        I.append(
                          n(
                            "p",
                            "hint",
                            "Separe os nomes por vírgula. Avisa quando aparece um Pokémon selvagem fora dessa lista; inclua nomes Shiny se forem esperados.",
                          ),
                        ))
                      : "teleport" === O.type &&
                        (r(
                          t(I),
                          "Intervalo de verificação (ms)",
                          O,
                          "teleportIntervalMs",
                          { type: "number", min: 50, change: w },
                        ),
                        I.append(
                          n(
                            "p",
                            "hint",
                            "Detecta deslocamento de 3 ou mais tiles em X, Y ou Z entre verificações. Esse sinal também pode ocorrer em movimento rápido.",
                          ),
                        ));
      const j = s(
          v,
          "Como avisar",
          "Escolha a voz em português do evento ou um dos beeps clássicos. A notificação do sistema acompanha o aviso.",
        ),
        N = { enabled: O.soundEnabled && "off" !== O.soundKind };
      if (
        (i(t(j), "Tocar som do alerta", N, "enabled", () => {
          ((O.soundEnabled = N.enabled),
            O.soundEnabled && "off" === O.soundKind
              ? ((O.soundKind = "default"), w(), M())
              : w());
        }),
        a.select(
          t(j),
          "Tipo de áudio",
          O,
          "soundMode",
          [
            ["voice", "Voz em português"],
            ["beep", "Beep clássico"],
          ],
          () => {
            (w(), M());
          },
        ),
        "beep" === O.soundMode &&
          a.select(
            t(j),
            "Beep clássico",
            O,
            "soundKind",
            Object.entries(g).concat(
              "off" === O.soundKind ? [["off", "Desligado"]] : [],
            ),
            w,
          ),
        o(t(j), "Ouvir prévia", () => {
          (window.PkaAlertAudio?.stop(),
            window.PkaAlertAudio?.play(
              u({
                ...O,
                soundEnabled: !0,
                soundKind: "off" === O.soundKind ? "default" : O.soundKind,
              }),
            ));
        }),
        p(
          i(t(j), "Trazer o jogo para frente", O, "frontEnabled", w),
          "Com o aviso, a janela do jogo vem para a frente das outras.",
        ),
        ["hp", "creature", "player", "hunt_pokemon"].includes(O.type) &&
          (p(
            i(
              t(j),
              "Repetir enquanto a condição continuar",
              O,
              "soundRepeatEnabled",
              w,
            ),
            "Avisa de novo a cada intervalo enquanto o motivo continuar (HP baixo, criatura perto…).",
          ),
          r(t(j), "Intervalo de repetição (s)", O, "soundRepeatSeconds", {
            type: "number",
            min: 1,
            change: w,
          }),
          "hp" === O.type &&
            O.hpOnce &&
            !O.soundRepeatEnabled &&
            j.append(
              n(
                "p",
                "hint",
                "Uma notificação por queda. Ative a repetição para continuar avisando enquanto o HP estiver baixo.",
              ),
            )),
        l.includes(O.type))
      ) {
        const e = s(
            v,
            "Ações no bot",
            "Os módulos pausados precisam ser iniciados novamente.",
          ),
          o = t(e);
        (p(
          i(o, "Pausar Walker", O, "pauseWk", w),
          "O alerta para o Walker. Para voltar, inicie o Walker de novo.",
        ),
          p(
            i(o, "Pausar Target e Hoenn", O, "pauseTarget", w),
            "O alerta para o Target e o Hoenn. Para voltar, inicie de novo.",
          ),
          p(
            i(o, "Pausar captura", O, "pauseLooting", w),
            "O alerta para a captura. Para voltar, inicie de novo.",
          ),
          "disconnected" !== O.type &&
            p(
              i(t(e), "Desconectar do jogo", O, "logoutEnabled", w),
              "Encerra a conexão deste personagem e pausa os módulos. As mensagens pendentes são canceladas.",
            ),
          "gm_arrow" === O.type
            ? (a.select(
                t(e),
                "Ao detectar a seta",
                O,
                "gmArrowMode",
                [
                  ["stop", "Parar o personagem"],
                  ["walk", "Caminhar até a seta"],
                ],
                () => {
                  (w(), M());
                },
              ),
              e.append(
                n(
                  "p",
                  "hint",
                  "A seta sempre interrompe o Walker. A caminhada só começa se houver caminho; a chegada precisa ser confirmada no mapa.",
                ),
              ),
              "walk" === O.gmArrowMode &&
                (i(t(e), "Girar ao chegar", O, "gmArrowSpinEnabled", () => {
                  (w(), M());
                }),
                O.gmArrowSpinEnabled &&
                  r(t(e), "Girar por (s)", O, "gmArrowSpinSeconds", {
                    type: "number",
                    min: 0,
                    change: w,
                  }),
                r(
                  e,
                  "Mensagens ao chegar (separadas por vírgula)",
                  O,
                  "gmArrowMsg",
                  { change: w },
                ),
                r(
                  t(e),
                  "Espera depois de chegar/girar (s)",
                  O,
                  "gmArrowMsgDelaySec",
                  { type: "number", min: 0, change: w },
                )))
            : "disconnected" !== O.type
              ? (i(t(e), "Enviar mensagem", O, "talkEnabled", () => {
                  (w(), M());
                }),
                O.talkEnabled &&
                  (r(e, "Mensagens (separadas por vírgula)", O, "talkMsg", {
                    change: w,
                  }),
                  r(
                    t(e),
                    "Intervalo mínimo entre mensagens (s)",
                    O,
                    "talkCooldownSec",
                    { type: "number", min: 1, change: w },
                  ),
                  e.append(
                    n(
                      "p",
                      "hint",
                      "Envia uma mensagem por vez, em sequência, após 2 a 5 segundos. Pausar o monitor cancela mensagens pendentes.",
                    ),
                  )),
                "chat" === O.type &&
                  O.talkEnabled &&
                  e.append(
                    n(
                      "p",
                      "hint",
                      "Mensagens privadas recebem resposta no privado do remetente. As outras recebem resposta no chat local.",
                    ),
                  ))
              : e.append(
                  n(
                    "p",
                    "hint",
                    "Com o cliente já desconectado, somente avisos, foco e pausas são aplicados; mensagens e logout são ignorados.",
                  ),
                ));
      }
      x();
    }
    return {
      render: S,
      refresh: x,
      update: x,
      reset() {
        A = 0;
      },
      hide() {
        k = null;
      },
    };
  },
};
