# Combate: auditoria dos campos e correções — 28/10/2026

Atualizacao de 29/10/2026: o transporte RPM/teclado do Target foi conectado e
ensaiado no cliente real. Consulte TARGET_RPM_VALIDACAO.md para resultados,
incidente de selecao do proprio Pokemon e protecao conservadora adicionada.
Esta matriz continua historica: a integracao de transporte nao valida todos
os campos, ownership, cooldowns reais nem a equivalencia integral ao original.

## Resultado e escopo

A integração completa de combate no cliente real permanece pendente. Esta rodada
corrige desvios reproduzidos, explica o bloqueio real na UI e inventaria os campos
do Target. Testes unitários e a auditoria simulada não validam combate no jogo.
Nenhum comando foi enviado ao cliente nesta rodada. Os perfis e a referência
original foram preservados.

## Fontes consultadas

- ../Extracted_Source/shared/schema.js: campos, limites e descrições de cada opção.
- ../Extracted_Source/renderer/target.js: comportamento anunciado no formulário e dicas.
- ../Extracted_Source/shared/diagnostics.js: critérios originais para iniciar Target.
- reconstruction/engines/target-engine.cjs, reconstruction/automation.cjs,
  reconstruction/engines/lure-engine.cjs: consumidores atuais das configurações.
- reconstruction/walker-input-runtime.cjs e reconstruction/live-session.cjs:
  limites do backend teclado/RPM.
- ASAR de referência: SHA-256
  0cc1cf89ee210714c150ed6270c9f44afc90e1d0bc2a790c6ab7b9eb77438e24.

Não se deduz a rotina nativa completa a partir dos rótulos da UI. O carregador
native-runtime.cjs não equivale ao código-fonte legível de native-runtime.jsc.

## Erros reproduzidos e corrigidos

1. Ignorar Shiny * não filtrava Shiny Rat: o motor enviava attack 7.
   O filtro agora compara o nome inteiro, ignora caixa e aceita * como curinga,
   tratando os demais caracteres literalmente. Target, validação hunt e Luring
   usam o mesmo comparador para seus filtros de ignorados.
2. AutoCombo nativo com sequência manual m5 salva e sem nativeSequence emitia
   talk m5, apesar de a UI original afirmar que a sequência manual não é usada
   nesse modo. Agora usa a sequência nativa válida ou o comando !autocombo.
3. Uma hotkey nativa configurada, bloqueada por GCD, podia cair no caminho talk
   quando existia nativeSequence. Agora espera a liberação da hotkey, sem mudar
   silenciosamente o mecanismo de disparo.
4. O diagnóstico original sugeria reiniciar o jogo mesmo quando o backend
   selecionado era apenas Walker teclado/RPM. Um overlay informa essa limitação,
   preserva os demais erros de perfil/conexão e mantém o botão bloqueado.
   A mudança entra no build; nativeVerified e versões não são alterados.

## Matriz do Target

Todos os caminhos abaixo têm prefixo target. “Lógica existente” significa apenas
consumo no código: não significa execução comprovada no jogo.

