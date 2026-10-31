# Proteção dinâmica dos Pokémon — investigação de 2026-10-29

## Estado da primeira investigação

A leitura dinâmica de posse ainda não está integrada. Nenhum resultado desta
investigação comprova que o Target reconheça automaticamente o time atual.
O filtro provisório de nomes em local-data/keyboard-combat.json foi preservado:
removê-lo antes de existir uma fonte de posse comprovada reduziria a proteção.
Esse filtro é insuficiente após troca de time e também exclui selvagens homônimos.

## Evidência coletada sem comandos de combate

- Processo observado: PokeAlliance_dx.exe, PID 28460, janela
  PokeAlliance - Nobutdopai, HWND 395406.
- O acesso RPM sem elevação retornou process-access-denied / Win32 5.
- A coleta elevada de RTTI resolveu LocalPlayer, Item, UIItem e UILabel pela
  imagem carregada, sem reutilizar os endereços de vtable de outra versão.
- Evidência: captures/ownership-rtti-28460.txt.
- A sonda tools/probe_roster_objects.py encontrou objetos UILabel com parent IDs
  poke1 até poke6. Os slots 1–4 tinham HP/contagens de skills preenchidos;
  5–6 não tinham esses valores. A captura visual da Pokébar concordava com
  quatro Pokémon carregados e Charmander ativo.
- Evidência bruta: captures/roster-labels-28460.jsonl. A extensão não implica
  UTF-8: o redirecionamento do PowerShell gravou UTF-16LE.
- Exemplos observados: parent poke1 / cooldownText / 5/5;
  parent poke2 / cooldownText / 6/6; parent poke3 / cooldownText / 7/7;
  parent poke4 / cooldownText / 6/6. São observações de widgets, não UUIDs.
- Os campos de string foram encontrados em offsets relativos ao objeto UILabel:
  ID 0x20, parent ID 0xB8 e texto 0x4C8/0x4E8. Isso não é um contrato
  generalizado para outra versão do cliente e não foi instalado no runtime.
- A segunda coleta de objetos/parent foi rejeitada pelo executor antes de
  iniciar. Não há evidência nova de UIWidget nem de identificação por UUID.

## Lacuna na origem dos dados

tools/pka_live_session.py e reconstruction/live-session.cjs não publicam roster,
UUID da Pokéball nem relação dono/criatura. A bridge de criaturas não cria essa
relação. Consumir um campo roster fictício no filtro não resolveria a leitura.

O contrato original reconstruction/telemetry.cjs tem roster com slot, uuid,
name, healthPercent e moves. UUID de Pokéball não equivale a ID de criatura.
O byte em criatura+0xC4, atualmente convertido em canAttack, não é evidência
de hostilidade ou de posse e não deve ser usado para separar próprio/selvagem.

## Critérios para concluir

1. Recuperar uma fonte viva de roster/identidade da Pokébar ou inventário, sem
   nomes fixos, e comprovar sua atualização após mudança real de time.
2. Recuperar e validar a relação entre o Pokémon do roster e a entidade em
   campo. Não comparar UUID com creature.id nem inferir posse por espécie.
3. Vincular a leitura a PID, personagem e timestamp; leitura ausente, parcial,
   antiga ou durante troca deve suspender novos ataques, não liberar alvos.
4. Revalidar a posse antes de cada ataque e skill; cancelar ações enfileiradas
   quando o alvo passa a ser próprio ou a identidade fica indeterminada.
5. Comprovar troca, rename, reconexão e selvagem homônimo com evidência real;
   complementar com regressões automatizadas. Não prometer ausência de falhas
   futuras apenas por tornar a configuração dinâmica.

Na primeira investigação não houve alteração de perfis, rotas, runtime de
combate ou estado do time. O estado atualizado está na seção seguinte.

## Atualização: proteção por identidade integrada

### Método e evidência

- O endereço usado pelo scanner é a base do control block MSVC. O objeto
  Monster começa 0x10 bytes depois. O offset 0x0C pertence aos contadores
  desse control block, não ao tipo da criatura.
