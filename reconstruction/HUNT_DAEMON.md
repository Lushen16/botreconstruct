# Hunt estrita: auditoria e integracao

## Escopo e resultado

O daemon usa uma unica instancia persistente de createAutomation, com options.hunt.
O modo legado continua disponivel sem essa opcao. Nenhum input real foi disparado
durante esta implementacao; a validacao usa snapshots e transportes simulados.

Problemas encontrados no fluxo legado:

- Healer executava antes de detectar combate: uma potion podia preemptar o target.
- A pausa da cura dependia de haver comando emitido naquele tick: cooldown podia
  liberar o walker com HP ainda baixo.
- Perfect lure podia continuar andando com monstros detectados abaixo de minWilds.
- Nao havia pauseWalker explicito no resultado para coordenar o transporte.
- O healer nao trocava para healPokemonName antes de usar o movimento; no modo
  estrito agora troca, espera confirmacao na telemetria e so entao cura.

## Estados e prioridades

1. BLOCKED: sessao offline, pausada, invalida, expirada, PID divergente, HP
   desconhecido/zero, criatura relevante com campos desconhecidos ou scan parcial.
   pauseWalker=true; nenhum comando de jogo.
2. COMBAT: pelo menos um alvo configurado, canAttack===true, HP numerico >0 e <=100,
   ID valido, mesmo Z, distancia Chebyshev <=target.maxDistance, sem player/ignorados.
   pauseWalker=true, ataque e skills F1-F12 conforme cooldown. Nao chama healer,
   lure nem walker. Perfect lure e healSkill de combate ficam desabilitados aqui.
3. HEAL: nenhum alvo e HP<=healBelow. A recuperacao fica latched entre ticks,
   inclusive cooldown, e so termina com HP>resumeAbove. Um novo alvo preempta
   imediatamente a cura. Sem canal de cura, segura a rota e registra bloqueio.
4. WALKING: nenhum alvo, recuperacao encerrada e nenhuma limpeza/troca de Pokemon
   pendente. Retoma a instancia do walker sem resetar o indice do waypoint.

Padrao: healBelow=80 e resumeAbove=80. Para histerese, configure resumeAbove=90;
nesse caso os canais de cura habilitados continuam tratando ate ultrapassar 90.
Uma potion pode continuar em cooldown mesmo apos o fim do combate: isso segura
a rota, nao antecipa a proxima dose. O GCD de hotkeys e compartilhado (250 ms).
Com tick de 200 ms, a proxima hotkey pode sair apenas no tick de 400 ms.
HP=100 e permitido; resumeAbove deve ser <100 para permitir a saida da recuperacao.

## Execucao

Edite tools/hunt.example.json: os nomes e coordenadas sao apenas exemplos. Configure
a volta real da hunt e as skills. Nao use a tecla da potion tambem como skill.
Os caminhos abaixo sao relativos a raiz RE_PKA; substitua o PID pelo atual.

    node tools/hunt_daemon.cjs --config tools/hunt.example.json --session local-data/hunt-session.json --creatures local-data/hunt-creatures.json --pid 1234 --tick-ms 200

O comando e dry-run: registra decisoes, nao carrega o adapter e nao envia input.
Use --once para validar um tick (codigo 2 se bloqueado). Para enviar comandos:

    node tools/hunt_daemon.cjs --config tools/hunt.example.json --session local-data/hunt-session.json --creatures local-data/hunt-creatures.json --pid 1234 --actuate --adapter tools/meu_hunt_adapter.cjs

meu_hunt_adapter.cjs e um transporte que ainda precisa ser implementado para o
runtime em uso; NAO e um arquivo incluido nem uma integracao live ja comprovada.
--help mostra limites de idade/timeout e limiares de cura.

## Fonte de dados: nao fabricar verificacao nativa

--session deve apontar para um envelope de sessao do runtime, com generatedAt ISO
da publicacao, pid, online, ageMs numerico medido na publicacao e telemetry.
Preserve stale, error, paused, authExpired e runtime quando existirem. O daemon
soma o tempo desde a publicacao a ageMs e mantem os gates de automation.cjs:
nativeVerified===true, pulseVersion===3, posicao valida e PID coerente.
Esses indicadores devem vir da fonte verificada, nunca ser constantes inventadas
para aceitar o scanner externo. O limite efetivo da sessao e no maximo 1000 ms.

telemetry deve incluir position, playerName, healthPercent REAL do personagem e
creatures (ou --creatures separado). Para cura por Pokemon, inclua pokemonName,
activeSlot e roster com slot/name/uuid. HP de uma criatura ou Pokemon nao deve
ser utilizado como HP do personagem sem confirmar a semantica da leitura.

