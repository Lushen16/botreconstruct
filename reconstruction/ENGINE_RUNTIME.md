# Integracao dos motores na interface

O controlador da janela usa EngineRuntime para iniciar, pausar e parar Target,
Healer e Walker. Os botoes nao registram execucao quando so existe uma sessao
RPM. O transporte e aberto apenas ao ativar um modulo, nunca no bootstrap.

## Modo simulacao (ferramenta de diagnostico, separada)

A simulacao e uma ferramenta de diagnostico, nao funcionamento no jogo. Ela roda
em uma superficie SEPARADA do namespace recuperado: o preload expoe `pkaDiag`
(nao `pka`) e somente quando o app esta em modo de diagnostico - CLI
`--dev`/`--audit`/`--smoke` ou env `PKA_DIAGNOSTICS=1`. O main so registra o
handler `pka-diag:simulate` nesse modo; em uso normal a superficie nao existe. O
namespace `pka` e seus 34 membros permanecem exatamente os originais
(`tests/renderer_api.test.cjs`, `tests/diagnostics_api.test.cjs`).

`pkaDiag.simulate(true, options)` cria uma sessao sintetica com `nativeVerified`,
`pulseVersion 3` e `automationVersion 1` (explicitamente SINTETICA), posicao,
roster e, via `options.creatures`, criaturas. `pkaDiag.status()` devolve o estado
interno simulado (posicao, tick, slot ativo, ultimo comando aceito) para
observacao no teste. Nada sai da maquina; o jogo nunca e afetado. Comandos do
simulador passam pelo mesmo `encodeCommand`; o terceiro argumento do adapter e o
contexto (`{ pid, signal, extra }`) e `context.extra` vai ao encoder. Nomes de
Pokemon sao resolvidos pelo roster (troca atualiza slot e nome; nomes
desconhecidos/ambiguos sao rejeitados sem mutar estado).

O modo simulacao NAO inicializa o adaptador nativo nem o canal
pka-runtime-2-PID. `EngineRuntime.connect` abre o transporte para comandos
manuais sem ativar modulo.

Portas ligadas ao controlador: `command` (manual, conecta sob demanda);
`monitor`/`monitorState` (`monitor-runtime.cjs`, motor de alertas local);
`showLook` (janela de look `ui/look.html` + `ui/look-preload.cjs`, namespace
`pkaLook`, cobre `pka-look:copy`/`pka-look:close`); `shortcuts` (atalhos globais
menu/pausa via `globalShortcut`); `walkerProfiles`/`loadWalkerProfile`/`saveRoute`
(rotas em `local-data/routes/wk_<nome>.lua`, `route-store.cjs`); e `performance`
(minimiza a janela). O formato de rota do main original era bytecode V8; o store
usa JSON dentro do arquivo `wk_*.lua` e isso e documentado como formato da
reconstrucao.

Cenarios que a simulacao nao exercita na UI ficam como PENDENTES no relatorio da
auditoria, com a referencia do teste que cobre o motor: alerta disparando
(`tests/monitor_runtime.test.cjs`), kill (`tests/local_runtime.test.cjs`,
`creatureDamage`) e Revive (`tests/local_runtime.test.cjs`, combo -> hotkey).
Execucao real no jogo continua PENDENTE por falta do canal nativo.

## Conexao

Antes de abrir ABRIR_RECONSTRUCAO.bat, configure PKA_CHANNEL_KEY no ambiente
ou PKA_CHANNEL_KEY_FILE com o caminho de um JSON existente contendo pid e key.
O arquivo deve corresponder ao PID selecionado. Nenhuma chave e criada ou
extraida por este modulo. Nao coloque valores de chaves no repositorio.

O canal nativo pka-runtime-2-PID precisa existir, estar disponivel e aceitar
o handshake implementado por Transport. A integracao nao instala um servidor
no cliente nem substitui componentes nativos ausentes. O pipe e de consumidor
unico: nao execute simultaneamente a interface e outro consumidor desse canal.

PKA_SESSION_FILE permite selecionar o snapshot RPM usado para exibir a posicao.
PKA_CREATURES_FILE, opcional, seleciona o stream independente de criaturas.
Quando configurado, dados expirados, parciais, de outro PID ou de outro andar
interrompem o consumo; nao existe fallback silencioso para criaturas antigas.
Sem essa variavel, os motores usam criaturas da telemetria do canal nativo.

## Dados e execucao

- A sessao RPM e somente observacao: nativeVerified permanece false. HP,
  pulseVersion, playerId e roster nao sao inventados. Gravacao de waypoints
  pelo modelo original continua exigindo sessao nativa verificada.