- O byte observado de tipo está em objeto+0x176, portanto scannerBase+0x186.
  Os dumps reais preservados de Charmander próprio e Rattata selvagem têm
  respectivamente 3 e 1 nesse campo. Ambos têm 2 em scannerBase+0x0C.
- No executável examinado, RVA 0x3F3A75 contém:
  movzx eax, byte ptr [rcx+0x176]; sub al,3; cmp al,1; jbe.
  A comparação agrupa os tipos 3 e 4. A enumeração de nomes 0–4 foi consultada
  no renderer original. Isso é a correlação adotada, não uma comparação de UUID.
- A vtable dos objetos Pokémon capturados é a de Monster, RVA 0x1F43060;
  não é a vtable da classe base Creature, RVA 0x1F3C578. Essa distinção explica
  a coleta anterior de Creature sem Pokémon. LocalPlayer usa RVA 0x1F44628.
- Evidência estática reproduzida: captures/ownership-static-proof.json.
- Perfil restrito ao SHA-256
  473df25c1edd23e7464ad3ba9b923a603051a8b4ae8004a95c06402f678294e6.
  Outra versão do cliente deve falhar fechada, não reutilizar offsets às cegas.

### Alterações efetivas

- tools/creature_identity.py valida SHA do executável, código carregado,
  vtable, contadores de referências, nome, ID, posição, HP e tipo.
- O scanner principal classifica a descoberta e cada refresh de criaturas,
  publicando creatureType, isOwnPokemon, ownershipVerified e o perfil usado.
  O byte legado em 0xC4 deixou de determinar canAttack nessa leitura verificada;
  somente tipo 1 fica elegível para combate.
- A bridge transmite a identidade do jogador e o perfil; live-session.cjs
  preserva esses campos quando presentes e frescos. O worker legado opcional
  de pka_live_session.py não foi promovido a fonte de posse: sem perfil,
  a trava rejeita seus dados. O app usa o scanner principal separado.
- RpmCombatRuntime deixou de filtrar espécies por protectedCreatureNames;
  a propriedade com os quatro nomes foi removida de keyboard-combat.json.
  Nenhum perfil de hunt ou rota foi alterado.
- O runtime exige identidade com até 500ms, perfil correspondente e exatamente
  um Pokémon próprio vivo não ambíguo. Ausência/ambiguidade suspende combate.
  Mudança de ID do próprio Pokémon descarta a rotação enfileirada.
- Antes de cada ataque/skill, o runtime relê o snapshot e inclui targetGuard.
  combat_actuator.py abre RPM novamente e relê jogador, Pokémon próprio e alvo
  imediatamente antes dos eventos de entrada. Tipo diferente de selvagem,
  ID/vtable/nome trocado, objeto destruído, morte, mudança de posição,
  sobreposição com o próprio Pokémon, troca de andar e dados com mais de
  500ms causam cancelamento, inclusive quando expiram durante a revalidação.
- TargetEngine também exclui as flags de posse e creatureType diferente de 1
  quando esse campo existe. Selvagem homônimo não é excluído por espécie.

### Validação e limites físicos

Os testes incluem leitura dos dumps reais preservados e casos controlados de
troca de tipo, ID e timestamp. O caso homônimo automatizado modifica bytes
em uma cópia em memória do teste; não representa dois Charmander observados
simultaneamente no jogo.

A inspeção visual atual encontrou o cliente na seleção de personagem.
O clique via Computer Use não demonstrou entrada no mundo. A tentativa
de entrada pelo atuador elevado terminou com o erro real de Start-Process:
"A operação foi cancelada pelo usuário." Não foi repetida a elevação.
Nenhum ataque novo nem skill nova foi comprovado nesta rodada.

Permanecem pendentes: comprovar uma troca real de Pokémon; observar próprio e
selvagem homônimos simultaneamente; registrar seleção, reação e dano no cliente.
PostMessage aceito não comprova qual alvo o cliente selecionou. A leitura final
protege a identidade solicitada, mas o acknowledgment do alvo efetivamente
selecionado no cliente continua pendente. Portanto não há alegação de 100% de
aceite físico nem de inventário/roster UUID integralmente recuperado.

