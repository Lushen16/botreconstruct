# Auditoria de fidelidade de combate e Target

## Atualizacao: correcoes executadas em 27/10/2026

A auditoria abaixo e historica. Nesta rodada foram alterados os motores e adicionadas
regressoes; nao houve envio de inputs ao jogo nem alegacao de equivalencia nativa integral.

- Corrigido o envelope combo !autocombo: somente expectedUuid quando conhecido,
  sem attackTargetId. Ha teste pelo encoder e pelo EngineRuntime com adapter controlado.
- Rotacoes enumeradas passam a informar o instante da ultima skill; Revive entra
  apos a conclusao, inclusive com inimigos vivos, nos pipelines principal e hunt.
  O intervalo configurado e preservado integralmente, contado do despacho da ultima
  skill; hotkeys continuam sujeitas ao GCD compartilhado de 250 ms.
- Eliminadas as esperas fixas de 200/500 ms. waitForPokemon exige nome, roster
  unico e slot ativo coerentes, sem flags de troca pendente, antes da retomada.
- O Healer mantem a troca pendente ate confirmacao real desses campos; removida
  a liberacao por timeout de 3000 ms. O Walker permanece retido inclusive no GCD.
  Cura ja recuperada sem reset separado nao deixa o Walker preso.
- Reset limpa o ciclo de Revive. O runtime considera Revive uma fase que deve
  interromper movimento anterior.
- Novo arquivo tests/combat_fidelity.test.cjs e testes de integracao adicionais
  em tests/engine_runtime.test.cjs. O teste antigo de hunt foi realinhado ao
  contrato de fim de rotacao e confirmacao, em vez de validar esperas inventadas.