- A sessao de execucao combina estado e telemetria autenticados, cada um com
  validade maxima de 1000 ms. O HP recebido no estado alimenta telemetry.healthPercent.
- Falta de telemetria aguarda sem disparar comandos. PID divergente, erro,
  timeout ou ACK rejeitado interrompe a execucao e exige nova ativacao.
- Target, Healer e Walker sao habilitados individualmente. Ativar todos retira
  a pausa. Troca ou salvamento de perfil desliga os modulos; reative-os para
  aplicar a nova configuracao. Pausa e encerramento solicitam stop e exigem ACK.
- O tick de 50 ms e serializado: um lote aguarda o anterior. Todos os comandos
  do lote sao validados antes do primeiro envio. Cada comando exige ACK do
  mesmo tipo, com status 0. Isso confirma o protocolo, nao o efeito no jogo.
- GCD de pelo menos 250 ms e cooldowns de skills consideram o envio real.
  Falhas de resultado incerto nao sao repetidas automaticamente.
- Target aceita nomes, curinga total, prefixos como Shiny * e linhas da
  interface com name, priority e range. As opcoes avancadas da interface nao
  implementadas pelos motores existentes nao ganham suporte por esta ligacao.
- O provider RPM publica creaturesGeneratedAt separado de generatedAt. Atualizar
  a posicao do jogador nao renova a validade de uma lista de criaturas antiga.
- O build reaplica a separacao canStand/canRoute do Walker e preserva assets
  editados localmente. O manifest distingue os hashes originais dos publicados.

native-adapter.cjs tambem implementa open, supportedCommands, command,
pauseWalker e close para consumidores do contrato do daemon. A sessao JSON
do daemon continua exigindo seu formato normalizado; o JSON RPM bruto nao e
uma sessao de execucao autenticada.

## Validacao

    node --test tests/engine_runtime.test.cjs tests/controller.test.cjs tests/live_session.test.cjs
    node --test tests/target-engine.test.cjs tests/engines.test.cjs tests/scan_creatures.test.cjs
    node --test tests/local_runtime.test.cjs tests/diagnostics_api.test.cjs
    node --test tests/monitor_runtime.test.cjs tests/route_store.test.cjs
    node tools/validate.cjs

Niveis de evidencia, sem misturar: (1) teste unitario das regras; (2) UI
exercitada com a simulacao local (`electron reconstruction/app --audit` via
`tools/ui_audit.cjs`, com efeitos observados e itens nao exercitados listados
como pendentes); (3) diferencial contra o preload/decoder original recuperado do
ASAR; (4) execucao real no jogo, que continua PENDENTE (nao ha canal nativo
nesta rodada). Nenhum resultado de simulacao afirma equivalencia com o jogo.

O teste integrado abre um servidor local RuntimeServer e troca frames de
protocolo com Transport. Nao conecta ao jogo. O smoke usa --smoke: nao abre
transporte de execucao, nao inicia o provider RPM e nao envia comandos ao cliente.
Funcionamento ponta a ponta no cliente real ainda precisa ser observado.


## Finalizacao de combo e confirmacao de Pokemon

O adaptador informa o instante da ultima skill de uma rotacao enumerada (mN ou
lista de hotkeys). Ambos os pipelines, principal e hunt, entram em Revive ao
concluir essa rotacao, mesmo com alvos vivos. autoRevive.interval e contado desse
instante; recordDispatch o atualiza para o envio efetivo. O GCD compartilhado de
250 ms continua aplicavel. O fim da lista significa fim dos comandos da rotacao,
nao prova de que o cliente executou cada skill.

Depois do envio, waitForPokemon exige nome ativo igual ao Pokemon de combate,
uma unica entrada correspondente no roster e activeSlot coerente com o slot
quando presente; flags de troca pendente mantem a espera. Nao ha espera fixa de
200/500 ms nem timeout que finja confirmacao. Sem waitForPokemon, o ciclo retoma
no tick seguinte. O Healer mantem trocas pendentes ate essa mesma confirmacao,
inclusive durante o GCD. reset limpa a finalizacao e a espera de Revive.

O fallback nativo combo !autocombo envia apenas expectedUuid quando conhecido;
attackTargetId permanece restrito a talk mN. Um disparo nativo opaco nao fornece
um termino de rotacao observavel: nao se inventa a conclusao nem o reset dos
cooldowns. Para esse caminho ainda falta evidencia de termino do cliente; as
sequencias nativeSequence enumeradas seguem o ciclo explicito acima.