Resultados executados: 12 testes Python de identidade aprovados; validação
geral Node com 525 testes (517 aprovados, 8 ignorados, zero falhas), Electron
com 525 aprovados e zero falhas. Build e smoke passaram. O arquivo
validation.json contém o resultado completo da última execução.

## Validação real retomada em 29/10/2026, horário de São Paulo

Esta rodada ocorreu com o personagem dentro do mundo e acesso RPM liberado.
PID 28460, HWND 0x6088e, título PokeAlliance - Nobutdopai. O executável
continuou com SHA-256 473df25c1edd23e7464ad3ba9b923a603051a8b4ae8004a95c06402f678294e6.
Os arquivos de captura usam UTC (30/10/2026), correspondente à noite de 29/10 local.

### Resultados observados, sem equivaler transporte a efeito

- A sonda de acesso retornou ok=true, rpmAccess=true, commandsSent=0.
- O probe RTTI encontrou um LocalPlayer e 18 objetos Monster. Jogador
  Nobutdopai: ID 268452555, tipo 0, posição 3296,2260,9.
- O primeiro Charmander observado tinha ID 1089957523, tipo 3, HP 30%.
  Nos ciclos posteriores, o summon era Charmander ID 1089999772, tipo 3.
  Essa mudança anterior à troca controlada foi observada, não atribuída ao bot.
- Dois ciclos limitados de 3,5 segundos usaram Target sem Walker e uma sequência
  de validação m5, sem alterar o perfil salvo. Cada ciclo registrou três ataques
  por clique direito e uma tecla F5 para Rattata ID 1090017968, tipo 1.
  Todos os oito envios tiveram identityGuard com o ID do Charmander próprio,
  foreground=true e eventsSent=2. Os menores intervalos entre startedAtMs
  foram 517 ms e 529 ms, acima do GCD de 250 ms.
- Uma tentativa anterior terminou por perda de foco para HWND 0x302da, com
  zero dispatches. Foi preservada como falha, não contada como teste aprovado.
- O ataque direto posterior usou Oddish próprio ID 1090144726 e Rattata
  ID 1090017968. O guard confirmou tipo 1 antes do PostMessageW. O HP da
  Rattata permaneceu em 100% na releitura feita um segundo depois.
- Não foi observada redução de HP, morte ou confirmação inequívoca do alvo
  selecionado pelo cliente nesses ciclos. effectVerified permanece false.

### Bloqueios testados contra o processo real

O atuador foi chamado com dados lidos por RPM, sem substituir memória por mocks:

1. Target apontando para o Charmander próprio tipo 3: rejeitado com
   "Identidade mudou ou posse incerta: target".
2. Timestamp deliberadamente vencido em 1000 ms: rejeitado com
   "Identidade de combate expirada (limite 500ms).".
3. Após troca real, guard contendo o ID antigo do Charmander: rejeitado com
   "Identidade mudou ou posse incerta: own".

As três rejeições ocorreram no guard anterior ao trecho que chama PostMessageW.
O JSON de erro atual não contém contador eventsSent; essa ausência não foi
convertida em contador inventado.

### Troca real de espécie

Um clique do atuador na Pokébar produziu a mensagem visual "Charmander, Volte!"
e a entrada de Oddish. A nova sonda leu Oddish ID 1090144726, tipo 3,
scannerBase 0x2c04b95d0a0, na posição 3294,2260,9. O método de correlação
continua sendo Monster+0x176, equivalente a scannerBase+0x186; nenhum nome
de espécie foi adicionado à lista de proteção. O comando para restaurar
Charmander foi enviado uma única vez ao encerrar a troca controlada. A captura
captures/ownership-restored-28460.jpg confirmou Charmander novamente em campo.

### Evidências desta rodada

