# Target + Walker RPM: execucao de 29/10/2026

## Integracao implementada

- reconstruction/app/main.cjs seleciona RpmCombatRuntime no backend teclado.
- pka_live_session.py fornece posicao e identidade; scan_creatures.py publica
  criaturas em processo separado, com refresh solicitado de 300 ms.
- RpmCombatRuntime mescla snapshots frescos, elimina IDs conflitantes e aplica
  as regras do TargetEngine existente antes de despachar ataque e skills.
- combat_actuator.py vincula cada envio ao PID, imagem, HWND, titulo, tamanho
  da janela e foco. Cliques incluem WM_MOUSEMOVE antes dos botoes do mouse.
- mN usa as hotkeys reais de config.otml; no cliente observado, m5 = F5.
  O caminho padrao usa APPDATA, sem gravar caminho pessoal no codigo.
- O GCD compartilhado de 250 ms conta a partir do termino do helper. CDs por
  tecla podem ser configurados em cooldownsMs; eles nao sao CDs lidos do jogo.
- Walker e Target podem ser ligados/desligados independentemente. Combate
  segura movimento; idle/lure consulta o motor de luring antes de andar.
- Inicio e Continuar revalidam jogador e criaturas apos adquirir foco.
  Perda de foco pausa ambos e preserva a rota; nao ha retomada automatica.
- nativeVerified permanece false. Envio aceito pelo Windows continua com
  effectVerified=false: nao equivale a confirmacao de ataque pelo cliente.

## Ensaios reais, nao simulados

Cliente: PokeAlliance_dx.exe, PID 28460, HWND 0x6088e, Nobutdopai.
Janela observada: 1920 x 1009 pixels de area cliente.

1. O cliente estava na selecao de personagem. Um clique sem WM_MOUSEMOVE foi
   aceito na fila, mas nao entrou no mapa. Com o movimento anterior ao clique,
   a tela mudou para o mapa e o titulo confirmou Nobutdopai.
2. Entre 16:07:21 e 16:07:24 UTC, Target enviou quatro ataques por clique e
   duas teclas F5. Cada envio retornou PID/HWND corretos, foco e dois eventos.
   O RPM registrou Rattata 1080199944 com HP 100 e depois 81. Isso registra
   uma mudanca observada, nao prova isoladamente qual input causou o dano.
   Evidencia: captures/combat-live-28460/target-only-result.json,
   events.jsonl e after-target.png.
3. Entre 16:10:38 e 16:10:42 UTC, Walker e Target ficaram ativos juntos com o
   perfil salvo, Perfect Lure e minimo de oito criaturas. O motor nao atacou
   abaixo da contagem e enviou oito taps de movimento. O RPM mudou de
   (3291,2264,9) para (3294,2260,9) durante o ciclo; a captura seguinte mostrou
   (3295,2260,9), apos o ultimo tap. Evidencia: walker-lure-result.json,
   events.jsonl e after-walker.png no mesmo diretorio.

## Falha encontrada no ensaio conjunto

No ciclo de 16:13 UTC, a lista com curinga selecionou o proprio Charmander,
ID 1081501896. O scanner o publicava com canAttack=true. O teste evidenciou
que esse campo nao prova hostilidade nem ownership. O dump original foi
preservado em captures/own-charmander-28460.txt; comparacao com o Rattata em
captures/wild-rattata-28460.txt. A semantica completa do byte 0xC4 nao foi
estabelecida nesta rodada; nenhum offset de dono foi inventado.

O incidente ficou em captures/combat-live-28460/own-selection-incident-result.json.
Foi adicionada exclusao anterior a selecao/contagem para is_owned=true e para
protectedCreatureNames no transporte local. Essa lista contem os quatro nomes
vistos no roster real: Pidgey, Oddish, Charmander e Togepi. pokemonName da
telemetria, quando presente, tambem e protegido.

Essa e uma protecao conservadora por nome, nao identificacao automatica de dono:
tambem exclui selvagens homonimos. Se o roster ou apelidos mudarem, essa lista
precisa ser atualizada. Perfis e rotas do usuario nao foram modificados.

### Repeticao apos a protecao

