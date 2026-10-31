# Fidelidade da superficie de portas (showLook / shortcuts / walkerProfiles)

**Escopo:** confrontar as portas/superficie recentemente implementadas em
`reconstruction/app/main.cjs`, `reconstruction/controller.cjs`,
`reconstruction/route-store.cjs` e `tools/build_app.cjs` com a fonte original.
Somente leitura do original; nada em `Extracted_Source` foi alterado.
`readable/` e uma derivacao e NAO foi usada como autoridade.

**Metodo:** wire contract pelo preload original; comportamento do main pelo
bytecode `.jsc` (strings extraidas) + arquivos de rota reais em disco; prova
diferencial contra o bytecode original rodando no Electron 44.7.2.

---

## 1. Fontes originais (evidencia)

| Artefato | Onde | O que prova |
|---|---|---|
| `Extracted_Source/preload.cjs` (linha 1) | API `pka` | canais e aridade: `shortcuts`=scoped(1), `walkerProfiles`=scoped(0), `loadWalkerProfile`=scoped(2), `showLook`=invoke(msg, `!0===r`) |
| `Extracted_Source/look-preload.cjs` (linha 1) | API `pkaLook` | `onShow` chama o callback com o **2o** argumento; `copy`=invoke; `close`=send |
| `Extracted_Source/lib/walker-profiles.jsc` | main-side | `^wk_.+\.lua$`; `^wk_(?:index\|label_scripts)\.lua$` (reservados); `sha256`/`digest` (revision); `atomicWrite`, `.tmp`, `.bak`, `MAX_BYTES`; erros exatos |
| `Extracted_Source/lib/legacy.jsc` | parser | `parseLuaData`, `^return\b`, `^([a-zA-Z_][\w]*)\s*=`, `^(true\|false\|nil)\b`, "Arquivo Lua invalido ou maior que 2 MB." |
| `Extracted_Source/lib/hotkeys.jsc` | shortcuts | vocabulario de teclas (`^f([1-9]\|1\d\|2[0-4])$`, home/pageup/down/left/right/space/enter/backspace/printscreen/scrolllock/numlock/minus, `^ctrl$`, `^cmdorctrl$`), `menuHotkey`/`pauseHotkey`, "Atalhos do menu e da pausa precisam de teclas diferentes." |
| `Extracted_Source/main.jsc` | main | `pka://app/look.html`, `preload` `look-preload.cjs`, `setAlwaysOnTop`/`alwaysOnTop`, `pka-look:show`/`:copy`/`:close`, `globalShortcut`, `shortcuts`/`menuHotkey`/`pauseHotkey`, `walkerProfiles`/`loadWalkerProfile`, `pka-tools-profile`, `OTPbot`, `C:\OTPbot` |
| `%LOCALAPPDATA%\OTPbot\wk_Arcanine.lua` e `wk_index.lua` | formato real | corpo `return { waypoints = { {pos={x=..,y=..,z=..}, action="walk", param=""}, ... }, <settings> }`; `wk_index.lua` = `return { "Nome", ... }` |
| `Extracted_Source/shared/schema.js` | schema | chaves mapeaveis: walker `waypoints/smartWalking/startNearestWaypoint/recordStepDistance/loop/guildDaily*/luaProfile/luaRevision`; target `luring.*`/`lureSkill.*`/`healSkill.*` |

---

## 2. Confronto e veredito

### 2.1 showLook / pka-look:copy / pka-look:close — EQUIVALENTE (comprovado no contrato)
- **Contrato:** `pka.showLook(msg, pinned)` → `invoke('pka:showLook', msg, pinned===true)`;
  look window carrega `pka://app/look.html` com `look-preload.cjs`; main envia
  `pka-look:show` ao ficar pronto e usa `setAlwaysOnTop(pinned)`; `pka-look:copy`
  → invoke; `pka-look:close` → send.
