# Relatorio de RE - PKA Tools 3.1.9 (23/10/2026, 22/10/2026 base)

Atualizacao vigente em 23/10/2026: ver secao 6.7 e ALERT_TELEMETRY.md.
Validacao atual: Electron 291/291; Node 284 + 7 skip; build/smoke aprovados.
Esta etapa foi somente offline, sem memoria de processo, pipe, chave ou instalacao.
Os paragrafos de escopo/sessao e contagens de etapas anteriores sao historicos.

Escopo: inventario, mapa de execucao, separacao do protocolo e especificacao.
Nenhuma alteracao foi feita na instalacao; nenhuma conexao foi aberta nesta rodada.
O ASAR nao foi substituido. A sessao do jogo (PID 32084) foi mantida viva; o menu
estava fechado nesta rodada.

## 1. Inventario (versao + hash)

Produto PKA Tools 3.1.9, Electron 44.7.2, bytenode 1.7.0, win32-x64.
app.asar: 0cc1cf89ee210714c150ed6270c9f44afc90e1d0bc2a790c6ab7b9eb77438e24 (9.750.903 bytes).
package-integrity.json declara `"automation": "native-dll"` e `layout: electron-only`.
release-manifest.json declara `protection.method = decision-bytecode-v1` e lista 30 regras
( Emergency, TargetMinimum, TargetRank, BestTileScore, HoennMinimum, NextTeam, HealWanted,
TargetEligible, PathEstimate, PathCost, ComboMoveValid, ComboAck, ComboBuffDone, Alert*,
Capture*, LureLeadScore, LureCandidate, LureRecovered, HealerTimeout, HealerDeployReady ).

| Artefato | Papel | Bytes | SHA-256 |
|---|---|---:|---|
| launcher.exe | Launcher/login | 72734208 | `09ecedf95be280c9ddcfb48330406710edabba47dd1a28a2480ba482c3c09f88` |
| Shiba app entry (loader) | Injection/auth entry | 13398927 | `a9a0ab304d80786a97846b2793971de6a1ef8b74453e8f8aca44ff2b27cd9d47` |
| PKA Tools.exe | Electron 44.7.2 menu | 245590016 | `1b80dc101d2518eb9f5f8952c6f18d735850fb366ce410a771e3259d6f0ca0a7` |
| dll/version | Electron version file | 6 | `6c2e974c7c389942acf1219ad8fccd94145bc04778fb735d68244686d80cc7b5` |
| package-integrity.json | Metadata: automation=native-dll | 1395 | `83874bb25306ed2f30e63b9a822b4189a4ef7da544e9fd3c3a6dc2a4f349269e` |
| release-manifest.json | Metadata: decision-bytecode-v1 rules | 13471 | `c8be2a791b8577291d0edbd6faa39a2fa119769f7f924a9d7aa157e77c77e7d9` |
| app.asar | Menu code+assets | 9750903 | `0cc1cf89ee210714c150ed6270c9f44afc90e1d0bc2a790c6ab7b9eb77438e24` |
| libs/d3d9.dll | Corrupt PE (known) | 1866491 | `f1dee24b04b915996f46c2a10f8f6bebee123451928fcebea056f08962e64223` |
| libs/d3dcompiler_47.dll | Damaged imports | 3696071 | `f125ea8196de6b3b580edf84e17d2e835615c6b4c7b72326a9efd8a33c95d1a4` |
| libs/lpeg.dll | Managed CLR assembly | 4608 | `3d3244a8b5d71a40522cb7e314ce481e8068ea1703b9ecdfe4e5760c1157f2cb` |
| libs/SFML.Graphics.dll | Managed CLR assembly | 67072 | `24142a1db3357a91958af7ba22be586c23ec4464ba44e602b85126fcf9086806` |
| libs/SFML.System.dll | Invalid PE | 15640 | `e33ac2811321f81b4d48632baeb43f14c782b73b39449c4d1e2301eca609ccf2` |
| libs/SFML.Window.dll | Invalid PE | 40246 | `26c083f2464dea143ff741ec9d2afaef4fb10f5b8ddd20e82a7ee0290251f4ba` |
| game PokeAlliance_dx.exe | Game client | 37534256 | `9e4b4dcd735d5c1f709732f903d403a3068a6cf911e1977c4880f62b15d54a11` |
| PKAengine.exe | Discord-fix service | 28522496 | `3d76a06f59ebd879e14f23e4e5c71464ee2fe2cd823711960f4a44a385854145` |
| main.jsc | Extracted from ASAR | 64888 | `6fffeefd17a73bce9842ffa5be750b2507215798fbafb3f4f215864ce6f99d02` |
| preload.cjs | Extracted from ASAR | 2842 | `5f802bdc6db159f404bf2e9315ddb208d7479f127b502aa54baf6f752f6ea282` |
| look-preload.cjs | Extracted from ASAR | 352 | `ba82b05f28f63176997028840a3e551321f7f2206d3dd65138d6a156dc520c8d` |
| lib/protocol.jsc | Extracted from ASAR | 9312 | `56522f34578706292530ee7c05f8774b221b6d2e862a55f51e78700cfe10a48e` |
| lib/telemetry.jsc | Extracted from ASAR | 13256 | `0f308a9d7fd4a89f537a61a076dd68aae5ef8b3fdf668f128152c3d6475456c8` |
| lib/pipe-bridge.jsc | Extracted from ASAR | 26488 | `f2047593c12388a5bb09286d010fa7422b7e626fb8ea60c0268023be310114b4` |
| lib/native-runtime.jsc | Extracted from ASAR | 17224 | `20bdcad4912965a6526d7f43fdf9806d309e347854e181ec69f7542aefb4d58b` |
| lib/security.jsc | Extracted from ASAR | 8608 | `afc75885c9ad843beb72b9d4806322c18c2b23c801bb119ae16de39a5dbce823` |
| lib/settings.jsc | Extracted from ASAR | 23672 | `f521bf39c4a05dca206a0861c5d5b904870a57ca946f0e3cbbef849dbfdbd2aa` |
| lib/legacy.jsc | Extracted from ASAR | 18608 | `155d1aed676e0416c0feb352c789393702248e41e60594431ae47810c58150df` |
| lib/walker-profiles.jsc | Extracted from ASAR | 13048 | `c2176e31714360212cead743da27095d86e1847df4ba2452971b325a6cc1d455` |
| lib/hotkeys.jsc | Extracted from ASAR | 6080 | `d5d8e2d120fc1e9cdfcbdc0b70096fee985e3303a98983ef3715101ec94efddf` |
| lib/menu-view.jsc | Extracted from ASAR | 7176 | `c5dd09d0d9d606693cf45289626e22abfbc58f59428ac530c509b9ff6f868de2` |
| lib/map-view.jsc | Extracted from ASAR | 8896 | `024347e226e582aee84cc4291050dd387e4df765a208f7e1cd31d38588a75fd7` |
| lib/alert-presenter.jsc | Extracted from ASAR | 4152 | `e495085ded22a753a5b3bb698f1216c148fae2b2befa788908a28e4bbb7d7fc8` |
| lib/launch.jsc | Extracted from ASAR | 2592 | `cc92bfe8a7ff84553162667fdce2806149662690057caac3e143a7ad7ccee22e` |
| lib/otmm.jsc | Extracted from ASAR | 5184 | `64a1cabcb49bdb0a1756ff659919406aeebf7717b5d42aa0d6b0e3f4b4b55ce8` |
| shared/schema.js | Extracted from ASAR | 16092 | `8aa0fe77cbb90fa27ef132b20abf0951de0ba3e08fe81dd0d9f6e74be439e915` |
| shared/messages.js | Extracted from ASAR | 6597 | `eeeb0ac1970bcc15432fe3ad69a35d15c8ac6d3f68315524bbe3e3deb844a0c7` |
| shared/walker.js | Extracted from ASAR | 3520 | `9b77f866763aa6239f6a233cb26cd171f54e866f0073d96a46cb1c3d49b5ea2a` |
| shared/healer.js | Extracted from ASAR | 1598 | `e7b8d86f413956dd4472bc4895eedad53dc49d1873f269fbc2ac3262abcd7933` |
| shared/hoenn.js | Extracted from ASAR | 1471 | `40dfdadd51be75a6447d07fa1ff68a2afc110b1baaa6006455692af818fd94d7` |
| shared/alerts.js | Extracted from ASAR | 4737 | `424d3dbb18c27a693d681a0fffc21900c4122767d8bd049c07b2183bf9c462db` |
| shared/diagnostics.js | Extracted from ASAR | 3652 | `55e6fecf001a9bbb0b4fda5fb239e876a070906a9c661accd7d3492248435f97` |
| bytecode-runtime.cjs | Extracted from ASAR | 30026 | `dadf0da93f3d317b6f70250a751231eb167146c2c3ff02ebd5101929cb7f4f28` |

