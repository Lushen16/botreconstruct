# Reconstrucao local PKA Tools / Shiba

## Pasta oficial

Esta e a unica copia de trabalho oficial: `RECONSTRUÇAO OFIcial`, anteriormente
`RE_PKA`. Consulte ORGANIZACAO.md para o inventario da organizacao e
VERIFICACAO_UI_REAL.md para os limites observados no jogo. Relatorios historicos
preservam os nomes e caminhos da epoca; nao representam validacao atual.

## Integracao dos motores (27/10/2026)

Target, Healer e Walker agora possuem coordenador ligado a interface, com
ativacao por modulo e confirmacao de comandos no transporte. Consulte
reconstruction/ENGINE_RUNTIME.md para requisitos, configuracao e limites.
Apenas exibir uma sessao RPM nao confirma uma conexao nativa de execucao.
As secoes historicas abaixo nao comprovam validacao desta integracao no jogo.

## Abrir

Execute ABRIR_RECONSTRUCAO.bat nesta pasta. O runtime Electron ja esta em
runtime/electron-v44.7.2; o launcher usa esse runtime tambem para montar os
assets. Nao precisa instalar dependencias npm nem executar como administrador.
Mantenha a pasta original ../Shiba_Bots_App ao lado: o build verifica o ASAR
antes de copiar a interface. Nao execute os launchers originais para abrir
esta reconstrucao.

## O que esta disponivel

- Interface original preservada: Scripts, Targeting, Healer, Walker, CAPTURE,
  Alertas, Hoenn e Tools. A presenca de uma aba nao comprova seu motor de jogo.
- Criar, selecionar, editar, salvar automaticamente e excluir perfis locais.
- Importar/exportar configuracoes JSON, usando os botoes do painel Perfil.
  As rotinas foram implementadas; os dialogs de arquivos nao foram exercitados
  por automacao nesta rodada.
- Backend e preload novos, sem copiar PokeBot ou motores do Antigravity.
- Codec parcial do protocolo independente, validado contra casos capturados.
- Receptor incremental offline: fragmentacao, agrupamento e limites de frames.
- Decoder de telemetria independente, comparado com 1.993 vetores e 119 limites
  do modulo original.
- Motores independentes de target, healer e walker, com orquestrador, gates de
  sessao e sink que valida cada comando pelo protocolo reconstruido.
- Transporte do canal pka-runtime-2-<pid> com handshake HMAC comprovado contra
  o modulo original, e servidor de teste para rodar o bot sem o jogo.
- Modo simulacao (ferramenta de diagnostico, superficie separada `pkaDiag`):
  inicia um cliente sintetico local para exercitar Target/Healer/Walker sem o
  jogo. Nao e funcionamento no jogo e so existe em modo de diagnostico
  (`--dev`/`--audit` ou `PKA_DIAGNOSTICS=1`); a API `pka` recuperada nao muda.

Os perfis desta versao ficam em local-data/profiles/electron/settings.json.
Os dados do Electron ficam em local-data/electron. O teste grafico escreve
somente em smoke-data, sem reutilizar seus perfis locais ou os do original.

## Limite importante

Esta e uma reconstrucao **parcial**, nao um bot completo. Ataque, cura,
caminhada, captura, consulta de mapa e conexao ao cliente ainda nao funcionam.
Nenhum comando e enviado ao jogo. As acoes dependentes do componente ausente
retornam erro em vez de simular sucesso. A interface permanece aguardando um
cliente e pode apresentar mensagens genericas nas acoes nao implementadas.

O bloqueio atual e identificar e reconstruir os handlers nativos e o transporte
completo. A sessao original aberta apos login disponibiliza um canal nomeado
pka-runtime-2-PID. Nao houve conexao nossa a esse canal. Sua existencia nao prova
a origem do servidor nem que uma DLL externa esteja faltando. A conclusao
anterior de que outro download necessariamente resolveria o bloqueio foi revista.
As DLLs antigas continuam danificadas (native-payload-audit.json), mas ainda nao
foi demonstrado que essas copias sejam o motor da sessao original atual.

O carregador nativo nao foi iniciado nem modificado. A interface original
informa que execucao Lua foi descontinuada; editar uma biblioteca de scripts
nao significa executar Lua nesta reconstrucao.

## Validar e reproduzir

