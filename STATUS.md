# PKA Tools / Shiba - atualizado em 23/10/2026

## Estado real

Atualizacao de Capture: comparador deterministico e planejamento/revalidacao
useWith recuperados estaticamente do dump e implementados offline. tickLoot
RVA 0xa46e0 e send 0x84340 foram ligados por RTTI. CaptureRank/Approach agora
sao implementable no contrato LOCAL e partial na matriz: 13 implemented,
17 partial, 0 unsupported; contratos 16 implementable / 0 blocked.
O hook final apos a chamada virtual 0x8461a, navegacao eventual, modo aleatorio,
hash de chave sem instance e ciclo completo de fila/atraso ainda nao estao
reconstruidos. As novas APIs nao estao conectadas ao jogo nem ao tick da UI.
reconstruction/CAPTURE_NATIVE.md registra formulas, bytes, RVAs e limites.
BestTileScore/NextTeam/HealerDeployReady/ComboBuffDone fecharam com ancora
byte-exata em native_remaining_rules_evidence.json (secao 6.8 do relatorio).
Este resumo substitui os numeros historicos de Capture nas secoes seguintes.

Atualizacao apos login e selecao de processo: foi observado o named pipe
pka-runtime-2-32084, correspondente ao PID no nome do cliente aberto naquele
instante. Isso revela um canal disponivel, nao prova quem o serve nem valida
autenticacao. Nenhuma conexao foi aberta nesse pipe. A lista visivel de modulos
do jogo nao mostrou shiba_bots.dll. O executavel do cliente nao contem os
marcadores amostrados em ASCII/UTF-16. A origem nativa ainda nao foi localizada;
portanto, uma DLL limpa adicional nao e uma dependencia comprovada para todo
o trabalho restante. connected-runtime-observation.json registra esses limites.