| Campo | Situação observada |
| --- | --- |
| ignoredCreaturesText | Corrigido nesta rodada; regressões para nomes e curingas. |
| shinyPriorityEnabled | Lógica existente; exige shinyIcon ou metadados lookType confiáveis. |
| instanceModeEnabled | Bloqueado pelo diagnóstico original; rotina ausente. |
| lowHpComboPercent | Caminho corrigido nesta rodada: motor lê target.lowHpComboPercent e mantém combo.lowHpComboPercent apenas como fallback de perfis antigos. A semântica aplicada é a do spec (vida acima do limite = só attack); o rótulo de emergência da UI e o desvio do Perfect continuam não reproduzidos. |
| monsters[].name | Seleção existente: exato, *, prefixo terminado em *; curingas gerais na lista de inclusão ainda não são completos. |
| monsters[].range | Filtro existente por distância ao treinador; posição do Pokémon ainda precisa ser distinguida para a contagem original. |
| monsters[].priority | Ordenação existente por menor número. |
| monsters[].spell, monsters[].hp | Sem aplicação da skill por linha com combo desligado. |
| monsters[].minCount | Não aplicado; hoenn.minWildsToEngage não substitui a contagem por linha. |
| monsters[].creatureType | Não há aplicação independente do campo; filtros atuais usam is_player e canAttack. |
| monsters[].movement, monsters[].kiteRange | Chase/Stand/Kite por linha não integrados ao Target. |
| monsters[].randomMoves.stand/chase/kite | Sorteio de movimento por linha não integrado. |
| combo.enabled | Seleciona ataque simples ou combo no motor existente. |
| combo.sequenceText, combo.stepDelay | Rotação manual existente; escolha entre manual e nativo corrigida. |
| combo.useNativeSequence | Corrigido para não usar sequência manual oculta; !autocombo opaco não informa o término da rotação. |
| combo.lureDelay | Corrigido nesta rodada: espera desde a parada/alvo atual antes da primeira skill; as skills seguintes usam stepDelay. |
| combo.finishRemainingCount, combo.finishIgnoreShiny | Não integrados ao encerramento de combate/retomada da rota. |
| combo.usePokeStop | UI valida conditionEvents; fluxo do Target não executa a preparação completa. |
| combo.useMedicine, combo.useMedicineBeforeCombo | Sem sequência correspondente no Target; a Medicine de Hoenn tem configurações próprias. |
| combo.medicineHotkey, combo.medicineActionBar, combo.medicineDelayMs | Não consumidos pela sequência de preparação do Target. |
| combo.perfectingLureEnabled, combo.perfectingLureHpPercent, combo.perfectingLureRange | Perfect da UI não integrado; hoenn.perfectLure é um contrato diferente. |
| combo.perfectingSkillMaskEnabled, combo.perfectingSkillMask[].dx/dy | Desenho/configuração disponíveis, sem aplicação da área no motor de Target. |
| combo.perfectingReboxEnabled | Sem ciclo de Rebox integrado. |
| combo.bestTileEnabled | Sem escolha/ordem Best Tile integrada ao Target. |
| combo.targetCreaturesEnabled | Não controla o envio de attackTargetId: o motor inclui o alvo em toda skill manual com UUID. |
| autoRevive.enabled, autoRevive.hotkey, autoRevive.interval | Lógica existente após rotação enumerada; efeito de reset no jogo não comprovado. |
| autoRevive.waitForPokemon | Lógica existente aguarda nome, roster e slot coerentes; RPM atual não fornece essa confirmação. |
| luring.enabled, luring.maxDistance | Lógica existente em lure-engine; normalização restringe distância a 16, schema aceita 30. |
| luring.frontEnabled, luring.frontRegroupMargin, luring.frontRegroupSteps | Lógica existente; fidelidade integral dos parâmetros e transições ainda pendente. |
| luring.randomEnabled, luring.randomMinSeconds, luring.randomMaxSeconds | Lógica existente; limites locais de 5..3600 s diferem do schema de 1..3600000 s. |
| lureSkill.enabled, lureSkill.move, lureSkill.hpPercent | Parcial: aceita uma mN; o RPM agora repassa luring.enabled ao motor e executa o buff enquanto lura. A UI anuncia sequência de buffs com intervalo de 250 ms, ainda não aceita. |
| healSkill.enabled, healSkill.move, healSkill.hpPercent | Parcial: usa healthPercent genérico; não executa a Medicine anterior anunciada na UI. |
| combatStanceAuto.enabled | Alternância ofensivo/defensivo não integrada ao Target. |

No backend teclado/RPM, o diagnóstico de Target deixa de exigir Medicine,
PokeStop e Revive, que esse runtime não executa, e passa a mostrar o erro real
de identidade/varredura mesmo quando a posição do Walker ainda não está
disponível. Monstros vazios e Modo instância continuam bloqueando. A supressão
não declara efeito no jogo: apenas evita exigir hotkeys sem consumidor.