- **Implementacao:** `main.cjs` `ensureLookWindow()` (look.html + look-preload.cjs),
  `showLook()` envia quando `did-finish-load`/senao direto + `setAlwaysOnTop(pinned)`;
  handlers `pka-look:copy` (clipboard) e `pka-look:close` (hide). `tools/build_app.cjs`
  gera `ui/look-preload.cjs` expondo `pkaLook`. `renderer-api.cjs` inalterado no membro.
- **Veredito:** contrato de wire comprovadamente igual ao preload original
  (`tests/renderer_api.test.cjs` compara com o preload do ASAR; `tests/preload.test.cjs`
  cobre `pkaLook`). Comportamento do main casa com as strings de `main.jsc`.
- **Lacuna:** geometria/posicao/opacidade exatas da janela nao foram recuperadas
  (so `setAlwaysOnTop` e a pagina/preload sao evidenciados). Nao inventado.

### 2.2 shortcuts — PARCIAL (divergencia comprovada de normalizacao)
- **Contrato:** `scoped('shortcuts', tools)` (invoke com profileContext). `hotkeys.jsc`
  normaliza o vocabulario de teclas, exige `menuHotkey != pauseHotkey` e reporta
  `registered`/`menu`/`pause`.
- **Implementacao:** `registerShortcuts(tools)` chama `globalShortcut.unregisterAll()`
  e registra `tools.menuHotkey`/`tools.pauseHotkey` **diretamente**, retornando
  `{registered, menu, pause}`. Delega via `controller.cjs` (`ports.shortcuts`).
- **Divergencia comprovada:** falta (a) normalizacao/validacao do vocabulario original
  (`pageup`→`PageUp`, `cmdorctrl`, teclas minusculas, etc.) e (b) a checagem
  "teclas diferentes". Retorno de erro do original ("Atalho invalido"/"indisponivel")
  nao replicado — `globalShortcut.register` retorna `false` silenciosamente.
- **Veredito:** canal e args iguais; comportamento de normalizacao NAO equivalente.
  Registrado como lacuna (nao implementado o mapeamento exato, que e so parcialmente
  recuperavel pela lista de strings).

### 2.3 walkerProfiles — EQUIVALENTE (comprovado por diferencial)
- **Contrato:** `scoped('walkerProfiles')` → lista `{id,name}` onde `id = wk_<nome>.lua`.
- **Implementacao:** `routeStore.list()` varre o diretorio, exclui reservados e ordena.
- **Veredito:** `tests/route_store.test.cjs` (teste "route listing...") + teste 20
  (diferencial) comparam `list()` com `Extracted_Source` `WalkerProfiles.list()`
  → igual.

### 2.4 loadWalkerProfile / saveRoute — CORRIGIDO (era formato inventalo)
- **Contrato original:** arquivo de rota e uma **tabela Lua** (`return { ... }`), nao
  JSON; `luaRevision` = sha256 do conteudo; MAX 2 MB; escrita atomica com `.tmp`+`.bak`;
  nomes reservados `wk_index.lua`/`wk_label_scripts.lua`; erros exatos; chaves nao
  mapeadas preservadas.
- **Correcao aplicada (`route-store.cjs`):**
  - `parseLuaData`/`serializeLuaRoute` implementam a tabela Lua (subset: records, arrays,
    `[k]=v`, strings com escapes/decimais, numeros, true/false/nil, comentarios).
  - `read()` valida id, erro "O perfil precisa ser um arquivo da pasta OTPbot." quando
    ausente, "O perfil do Walker excedeu 2 MB." acima do limite.
  - `save()` faz escrita atomica (`tmp`+rename), preserva `.bak`, checa `expectedRevision`
    ("... foi alterado fora do bot. Recarregue a rota antes de salvar ..."), e faz
    merge preservando chaves sem lar no schema (ex.: `flyPokemon`, `comboLureDelay`,
    `guildDailyTier`).
  - `loadWalkerProfile` mapeia apenas chaves provadas no schema (`waypoints`,
    `smartWalking`, `startNearestWaypoint`, `recordStepDistance`, `guildDaily*`,
    `luring.*`, `lureSkill.*`, `healSkill.*`), deixa o resto intacto, e devolve
    `luaProfile`/`luaRevision`.
  - `controller.cjs` autosave passa `(id, config, {expectedRevision})` e propaga a
    revision de volta.
