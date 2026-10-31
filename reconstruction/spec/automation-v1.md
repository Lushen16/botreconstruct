# Especificacao de automacao - PKA Tools 3.1.9 (v1)

Machine-readable: `automation-v1.json` (mesma pasta).
Base: configuracao distribuida, modelos legiveis do renderer/shared e modulo de protocolo.
Nao e engenharia reversa das regras nativas da DLL; ver `REPORT_RE_v3.1.9.md`.

## 1. Fronteira

Entradas por tick: sessao (online/stale/error/authExpired/ageMs/paused/runtime), telemetria
decodificada e configuracao. Saidas: comandos (encodeCommand) e relatorio do tick
(status, reason, emitted, blocked, lure.state, walker.index).

Ordem: gate -> healer -> target -> lure -> walker. Acao de cura encerra o tick; o Target
roda antes de andar; o Lure so bloqueia o Walker (combate continua).

## 2. Gate de sessao

Transicoes: `blocked` -> `ready` quando todas as condicoes passam; `ready` -> `blocked`
no primeiro motivo falho, nesta ordem: paused, offline, stale, error, auth-expired,
stale-snapshot (ageMs>1000), no-telemetry, native-unverified, pulse-version(!=3),
no-position, runtime-pid.
Falha: nenhum comando e emitido.
Evidencia: shared/healer.js (autoPlan), renderer/guild-daily.js, literais de native-runtime.jsc.

## 3. Walker

Estados: idle, move, hold, advance, done.
Entradas: position (x,y,z). Distancia Chebyshev; z diferente = infinito (shared/walker.js).
Acoes: walk, safespot, box, stairs, wait, say.
- arrive: mesma tile -> advance; sem proximo e loop=false -> done.
- wait: hold por `param` ms (0..3600000).
- say: envia `talk` uma vez por visita (1..255 bytes, sem controle).
- stairs: em cima da tile, hold ate z mudar; timeout 5000ms -> advance(stairs-timeout).
- move: `walk(direction 0..7)` por tick.
- stuck: 3 ticks na mesma posicao -> gira a direcao; 6 -> advance(stuck).
Limites do produto: 2000 waypoints; wait<=3600000; say<=255 bytes.
Falhas: say-invalid, floor-mismatch, stuck, stairs-timeout.

## 4. Lure

Modos mutuamente exclusivos (shared/walker.js setLureMode/normalizeLuring):
randomEnabled -> dynamic(frontEnabled) -> distance(enabled) -> off.
Saida: allowMovement e, no modo dynamic, `chase 0/1`.

| Modo | Condicao | Saida |
|---|---|---|
| distance | nearest > maxDistance | hold (allowMovement=false) |
| distance | hold > 8000ms | release por 3000ms (allowMovement=true) |
| distance | nearest <= maxDistance | in-range (allowMovement=true) |
| dynamic | nearest >= maxDistance + frontRegroupMargin | regroup, `chase 1` |
| dynamic | nearest <= maxDistance + frontRegroupSteps | in-range, `chase 0` |
| random | ciclo vencido | alterna random-walk/random-wait por [min,max] s |

Clamps: maxDistance 1..16; margin 4..8; steps 1..4 (< margin); random 5..3600 s.
Evidencia: chaves target.luring, LEIA-ME (limite 3 SQM; 8s de espera; 3s de liberacao),
shared/walker.js. Os tempos 8000/3000 ms vem da documentacao do produto, nao da DLL.

## 5. Target

Selecao: canAttack=true; remove ignoredCreaturesText (target+hoenn); prioridade shiny
(shinyIcon=1 ou lookType=shinyLookType); menor Chebyshev; desempate por id.
Gates: perfectLure sem forceBox e atacaveis < minWildsToEngage -> luring (nao ataca);
lowHpComboPercent>0 e vida acima -> so attack.
Combo: `combo.sequenceText` (tokens mN) ou nativeSequence (useNativeSequence); guarda
expectedUuid do roster em activeSlot e attackTargetId; stepDelay entre passos; attack
retry 1000ms. Sem uuid -> reason missing-uuid, sem envio.
Skills: healSkill (vida<=hpPercent) e lureSkill (em luring, vida>=hpPercent).
Finalizacao atual: autoRevive usa o canal hotkey configurado apos concluir uma
rotacao enumerada, respeitando interval desde a ultima skill e o GCD. A opcao
waitForPokemon exige confirmacao de nome/roster/slot ativo, sem atraso fixo.
O fallback combo !autocombo usa apenas expectedUuid e nao fornece, por si so,
evidencia de termino. Ver ENGINE_RUNTIME.md para os limites dessa observacao.
Nao implementado: combatStanceAuto (semantica de fight 1..3 desconhecida).

## 6. Healer

Uma acao por tick, nesta prioridade: potion, medicine, pet heal, pet reset, return.
- potion: vida<=hoenn.potionHpPercent; canal hotkey (texto) ou action (1..50); cooldown
  potionCooldownMs (default 1500).
- medicine: conditions nao vazias e useMedicine; cooldown 1500.
- pet heal: vida<=healer.healHpPercent; healPokemonName precisa casar exatamente 1 no
  roster; envia `talk m<healMoveSlot>` com expectedUuid.
- pet reset: apos curar, se healResetSlot != healMoveSlot -> `talk m<reset>`.
- return: returnPokemonName diferente do ativo -> `switchPokemon`.
Evidencia: shared/healer.js, renderer/healer.js, protocolo (talk/switchPokemon/action/hotkey).

## 7. Falhas

| Codigo | Efeito |
|---|---|
| gate-blocked | nenhum comando; status blocked + reason |
| combo-missing-uuid | passo pulado; blocked += combo-without-uuid |
| potion-channel-missing | sem potion; blocked += potion-channel-missing |
| heal-pokemon-unresolved | sem heal de pet; blocked += heal-pokemon-unresolved |
| stairs-timeout | advance com reason |
| stuck | advance com reason |
| send-error | encodeCommand rejeitou o comando |

## 8. Testes

`tests/spec_conformance.test.cjs` + `tests/fixtures/automation-v1.json`:
8 cenarios deterministicos (gate, walk, target, perfect lure, lure distance/dynamic/random,
potion) e cobertura das chaves de configuracao declaradas. Sem pipe e sem jogo.