As extensões skills, globalCooldownMs, combo.hotkey e combo.nativeHotkey da
reconstrução não aparecem como esses campos no schema original consultado.
Sua existência não comprova equivalência com o bot distribuído.

## Bloqueio real observado

- Processo observado passivamente: PokeAlliance_dx, PID 26100, título
  PokeAlliance - Nobutdopai.
- live-snapshot.json amostrado: generatedAt 2026-10-29T02:09:38.967978+00:00,
  idade 128 ms, posição 3295/2212/7 e online=true.
- Essa amostra não continha HP do jogador nem roster. Continha 45 criaturas,
  mas creaturesGeneratedAt era 2026-10-29T02:09:30.153822+00:00: aproximadamente
  8,9 segundos de idade, diferente da frescura da posição.
- O backend padrão sem canal nativo é WalkerInputRuntime e aceita somente Walker.
  O atuador combat_actuator.py envia teclas, mas não implementa seleção por ID,
  confirmação de Pokémon, postura, Best Tile ou conclusão observável do AutoCombo.
- O diagnóstico original exige nativeVerified=true, pulseVersion=3 e
  automationVersion=1. Leitura RPM isolada não demonstra esses contratos.

## Próxima integração necessária

Antes de ativar todos os controles, é necessário um backend de combate com
capacidades declaradas, percepção fresca de criaturas e Pokémon, identidade/HP
distintos e confirmação dos comandos. Em seguida, implementar e comparar as
regras pendentes da matriz com observações do original. A nova versão do Shiba
pode servir para comparação separada; não deve sobrescrever a referência atual.

## Validação

Testes específicos em tests/combat_fields.test.cjs cobrem os filtros, os dois
modos de sequência, GCD da hotkey nativa e publicação/preservação dos diagnósticos.
Os resultados gerais ficam em validation.json e validation-*.txt, produzidos por
node tools/validate.cjs. A aprovação dessas verificações não encerra as pendências
de integração e teste real no jogo listadas neste relatório.

Execução anterior: generatedAt 2026-10-29T02:11:56.553Z
(23:11:56 de 28/10/2026 em America/Sao_Paulo):

- build: exitCode 0.
- Node: 494 testes, 486 aprovados, 0 falhas, 8 ignorados.
- Electron: 494 testes, 494 aprovados, 0 falhas, 0 ignorados.
- smoke: exitCode 0.
- audit de UI simulada: exitCode 0.

## Correção da captura com Hotkey AutoCombo undefined

A captura posterior confirmou o diagnóstico de backend e mostrou um erro
separado no formulário. O controle nativeHotkey foi acrescentado apenas a
reconstruction/app/ui/target.js: não existe no schema original, não recebe
default e é descartado por validateConfig ao salvar. Foi reproduzido o descarte
de F5, sem alterar nenhum perfil do usuário.

O formulário foi restaurado ao renderer/target.js original, retirando Hotkey
AutoCombo e o intervalo de repetições acrescentado. O engine mantém a extensão
programática já existente, mas a UI não anuncia persistência de um campo ausente
do contrato original. Reiniciar o jogo ou preencher esse campo não solucionaria
a ausência do backend de combate.

Também foi reproduzido que o erro Backend teclado suporta somente Walker era
traduzido para o banner genérico Não foi possível concluir. O runtime agora
retorna uma mensagem específica preservada pelo tradutor de mensagens, indicando
que Target e Healer ainda exigem integração do backend de combate.

Validação posterior: Node 497 testes, 489 aprovados, 8 ignorados, 0 falhas;
Electron 497 aprovados, 0 ignorados, 0 falhas; build, smoke e audit exitCode 0.
app-audit.json inclui target.comboUiContract aprovado: nativeSelected=true,
unsupportedHotkey=false e undefinedInputs=0. Essa checagem utiliza o Electron
com simulação local, não o cliente real.

O bot já aberto mantém o código carregado anteriormente. Para carregar a UI
corrigida, salvar primeiro as alterações de perfil e reabrir somente o bot.
Nenhuma janela do usuário foi encerrada nesta correção e nenhum input foi
enviado ao jogo. A integração de combate real permanece pendente.