--creatures e opcional se a propria sessao ja contem criaturas atualizadas.
Se informado, o arquivo deve ser schema=2, generatedAt ISO, pid correspondente,
player com identidade/andar coerentes e creatures. Usa mergeCreatureSnapshot,
sem substituir o HP nem a verificacao nativa da sessao.
O produtor deve publicar JSON completo via arquivo temporario + rename atomico,
sem reaproveitar timestamps para dados antigos. Nao ha fallback para ultimo
snapshot valido. Erros de leitura mantem BLOCKED e sao reavaliados no proximo tick.
Um diagnostics.limit_reached=true bloqueia o daemon: scan parcial nao prova
ausencia de monstros. O mesmo vale para qualquer outra fonte incompleta, que o
produtor deve sinalizar como stale/error antes de publica-la.

Pontos ainda abertos nos arquivos encontrados:

- scan_creatures.py deixa ID, HP e canAttack null sem os offsets opcionais.
  Os offsets informados pelo usuario para ID/HP exigem --id-offset 0x5c e
  --hp-offset 0xc0 no produtor. O offset de canAttack nao foi fornecido/verificado:
  NAO converter null em true para liberar o bot.
- scan_creatures.py identifica player, mas atualmente seu objeto player so expoe
  name/pos/struct_va; nao expoe healthPercent do personagem.
- creature_bridge.cjs e uma execucao avulsa e recria o motor a cada processo;
  nao conserva cooldowns nem substitui um produtor continuo de telemetria.
- Este daemon consome snapshots atualizados; nao inicia um scan completo da
  memoria a cada 200 ms. O tempo real do scan deve ser medido pelo produtor.
  Um scan lento nao pode ser apresentado como loop de 5 Hz garantido.

## Contrato do adapter de atuacao

O modulo CommonJS passado por --adapter exporta open({pid, config, signal}).
open retorna um objeto com:

- supportedCommands: lista exata de comandos implementados (por exemplo attack,
  hotkey, walk, talk, switchPokemon). Um lote com comando nao suportado e recusado
  antes de enviar qualquer acao daquele lote.
- pauseWalker(paused, {pid, signal}): Promise<boolean>. true confirma a operacao.
  Deve suspender o movimento ja iniciado, nao apenas desligar o proximo tick.
  false permite apenas os passos discretos deste daemon, NAO reativa outro loop.
  Em combate/cura/bloqueio a confirmacao da pausa antecede qualquer comando.
- command(name, parameter, {pid, extra, signal}): Promise<boolean>. Retorna true
  somente apos confirmar a operacao. Preserva guardas como expectedUuid e
  attackTargetId; nao mapeia talk/switchPokemon para teclas sem uma regra validada.
- close({signal}): opcional; libera handles/conexao sem reiniciar o walker.

O adapter deve adquirir exclusividade para este PID e impedir disputa com o
walker/automation da interface ou outro daemon. Nao iniciar dois donos do input.
As operacoes devem respeitar AbortSignal; timeout tem resultado incerto e causa
parada fatal SEM retry automatico. O daemon tenta pausar novamente no encerramento,
mas uma falha no transporte nao permite prometer que o personagem parou fisicamente.
Logs finais usam pauseWalkerRequested, nao uma confirmacao de parada.

combat_actuator.py prova apenas o canal de teclas em background. PostMessageW
nao implementa attack(creatureId), selecao de alvo por ID, troca por nome/UUID,
acao de barra ou protocolo nativo. Um adapter pode usa-lo para hotkey, verificando
exit code e o JSON success, e mapear direcoes comprovadas para setas; isso por si
so NAO implementa o restante do contrato. Nao fixar HWND 0x709d2: resolva pelo PID.
O uso de PostMessage tambem nao prova que uma potion curou: quem confirma e o
HP do snapshot posterior. Este e o motivo de manter o estado HEAL entre ticks.

## Loop e logging

Leitura -> validacao -> decisao pura/recorder -> validar suporte -> confirmar
pauseWalker -> enviar comandos em ordem com ACK -> esperar restante do periodo.
Nao usa setInterval nem sobrepoe ticks. A instancia de automacao preserva alvo,
cooldowns, recuperacao e waypoint. Antes de cada envio revalida a idade dos dados.
Timeout/ACK negativo/comando nao suportado interrompe o daemon, sem replay do lote.
SIGINT/SIGTERM encerram o loop e solicitam pausa; uma operacao em curso fica
limitada pelo timeout do adapter. Falha de leitura, por outro lado, e recuperavel.

Logs JSON contem at, mode, status, pauseWalker, monsters, hp, targetId, waypoint,
commands, reason, error e blocked. Mudancas de estado e comandos sao registrados;
estados silenciosos recebem heartbeat a cada 5 segundos. tick-overrun avisa
quando leitura/transporte excede 200 ms; o daemon nao tenta compensar com rajadas.

    node --test tests/hunt.test.cjs tests/hunt_daemon.test.cjs tests/engines.test.cjs tests/target-engine.test.cjs

Os testes cobrem prioridade, cooldown, histerese, retomada, interrupcao por novo
alvo, troca/retorno de Pokemon, gates, PID/frescor, ACK, timeout, concorrencia e
scan parcial. Nao constituem validacao live de memoria, janela ou protocolo.
