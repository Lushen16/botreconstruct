# Walker independente por teclado + RPM

## Atualizacao de 29/10/2026: Target RPM

O aplicativo agora usa RpmCombatRuntime para unir Walker e Target. O scanner
de criaturas roda em processo separado e o atuador de combate usa PostMessageW.
Houve envio real de ataque/F5 e deslocamento confirmado por RPM no PID 28460.
O texto abaixo preserva o historico anterior, inclusive seus limites e contagens
de testes; a situacao atual, evidencias e pendencias estao em TARGET_RPM_VALIDACAO.md.
Healer, ownership automatico e todos os campos avancados ainda nao estao validados.

Este backend e uma extensao local, nao um handler recuperado do bot original.
Ele reutiliza createWalkerEngine para os waypoints e usa teclas do Windows para
movimentar o cliente em primeiro plano. Nao conecta ao canal nativo, nao altera
sua autenticacao, nao usa a chave oficial e nao marca nativeVerified como true.
O comportamento de entrada por teclado ainda depende da configuracao do jogo.

## Abrir e testar

No PowerShell, na pasta RECONSTRUÇAO OFIcial:

    .\ABRIR_WALKER_TECLADO.ps1 -ClientPid PID_DO_JOGO -PlayerName 'NOME_EXATO_DO_JOGADOR'

O launcher valida o PID, monta os assets e consulta a janela com --probe
(zero eventos de teclado). Ele abre o aplicativo sem iniciar movimentos.
O launcher normal ABRIR_RECONSTRUCAO.bat tambem seleciona este backend quando
PKA_CHANNEL_KEY e PKA_CHANNEL_KEY_FILE estao ausentes, fora de diagnostico e
simulacao. PKA_WALKER_BACKEND=native preserva a escolha explicita do canal;
PKA_WALKER_BACKEND=keyboard seleciona o teclado explicitamente.
Sem PKA_PLAYER_NAME, o nome RPM precisa coincidir com o titulo vivo da janela
PokeAlliance - NOME. Ao iniciar, o nome e fixado para impedir troca de personagem
durante a rota. Na selecao de personagens o botao Iniciar permanece bloqueado.
PKA_PID e PKA_PLAYER_NAME selecionam o processo e validam a identidade do jogador;
PKA_SESSION_FILE aponta para live-walker-PID.json neste launcher.

O launcher tambem testa --probe-access antes de abrir a interface. Se o Windows
negar a leitura RPM (erro 5), o inicio e interrompido com a causa real. Jogo e
bot precisam de niveis de privilegio compativeis. Para um jogo iniciado como
administrador, a elevacao do launcher e uma opcao explicita, com confirmacao UAC:

    .\ABRIR_WALKER_TECLADO.ps1 -ClientPid PID_DO_JOGO -PlayerName 'NOME_EXATO_DO_JOGADOR' -Elevate

Outra possibilidade e reiniciar o cliente sem elevacao. Nenhuma permissao de
outro processo e alterada. Elevacao nao garante leitura de processos protegidos;
o preflight continua exigindo sucesso real de OpenProcess com VM_READ.

Selecione/carregue uma rota formada somente por Walk e Wait, no mesmo andar
atual, e clique no botao proprio do Walker, [▶ Iniciar]. Esse botao usa o IPC
pka:runtime existente, que agora chega a WalkerInputRuntime quando esse backend
foi escolhido. O aplicativo tenta dar foco ao jogo antes de ativar o timer.
Se o Windows impedir a troca de foco, o inicio retorna erro em vez de simular
sucesso. O botao generico de outros motores nao habilita esse backend.

Uma rota curta, em area desobstruida e conhecida, permite observar se os passos
realmente alteram as coordenadas RPM. Envio aceito pelo Windows nao significa
chegada ao waypoint: a chegada depende das coordenadas lidas depois do envio.
O helper usa somente setas estendidas para norte/leste/sul/oeste. Waypoints
diagonais usam a logica smartWalking existente, por eixos, apenas neste backend;
a configuracao salva e o motor nativo permanecem inalterados. Numpad 9/3/1/7
foi removido deste atuador para evitar conflitos com a barra de Pokemon e NumLock.

## Paradas e limites