Objetivo: reconstruir o PKA Tools, sem usar o PokeBot.
O clone completo e a automacao no jogo continuam pendentes. Esta etapa entrega
um aplicativo Electron executavel com a interface original verificada, backend
local de perfis, API renderer independente, protocolo parcial e testes diferenciais.
Os motores do Antigravity em ../production e ../*Engine.js nao sao usados.

## Evidencias

Atualizacao da instalacao ativa: o processo 1ae1ae7bf17ae3b1b996b1ed9ef348a2.exe.tmp
foi localizado em AppData/Local/ShibaLauncher/Apps/.../current/Shiba Bots - Poke
Alliance v3.1.9/dll. active-installation-audit.json compara os arquivos instalados
com a copia anterior. ASAR, PKA Tools.exe e libs/d3d9.dll sao byte-identicos.
Assim, o formato invalido dessa DLL tambem existe na instalacao do launcher;
nao ha evidencia para atribui-lo apenas a extracao anterior. A identidade da
DLL como motor de automacao continua nao estabelecida. Nao foram lidas senhas,
tokens, argumentos de processo ou os bytes extras dos executaveis temporarios.

- ASAR SHA-256: 0cc1cf89ee210714c150ed6270c9f44afc90e1d0bc2a790c6ab7b9eb77438e24.
- Os 79 arquivos extraidos correspondem ao ASAR e ao inventario anterior.
- audit_20261022.json registra hashes, cabecalhos PE, marcadores e offsets.
- REA analisou sete caminhos selecionados; nao e cobertura completa da aplicacao.
- Evidencia REA principal:
  ev_2acd17d78a5d788b3a23faaba5b9fa97ccbb52aac2498e4b2413ffc09cbee406.
- Bundle salvo em rea_evidence_20261022.json. Sessao nativa encerrada.

## Implementacao e verificacao

Abrir ABRIR_RECONSTRUCAO.bat nesta pasta. O launcher usa o Electron stock em
runtime/electron-v44.7.2, sem iniciar o executavel original, main.jsc ou o jogo.
Nao exige Node separado para abrir. A montagem depende do ASAR preservado em
../Shiba_Bots_App/dll/resources/app.asar. LEIA-ME.md descreve uso e limites.

reconstruction/app/main.cjs integra as oito abas originais e 41 arquivos de
interface/assets com SHA-256 conferido. O preload e o controller sao novos.
Perfis sao armazenados somente em local-data/profiles/electron/settings.json.
O teste grafico usa smoke-data, separado dos perfis do usuario.

reconstruction/settings.cjs implementa validacao e persistencia local usando
schema e normalizadores legiveis do original, sem bytecode em producao.
settings_vectors.json registra 88 casos de validacao e o ciclo de vida observado.
Gravacao temporaria, rename, backup inicial e lock preservam os arquivos locais.

reconstruction/protocol.cjs corresponde aos 3.470 vetores capturados do modulo
protocol.jsc em execucao controlada. Ha 4 testes de protocolo, incluindo um
diferencial vivo apenas no Electron compativel. authExpired e revive continuam
parcialmente desconhecidos: authExpired permanece false e revive rejeita os
numeros amostrados. Isto nao estabelece equivalencia global nem um transporte
funcional com o jogo. O aplicativo nao usa esse modulo para enviar comandos.

validation.json: 291 testes aprovados no Electron 44.7.2/Node24.21.0; em Node
22.23.1, 284 aprovados e 7 diferenciais vivos omitidos por incompatibilidade V8.
O smoke grafico confirmou as oito abas, criacao, autosave, persistencia em disco,
recarga do renderer, selecao e remocao de perfil. app-smoke.json e app-smoke.png
registram o resultado. tools/validate.cjs reproduz build, testes e smoke.
O stderr de pka:mapInfo no smoke e a rejeicao esperada da consulta de mapa,
que ainda depende do componente ausente; nao significa mapa reconstruido.

reconstruction/framing.cjs implementa o enquadramento observado: comprimento
do payload (uint32 LE) no offset 0, tipo (uint32 LE) no offset 4, payload no
offset 8. framing_vectors.json possui 175 vetores de Buffer, com teste vivo
no Electron. MAX_FRAME=2105344 e observado, mas o emissor original nao limita
o tamanho por essa constante. Payloads que
nao sejam Buffer sao rejeitados explicitamente na implementacao independente.
As classes PipeBridge e SnapshotPublisher foram identificadas por inicializacao
de modulos selecionados, com rede/arquivos substituidos; nenhum metodo de
conexao ou prova de autenticacao foi executado. Isso nao modifica a sessao ativa.
bridge-module-observation.json registra hashes, imports e nomes exportados.

reconstruction/frame-decoder.cjs monta envelopes incrementalmente, mesmo com
cabecalhos e corpos fragmentados ou varios frames no mesmo chunk. Os 50 casos
de receiver_vectors.json comparam somente consumo de bytes do receptor
original, que continua rejeitando mensagens nao autenticadas. MAX_BUFFERED e
2170888 bytes, verificado antes de processar o chunk; MAX_FRAME limita o corpo.
Tipos desconhecidos permanecem envelopes opacos, sem despacho ou autenticacao.
reset/end sao uma API local nova: entrada invalida descarta o estado parcial e
exige reset; EOF incompleto falha. Se um chunk contem frames validos seguidos
de cabecalho invalido, push lanca erro sem devolver os frames desse chunk.
Esse ciclo de falha nao e alegado como equivalente ao original. O decoder nao
esta ligado ao pipe ativo nem ao renderer.

reconstruction/telemetry.cjs implementa decodeTelemetry com as regras
observadas do modulo telemetry.jsc. telemetry_vectors.json registra 1.993 casos
sinteticos (entrada bruta, JSON, campos e colecoes) e telemetry_edges.json
registra 119 limites adicionais (contagens maximas, duracoes, bytes de string,
regex de id, coordenadas, opcionais e blocos de alerta). Os limites observados
sao: 100 moves, 512 condicoes/criaturas, 2.048 itens, 357 tiles, 6 slots de
roster, 256 caixas de texto, 100 entradas de sequencia, 255 bytes por string,
512 bytes por texto fixado e 2.147.483.647.000 ms por duracao de move.
Condicoes usam /^\d{1,20}$/ limitado a 2^64-1; ids de caixa usam
/^[0-9a-f]{1,16}(?::[0-9a-f]{1,16}){3}$/ e exigem unicidade; UUIDs de roster
exigem unicidade. Campos desconhecidos sao preservados, nao recriados.

Lacunas de telemetria mantidas explicitas: guildDailies aceita somente null.
As fixtures redigidas ja incluem inspection e alertEvents nao vazio. Em
23/10/2026, inspection_vectors.json acrescenta 48 mutacoes observadas contra
telemetry.jsc original (15 aceitas, 33 rejeitadas), sem nova coleta em memoria.
Isso corrigiu container boolean obrigatorio, revision em 1..4294967295 e pos
nula permitida. O teste offline monta frames fragmentados, decodifica a fixture
e consulta as decisoes locais de captura com configuracao/posicao sinteticas.
Isso nao executa captura nem valida a estrategia nativa.

tools/probe_telemetry_vectors.cjs e tools/probe_telemetry_edges.cjs executam
somente o modulo original com dados sinteticos e imports de I/O bloqueados.

Inventario e mapa de execucao em reconstruction/REPORT_RE_v3.1.9.md:
versao/hash de loader, Electron/ASAR, preload, main/lib bytecode, libs e executaveis;
separacao de conexao, handshake, mensagens, heartbeat e desconexao; e a conclusao
de que a decisao/execucao mora na DLL nativa. Evidencia central: package-integrity.json
declara "automation": "native-dll" e release-manifest.json lista 30 regras de decisao
(decision-bytecode-v1) que nao existem em nenhum arquivo Electron. O processo do jogo
expunha 99 modulos e nenhum modulo de automacao visivel (modulo oculto/manual-mapped).
Lacunas: sem imagem valida da DLL, sem enderecos nativos, security handshake e origem da
chave nao mapeados.

Especificacao: reconstruction/spec/automation-v1.md e automation-v1.json descrevem
entradas, saidas, estados, transicoes, falhas e o mapeamento de configuracao. O motor
de Lure foi adicionado em reconstruction/engines/lure-engine.cjs (distance/dynamic/random)
e integrado ao orquestrador; tests/spec_conformance.test.cjs valida 8 cenarios
deterministicos a partir de tests/fixtures/automation-v1.json, sem pipe e sem jogo.
Mock Python do canal em tools/pka_runtime_server.py (sem dependencias): framing LE,
HMAC PKA2/client|server, kinds 1..12, ACK 12 bytes, state/telemetry validos e guarda de
MAX_FRAME no buffer. Interop reproduzivel em python_mock_interop.json (Transport novo) e
python_mock_interop_original.json (PipeBridge original autenticado). Report agora tem 21
CLAIMs verificaveis por node tools/verify-report.mjs.

Matriz de decisao: reconstruction/spec/decision-rules-v1.json cobre as 30 regras do
release-manifest (8 implemented, 6 partial, 16 unsupported) e tools/check_decision_rules.cjs
verifica IDs, status, chaves de config e evidencias; tests/decision_rules.test.cjs fixa o
resultado. Limiares nativos continuam UNVERIFIED.

Contratos das 16 lacunas: alerts-v1 (7), capture-v1 (5) e remaining-rules-v1 (4),
verificados por tools/check_contracts.cjs (16 regras, 16 implementable, 0 blocked).
Entradas de telemetria sao validadas contra o decoder verificado; campos inventados
(isPlayer/isDead/canCapture/telemetry.connected) falham o checker. Capture permanece
parcial: inspection valida ja existe; CaptureRank/Approach tem comparador e
planejamento offline recuperados, sem navegacao/hook final nativo verificados.

Resumo de auditoria derivado: tools/audit_summary.cjs recomputa claims, decisoes e
contratos a partir dos artefatos, exige cobertura exata das 16 lacunas e verifica o hash
canonico do mock; tests/audit_summary.test.cjs fixa o resultado. Nada de numeros
hardcoded como no resumo concorrente.

Motor de alertas: alerts-engine.cjs implementa hp/creature/hunt_pokemon/teleport/disconnected
e chat local por talk (notify/pause/repeat/rearme), com 11 testes deterministicos.
Chat continua parcial, sem provar filtros nativos de self/mode ou GM. Matriz atual:
13 implemented, 17 partial, 0 unsupported; contratos 16 fechados / 0 blocked.
Decoder de alertas validado em 282 sondas no modulo original: fila de 32 eventos,
name de 95 bytes UTF-8, value uint16 e campos obrigatorios; IDs positivos,
crescentes e ate a revisao. Evidencias e limites: reconstruction/ALERT_TELEMETRY.md.

Dump nativo em memoria (23/10, PID 32336): o payload roda em module stomping na .text do
msftedit.dll (base 0x7ff85c470000); .text difere 2.231.494 bytes do disco e contem
pka::bot::Runtime (tickBestTile, tickHoenn, tickLoot, tickRevive, comboTick,
tickTravelLure, send...), TravelLure::plan e strings [native]/automationVersion/
captureVersion. Estatico: dispatcher RVA 0x12c40 (follow/attack), init
0x15590 (PKA-INIT-NATIVE/SESSION + 3 hashes), validacao 0x8a756 (walker/target/
healer/looting/capture/hoenn); 90 chaves JSON no payload. Dumps em dumps/ (memory, .text, JSON) e native_dump_evidence.json;
status nativo agora MEMORY-DUMPED, com identidade de arquivo e enderecos de funcao
ainda UNVERIFIED.

Snapshot real de telemetria (23/10, menu PID 16576): schema 2, 627 itens, 8 criaturas,
26 itemCounts, inspection null; 78.160 bytes, sha256 dfc5cbd1...; fixture
redigida em reconstruction/fixtures/telemetry-schema2-redacted.json. Uma segunda
fixture preserva inspection preenchida (item 4029), ligada ao hash registrado
em reconstruction/inspection-snapshot-evidence.json. CaptureEligible/Ball/Delay implementadas/parciais com look real;
CaptureRank/Approach agora tem subset offline (ver resumo atual e CAPTURE_NATIVE.md).

Nenhuma alteracao foi feita na instalacao e o ASAR nao foi substituido.

Transporte nativo reconstruido e validado: reconstruction/transport.cjs (cliente)
e reconstruction/runtime-server.cjs (servidor de teste). O contrato observado:
pipe \\.\pipe\pka-runtime-2-<pid>; quadro [uint32 len][uint32 kind][payload]
com MAX_FRAME 2105344; tipos challenge 1, authenticate 2, welcome 3, state 4,
telemetry 5, automation 6, startup 7, automation_revoked 8, manual 9, ack 10,
automation_control 11, automation_lease 12.

Handshake provado contra o modulo original (tests/transport_live.test.cjs):
- servidor envia challenge com nonce;
- cliente responde authenticate = HMAC-SHA256(chave, "PKA2/client\0" + nonce + uint32LE(pid));
- servidor responde welcome = uint32LE(pid) + HMAC-SHA256(chave, "PKA2/server\0" + nonce + uint32LE(pid));
- ambos comparam com timingSafeEqual. A chave vem de PKA_CHANNEL_KEY (literal em main.jsc).
O teste diferencial inicia o servidor independente, conecta o PipeBridge original
e confirma que ele autentica e produz exatamente a mesma prova do cliente novo.

reconstruction/runtime-server.cjs permite rodar o bot sem o jogo (telemetria
sintetica, ACK automatico, STATE/TELEMETRY publicados). tools/run_bot.cjs tem
modo --simulate (fim a fim) e modo --pid/--key para o canal real.

Estado do canal ao vivo em 22/10/2026: PokeAlliance_dx PID 32084 mantinha os
pipes pka-runtime-2-32084 e pka-security-32084, mas a segunda conexao expirou
(instancia unica ocupada pelo cliente original). Nenhuma conexao foi forcada e
o cliente em uso nao foi derrubado.

Captura da PKA_CHANNEL_KEY: tools/capture_channel_key.ps1 le o bloco de ambiente
do PEB do processo "PKA Tools" (PROCESS_QUERY_LIMITED_INFORMATION | VM_READ), sem
injetar, alterar ou fechar nada. Autoteste com uma variavel temporaria no proprio
PowerShell confirmou a extracao e o arquivo channel-key.json. A captura real
depende de o menu ser aberto pelo PokeAlliance.exe; o processo nao estava em
execucao nesta rodada. tools/run_bot.cjs aceita --key-file channel-key.json e
--probe para validar o canal (imprime handshake, state e telemetry decodificados)
sem enviar comando algum.

Publicacoes por arquivo: writePublication(nome, valor, pid) e
readPublication(nome, pid); sem canal confirmado elas falham com
"Sem confirmacao da DLL." e "O canal nativo ainda nao publicou este estado.".
Os nomes seguem state_<n>.bin, cmd_<n>.bin, ack_<n>.bin, telemetry_<n>.json,
automation[_control|_lease|_revoked]_<n>.json, startup_<n>.json, .session.<pid>,
runtime.jsonl e runtime.jsonl.previous. O diretorio efetivo de runtime nao foi
localizado em disco porque nenhuma sessao ativa o publicou nesta rodada.

Roteiro para fechar o canal real:
1. Abrir o jogo e o menu pelo PokeAlliance.exe normalmente.
2. Executar tools/capture_channel_key.ps1 (como administrador, se o menu estiver elevado).
3. Fechar o menu pelo botao "Encerrar o menu", mantendo o jogo aberto.
4. node tools/run_bot.cjs --probe --key-file %LOCALAPPDATA%\PKARecon\channel-key.json
5. Se o pipe aceitar, o decoder mostra state/telemetry reais; depois rodar sem --probe.

Ainda sem evidencia: o guard de sessao usado por PipeBridge.send (mensagem
"Este menu pertence a outro cliente..."), a semantica dos arquivos .session.<pid>
e runtime.jsonl, e a origem exata da chave no loader real. sendFrame/kind manual
e automation ja foram observados escrevendo quadros validos apos o handshake.

Motores independentes de automacao: reconstruction/engines/target-engine.cjs,
healer-engine.cjs e walker-engine.cjs, orquestrados por reconstruction/automation.cjs.
Eles recebem um snapshot de sessao + telemetria e emitem comandos pelo mesmo contrato
do protocolo; createProtocolSink valida cada comando com encodeCommand antes de
entregar bytes ao transporte. Nenhum transporte esta ligado: o Controller continua
recusando ativar modulos ao vivo.

Regras implementadas (deduzidas de default_config.json, shared/walker.js,
shared/healer.js, do protocolo e dos campos de telemetria):
- Walker: waypoints walk/safespot/box/stairs/wait/say, distancia Chebyshev,
  loop, startNearestWaypoint, smartWalking, espera troca de andar em stairs,
  watchdog de preso e limite de 2.000 waypoints no modelo original.
- Target: filtra canAttack, lista de ignorados, prioridade shiny, alvo mais
  proximo, retry de attack, minWildsToEngage/perfectLure (segura ataque e
  continua lure), combo por sequencia ou nativeSequence, stepDelay, guarda de
  identidade por UUID do roster, healSkill/lureSkill e lowHpComboPercent.
- Healer: potion por hotkey ou action bar com cooldown, medicine por condicoes,
  heal de pet por slot com reset e retorno ao Pokemon anterior; uma acao por tick.
- Gates iguais aos do renderer: online, stale, error, authExpired, ageMs<=1000,
  nativeVerified, pulseVersion 3, runtime.pid, paused.

Nao implementado por falta de evidencia: revive (encodeCommand sempre rejeita os
parametros amostrados), semantica de combatStanceAuto (fight 1..3 desconhecido),
finishRemainingCount/usePokeStop e o despacho real pelo pipe. tools/simulate_automation.cjs
roda cenarios walk/lure/combat/heal sem jogo e imprime os comandos gerados.

tests/engines.test.cjs cobre gates, waypoints, stuck/stairs, selecao de alvo,
perfect lure, combo, cooldowns de cura e a codificacao de todos os comandos.

reconstruction/renderer-api.cjs exporta createRendererApis(transport).
O transporte fornece invoke, send, on e removeListener. Nao existe conexao
nativa implicita. Sao implementados 31 membros pka e tres membros pkaLook.
O modulo nao importa Electron, PokeBot nem motores do Antigravity.

tests/renderer_api.test.cjs compara chamadas, argumentos, resultados e eventos
com os preloads originais extraidos do ASAR. Cobre casos finitos, nao equivalencia
global. Inclui contexto monotonicamente crescente, descarte de settings antigos,
contexto acrescentado nos wrappers scoped mas nao em command, override de
autosave, booleano estrito de showLook, filtro de som e limpeza de listeners.

tools/probe_preload.cjs substitui Electron por um gravador em memoria. Somente
os preloads legiveis sao executados. Nenhum main.jsc, loader, motor ou comando
de jogo e executado. A VM serve para instrumentacao, nao como sandbox de seguranca.

## Bloqueios nativos observados

- libs/d3d9.dll possui 1.866.491 bytes; e_lfanew no offset 0x3c e 538.976.496
  (f0 20 20 20), fora do arquivo. REA rejeitou o PE. A copia Desktop/v2.6.6 tem
  o mesmo SHA-256: f1dee24b04b915996f46c2a10f8f6bebee123451928fcebea056f08962e64223.
  A causa e a identidade funcional dessa DLL permanecem desconhecidas.
  Nenhum byte foi reparado por suposicao.
- O executavel a497a7a52bf97c5bcc5fad69c7958ce6.exe foi admitido pelo REA, mas
  a consulta Ghidra excedeu 330.000 ms durante a autoanalise. Nenhuma funcao
  ou pseudocodigo nativo foi recuperado nessa tentativa.
- main e 14 modulos lib estao em bytecode V8. Os carregadores .cjs nao sao
  implementacoes decompiladas desses modulos. settings, protocol, telemetry e
  pipe-bridge participam de probes selecionados com dados sinteticos e imports
  de I/O bloqueados; o main original nao foi executado. Isso nao constitui uma
  sandbox do sistema operacional ou cobertura integral desses modulos.
- PKA2/, prefixo de named pipe, automation_control, automation_lease e mensagens
  de estado de 48 bytes/ACK de 12 bytes sao literais com offsets registrados.
  Isoladamente nao confirmam layouts ou autenticacao. Os vetores posteriores
  de protocol_vectors.json sustentam apenas os layouts e casos ali observados.

native-payload-audit.json reproduz a auditoria das DLLs com leitura de bytes.
As copias shiba_bots.dll de Desktop/v2.6.3 e v2.6.6 tem e_lfanew fora do arquivo
e 13.587.112 sequencias UTF-8 de substituicao cada. A evidencia e consistente
com transcodificacao destrutiva; nao estabelece a autoria da transformacao.
Os valores originais substituidos nao sao recuperados por troca arbitraria de
espacos. Nenhuma DLL original foi editada ou executada.

## Proximas etapas para o bot completo

1. Identificar a provisioning da PKA_CHANNEL_KEY no loader e o guard de sessao
   do PipeBridge.send. O handshake e os quadros ja estao reproduzidos.
2. Completar as lacunas de protocol.jsc, pipe-bridge.jsc e native-runtime.jsc.
   Em telemetry.jsc, obter formas validas de guildDailies, inspection e
   alertEvents antes de ligar o decoder a uma sessao real.
3. Confirmar respostas do servidor real (state/telemetry/ack) numa sessao livre.
   O adaptador e o servidor de teste ja existem.
4. Completar handlers main e ligar os motores independentes ao transporte.
   Persistencia, janela, IPC e os motores target/healer/walker ja existem como
   implementacoes independentes testadas; falta o despacho nativo.
5. Validar cada comportamento com fixtures e depois no cliente. Ataque, cura
   e caminhada nao foram validados. Os oito grupos de schema nao provam motores.

## Reproducao

Executar nesta pasta com Node.js, sem instalar dependencias:

    node tools/validate.cjs
    node tools/smoke_app.cjs
    node tools/audit_payloads.cjs
    node tools/observe_connection.cjs
    node tools/probe_preload.cjs
    node tools/audit_native.cjs

O audit regrava apenas audit_20261022.json. Os binarios e o PokeBot sao preservados.
validate grava validation.json e validation-*.txt; o smoke usa dados isolados.