Entre 16:22:41 e 16:22:45 UTC, Walker e Target ativos juntos enviaram quatro
ataques e duas F5, todos para Rattatas. O Charmander nao foi selecionado.
Durante esse combate houve zero taps do Walker. O menor intervalo real entre
o fim de um envio e o inicio do seguinte foi 329 ms, acima do GCD de 250 ms.
O RPM mostrou Rattata 1081734595 com HP 100 e depois 81. A captura exibiu um
Rattata marcado em vermelho e o Charmander em campo. Evidencias:
captures/combat-live-28460/result.json, events.jsonl e after-protected-combat.png.
O ciclo terminou sem erro; finally encerrou o runtime e seus leitores.

Um ensaio anterior expirou aguardando go.json e nao enviou inputs; a falha
ficou em focus-signal-timeout-result.json. O historico nao foi convertido em
sucesso nem apagado. Esses ensaios curtos nao provam toda a rotacao/retomada
apos matar todos os monstros, nem confirmam ownership para outros rosters.

## Limites ainda abertos

- Ownership/hostilidade por RPM exige recuperacao e validacao do campo real.
- Viewport depende de zoom, paineis e tamanho observados. Recalibrar ao mudar
  o layout; redimensionamento invalida o envio em vez de clicar as cegas.
- AutoCombo do cliente esta mapeado a C, mas seu ciclo completo e o efeito de
  repeticao dessa tecla ainda nao foram comprovados. Os ensaios de combate
  usaram temporariamente m5 manual e Perfect Lure desligado, sem salvar perfil.
- F1..F12 disponiveis nao significam skills prontas: CDs reais, estado do chat,
  HP/roster completos, Revive e Healer ainda exigem telemetria adicional.
- Box/Safespot reutilizam o deslocamento existente; nao ha prova de toda a
  semantica nativa desses modos ou dos campos avancados da UI.
- O ensaio usa o runtime real diretamente. Nao substitui auditoria completa
  do botao Iniciar, IPC/renderer e de todos os botoes da interface Electron.

## Reproduzir com o cliente em primeiro plano

    node tools/live_combat_check.cjs PID NOME --single-target --walker --wait-for-go

O helper inicia leitores reais, aguarda prontidao, escreve ready.json e espera
por go.json com at >= armed. O ciclo dura 3500 ms e encerra seus proprios
leitores/runtime em finally. Erros tambem geram result.json; events.jsonl e
acumulativo. --single-target aplica apenas os overrides de ensaio descritos
acima. Sem ele, usa o perfil salvo. Zero ataques pode ser correto durante lure;
o ensaio contabiliza separadamente os envios reais de movimento.

A validacao de regressao completa fica em validation.json e validation-*.txt.
Esses testes complementam as evidencias do cliente e nao substituem gameplay.

Ultima execucao: node tools/validate.cjs, 29/10/2026, 16:21:23 UTC.
Node: 521 testes, 513 aprovados, oito ignorados, zero falhas.
Electron: 521 testes, 521 aprovados, zero ignorados/falhas.
Build, smoke e auditoria local da UI: exitCode 0.

## Ajustes de fidelidade no runtime RPM (30/10/2026)

- O motor de Target passa a ler target.lowHpComboPercent, com
  combo.lowHpComboPercent apenas como fallback de perfis antigos.
- combo.lureDelay passa a atrasar a primeira skill contada desde a parada/alvo
  atual; as skills seguintes continuam usando stepDelay.
- O runtime RPM repassa target.luring.enabled ao motor, ativando lureSkill
  (e o buff de HP) enquanto o Walker lura.
- O diagnostico de Target no backend teclado/RPM deixa de exigir Medicine,
  PokeStop e Revive, nao executados por esse runtime, e mostra o erro real de
  identidade/varredura mesmo sem posicao do Walker. Monstros vazios e Modo
  instancia continuam bloqueando.

Validacao: node tools/validate.cjs, 30/10/2026.
Node: 537 testes, 529 aprovados, oito ignorados, zero falhas.
Electron: 537 testes, 537 aprovados, zero ignorados/falhas.
Build, smoke e auditoria local da UI: exitCode 0. Nenhum desses testes prova
efeito no cliente real; nativeVerified e effectVerified continuam false.
