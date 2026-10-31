# Telemetria de alertas - validacao diferencial (23/10/2026)

## Autoridade e reproducao

tools/probe_alert_vectors.cjs carrega o telemetry.jsc original pela infraestrutura
de sondagem existente, no Electron 44.7.2 em modo Node. SHA-256 do modulo:
0f308a9d7fd4a89f537a61a076dd68aae5ef8b3fdf668f128152c3d6475456c8.
alert_vectors.json registra 282 entradas, 83 aceitas e 199 rejeitadas, com hash
da fixture, do inventario completo e dos resultados. Entradas aceitas vinculam
tambem o hash JSON da saida; rejeicoes preservam classe e mensagem do erro.

A base e telemetry-schema2-inspection-redacted.json, vinculada em
inspection-snapshot-evidence.json ao snapshot real de 85.482 bytes, SHA-256
546bcb8a1c18e3eb8dd454d4ff94dcc3b59f1506547b7e710ea779a3d989298f.
Os 11 eventos talk (IDs 175 a 185), revision 185, dropped 153 e os cinco sinais
true pertencem a essa captura. Todas as mutacoes adicionais sao sinteticas,
nao novos eventos observados no jogo. O contador dropped e preservado, sem
deduzir perda de transporte nem quantidade de eventos que deveriam disparar.

Reproduzir: usar ELECTRON_RUN_AS_NODE=1 e ELECTRON_NO_ASAR=1 com o runtime
runtime/electron-v44.7.2/electron.exe e tools/probe_alert_vectors.cjs.
O teste tests/alert_decoder.test.cjs compara resultados gravados no Node e
repete o diferencial original quando executado no Electron compativel.
O main original nao e executado. Nao ha leitura de memoria, pipe, chave ou
gravacao na instalacao; imports operacionais do harness permanecem bloqueados.
Esse harness nao e uma sandbox do sistema operacional.

## Regras comprovadas do decoder

- O bloco alertSignals/alertEvents/alertEventRevision/alertEventsDropped pode
  estar completamente ausente; sua presenca parcial e rejeitada.
- Os cinco sinais conhecidos exigem booleanos, inclusive false valido.
  Campos adicionais sao preservados nos casos aceitos amostrados.
- A fila aceita ate 32 eventos completos; 33 eventos ja sao rejeitados.
  Foram sondados comprimentos consecutivos de 32 a 65 e casos maiores.
- id e inteiro positivo seguro, estritamente crescente na ordem recebida e
  menor ou igual a alertEventRevision. Duplicacao, ordem inversa, zero e
  evento posterior a revisao sao rejeitados. MAX_SAFE_INTEGER e aceito
  quando a revisao comporta esse ID; nao e um identificador uint32.
- kind aceita talk/pinned/effect/viewers nos registros completos sondados.
  O snapshot real usado aqui possui apenas talk.
- mode, value, name, text, self e pos sao obrigatorios nos casos sondados:
  mode inteiro 0..255; value inteiro 0..65535; name ate 95 bytes UTF-8;
  text ate 512 bytes UTF-8; self booleano; pos nulo ou coordenada valida.
- A fronteira de name foi medida com comprimentos ASCII consecutivos de
  64 a 128 e casos UTF-8 de 94/95/96 bytes. Nao se confunde bytes com letras.
- alertEventRevision e alertEventsDropped aceitam inteiros seguros nao
  negativos; a revisao ainda precisa comportar os IDs presentes.

O decoder reconstruido antes desta etapa permitia 2048 eventos, nome de
255 bytes, value uint32, campos ausentes e IDs sem invariantes de ordem/revisao.
Essas permissoes foram removidas conforme resultados do modulo original.

## Motores e limites

O motor local de chat existente consome talk por ID com notify/pause/repeat.
Isso continua um subset parcial: o diferencial valida o decoder, nao prova
que todos os talk devam acionar chat no nativo, nem filtros self/mode, cooldown
ou comportamento de GM. alertSignals true indica capacidade declarada, nao
ocorrencia de alerta. O teste de integracao com flags true e fila vazia exige
zero acoes e mantem GM/setas/viewers/captura sem classificacao inventada.

Nao ha novos opcodes ou campos de protocolo. BestTileScore, NextTeam,
ComboBuffDone e HealerDeployReady continuam blocked. A matriz permanece
13 implemented / 13 partial / 4 unsupported; contratos 12 implementable / 4 blocked.
Validacao: Electron 291/291; Node 284 aprovados + 7 skips de diferenciais
dependentes do V8; build e smoke aprovados. Equivalencia global nao foi provada.