Observacao de processo (22/10, PID 32084, sessao ativa naquele momento): 99 modulos
via EnumProcessModules; nenhum modulo de automacao (shiba/pka/bot) aparece. Os pipes
pka-runtime-2-32084 e pka-security-32084 existiam durante a sessao. O PID 32084 nao
estava mais presente ao final desta rodada.

## 2. Onde executa cada coisa

| Funcao | Onde executa | Evidencia | Lacuna |
|---|---|---|---|
| UI, abas, formularios, validacao de campos | Menu (Electron renderer, JS minificado) | renderer/*.js e shared/*.js no ASAR; build_app copia 41 arquivos | - |
| Perfis e persistencia | Menu (lib/settings.jsc) + arquivos JSON em %LOCALAPPDATA%\OTPbot | settings.jsc valida/normaliza; electron/settings.json e perfis .lua no OTPbot | formato exato do arquivo por perfil |
| Sessao, leases, controle de modulos, monitor | Menu (main.jsc + lib/native-runtime.jsc + lib/pipe-bridge.jsc + lib/security.jsc) | native-runtime exports (start/monitor/stop/pauseAll/lease/configure); pipe-bridge KIND automation/control/lease | assinatura exata de start(5)/monitor(4) |
| Decisoes (TargetMinimum/Rank, HoennMinimum, HealWanted, ComboAck/Buff, Lure*, Path*, Capture*, Alert*) | DLL nativa (injetada) | package-integrity automation=native-dll; release-manifest decision-bytecode-v1 lista as regras; nenhuma dessas strings existe em main.jsc, lib/*.jsc, renderer/shared | sem imagem DLL em disco; modulo nao visivel no processo |
| Execucao de movimento, ataque, combo, potion/revive, hotkeys | DLL nativa | protocol.jsc e apenas encoder manual; native-runtime so envia controle/lease; regras de decisao acima vivem na DLL | enderecos/funcoes nativas indisponiveis |
| Scripts legados Lua | Menu (lib/legacy.jsc) | literais de perfis .lua, Walker/Healer/target; aviso "execucao Lua descontinuada" na UI | se ainda executa de fato nesta build |
| Mapa/OTMM (tiles, mapinfo) | Ambos | lib/map-view.jsc consome publicacoes; release-manifest map.sha256/blocks | formato binario do mapa nao mapeado |

Conclusao: o menu decide pouco e executa menos; a DLL concentra decisao e execucao.
O menu mantem sessao, configuracao, telemetria e comandos manuais.

## 3. Protocolo separado por camada

### 3.1 Conexao
- Named pipe: \\.\pipe\pka-runtime-2-<pid>; seguranca em \\.\pipe\pka-security-<pid>.
- Quadro: [uint32 len][uint32 kind][payload]; MAX_FRAME 2105344.
- Tipos: challenge1 authenticate2 welcome3 state4 telemetry5 automation6 startup7
  automation_revoked8 manual9 ack10 automation_control11 automation_lease12.

### 3.2 Handshake (comprovado contra o modulo original)
- servidor envia challenge(nonce);
- cliente: HMAC-SHA256(chave, "PKA2/client\0" + nonce + uint32LE(pid));
- servidor: welcome = uint32LE(pid) + HMAC-SHA256(chave, "PKA2/server\0" + nonce + uint32LE(pid));
- comparacao com timingSafeEqual.
Evidencia: tests/transport_live.test.cjs conecta o PipeBridge original ao nosso servidor
e confirma authenticated=true e prova identica a nossa implementacao.

### 3.3 Mensagens de aplicacao
- state: 48 bytes (protocol.decodeState) -> health/hp/mana/target/attackSeq/protoVersion.
- telemetry: JSON validado por telemetry.decodeTelemetry (schema 2, pulseVersion 3).
- ack: 12 bytes (commandId,type,status) com STATUS em protocol.jsc.
- automation/automation_control/automation_lease/automation_revoked/startup: controle.
- manual: comandos pontuais (encodeCommand, 24 bytes + texto).

### 3.4 Heartbeat e staleness
- PipeBridge defaults observados: pollMs=50, staleMs=3000, commandTimeoutMs=2500,
  startupTimeoutMs=20000; sequence aleatoria por instancia.
- Gates do renderer: online, !stale, !error, !authExpired, ageMs<=1000,
  nativeVerified, pulseVersion=3; healer exige automationVersion=1.
- Frequencia de state/telemetry nao observada diretamente: LACUNA.

### 3.5 Desconexao
- socket close -> estados de sessao expiram; comandos pendentes falham.
- automation_revoked pausa modulos ("A DLL negou a sessao; todos os modulos foram pausados.").
- pipe-bridge mantem fila limitada ("Fila de comandos cheia.") e exige confirmacao da DLL.

### 3.6 Advertencia sobre o mock
O mock (reconstruction/runtime-server.cjs) implementa uma hipotese de servidor. Ele NAO
prova o comportamento da DLL real. O que esta comprovado e apenas o lado cliente
(vetores de authenticate/welcome aceitos pelo modulo original) e os formatos de mensagem
observados no bytecode (state/ack/telemetry).

## 4. Especificacao e implementacao

Especificacao: reconstruction/spec/automation-v1.md + automation-v1.json.
Implementacao: reconstruction/engines/{target,healer,walker,lure}-engine.cjs e
reconstruction/automation.cjs, com testes deterministicos em tests/spec_conformance.test.cjs
e fixtures tests/fixtures/automation-v1.json.

Limites da implementacao: ela reproduz as configuracoes, gates e mensagens do menu,
mas as regras de decisao nativas (release-manifest decision-bytecode-v1) continuam
desconhecidas; os limiares usados sao os documentados no proprio produto (LEIA-ME e
default_config.json), nao engenharia reversa da DLL.

## 4.1 Reproducao das verificacoes

Comandos usados nesta rodada e saida observada (nao ha numero sem comando):

    & runtime/electron-v44.7.2/electron.exe --version   -> v44.7.2
    Get-Content runtime/electron-v44.7.2/version        -> 44.7.2
    Get-FileHash runtime/electron-v44.7.2/electron.exe  -> 1f41127064012c5e74422b2e0dfc35ff0b0fe8d7908b97d01503becd1b7fa9e1
    node tools/validate.cjs                             -> node 285 (279 pass, 6 skip); electron 285/285 pass; smoke ok
    node -e "require('./inventory.json').entries.length" -> 79; asar sha256 0cc1cf89...e24

Exports dos modulos .jsc, executados no Electron 44.7.2 com o bytecode-runtime do
proprio pacote e hash conferido antes da execucao:

    protocol.jsc        56522f34... exports STATE_SIZE, COMMAND_SIZE, ACK_SIZE, COMMANDS, DIRECTIONS, STATUS, uint32, uuidHash, decodeState, encodeCommand, decodeAck
    settings.jsc        f521bf39... exports SettingsStore, validateFields, validateConfig, profileName, characterName, characterKey, characterDirectory, MAX_BYTES
    telemetry.jsc       0f308a9d... exports decodeTelemetry
    pipe-bridge.jsc     f2047593... exports PipeBridge, SnapshotPublisher, KIND, MAX_FRAME, proof, frame
    native-runtime.jsc  20bdcad4... exports NativeRuntime

Os nomes de metodo (start/monitor/stop/pauseAll/lease/configure etc.) vem da execucao
desses bytecodes, nao de suposicao; o hash de cada .jsc e verificado antes do load.

## 4.2 Hashes completos e verificacao automatica

SHA-256 completos dos seis artefatos pedidos:

```text
0cc1cf89ee210714c150ed6270c9f44afc90e1d0bc2a790c6ab7b9eb77438e24  Shiba_Bots_App/dll/resources/app.asar
56522f34578706292530ee7c05f8774b221b6d2e862a55f51e78700cfe10a48e  Extracted_Source/lib/protocol.jsc
f2047593c12388a5bb09286d010fa7422b7e626fb8ea60c0268023be310114b4  Extracted_Source/lib/pipe-bridge.jsc
20bdcad4912965a6526d7f43fdf9806d309e347854e181ec69f7542aefb4d58b  Extracted_Source/lib/native-runtime.jsc
dadf0da93f3d317b6f70250a751231eb167146c2c3ff02ebd5101929cb7f4f28  Extracted_Source/bytecode-runtime.cjs
6fffeefd17a73bce9842ffa5be750b2507215798fbafb3f4f215864ce6f99d02  Extracted_Source/main.jsc
```

Convencao `CLAIM <id> :: <caminho> :: <sha256> :: <nota>`; caminhos relativos a raiz
que contem `RE_PKA`, `Extracted_Source` e `Shiba_Bots_App` (na entrega, a propria
pasta de entrega). Verificador: `node tools/verify-report.mjs reconstruction/REPORT_RE_v3.1.9.md ..`
gera `verify-report.json` e sai com codigo 1 em qualquer divergencia. As copias em
`RE_PKA/install-metadata/` sao byte-identicas aos arquivos da instalacao (copiadas,
nunca editadas); os executaveis grandes da instalacao ficam fora dos CLAIM porque nao
sao redistribuidos.

```text
CLAIM claim.app-asar :: Shiba_Bots_App/dll/resources/app.asar :: 0cc1cf89ee210714c150ed6270c9f44afc90e1d0bc2a790c6ab7b9eb77438e24 :: Menu Electron (ASAR) - identidade do pacote
CLAIM claim.protocol-jsc :: Extracted_Source/lib/protocol.jsc :: 56522f34578706292530ee7c05f8774b221b6d2e862a55f51e78700cfe10a48e :: Encoder/decoder do IPC
CLAIM claim.telemetry-jsc :: Extracted_Source/lib/telemetry.jsc :: 0f308a9d7fd4a89f537a61a076dd68aae5ef8b3fdf668f128152c3d6475456c8 :: Decoder de telemetria
CLAIM claim.settings-jsc :: Extracted_Source/lib/settings.jsc :: f521bf39c4a05dca206a0861c5d5b904870a57ca946f0e3cbbef849dbfdbd2aa :: Perfis e validacao
CLAIM claim.pipe-bridge-jsc :: Extracted_Source/lib/pipe-bridge.jsc :: f2047593c12388a5bb09286d010fa7422b7e626fb8ea60c0268023be310114b4 :: Cliente do canal (handshake/controle)
CLAIM claim.native-runtime-jsc :: Extracted_Source/lib/native-runtime.jsc :: 20bdcad4912965a6526d7f43fdf9806d309e347854e181ec69f7542aefb4d58b :: Orquestrador de modulos/leases
CLAIM claim.security-jsc :: Extracted_Source/lib/security.jsc :: afc75885c9ad843beb72b9d4806322c18c2b23c801bb119ae16de39a5dbce823 :: Ponte pka-security (DevTools/verify)
CLAIM claim.bytecode-runtime :: Extracted_Source/bytecode-runtime.cjs :: dadf0da93f3d317b6f70250a751231eb167146c2c3ff02ebd5101929cb7f4f28 :: Loader V8 usado nas sondas
CLAIM claim.main-jsc :: Extracted_Source/main.jsc :: 6fffeefd17a73bce9842ffa5be750b2507215798fbafb3f4f215864ce6f99d02 :: Main Electron em bytecode
CLAIM claim.package-integrity :: RE_PKA/install-metadata/package-integrity.json :: 83874bb25306ed2f30e63b9a822b4189a4ef7da544e9fd3c3a6dc2a4f349269e :: Copia byte-identica: automation=native-dll
CLAIM claim.release-manifest :: RE_PKA/install-metadata/release-manifest.json :: c8be2a791b8577291d0edbd6faa39a2fa119769f7f924a9d7aa157e77c77e7d9 :: Copia byte-identica: decision-bytecode-v1
CLAIM claim.install-version :: RE_PKA/install-metadata/version :: 6c2e974c7c389942acf1219ad8fccd94145bc04778fb735d68244686d80cc7b5 :: Copia byte-identica: Electron 44.7.2
CLAIM claim.default-config :: RE_PKA/default_config.json :: 330dafb71eb0a4417de21919ce3fa84068855bd4b26bc03abd886fad901b5f98 :: Configuracao distribuida
CLAIM claim.transport :: RE_PKA/reconstruction/transport.cjs :: 8e5671d167c76fd92188fd2dc436f31095e815ead810a6c99ed67b6ee68c8429 :: Cliente independente do canal
CLAIM claim.telemetry-impl :: RE_PKA/reconstruction/telemetry.cjs :: 79328aa0ce48bd678d599f2909a0f034fea82e660da54f424bd165bc218d1d5a :: Implementacao independente da telemetria; inspection validada diferencialmente
CLAIM claim.spec-json :: RE_PKA/reconstruction/spec/automation-v1.json :: 7194d8c75dae5d54d7b9325c7a426bb224089138d21fa11c04a109198ab9987c :: Especificacao machine-readable
CLAIM claim.fixtures :: RE_PKA/tests/fixtures/automation-v1.json :: d1682302f60271e8c16dfbfe8337179a85d83789792cb7d14656207ebaebebc0 :: Cenarios deterministicos
CLAIM claim.transport-live-test :: RE_PKA/tests/transport_live.test.cjs :: 20f0a8cf40addb371949c118e14806332cb7c07babd8c3770192ec6c90e6480b :: Diferencial do handshake contra o modulo original
```

## 4.3 Mock Python do canal (contrato verificado)

Porta Python 3.12 do runtime-server, sem dependencias externas, em tools/pka_runtime_server.py.
Corrige os erros do porte concorrente: `__init__`/`__main__` mangled, caminho do pipe
`\.\pipe` (precisa `\\\\.\\pipe`), INVALID_HANDLE_VALUE comparado com -1 quando
o restype e HANDLE/c_void_p, GetLastError sem `use_last_error=True`, ausencia de guarda
de MAX_FRAME no buffer de recepcao e ausencia de state/telemetry validos apos o welcome.
Mantem framing '<II' LE, HMAC PKA2/client|server, kinds 1..12, ACK '<III' e
MAX_FRAME 2105344.

Resultados reproduziveis:
- python_mock_interop.json: Transport independente autentica, decodifica
  state (healthPercent=90, protoVersion=1) e telemetry (pulseVersion=3), e recebe
  ACK commandId=1 type=4 status=0.
- python_mock_interop_original.json: o PipeBridge ORIGINAL (bytecode) autentica
  contra o mock Python (authenticated=true).

```text
CLAIM claim.python-mock :: RE_PKA/tools/pka_runtime_server.py :: 605f328a9fddfb150e62ee5c00ba0d4182b8eddca395f5c1b45eb7d18eabe339 :: Mock Named Pipe em Python no contrato verificado
CLAIM claim.python-interop :: RE_PKA/python_mock_interop.json :: b02e5e064976acb994cb50ab42d0b290762d0876157cea68c445a3fb2486b6d8 :: Interop: Transport independente <-> mock Python
CLAIM claim.python-interop-original :: RE_PKA/python_mock_interop_original.json :: 88e4374226672a20300ea34c9055924b20683729198f504464244f13c0332744 :: Interop: PipeBridge original <-> mock Python
```

## 4.4 Matriz de decisao (30 regras do manifesto)

reconstruction/spec/decision-rules-v1.json mapeia, uma a uma, as 30 regras de
release-manifest.json protection.rules para grupo, status, chaves de configuracao e
evidencia (arquivo do motor ou ausencia declarada). tools/check_decision_rules.cjs
valida: igualdade exata de IDs com o manifesto, status permitido, notas, chaves
existentes no default_config.json e existencia dos arquivos de evidencia.

Estado atual: 13 implemented, 13 partial, 4 unsupported, 0 native-unknown.
Os limiares nativos continuam UNVERIFIED; implemented/partial significam cobertura
pela especificacao independente, nao equivalencia com a DLL.

```text
CLAIM claim.decision-rules :: RE_PKA/reconstruction/spec/decision-rules-v1.json :: 9c59e1ded836e056cd76a2db52d05cea2f0b23322cd8747184429d0971b2174e :: Matriz das 30 regras do release-manifest
CLAIM claim.decision-checker :: RE_PKA/tools/check_decision_rules.cjs :: 54f2e5e8a42e265d30851c5711052879ce9188eadf471d56d33d56aabab1b4cc :: Verificador da matriz contra manifesto/config
CLAIM claim.decision-test :: RE_PKA/tests/decision_rules.test.cjs :: 13c52e811521dbed8b22f412a14c5c2324f83920c38d5630cce4082115150a8e :: Teste deterministico da matriz
```

## 4.5 Contratos das 16 lacunas (Alert/Capture/restantes)

reconstruction/spec/alerts-v1.json (7 regras), capture-v1.json (5) e
remaining-rules-v1.json (4) cobrem as 16 regras originalmente sem suporte; 16 fechadas
(Alert* + Capture* + BestTile/NextTeam/HealerDeploy/ComboBuff parciais) e 0
continuam blocked. Cada regra declara status (implementable/blocked), cobertura,
entradas, chaves de config, saidas, blockedBy e evidencia.

Politica de entradas: tools/check_contracts.cjs aceita apenas campos de telemetria que
o decoder verificado conhece e rejeita tokens inventados (isPlayer, isDead, canCapture,
telemetry.connected). Chaves de config precisam existir no default_config.json e a
evidencia precisa existir em disco.

Resultado atual: 16 regras, 16 implementable (subset local), 0 blocked, 0 erros. As 7 regras Alert*
foram implementadas no alerts-engine; CaptureEligible/Ball/Delay foram implementadas/parciais
com o snapshot real de inspection; CaptureRank/Approach tem subset offline (secao 6.5).
BestTile/NextTeam/HealerDeploy/ComboBuff passaram a partial com ancora byte-exata (secao 6.8).

```text
CLAIM claim.alerts-contract :: RE_PKA/reconstruction/spec/alerts-v1.json :: 6362ba3aaed5416c9ef1f1681469894ba7764b93068120076e897f4c1e05ea25 :: 7 regras Alert* com entradas/saidas/bloqueios
CLAIM claim.capture-contract :: RE_PKA/reconstruction/spec/capture-v1.json :: 30e17a01ede91c08fa377b1f2590e6093868c9ee411bf01bb7b5fa80a6efe59f :: 5 regras Capture*: subset local implementavel, cobertura nativa parcial declarada
CLAIM claim.remaining-contract :: RE_PKA/reconstruction/spec/remaining-rules-v1.json :: 0a79a9d4cb76484a57018ecb00869bea530106bf42228c07040c29e5c7cad3bc :: BestTile/NextTeam/ComboBuff/HealerDeploy; 4 parciais fechadas
CLAIM claim.contracts-checker :: RE_PKA/tools/check_contracts.cjs :: 068db8d9133b5daa82add609aba1ecb838452c4c1f6986fa3927ca5edb28144f :: Cobertura das 16 lacunas + politica de entradas
CLAIM claim.contracts-test :: RE_PKA/tests/contracts.test.cjs :: 3196ac6f338bd67ea036f2abeabc1b2d913900758ca7af3c8ab8bb551c56420b :: Teste deterministico dos contratos
```

## 4.6 Resumo de auditoria derivado

tools/audit_summary.cjs nao imprime numeros fixos: le verify-report.json,
decision-rules-v1.json, os tres contratos, o release-manifest copiado e o proprio
tools/pka_runtime_server.py; recomputa contagens, exige que os contratos cubram
exatamente as lacunas unsupported, exige 0 falhas no verify, confere o total de
vereditos e verifica que o hash do mock continua 605f328a... (canonico). Gera
audit-summary.json e sai com codigo 1 em qualquer divergencia.

```text
CLAIM claim.audit-summary :: RE_PKA/tools/audit_summary.cjs :: e0cd96cc31d084011eb386cf4834bce5460df3c5121c09fd37843cd7d4c9e04f :: Resumo derivado dos artefatos com cross-checks
CLAIM claim.audit-test :: RE_PKA/tests/audit_summary.test.cjs :: d8dec1201181ddfaba0be2e38dc28499ade39c5ffc5a49d6de4d073319433551 :: Teste deterministico do resumo
```

CLAIM claim.alerts-engine :: RE_PKA/reconstruction/engines/alerts-engine.cjs :: d96df0721588720970f59001227410afb04357cdfa75cfbce12f26786284b210 :: Motor de alertas (6 tipos suportados, chat por alertEvents talk)
CLAIM claim.alerts-test :: RE_PKA/tests/alerts_engine.test.cjs :: 163159bda375ffefd8725a08ebe3fb1313b4c09ff0e4057454b00a794741df9a :: Testes deterministicos do motor de alertas

## 4.7 Motor de alertas (Track A)

reconstruction/engines/alerts-engine.cjs implementa as 7 regras Alert* para os tipos com
entrada verificada: hp (hpOnce/rearme/repeat), creature (nome curinga, range 1..30, mesmo
andar, reentrada), hunt_pokemon (fora da lista), teleport (delta >=3 tiles apos
teleportIntervalMs), disconnected (borda online->offline, rearme) e chat (novos eventos
alertEvents kind=talk observados no snapshot real). Saidas sao notify,
pause(walker/target/looting) e suppress; nenhum comando IPC novo. Tipos player/
gm_arrow/gm_message/camera_viewers/pokemon_capture continuam sem implementacao por falta
de sinal verificado. tests/alerts_engine.test.cjs cobre 11 cenarios deterministicos; os tipos com repeat repetem enquanto a condicao persiste.

A matriz passou de 8/6/16 para 13/13/4; o contrato alerts-v1 registra as 7 como
implementable/fechadas, capture-v1 tem 5 implementable, remaining tem 4 blocked.

## 4.8 Capture engine (pos-look)

reconstruction/engines/capture-engine.cjs usa o shape real de inspection
{revision,id,kind:"item",container,pos}, schema2/captureVersion=1/
itemInspectorAvailable e itemCounts {id,count}. Implementa:

- CaptureEligible: corpseId configurado == inspection.id, mesmo andar e distancia
  Chebyshev <= maxCaptureDist (parcial; visibilidade nativa nao observada).
- CaptureBall: ballId primaria se count>0; fallback caso contrario (parcial;
  consumo nativo nao observado).
- CaptureDelay: nextCaptureAt(now,captureDelayMs) com clamp 1..60000 (completa
  somente para o contrato local; temporizacao nativa nao comparada).

Validacao adicional em 23/10/2026: inspection_vectors.json registra 48 mutacoes
da fixture redigida contra telemetry.jsc original, 15 aceitas e 33 rejeitadas.
O decoder independente foi corrigido: container e boolean obrigatorio,
revision e inteiro 1..4294967295 e pos pode ser null. Nenhuma nova varredura de
memoria, leitura de chave ou conexao ao pipe foi feita nesta rodada.
tests/inspection_decoder.test.cjs liga a identidade da fixture ao registro de
evidencia e testa frame fragmentado -> decoder -> decisoes locais. Configuracao
e posicao desse teste sao sinteticas; ele nao comprova captura no jogo.

CaptureRank e CaptureApproach passaram a ter subset offline comprovado na secao 6.5.
A captura usa useWith existente; nao foi criado opcode novo. tests/
capture_engine.test.cjs cobre 12 cenarios; capture_native.test.cjs acrescenta
5 testes de evidencia estatica, incluindo 1.296 pares de desempate.

```text
CLAIM claim.capture-engine :: RE_PKA/reconstruction/engines/capture-engine.cjs :: acf0354f9b9c132b55770268baf53bf6d123be2129e45d25cc0c3470b354cd9a :: elegibilidade/ball/delay, rank deterministico e planejamento useWith offline
CLAIM claim.capture-test :: RE_PKA/tests/capture_engine.test.cjs :: d3f4239b59da32576fb9f042e83257564808d2b65206c88491d975da06dae3de :: testes deterministicos
CLAIM claim.inspection-fixture :: RE_PKA/reconstruction/fixtures/telemetry-schema2-inspection-redacted.json :: 32b5baa061ab25a6379107f217b7136f39b7d1820bbfd17ccf7bf2989535805c :: snapshot com inspection real
CLAIM claim.inspection-evidence :: RE_PKA/reconstruction/inspection-snapshot-evidence.json :: 3a99889c1b0c50e0e7226f95de9d31bda7406da45b740da6bf4e09f23c47b524 :: hash/proveniencia do look
```

## 6. Dump nativo em memoria (23/10/2026)

Sessao: PokeAlliance_dx.exe PID 32336, personagem Nobutdopai, conta descartavel
autorizada. O entry a497...exe injetou e saiu; os pipes pka-runtime-2-32336 e
pka-security-32336 passaram a existir. Nenhum modulo de automacao aparecia em
EnumProcessModules (97 modulos).

Varredura read-only (OpenProcess + VirtualQueryEx + ReadProcessMemory) achou os
marcadores em 0x7ff85c554d58/90 (PKA-INIT, "Debugger detected", PKA-INIT-NATIVE)
e 0x7ff85c6726aa (pka-runtime-2- em UTF-16). GetMappedFileNameW aponta a regiao
para C:\Windows\System32\msftedit.dll (base carregada 0x7ff85c470000, SizeOfImage
0x328000). Comparando com o PE em disco (ImageBase 0x180000000, rebase aplicado):
- .text (RVA 0x1000, 0x287000): 2.231.494 bytes diferentes;
- .rdata: 20 bytes; .data: 6; .pdata/.didat/.rsrc/.reloc: 0.
Isso caracteriza module stomping: o payload ocupa praticamente toda a .text do
msftedit, com headers zerados no inicio da imagem.

Dumps gerados (fora da instalacao):
- dumps/pid32336_msftedit.dll.memory.bin (0x328000 bytes, sha256 8fbd9d96...),
- dumps/msftedit_text_32336.bin (.text, 0x287000 bytes, sha256 7c0fd219...),
- dumps/pid32336_msftedit.dll.json (ranges/secoes/strings),
- native_dump_evidence.json (RTTI e strings).

Evidencia de execucao nativa (RTTI no dump): pka::bot::Runtime com metodos
tick, tickBestTile, tickGuildDaily, tickHoenn, tickHoennLure, tickLoot,
tickLureSkills, tickRevive, tickTravelLure, comboTick, clearTrainer, route,
send; pka::TravelLure::plan. Strings: "[native] Resolving %s target %u.",
"[native] Dispatching %s target %u.", automationVersion/pulseVersion/
shinyVersion/combatDispatchVersion/dynamicLureVersion, captureVersion,
itemInspectorAvailable, mensagens de combo/UUID, walkerIndex, healer, looting.

Isto encerra a duvida "menu ou DLL": decisao/execucao estao no modulo nativo,
agora dumpado da memoria. Continua UNVERIFIED a identidade de arquivo original
(header apagado, sem PE no dump) e os enderecos de funcao (RTTI da nomes, nao
simbolos); sem esses enderecos as 9 regras blocked seguem blocked.

Ferramenta: tools/dump_stomped_module.py (read-only; aplica relocs do PE de disco
e lista ranges). Limitacoes no JSON: IAT/loader writes contam como diff; ranges
sao diferencas de bytes, nao semantica.

```text
CLAIM claim.native-text-dump :: RE_PKA/dumps/msftedit_text_32336.bin :: 7c0fd219dc24f3fa273ded518eca8ea840d3395f00d14e78beacb4ffd7c50ea4 :: Secao .text stomped com o payload nativo
CLAIM claim.native-memory-dump :: RE_PKA/dumps/pid32336_msftedit.dll.memory.bin :: 8fbd9d963ac5bb09030b8ae27c01b74c0888717fd9b282551ebe978bba28d648 :: Imagem de memoria lida do PID 32336
CLAIM claim.native-dump-report :: RE_PKA/dumps/pid32336_msftedit.dll.json :: aecb5cca6f4bdde7e81b131209a5e28eb2cadabf74f2049fc8785cb9fdf515f0 :: Diff vs msftedit.dll em disco
CLAIM claim.native-dump-evidence :: RE_PKA/native_dump_evidence.json :: a62ec4f28f498ff4700507ed8cd0acd7472fe94bbf7790237f8053c47efa5844 :: RTTI/metodos/strings do payload
CLAIM claim.native-dump-tool :: RE_PKA/tools/dump_stomped_module.py :: b4c825dc3503849310840523c42cd51a82be163ca94ea3982d16e16f9f25f60c :: Dumper read-only + diff rebaseado
CLAIM claim.native-dump-test :: RE_PKA/tests/native_dump.test.cjs :: 54efe69f29b513b483520886ede26715d4be6690123c504ae843ab472e6da4b6 :: Teste deterministico dos dumps
```

## 6.1 Mapa estatico do payload (23/10/2026)

Arquivos derivados do dump (mesma hash 7c0fd219...): native_xrefs.json,
native_static_evidence.json, native_strings_evidence.json, native_disasm.txt.
Enderecos sao VA da imagem carregada; RVA relativo a 0x7ff85c470000.

| RVA | entrada candidata | evidencia estatica |
|---|---|---|
| 0x12c40 | dispatcher | strings "follow"/"attack" (chaseMode), logs Resolving/Dispatching |
| 0x15590 | init nativo | "starting", 3 constantes sha256, PKA-INIT-NATIVE, "ready", PKA-INIT-SESSION |
| 0x8a756 | bloco de validacao do tick | walker/waypoints, target/monsters, instanceModeEnabled, autoRevive/hotkey, usePokeStop/conditionEvents, healer/healHpPercent/healPokemonName/returnPokemonName, tools/looting/captureEnabled/captureVersion, hoenn/roster/formation 3x2, uuid/name |

O dispatcher tem duas referencias a follow/attack e chama 0x7ff85c47fcf0 em ambos
os ramos. O init le tres hashes fixos (bd2d8b24..., 74bc739c..., 954de5c4...)
antes de PKA-INIT-NATIVE; a finalidade (anti-tamper/perfil) nao esta provada.
O bloco de validacao emite as mensagens PT e le os campos de configuracao; nao
ha limiares numericos nas referencias de string.

Inventario de chaves JSON no payload: 90 chaves, incluindo alertEvents,
alertSignals, alertEventsDropped, guildDailies, guildDailyAutoVersion,
conditionEvents, performance (mapReadCalls/peakSnapshotUs/lastSnapshotUs),
inspection/items/itemCounts, chaseMode/fightMode, identityAvailable,
nativeSequence, captureVersion, itemInspectorAvailable. Comparado ao codigo
atual, 66 chaves nao aparecem em telemetry/protocol/settings/specs; ficam como
observacao, sem semantica implementada.

Limitacoes: entradas sao candidatas (sem simbolos/PDB); xrefs sao estaticas;
strings provam nomes, nao valores/limiares; nada aqui fecha as 9 regras blocked.

```text
CLAIM claim.native-xrefs :: RE_PKA/native_xrefs.json :: 3cd959ac7f24a489f9bb8a508363b9d068e4d45580a40cec1d2aa021d0e775c3 :: xrefs/RTTI
CLAIM claim.native-static-evidence :: RE_PKA/native_static_evidence.json :: a61337459e2c20fe13dae0c2f7e91118429d28dd82b0192a5dd31e4dc61282f3 :: funcoes candidatas
CLAIM claim.native-strings :: RE_PKA/native_strings_evidence.json :: 2b3542af7a2ae0e64c525f3f905713790cd58e5fd9544dc33b8039e082895912 :: inventario de chaves
CLAIM claim.native-disasm :: RE_PKA/native_disasm.txt :: 4a6eafc2e3eadca95e195b3bdb9111f71f22a13599b1e95042a5ca47a02e2dfa :: disassembly anotado
CLAIM claim.native-static-test :: RE_PKA/tests/native_static.test.cjs :: da4fe25e6d5ffd7cb57b2cc7f59031331652145cf89b4f7c45ed7d66d5a91f9c :: teste deterministico
```

## 6.2 Snapshot real de telemetria (schema 2)

Capturado em 23/10 do heap do menu PKA Tools (PID 16576) por ReadProcessMemory,
sem abrir pipe e sem chave. O objeto JSON completo tem 78.160 bytes, sha256
dfc5cbd193d7f6db883a5241489c12508ee621bd6c4bfbc0c95744818365a702; o raw nao
e distribuido. A fixture redigida mantem a forma observada.

Conteudo: schema 2, nativeVerified true, captureVersion 1,
itemInspectorAvailable true, 627 itens, 8 criaturas, 26 itemCounts,
inspection null, alertEvents/alertSignals/conditions/performance/tiles presentes.
Itens: id, stack, instance, container, pos{x,y,z}. Criaturas: id, name, type,
healthPercent, direction, shinyIcon, lookType, normalLookType, shinyLookType,
canAttack, pos. itemCounts: id, count.

Isto confirma o schema de telemetria e os campos de itens/criaturas que o dump
nativo ja indicava. Esse snapshot tinha inspection null; o look real esta no §6.3.

```text
CLAIM claim.telemetry-snapshot :: RE_PKA/reconstruction/fixtures/telemetry-schema2-redacted.json :: dc677659342e0ba80db1e675eda68bdc98fb248d0f7c6cb0919e03ecaa8d8bd7 :: fixture schema2 redigida
CLAIM claim.telemetry-snapshot-evidence :: RE_PKA/reconstruction/telemetry-snapshot-evidence.json :: 84e38d0a27dac4517797edbd54f55e1b852af08b6c47a18e633d42502441c5d4 :: hash/size/proveniencia
CLAIM claim.telemetry-snapshot-test :: RE_PKA/tests/telemetry_snapshot.test.cjs :: ab57185561f7a6d6d3331dbbe227b105e77c1196d60d66e0f3074b0481d961f4 :: teste deterministico
```

## 6.3 Look real e fechamento parcial de Capture (23/10/2026)

Apos Shift+clique (look) no item 4029, o menu registrou inspection:
{"revision":7,"id":4029,"kind":"item","container":true,"pos":{"x":3291,"y":2222,"z":8}}.
Snapshot completo: 85.482 bytes, sha256
546bcb8a1c18e3eb8dd454d4ff94dcc3b59f1506547b7e710ea779a3d989298f; fixture
redigida em reconstruction/fixtures/telemetry-schema2-inspection-redacted.json,
evidencia em reconstruction/inspection-snapshot-evidence.json.

Nesta etapa CaptureEligible/Ball/Delay sairam de blocked; CaptureRank/Approach
ainda estavam blocked. O bloqueio foi revisto com evidencia nativa na secao 6.5. A
matriz ficou 13 implemented, 13 partial, 4 unsupported; contratos 12 fechadas,
4 blocked.

## 6.4 Decoder de telemetria schema 2

reconstruction/telemetry.cjs agora aceita o schema real: alertEvents nao vazio
(kinds talk/pinned/effect/viewers, campos id/kind/mode/value/name/text/self/pos),
alertSignals com os cinco booleanos, alertEventRevision/Dropped, inspection
{revision:1..4294967295,id,kind:item|creature,container:boolean,pos:object|null}
e itemCounts {id,count}. Antes o
decoder rejeitava qualquer inspection e exigia alertEvents vazio.

tests/telemetry_snapshot.test.cjs reproduz a fixture schema2 completa, exige
inspection.id 4029, 11 eventos talk e 29 itemCounts, e rejeita inspection/evento
malformados (fail closed). Os 48 casos de inspection_vectors.json e o
diferencial vivo adicional validam as correcoes; nao estabelecem equivalencia
global do decoder ou dos cinco comportamentos Capture*.

CLAIM claim.inspection-vectors :: RE_PKA/inspection_vectors.json :: b57e023bb263a45643f86cd05c177dcb5aad19e4d025973f70513d78be5e8540 :: 48 casos observados no decoder original
CLAIM claim.inspection-differential-test :: RE_PKA/tests/inspection_decoder.test.cjs :: 5f2fd6518d4c85e816da7d26d4dbb820114beea4bbcc3c588d6c40528c2e9739 :: Identidade, casos, diferencial vivo e integracao offline

## 5. Lacunas declaradas

1. Imagem da DLL nativa: identidade resolvida como shiba_bots.dll (recurso
   encriptado do injetor, extraido em runtime e apagado apos injecao; secao 6.9).
   O arquivo cru desencriptado e os enderecos de funcao (sem simbolos) seguem
   pendentes; captura do recurso exige debugger/hook no injetor, nao executado.
2. Handshake de pka-security-<pid> (attach/verify/ready) nao mapeado; provavel origem
   da PKA_CHANNEL_KEY, mas apenas hipotese.
3. PKA_CHANNEL_KEY nao foi encontrada nas localizacoes verificadas: env de jogo,
   env do menu, settings.json do OTPbot, Local Storage e arquivos do OTPbot. Ausencia
   fora dessas localizacoes e UNVERIFIED; a hipotese atual e troca via pka-security.
4. Frequencia/cadencia real de state/telemetry, runtime.jsonl e .session.<pid> ainda
   nao observados; existe um snapshot schema2 real (§6.2/6.3).
5. Semantica exata de combatStanceAuto (fight 1..3) e revive nao observada.
6. CaptureRank e CaptureApproach tem subset local recuperado (secao 6.5); navegacao,
   hook final, modo aleatorio e ciclo nativo completo permanecem desconhecidos.

## 6.5 Capture: comparador e fronteira de despacho nativos

A analise estatica do dump de hash 7c0fd219...50ea4 ligou tickLoot em
RVA 0xa46e0 e send em 0x84340 via vtable/COL/RTTI, nao so por strings.
reconstruction/CAPTURE_NATIVE.md fornece formulas, tabela de bytes/RVAs,
offsets, reproducao e limitacoes; native_capture_evidence.json fixa 49 ancoras.

CaptureRank: ramo deterministico prefere attempts==0 && failures<3, depois
menor lastAttemptAt, menor distancia Chebyshev, maior stack e primeiro na
iteracao em empate. O descritor RVA 0xe6398 foi decifrado estaticamente;
1.296 pares distancia/stack sao comparados ao predicado recuperado nos testes.
O historico e interno e explicito; nao foi adicionado campo a telemetry.

CaptureApproach: o trecho recuperado usa alcance <= maxCaptureDist, revalida
id/stack/XY/chave e pede useWith com posicao do corpo, itemId da ball,
targetId do corpo e stack. Nao foi inventada uma rota ou regra <=1.
A chamada virtual em RVA 0x8461a tem binding do worker resolvido na secao 6.6;
nao e prova de captura executada nem de navegacao do cliente. O modo aleatorio, o hash de
chave sem instance e o ciclo completo de atraso/fila tambem permanecem abertos.

capture-engine.cjs implementa comparador, planejamento, revalidacao e transicao
local de historico/cooldown. As APIs nao estao ligadas ao tick da UI ou ao jogo.
Contrato: implementable com coverage partial para as duas regras; matriz:
13 implemented, 13 partial, 4 unsupported. Contratos: 12 implementable e 4
blocked. Fechamento aqui significa subset local, nao equivalencia nativa total.

Validacao historica da etapa 6.5: build/smoke aprovados, 275/275 testes no Electron,
269 aprovados e 6 omitidos no Node22, zero falhas. Os quatro verificadores
solicitados passaram; verify-report.mjs conferiu 68/68 hashes.

CLAIM claim.native-capture-static :: RE_PKA/native_capture_static.json :: b31e5af919ec1bbe8250fe7fb6dc41753bca29bd0987251cabd78056f2e568e7 :: evidencia estatica de captura; limites no relatorio
CLAIM claim.native-capture-assembly :: RE_PKA/native_capture_disasm.txt :: 8bc222cf2527f8ea2267b3ef07dabc684302ad191f525193cda817a0b073e472 :: evidencia estatica de captura; limites no relatorio
CLAIM claim.native-capture-guard-static :: RE_PKA/native_capture_guard_static.json :: 8409d8e71393f88aec577072a9ab9598cb73c9d44c26225cd76e60e57226d8c3 :: evidencia estatica de captura; limites no relatorio
CLAIM claim.native-capture-guard-assembly :: RE_PKA/native_capture_guard_disasm.txt :: e146292db5d1d05147a663e206b5ed4bb02c0e3eaaf6802b239cf6cf97a81030 :: evidencia estatica de captura; limites no relatorio
CLAIM claim.native-capture-send-static :: RE_PKA/native_capture_send_static.json :: 749a87336c93f740816e952d9260c2bf2ba532f43ca0ae8bc739ee813148ace2 :: evidencia estatica de captura; limites no relatorio
CLAIM claim.native-capture-send-assembly :: RE_PKA/native_capture_send_disasm.txt :: 9d49ad27dd3b93e19a56d439ff4a2961c7e6eed99cf7ba1b4e11e605476013f6 :: evidencia estatica de captura; limites no relatorio
CLAIM claim.native-capture-vm-static :: RE_PKA/native_capture_vm_static.json :: 5238710db9d3d7ac0bcdec7847b90b41cb3d888fc74ee523615bbbfeb0abe9a7 :: evidencia estatica de captura; limites no relatorio
CLAIM claim.native-capture-vm-assembly :: RE_PKA/native_capture_vm_disasm.txt :: 3a78a2917bc80a278b04b00741478f7eccca5d720dc96549f28754bea2b76b29 :: evidencia estatica de captura; limites no relatorio
CLAIM claim.native-capture-distance-static :: RE_PKA/native_capture_distance_static.json :: d96903c4fb37d1b46f413128a175d5bd42ae3f1d5f71d0a831d82e871755f26e :: evidencia estatica de captura; limites no relatorio
CLAIM claim.native-capture-distance-assembly :: RE_PKA/native_capture_distance_disasm.txt :: 3fc6311c036c688d3c62ff44aae94d8e5dd859c370f46b97921194ace5bf9347 :: evidencia estatica de captura; limites no relatorio
CLAIM claim.capture-native-evidence :: RE_PKA/native_capture_evidence.json :: edfbd9589e9ffb2f61d5ae52606a453ef840f2a94845e67daad5819486ef8797 :: evidencia estatica de captura; limites no relatorio
CLAIM claim.capture-native-extractor :: RE_PKA/tools/capture_native_evidence.py :: c623b1952437ffbcd1fb3b2bcb5099506587e057a8b8211f508e0fe6b18ca31d :: evidencia estatica de captura; limites no relatorio
CLAIM claim.capture-native-analyzer :: RE_PKA/tools/analyze_capture_native.py :: 64705a1b019d4c0bd83c70f144a80c6e8f9592289671789a761096e91dfbd92f :: evidencia estatica de captura; limites no relatorio
CLAIM claim.capture-native-test :: RE_PKA/tests/capture_native.test.cjs :: 5d1691efa40a33ecdbe6de6d54f93075c020c84924988a5c61e6de10d1f076db :: evidencia estatica de captura; limites no relatorio
CLAIM claim.capture-native-report :: RE_PKA/reconstruction/CAPTURE_NATIVE.md :: 08f1013a4f2d2c41eb0164fa6685eb7f9994ba089e32403fa299dbf0d5d1961b :: evidencia estatica de captura; limites no relatorio

## 6.6 Native runtime: static dispatch, routes and random timing (2026-10-23)

The quoted file offsets differ from RVAs by 0x1000. RVA 0x85633 reaches
memcmp via thunk 0xd6e76 and import slot 0xe2438 (VCRUNTIME140.dll).
The distinct virtual call at RVA 0x8461a resolves, for the recorded worker
constructor binding, to adapter 0xc6360 and handler 0xcfe40. This handler
runs the preflight callback and stages a pending command; its downstream
consumer, client hook and ACK are not established by this static trace.

Route candidate 0x7df00 reads tiles/walkable/creatures and calls search
0x613e0 using Chebyshev helper 0x5d0f0. Full A* costs and tie-breaks remain
open. TravelLure::plan candidate 0x6f610 and tickTravelLure 0xac180 are
linked through RTTI/calls; travel routes at 0xac4ce and sends walk at 0xacf46.
The tick graph is conditional, not the illustrative fixed module list.

Recovered helper 0x8ed30 samples inclusive integer SECONDS, not arbitrary
milliseconds. native-random.cjs implements the bounded formula and native
two-word double conversion; lure-engine.cjs consumes the corrected deadline.
Full lure mode transitions, candidate scoring and live RNG seed stay unknown.

native_runtime_evidence.json pins 91 instruction anchors and 34 disassembly
blocks to the preserved dump hash. NATIVE_RUNTIME.md records bytes, RVAs,
input/output boundaries, conditional bindings and residual unknowns.
BestTileScore, NextTeam, ComboBuffDone and HealerDeployReady stay blocked.
Matrix remains 13 implemented / 13 partial / 4 unsupported. Contract totals
remain 12 locally implementable / 4 blocked. No new IPC opcode or JSON field
was invented. All work in this stage was static/offline.

Validation of stage 6.6: verify-report 76/76 hashes; decision rules and contracts
checks report zero errors; audit summary passes. validate.cjs passes build,
Node22 (279 passed, 6 skipped, 0 failed), Electron (285 passed, 0 skipped,
0 failed) and smoke. This validates the local subset, not full native equivalence.

CLAIM claim.native-runtime-extractor :: RE_PKA/tools/native_runtime_evidence.py :: 43b5a220d47ed0f067c5c264d3a31b8637726b566697b4dc9c13cc974b6d4ae6 :: static runtime evidence or bounded local reconstruction; limitations in NATIVE_RUNTIME.md
CLAIM claim.native-lifecycle-research :: RE_PKA/tools/lifecycle_research.py :: 78807ceadfa8736f874a84bdee1f412e3d59364edcdbbdaa9e60494061178a49 :: static runtime evidence or bounded local reconstruction; limitations in NATIVE_RUNTIME.md
CLAIM claim.native-runtime-evidence :: RE_PKA/native_runtime_evidence.json :: 9ef32013c65ea61e034458a06ae5470a6f2a24c113c75b41a41154108e2c0aea :: static runtime evidence or bounded local reconstruction; limitations in NATIVE_RUNTIME.md
CLAIM claim.native-runtime-assembly :: RE_PKA/native_runtime_disasm.txt :: 285d63e4821bc55708875ec524a7146c511ecb38041877b3894dbf876e1a29c7 :: static runtime evidence or bounded local reconstruction; limitations in NATIVE_RUNTIME.md
CLAIM claim.native-runtime-report :: RE_PKA/reconstruction/NATIVE_RUNTIME.md :: 864d8db4d760cc4814c04afb146803ff55b98dbfd030a22e8c31236f05e92a2f :: static runtime evidence or bounded local reconstruction; limitations in NATIVE_RUNTIME.md
CLAIM claim.native-runtime-test :: RE_PKA/tests/native_runtime.test.cjs :: fd63dd49a758509feab33ff98b4931a0873d4371f71a0d87c7065ff145bfd60a :: static runtime evidence or bounded local reconstruction; limitations in NATIVE_RUNTIME.md
CLAIM claim.native-random-engine :: RE_PKA/reconstruction/engines/native-random.cjs :: a6176c5358cfdfee9b12ec6904c6cc377d0f1349e7ab83cfda985082d29505b4 :: static runtime evidence or bounded local reconstruction; limitations in NATIVE_RUNTIME.md
CLAIM claim.native-lure-engine :: RE_PKA/reconstruction/engines/lure-engine.cjs :: 7d986f1102f03713eb8c76d1ca6da6b06820c362d44162c338e1e61db9df243b :: static runtime evidence or bounded local reconstruction; limitations in NATIVE_RUNTIME.md


## 6.7 Telemetria de alertas: diferencial e correcao do decoder (23/10/2026)

O checkout ja continha a correcao das fixtures: os cinco testes de snapshot
passaram sem mudancas. O trabalho posterior de captura/runtime foi preservado,
assim como o chat parcial adicionado em paralelo ao motor local.

282 sondas sobre o telemetry.jsc original, no Electron 44.7.2, resultaram em
83 aceites e 199 rejeicoes. A fixture de partida e o look real redigido do
secao 6.3; demais casos sao mutacoes sinteticas, nunca eventos reais inventados.
O diferencial compara aceite, erro e hash da saida, e nao comportamento nativo
de alertas. Nenhuma operacao externa foi chamada pelo harness.

Fronteiras confirmadas: fila ate 32 eventos, name ate 95 bytes UTF-8,
value uint16, campos mode/value/name/text/self/pos obrigatorios. IDs sao
inteiros seguros positivos, estritamente crescentes e ate alertEventRevision.
O decoder local antes aceitava 2048 eventos, name de 255 bytes, value uint32,
campos ausentes e IDs fora da ordem/revisao. Essas divergencias foram corrigidas.
ALERT_TELEMETRY.md detalha amostras, hashes, reproducao e limites de autoridade.

Chat local consome talk por ID; nao ha prova de equivalencia dos filtros
self/mode com o nativo. As flags alertSignals sao capacidades, nao eventos.
GM/setas/viewers/captura continuam sem novos gatilhos. Nao houve criacao de
campos, opcodes, limiares ou classificadores sem evidencia do decoder original.
A matriz permanece 13 implemented / 17 partial / 0 unsupported; contratos
16 implementable / 0 blocked. As quatro regras restantes fecharam com evidencia
estatica (secao 6.8).

Validacao desta etapa: build/smoke aprovados; Electron 291/291; Node 284
aprovados, 7 skip por V8, zero falhas. Os seis testes novos de alert decoder
incluem procedencia, comparacao dos 282 vetores, fronteiras, enquadramento
fragmentado, flags sem eventos e diferencial vivo no Electron. O hash canonico
do mock permanece 605f328a9fddfb150e62ee5c00ba0d4182b8eddca395f5c1b45eb7d18eabe339.

CLAIM claim.alert-decoder-probe :: RE_PKA/tools/probe_alert_vectors.cjs :: 83cfcccf3436262a0a1fda077b8042a2854a756868e78cf015feda8e82b6089d :: diferencial finito de decoder; nao prova gatilhos nativos
CLAIM claim.alert-decoder-vectors :: RE_PKA/alert_vectors.json :: 0419f3cda15423cf9b29c935c456acf7765536b500e481b033867e5e20a0b9ef :: diferencial finito de decoder; nao prova gatilhos nativos
CLAIM claim.alert-decoder-test :: RE_PKA/tests/alert_decoder.test.cjs :: 8b0ba03ae551b81797b4faaf44ce11f947ff1a4daef4825bb877417b433a4784 :: diferencial finito de decoder; nao prova gatilhos nativos
CLAIM claim.alert-telemetry-report :: RE_PKA/reconstruction/ALERT_TELEMETRY.md :: 5cdbe7c0ee25776b167797290bc82b13696c1de761eb743122ef7f0b868c6f06 :: diferencial finito de decoder; nao prova gatilhos nativos

## 6.8 Regras restantes: constantes e predicados estaticos (23/10/2026)

native_remaining_rules_evidence.json fixa, byte a byte contra o dump de hash
7c0fd219...50ea4, as constantes carregadas em RIP-relative dentro de tickBestTile
(0x92730..0x93c63), tickHoenn (roster/time) e do bloco de deploy. 24 ancoras de
instrucao e 9 doubles de .rdata decodificados:

- HealerDeployReady: predicado pronto = (now - deployStableSince) >
  max(pokeReadyTimeoutMs, 1000). Clamp 1000.0 em rdata 0xecf80, comparacao
  comisd/jbe em 0x9d2c3/0x9d2c7. Agregacao roster-wide (gateReadyPct/gateMinHp)
  nao observada.
- BestTileScore: keys bestTileMaxWaitMs/bestTileRetryMs/bestTileRange/
  perfectLureTimeoutMs lidas em 0x9d9ef; constantes 2.0/200.0/4000.0/2500.0/
  1400.0/4.0/100.0/1.0 observadas; strings reais de box 8x8. Formula de score e
  desempates seguem parciais.
- NextTeam: roster em 0x9b683, health convertido em 0x9b6b3 (cvttsd2si), limite
  de 6 slots (0x9b6a9) e rotacao modulo (0x9b6c8..0x9b6ce). Predicado de troca
  por hp segue parcial.
- ComboBuffDone: gate de config em 0x57df5..0x57f8d (useMedicine +
  useMedicineBeforeCombo + medicineHotkey/medicineActionBar, erro inline
  'Configure a hotkey de Medicine ou desative Medicine.' em 0xe72f8); gate de
  combo em 0x57f90..0x5818d com consts 1000.0 (comisd 0x57fe8) e 3.0
  (ucomisd 0x58097). Dispatch do combo em 0xa1633..0xa1800 monta o pedido com
  pokestopToComboMs/gateStopped/useReadyGate/cycleAtSafeSpot/gateReadyPct/
  readyPct/healthPercent/gateDpsMinHp, confirmando a ordem gate->combo.
  ACK do ComboStep e contagem de buffs por step seguem parciais.

Nenhuma formula foi inventada: o que nao tem ancora vai anotado como parcial.
Isso moveu a matriz para 13 implemented / 17 partial / 0 unsupported e os
contratos para 16 implementable / 0 blocked, sempre subset local estatico.

```text
CLAIM claim.remaining-evidence :: RE_PKA/native_remaining_rules_evidence.json :: 7b848c08356ba6ea1c8eda2d24cef51d1e517a7127721c0f5163e4b60e52cf3b :: constantes/ancoras byte-exatas das 4 regras restantes
CLAIM claim.remaining-test :: RE_PKA/tests/remaining_rules_evidence.test.cjs :: 9a27125fb37bd32770b4bb7a4345a714e58db872ebf99c751d39a9fe19410091 :: teste deterministico da evidencia das regras restantes
```

## 6.9 Sessao viva e diferenca de builds (23/10/2026)

Captura read-only da sessao ativa (jogo PID 37152, PKAengine PID 5580) via
OpenProcess + VirtualQueryEx + ReadProcessMemory, sem escrita no alvo:

- Imagem completa 0x328000 (dumps/pid37152_msftedit.memory.bin, sha256
  91f6aaef...), .text 0x287000 (dumps/msftedit_text_live_37152.bin, sha256
  e44df8d6...), PE reconstruido (dumps/payload_reconstructed_live37152.dll,
  sha256 36b3b165...).
- Header da imagem viva zerado (e_magic 0000, sem PE), confirmando o mesmo
  padrao de module stomp da sessao 32336.
- **Descoberta:** o payload vivo e uma build DIFERENTE da 32336. Strings de
  config compartilhadas (bestTileMaxWaitMs/pokeReadyTimeoutMs/etc) deslocadas
  ~0xa80, prologue de tickBestTile em 0x61b60 (vivo) vs 0x612b0 (32336), sem
  correspondencia byte-a-byte no codigo de instrucao. As ancoras de codigo da
  secao 6.6/6.8 NAO existem na build viva.
- PKAengine.exe e PKA-Proxy.exe escaneados em disco: apenas a string
  'PKAengine' (nome proprio); nenhum payload embutido identificavel.
- %TEMP% escaneado (arquivos .tmp/.dll >=10KB): nenhum marcador PKA.
- app.asar: apenas lib/pipe-bridge.jsc, main.jsc e shared/schema.js mencionam
  marcadores; o DLL nativo nao esta no ASAR.

A identidade original foi RESOLVIDA como **shiba_bots.dll**: o injetor
(a497a7a52bf97c5bcc5fad69c7958ce6.exe.tmp, atalho PKA Tools) extrai o payload de
um recurso embutido (FindResource/LockResource, encriptado) para
`%s\dll\shiba_bots.dll`, injeta no jogo e deleta. Evidencia: strings no injetor
`%.*s\dll\shiba_bots.dll`, `%s.tmp`, `.pka-before-unblock-`, `C:\OTPbot`,
`PKA-MENU-RUN-V1`; release-manifest/package-integrity confirmam automation=
native-dll e layout electron-only (sem shiba_bots.dll listado, pois e extraido
em runtime). O arquivo cru (recurso desencriptado) nao foi capturado: ele e
criado e apagado a cada injecao. A captura esta preparada: tools/seize_payload_dll.py
abre o DLL com GENERIC_READ sem FILE_SHARE_DELETE, travando o DeleteFile do
injetor e copiando os bytes desencriptados; deve ser rodado antes de o menu
iniciar a injecao (requer sessao logada do ShibaLauncher + jogo + bot iniciando,
que nao pude acionar sem a UI do usuario). O jogo foi restaurado apos a tentativa
de captura (a extracao exige o ciclo logado; o watcher sozinho nao dispara nada).

```text
CLAIM claim.live-session-evidence :: RE_PKA/native_live_session_evidence.json :: be91552e951accf56014bfba06e2599325d79ef0433142e22e5bcf7f1d6c70ae :: sessao viva, dumps, 2 builds, identidade shiba_bots.dll
CLAIM claim.live-session-dump-image :: RE_PKA/dumps/pid37152_msftedit.memory.bin :: 91f6aaef8fcebd9097d1994c1a36b558aaeb890391e997b94cfd018eb9ca49e8 :: imagem completa viva
CLAIM claim.live-session-dump-text :: RE_PKA/dumps/msftedit_text_live_37152.bin :: e44df8d64929672b20252f54b6a2221c7ae5a7082e11a832213f1d6f84062b3f :: .text vivo
CLAIM claim.live-session-rebuilt-pe :: RE_PKA/dumps/payload_reconstructed_live37152.dll :: 36b3b165a62b5ec9c42c4089438649260b533a39a2e8c35faf6d1f1ee14ee2d5 :: PE reconstruido da build viva
CLAIM claim.live-session-evidence-file :: RE_PKA/dumps/payload_reconstructed_live37152.dll.evidence.json :: ddf9fccf83ce997529e952a8f34c826cf0dec5a068a75be1f7060c355539bc9a :: relatorio do rebuild vivo
CLAIM claim.live-session-test :: RE_PKA/tests/live_session_evidence.test.cjs :: d4c8a8aec909fad6b2c5f321a17a39cc0303cf7677e73ecc0c9d07a034199986 :: teste deterministico da sessao viva
CLAIM claim.live-scan-tool :: RE_PKA/tools/scan_payload_memory.py :: 6fd660c31b7fb14cb2cac86ad0d3ef689b3640e0e0cf2ca2230cb4dd65fb6606 :: scan read-only de memoria por marcadores/PE intacto
CLAIM claim.seize-payload-tool :: RE_PKA/tools/seize_payload_dll.py :: aff0bc2dd9a780d82d1be6b7f082e2b01b8ef09a7586af6d8407656273070c5a :: captura do shiba_bots.dll via lock de delete no injetor
```