- captures/ownership-resume-live-28460.json
- captures/combat-live-28460-2026-10-30T00-34-15-297Z/result.json (perda de foco)
- captures/combat-live-28460-2026-10-30T00-35-46-193Z/result.json
- captures/combat-live-28460-2026-10-30T00-38-28-676Z/result.json
- captures/ownership-live-negative-28460.json
- captures/ownership-after-switch-28460.json e .jpg
- captures/ownership-old-summon-block-28460.json
- captures/ownership-direct-guarded-attack-28460.json e .jpg
- captures/ownership-switch-command-28460.json
- captures/ownership-restore-command-28460.json

O validador tools/live_combat_check.cjs passou a criar uma pasta datada por
execução e informar seu caminho, preservando resultados anteriores.
node tools/validate.cjs foi executado novamente: build, smoke e audit com
exitCode=0; Node 525 testes, 517 aprovados, 8 ignorados, zero falhas;
Electron 525 testes aprovados, zero falhas.

### Pendências que permanecem abertas

Ainda falta observar próprio e selvagem homônimos simultaneamente no mesmo
andar do mapa, comprovar o alvo efetivamente reconhecido pelo cliente e
registrar dano causado pelo ciclo automatizado. Os Oddish selvagens encontrados
pela sonda estavam em outro andar; isso não satisfaz o cenário de homônimos.
A troca e os bloqueios reais avançaram, mas o aceite físico integral não está
concluído. A recuperação completa do inventário/roster UUID também não foi
demonstrada por este método de tipo da entidade.


## Aceite físico de 30/10/2026 — sessão PID 4152

O PID desta rodada é 4152, HWND 0x5082a, janela PokeAlliance - Nobutdopai.
O PID histórico 28460 não foi reutilizado. As horas abaixo estão em UTC.

### Dano e seleção próximos: comprovados por ataque básico

Em 12:36:13, o atuador PostMessageW enviou um clique direito no cliente
(887,404). Jogador em 3296,2259,9; Rattata selvagem ID 1078692116,
tipo 1, em 3295,2259,9; Charmander próprio ID 1078549186, tipo 3,
em 3294,2260,9. Distância Chebyshev jogador/alvo e próprio/alvo: 1 tile.
O retorno inclui identityGuard targetId=1078692116 e ownPokemonId=1078549186.
A imagem inicial mostra a marca vermelha de seleção; a final mostra o cadáver.

As 50 amostras RPM de aproximadamente 10 segundos registram:

| UTC | HP da Rattata |
| --- | --- |
| 12:36:13.483 | 100% |
| 12:36:14.350 | 79% |
| 12:36:16.566 | 57% |
| 12:36:18.533 | 36% |
| 12:36:20.521 | 14% |
| 12:36:22.509 | 0% |
| 12:36:22.725 | entidade ausente |

O óbito foi observado aproximadamente 9,2 segundos após o comando.
Nenhuma skill foi enviada nessa janela. Este resultado comprova seleção
próxima e dano por ataque básico, não a rotação completa de skills.
O effectVerified=false retornado pelo transporte foi preservado: ele informa
apenas enfileiramento. A comprovação de efeito vem das amostras e imagens.

### Bloqueio real do Pokémon próprio

Em 12:58:28, com a sessão real e leitura fresca, foi submetido ao atuador
um pedido de ataque cujo target era o próprio Oddish ID 1078729374,
creatureType=3. O processo retornou status 1 e:

    {"success": false, "error": "Identidade mudou ou posse incerta: target", "win32Error": null}

A rejeição acontece antes do trecho de envio de inputs. O retorno de erro
não publica eventsSent; nenhum contador foi inferido desse campo ausente.
A correlação mantém Monster+0x176, equivalente a scannerBase+0x186.
Esse bloqueio real não substitui o ensaio simultâneo com selvagem homônimo.

### Homônimos no mesmo andar: pendente

A navegação real passou de z=9 para z=8 pela escada abordada a partir de
3297,2224,9, seguindo para leste. A posição final foi 3293,2220,8.
O Oddish próprio foi confirmado tipo 3 nesse piso, mas a leitura final
não continha Oddish selvagem no mesmo andar. As tentativas da escada visual
ao norte não produziram a transição para z=7. Não há evidência de aceite
físico do cenário Oddish próprio + Oddish selvagem no mesmo piso.