Para desenvolvimento, com Node instalado:

    node tools/validate.cjs
    node tools/run_bot.cjs --simulate --ticks 30
    node tools/check_decision_rules.cjs
    node --test tests/alerts_engine.test.cjs
    node tools/check_contracts.cjs
    node tools/audit_summary.cjs
    node --test tests/spec_conformance.test.cjs
    python tools/pka_runtime_server.py   (mock; use PKA_PID/PKA_KEY/PKA_NONCE)
    powershell -ExecutionPolicy Bypass -File tools/capture_channel_key.ps1
    node tools/run_bot.cjs --probe --key-file "%LOCALAPPDATA%\PKARecon\channel-key.json"
    node tools/simulate_automation.cjs combat
    node tools/simulate_automation.cjs walk
    node tools/audit_payloads.cjs

validation.json e os logs validation-*.txt registram os resultados. Em
23/10/2026: 300/300 testes no Electron; Node22 executa 293 e omite os sete
diferenciais vivos dependentes do V8 compativel. Os 3.470 vetores do protocolo,
175 de enquadramento, 50 de receptor e 2.112 de telemetria passam nos casos
capturados, nao em todas as entradas possiveis. Nenhum decoder novo esta
conectado ao jogo. O decoder de alertas possui mais 282 sondas diferenciais
originais (83 aceitas, 199 rejeitadas), incluindo fila/bytes/campos/ordem/revisao;
reconstruction/ALERT_TELEMETRY.md distingue esses testes de eventos reais.

O smoke abre uma janela oculta real, visita as oito abas, cria um perfil,
salva configuracao, rele do disco, recarrega o renderer, seleciona e exclui
o perfil temporario. app-smoke.json e app-smoke.png guardam a verificacao.
Ele consulta a aba Walker; a rejeicao esperada de pka:mapInfo aparece no log.

## Evidencia e procedencia

Capture (atualizacao): rank deterministico, revalidacao e plano useWith estao
implementados para uso offline no capture-engine.cjs, com testes contra
predicados decifrados do dump. Veja reconstruction/CAPTURE_NATIVE.md para
os RVAs, bytes e contratos de entrada. Nao ha integracao nova com o jogo:
navegacao/hook final, modo aleatorio e ciclo nativo completo seguem pendentes.
Os status implementable/partial descrevem somente esse subset local.

- STATUS.md: mapa de implementacao, evidencias e pendencias.
- inventory.json, audit_20261022.json: identidade e inventario do ASAR.
- protocol_vectors.json, settings_vectors.json: casos observados e limites.
- framing_vectors.json: contrato de emissao de frames com payload Buffer.
- receiver_vectors.json: 50 casos de consumo de bytes, sem autenticar mensagens.
- telemetry_vectors.json, telemetry_edges.json: validacao e limites de
  decodeTelemetry; guildDailies nao nula continua sem forma valida observada.
- inspection_vectors.json: 48 mutacoes da fixture redigida contra o decoder
  original; container obrigatorio, revision uint32 positiva, pos nula aceita.
  A fixture com inspection preenchida ja existe: esta rodada nao exige abrir
  um container, reiniciar o launcher, ler memoria ou conectar ao pipe.
- reconstruction/automation.cjs + engines/: motores e gates, incluindo Lure.
- reconstruction/REPORT_RE_v3.1.9.md: inventario/hashes, mapa de execucao e protocolo.
- reconstruction/spec/automation-v1.{md,json}: especificacao e cenarios deterministicos.
- reconstruction/transport.cjs: cliente do pipe; exige PKA_CHANNEL_KEY e um canal
  livre. Nao foi conectado a sessao em uso.
- tools/capture_channel_key.ps1: captura a chave do menu pela leitura do PEB.
- tools/run_bot.cjs --probe --key-file channel-key.json: valida o canal real sem
  enviar comandos.
- reconstruction/runtime-server.cjs: servidor de teste, nao e a DLL original.
- connected-runtime-observation.json: metadados da sessao ativa, sem mensagens.
- bridge-module-observation.json: exports observados com imports de I/O bloqueados.
- rea_evidence_20261022.json: evidencias estaticas anteriores do REA.
- reconstruction/app/asset-manifest.json: hashes dos 41 arquivos copiados.

O app usa renderer, assets, schema e modelos legiveis do pacote fornecido.
Isso nao e recuperacao do codigo-fonte original do main ou dos modulos nativos.
A implementacao nova depende desses arquivos locais; nao e uma redistribuicao
autossuficiente do produto completo.