- **Veredito:** EQUIVALENCIA COMPROVADA para o parser/loader/lista pela prova diferencial
  contra o bytecode original (`Extracted_Source/lib/legacy.cjs` `parseLuaData` e
  `WalkerProfiles.load/list`), com SHA256 dos `.jsc` originais conferido — verificado no
  Electron 44.7.2 (teste 20, PASS).
- **Lacuna:** o diretorio de rotas real e `C:\OTPbot` / `<userData>/characters/<nick>/routes`
  no original; a reconstrucao usa `<dataRoot>/routes`. Mantido por decisao de layout
  da reconstrucao (nao e o caminho original).

### 2.5 gmLearning — NAO RECUPERAVEL nesta rodada
- Depende do feed nativo (aprendizado de perfis GM a partir do chat). Sem canal nativo,
  permanece indisponivel explicito. Nao inventado.

---

## 3. Pre-requisitos do canal nativo (observacao real, sem extrair chave)

Coleta somente-leitura nesta rodada; nenhuma chave lida/exibida, nenhum comando ao jogo.

- Processo do jogo: `PokeAlliance_dx` em execucao (PID **26100**).
- Pipes nomeados: **329** enumerados; **0** casando `pka|shiba|runtime|security`.
  => O canal `pka-runtime-2-<pid>` **nao esta presente** (menu/loader nao o serve agora).
- `PKA_CHANNEL_KEY` (env): ausente. `PKA_CHANNEL_KEY_FILE` (env): ausente.
  `%LOCALAPPDATA%\PKARecon\channel-key.json`: ausente.
- Exigencia do codigo: `reconstruction/native-adapter.cjs:8-11` lanca
  "Configure PKA_CHANNEL_KEY ou PKA_CHANNEL_KEY_FILE para conectar o motor."

**Bloqueio exato:** o adaptador nativo so conecta quando (a) o pipe
`pka-runtime-2-<pid>` existe e aceita o handshake HMAC e (b) ha uma chave de canal
provida. Hoje nenhum dos dois existe; por isso a sessao real nao destrava e os modulos
rodam apenas sobre a sessao RPM/simulada. Nao foi fornecida chave nem aberto canal
(o teste diferencial do transporte original ja e feito offline em
`tests/transport_live.test.cjs`).

---

## 4. Testes e saidas reais (apos as duas frentes)

```
node tools/validate.cjs
  build    exit 0
  node     474 testes, 466 pass, 0 fail, 8 skip
  electron 474 testes, 474 pass, 0 fail, 0 skip
  smoke    exit 0
  audit    exit 0
Foco desta frente (Electron 44.7.2):
  tests/route_store.test.cjs tests/controller.test.cjs -> 20/20 pass, inclui
  "original bytecode agrees with Lua parser and profile loading in compatible Electron"
```

**Consolidacao:** as alteracoes das DUAS frentes foram executadas juntas no pipeline
acima (build + Node + Electron + smoke + auditoria UI), todas exit 0.

---

## 5. Classificacao de evidencia

- **Equivalencia comprovada:** wire contract da API `pka`/`pkaLook` (diferencial vs preload
  original); formato de rota / parser / lista / loader (diferencial vs bytecode original).
- **Reconstrucao plausivel (nao equivalencia):** geometria/comportamento exato da janela
  de look; normalizacao/validacao de atalhos; diretorio de rotas escolhido pela
  reconstrucao.
- **Lacuna explicita (nao recuperavel agora):** `gmLearning`; canal nativo ao vivo.

Nada aqui e execucao no jogo. A simulacao e ferramenta de diagnostico.