Ao encerrar, o Oddish estava com 59% de HP após ataques das Rattatas do mapa.
Foi recolhido por um único clique na Pokébar; a imagem registra
"Oddish, Volte!" e o snapshot final não contém criatura tipo 3.
O scanner iniciado nesta rodada foi encerrado; o jogo permaneceu aberto.

### Discrepância do ciclo integrado ainda aberta

O ensaio em captures/combat-live-4152-2026-10-30T12-28-33-282Z aceitou
um ataque, mas pausou o runtime com "Alvo mudou de tile ou andar antes do envio.".
A proteção deve continuar rejeitando a coordenada antiga. A recuperação
por nova leitura/reseleção ainda precisa ser implementada e validada.
Não há confirmação RPM do ID atualmente selecionado pelo cliente: o guard
verifica a identidade pretendida antes do clique, não o ID de seleção interno.
Por isso, combate automatizado contínuo e rotação completa seguem sem aceite.

### Alterações e validação de software desta rodada

- tools/live_combat_check.cjs aceita --duration-ms=N entre 1000 e 10000 ms.
- --single-target limita o alcance a 2 tiles somente na configuração em memória.
- O log das opções de validação registra também maxDistance=2.
- A duração é um teto: o ensaio termina antes se o runtime entrar em pausa.
- node tools/validate.cjs: build, Node, Electron, smoke e audit com exitCode=0.
- Node: 525 testes, 517 aprovados, 8 ignorados, 0 falhas.
- Electron: 525 testes, 525 aprovados, 0 ignorados, 0 falhas.
- Esses testes de software não equivalem ao aceite físico pendente.

### Evidências preservadas

Diretório captures/acceptance-4152-2026-10-30T12-31-52-158Z/:

- damage-trace.json: pedido, resposta do atuador e 50 amostras RPM.
- damage-attack-start.jpg e damage-attack-end.jpg: seleção e cadáver.
- own-identity-rejection.json: pedido e rejeição do ID próprio real.
- manual-events.jsonl: comandos registrados durante a intervenção.
- final-position.jpg: posição final e recolhimento do Oddish.
- final-snapshot.json: telemetria após o recolhimento.

As tentativas anteriores com observação após o alvo já desaparecer e a tecla
F5 enviada com outro target não foram usadas como prova de dano por skill.

## Recuperação de alvo móvel e ciclo integrado — 30/10/2026

Esta seção atualiza a discrepância do ciclo integrado registrada acima.
Horários em UTC; cliente real PID 4152, HWND 0x5082a.

### Correção implementada

- tools/creature_identity.py distingue TargetMovedError somente após validar
  frescor, identidade, tipo, vida, andar e separação do Pokémon próprio.
- tools/combat_actuator.py retorna COMBAT_TARGET_MOVED, PID e eventsSent=0
  para essa rejeição anterior ao envio. Mudança de andar/posse e leitura
  expirada continuam sendo falhas distintas, sem liberar o ataque.
- reconstruction/keyboard-combat.cjs só propaga a recuperação quando o
  retorno identifica o mesmo PID e zero eventos enviados.
- reconstruction/rpm-combat-runtime.cjs preserva a fila e aguarda um novo
  timestamp do scanner antes de reprojetar. A rejeição transitória não pausa
  o Walker nem consome GCD/cooldown; skill rejeitada exige nova seleção antes
  de continuar. Alvo morto, ausente ou em outro andar perde a fila antiga.

### Validação executada

node tools/validate.cjs concluiu build, node, electron, smoke e audit com
exitCode=0. O manifesto validation.json registra 13:14:46.714 UTC:

| Runner | Testes | Aprovados | Falhas | Ignorados |
| --- | ---: | ---: | ---: | ---: |
| Node | 529 | 521 | 0 | 8 |
| Electron | 529 | 529 | 0 | 0 |

Os testes específicos passaram de 19/23 para 23/23 após a correção.
Saídas preservadas em captures/moving-target-before.txt e
captures/moving-target-after.txt. Incluem espera por snapshot novo,
reprojeção, reseleção antes de skill e manutenção dos bloqueios de identidade.