Resultados executados apos as correcoes:

    node --test tests/*.test.cjs
    tests 406; pass 399; fail 0; skipped 7; duration_ms 1050.5421; exit 0

    Electron compativel, todos os tests/*.test.cjs
    tests 406; pass 406; fail 0; skipped 0; duration_ms 1074.1651; exit 0

Logs atuais: combat-fidelity-node.txt, combat-fidelity-electron.txt e
combat-fidelity-electron-stderr.txt. Antes da correcao, seis das oito primeiras
regressoes falharam (combat-fidelity-before.txt). Depois foram adicionadas
regressoes para timestamp efetivo, GCD e retomada do Healer.

Limite preservado: o envio opaco !autocombo/hotkey nativa nao fornece evento de
fim de rotacao na telemetria atual. Nao e tratado como conclusao nem como prova
de que os cooldowns foram restaurados. nativeSequence enumerada e rotacoes
manuais sao observadas pelo envio dos passos; a execucao efetiva no cliente
continua dependente de evidencia nativa. Permanecem fora desta correcao os
achados de gate automationVersion e equivalencia de todas as regras da DLL.

---

## Escopo e resultado

Comparacao estatica com Extracted_Source/shared/schema.js, shared/healer.js e renderer/target.js; revisao do transporte; verificacao passiva do PID; execucao real dos testes. Nenhuma alteracao no codigo dos motores, nenhuma conexao ao jogo e nenhum input enviado nesta auditoria.

Conclusao: a implementacao atual nao comprova equivalencia integral com o original. Os contratos legiveis ja permitem demonstrar divergencias; a parte nativa permanece parcialmente reconstruida. Extracted_Source/lib/native-runtime.cjs apenas carrega native-runtime.jsc, nao contem a logica legivel de combate. native_remaining_rules_evidence.json declara limites de cobertura estatica e inferencias de fluxo.

## Discrepancias confirmadas

1. **AutoCombo com fallback falha no encoder.** reconstruction/engines/target-engine.cjs:177 envia combo !autocombo com expectedUuid e attackTargetId. reconstruction/protocol.cjs:88 aceita attackTargetId somente para talk mN com UUID. Reproducao executada: attack codifica; combo falha com "Alvo/postura devem acompanhar uma skill de combo com UUID." O teste em tests/engines.test.cjs:411 usa recorder e nao codifica o evento. EngineRuntime valida os eventos antes de despachar o lote, portanto esse caminho encerra o tick com erro.

2. **Revive usa o marco e intervalo errados.** O schema original descreve interval como espera apos a ultima skill; renderer/target.js descreve Revive depois de cada combo. reconstruction/automation.cjs:115 inicia a fase somente quando desaparecem todos os candidatos; :128 usa Math.min(interval, 500), contado desde o fim da deteccao de combate, nao desde a ultima skill. Isso diverge do contrato visivel.

3. **waitForPokemon nao espera presenca.** reconstruction/automation.cjs:135 usa uma espera fixa de 500 ms, sem confirmar Pokemon em telemetria. Reproducao com waitForPokemon=true, pokemonName vazio, activeSlot=0, roster e criaturas vazios: t=1100 revive/sem envio; t=1600 revive/F8; t=2100 walking. O original explicita esperar o Pokemon aparecer no mapa. A restauracao real dos cooldowns tambem nao foi medida.

4. **Revive nao esta ligado ao pipeline principal.** O bloco reside em huntStep, dependente de options.hunt. EngineRuntime cria a automacao em reconstruction/engine-runtime.cjs:91 sem essa opcao. Ativar target.autoRevive no fluxo principal nao ativa esse bloco. A tolerancia finishRemainingCount do contrato original tambem nao e aplicada nessa transicao.

5. **Hotkey de AutoCombo e extensao sem contrato localizado.** O adaptador usa combo.nativeHotkey ou combo.hotkey, mas esses campos nao aparecem no schema/renderer original inspecionado. O original expoe useNativeSequence. A hotkey configurada funciona no recorder; isso nao prova equivalencia do mecanismo nativo.

6. **Gate de versao incompleto.** Extracted_Source/shared/healer.js autoPlan exige automationVersion=1, alem de nativeVerified e pulseVersion=3. reconstruction/automation.cjs:22 verifica pulseVersion, mas nao automationVersion.

7. **Estado de Revive sobrevive ao reset.** reconstruction/automation.cjs:225 reinicializa os motores e outros estados, mas deixa combatActive, combatEndedAt, reviving e reviveSentAt intactos. Risco de transicao residual apos reset; achado por inspecao, sem teste de regressao novo nesta rodada.

8. **Healer parcialmente evidenciado.** O schema e o modelo legivel confirmam configuracoes e precondicoes, mas nao provam a ordem completa da rotina nativa. O bloqueio para qualquer conditions nao vazia e o timeout de troca de 3000 ms sao politicas atuais da reconstrucao; identicidade com o binario original nao foi demonstrada.

## Inputs e processo

- Verificacao passiva encontrou PokeAlliance_dx.exe PID 8456; inicio reportado pelo Windows em 27/10/2026 13:07:05 local.
- Pipe esperado pelo transporte: \\.\pipe\pka-runtime-2-8456. Ausente na enumeracao realizada.
- PKA_CHANNEL_KEY e PKA_CHANNEL_KEY_FILE ausentes no ambiente deste executor; isso nao descreve ambientes de outros processos. Nenhuma chave foi lida ou exibida.
- Fluxo estatico: EngineRuntime -> createAutomation -> recorder -> encodeCommand -> native-adapter -> Transport -> ACK. Tick default de 50 ms, GCD de hotkeys de 250 ms, comando com timeout de 1000 ms no adaptador e ACK positivo/tipo validado.
- Esses intervalos sao parametros da reconstrucao. Sem canal nativo e observacao do consumo pelo cliente, nao ha medicao de keydown/keyup, frames DirectX ou timings nativos reais.

## Resultados reais

Comando solicitado: node --test tests/*.test.cjs

    tests 391
    pass 384
    fail 0
    skipped 7
    duration_ms 970.4389
    exit 0

Execucao adicional pelo runtime/electron-v44.7.2/electron.exe, com ELECTRON_RUN_AS_NODE=1 e todos os arquivos tests/*.test.cjs:

    tests 391
    pass 391
    fail 0
    skipped 0
    duration_ms 1117.8774
    exit 0

Logs: audit-combat-tests.txt, audit-combat-electron-tests.txt, audit-combat-electron-stderr.txt. Os testes diferenciais executados nao estabelecem equivalencia global das regras nativas; as reproducoes acima mostram lacunas nao cobertas pela suite aprovada.

## Proximos passos baseados em evidencia

Corrigir primeiro o envelope invalido do AutoCombo e adicionar teste passando pelo encoder/runtime; alinhar a finalizacao/Revive com os contratos visiveis; provar a condicao de presenca do Pokemon antes de liberar o Walker; conectar essa fase ao pipeline efetivo; cobrir reset e versao; depois observar um canal nativo funcional para medir tempos e confirmar efeitos reais. Nao substituir essas provas por atrasos escolhidos arbitrariamente.