- Cada tap separa keydown e keyup por 40 ms; nao ha tecla mantida entre ticks.
- Intervalo minimo de 250 ms e snapshot novo antes de repetir movimento.
- RPM com mais de 1000 ms, PID/nome divergente, mudanca de andar,
  modificadores pressionados ou erro de envio interrompem o Walker.
- Perda de foco confirmada pelo emissor antes de qualquer tecla pausa o Walker
  e preserva a rota e o indice atual. Use Continuar para readquirir o foco do
  jogo e retomar. Nao ha retomada automatica nem envio para outra janela.
- [■ Parar], pausa, troca de perfil e fechamento aguardam o tap em andamento e
  impedem novos envios. As coordenadas nunca sao atualizadas artificialmente.
- Rota bloqueada reporta erro em vez de ignorar o waypoint silenciosamente.
- Say, Stairs, Box, Safespot, Target, Healer e comandos nativos manuais ficam
  fora deste backend. Gravacao de rota continua seguindo o contrato original,
  que exige sessao nativa; carregue/crie os pontos antes do teste por teclado.
- Este backend nao usa mapa para calcular caminhos alternativos ao redor de
  paredes, nem confirma combate/monstros enquanto caminha. Nao e equivalencia
  completa com o Walker original.

## Evidencia e testes

    node --test tests/walker_input_runtime.test.cjs
    node tools/validate.cjs
    python tools/walker_input.py --pid PID_DO_JOGO --probe

Os testes automatizados usam emissor de teclas substituido e snapshots
controlados; nao movimentam o personagem. --probe consulta o processo e a
janela sem focar ou emitir teclas. O funcionamento de SendInput no cliente
DirectX precisa de observacao real apos a ativacao manual do botao Iniciar.

## Auditoria com cliente real

    .\ABRIR_WALKER_TECLADO.ps1 -ClientPid PID_DO_JOGO -PlayerName NOME -Elevate -LiveAudit

Este modo abre as abas reais, captura imagens, tenta iniciar a rota atual por
aproximadamente dois segundos e termina pausando os modulos e fechando somente
a instancia que executou a auditoria.
Nao usa simulacao nem modifica a rota para o teste. O resultado e salvo em
live-ui-audit.json e live-ui-tab-*.png. Abas renderizadas nao comprovam cura,
combate, looting ou acionamento de alertas no jogo. Uma posicao RPM diferente
e registrada como observacao, nao como prova de conclusao da rota inteira.

O provider compara o titulo da janela com PokeAlliance - NOME para detectar
a saida do personagem mesmo quando a estrutura antiga continua legivel na
memoria. Essa verificacao e um indicador adicional de sessao, nao autenticacao
do canal nativo. Instancias ja abertas precisam ser reiniciadas para usa-la.

## Isolamento Target/Walker (2026-10-29)

O autosave de qualquer configuracao chamava setModules('all', false), inclusive
quando apenas o Target mudava. No backend keyboard-rpm, o Controller agora
preserva o Walker quando suas configuracoes de execucao permanecem iguais.
luaRevision e ordem de propriedades nao contam como mudanca de rota. Alterar
waypoints, loop ou identidade da rota continua interrompendo antes de salvar.
Salvar explicitamente ou trocar de perfil mantem a parada anterior.

O clique na UI tambem pode tirar o foco do jogo. O emissor continua verificando
o foco antes de SendInput, mas sinaliza WALKER_FOCUS_LOST com eventsSent=0
quando nenhuma tecla foi enviada. Somente essa rejeicao confirmada preserva
a execucao pausada; erros genericos ou envio parcial continuam encerrando-a.

Target e Healer continuam fora do backend de teclado/RPM. Esta correcao evita
que configurar ou tentar iniciar Target encerre indevidamente o Walker; nao
implementa ataque, selecao de criaturas ou combo nesse backend.

Validacao executada em 2026-10-29: 39 testes focados aprovados; validacao geral
com 504 testes no Node (496 aprovados, 8 ignorados, zero falhas) e 504 no
Electron (504 aprovados, zero ignorados/falhas). Build, smoke e auditoria local
da UI terminaram com exitCode 0. Evidencia completa em validation.json e
validation-*.txt. Nenhum input foi enviado ao jogo nesta correcao; os testes
de continuidade e pausa usam snapshots e emissor controlados.