### Ensaio integrado de 10 segundos no jogo

Comando: node tools/live_combat_check.cjs 4152 Nobutdopai
--single-target --duration-ms=10000 --wait-for-go

Sinal de início em 13:20:52.021; término em 13:21:02.345.
Resultado: paused=false, status=combat, error=null, 11 despachos aceitos
(9 ataques por clique direito e 2 envios F5). Intervalo mínimo observado
entre despachos aproximadamente 547 ms, acima do GCD de 250 ms.
Nenhum despacho registrou como alvo o Oddish próprio ID 1079186423, tipo 3.

| Alvo selvagem, tipo 1 | F5 enviado | HP observado por RPM |
| --- | --- | --- |
| Rattata 1078997766 | 13:20:53.015 | 18% para 5%; ausente em 13:20:55.363 |
| Rattata 1078994373 | 13:20:56.360 | 38% para 25% e depois 13% |

O segundo alvo mudou de 3294,2220,8 para 3294,2221,8. Os cliques
aceitos mudaram de (1031,404) para (1031,476), mantendo o mesmo ID
e sem pausar o runtime. O ramo COMBAT_TARGET_MOVED não ocorreu nessa
janela física; sua recuperação específica foi exercitada nos testes.

As imagens mostram F5 entrando em cooldown e a Pokébar passando de 6/6
para 5/6. Ataque básico também estava ativo: a queda de HP não isola
numericamente o dano exclusivo da skill. O segundo envio F5 ocorreu
3,345 segundos após o primeiro; envio aceito não comprova segundo cast.
local-data/keyboard-combat.json mantém cooldownsMs vazio: cooldowns
individuais configurados são respeitados, mas a leitura dinâmica do
cooldown real do cliente ainda não foi integrada.

Evidências: captures/combat-live-4152-2026-10-30T13-19-26-197Z/
(result.json, events.jsonl, before.jpg, during.jpg, after.jpg) e
captures/final-combat-2026-10-30T13-16-14-775Z/rpm-during-integrated.json
(amostras reais de HP). effectVerified=false no transporte foi preservado.
Uma tentativa anterior sem APPDATA falhou antes da prontidão; seu
result.json em captures/combat-live-4152-2026-10-30T13-17-10-933Z/
também permanece preservado e não conta como execução aprovada.

### Retomada de navegação e estado final

Nova leitura contínua real de 200 ms foi iniciada em 13:41:23 UTC.
A navegação avançou de 3278,2214,8 para 3279,2208,8 e depois
3272,2208,8; a transição para z=7 não foi obtida. O cliente também
exibiu a mensagem "Não há rota" em uma das tentativas pelo minimapa.
Não foi observado Oddish selvagem no mesmo andar durante a retomada.
O aceite simultâneo de homônimos permanece pendente, sem equivalência
presumida com os testes de software ou com Rattata de outra espécie.

O Oddish próprio ID 1079506703 foi identificado como tipo 3. Durante
a navegação, sofreu ataques das Rattatas e terminou com 67% de HP na
Pokébar. Foi recolhido com um único clique; a tela registrou "Oddish,
Volte!" e o snapshot final contém zero entidades tipo 3. Nenhum novo
comando de ataque ou skill foi enviado nesta etapa de navegação.

Evidências desta retomada em
captures/resumed-combat-2026-10-30T13-41-23-716Z/: navigation.jsonl,
before-recall.json, before-recall.jpg, after-recall.jpg e final-snapshot.json.
O snapshot final tinha 123 ms de idade ao ser consultado. A sonda Python
PID 10300 foi encerrada; o cliente PID 4152 permaneceu aberto.

node tools/validate.cjs foi executado novamente, concluindo em
13:50:14.200 UTC: build, node, electron, smoke e audit com exitCode=0;
Node 529/521/0/8 e Electron 529/529/0/0 (testes/aprovados/falhas/ignorados).

Pendências de aceite: homônimos simultâneos no mesmo z; exercício físico
do ramo transitório COMBAT_TARGET_MOVED; cooldown individual real lido
do cliente; separação causal do dano da skill e do ataque básico.
