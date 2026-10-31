# Verificacao real da UI - 28/10/2026 (America/Sao_Paulo)

## Resultado

Pendencia aberta: o deslocamento do personagem nao foi confirmado. Este
relatorio nao aprova a automacao completa nem equivalencia integral ao original.

O cliente real foi observado inicialmente no mapa com Nobutdopai, PID 26100,
posicao 3319, 2277, 9. Posteriormente a janela mostrou a selecao de personagem,
com titulo PokeAlliance. A causa dessa transicao nao foi determinada.

## Execucoes e evidencias

- live-ui-audit-movement-attempt.json: execucao real iniciada em
  2026-10-29T00:23:17.493Z (21:23:17 do dia 28 no horario local).
- Backend keyboard-rpm, sem simulacao; a rota existente do perfil foi usada.
- Iniciar: modules=[walker], paused=false, status=walking.
- Pausar: modules=[walker], paused=true, pausedModules=[walker].
- Parar: modules=[], paused=true.
- As coordenadas registradas permaneceram 3319, 2277, 9; houve tambem uma
  amostra sem sessao. Nao ha evidencia de percurso de waypoints concluido.
- Nessa execucao, ipcErrors=[], failures=[] e aviso final da UI vazio.
- live-ui-audit.json: tentativa posterior bloqueada por ausencia de sessao
  RPM online recente; nenhum percurso foi aprovado.
- live-ui-tab-0.png ate live-ui-tab-7.png e live-ui-walker.png: capturas
  da propria aplicacao Electron, nao mockups.

## Matriz de verificacao

| Controle | Resultado observado |
| --- | --- |
| Abas Scripts, Targeting, Healer, Walker, Capture, Alertas, Hoenn, Tools | Renderizadas na aplicacao real; isto nao aprova atuacao no jogo |
| Walker - Iniciar | Acionado pela UI real e chegou ao runtime; movimento pendente |
| Walker - Pausar | Pausa confirmada no estado do runtime; nao comprova parada apos deslocamento |
| Walker - Parar | Modulos removidos do runtime |
| Walker - Adicionar waypoint | Nao exercitado; rota do usuario preservada |
| Walker - Carregar rota | Nao exercitado; rota existente utilizada |
| Target - lista, lock e rotacao | Nao testados no jogo; backend teclado permanece exclusivo do Walker |
| Healer - HP, cura e troca | Nao testados no jogo; snapshot atual nao fornece HP do jogador e roster ativo |
| Hoenn - potion, medicine e switch | Nao testados no jogo |
| Alertas - GM, player, HP e desconexao | Sem disparo audiovisual real comprovado nesta execucao |
| Tools, Scripts e Looting - submenus e toggles | Nao aprovados por mera renderizacao de abas |

## Alteracoes

1. Launcher agora abre Electron com janela visivel. O helper de elevacao
   continua oculto; somente a interface interativa recebe WindowStyle Normal.
2. Foco do cliente aguarda confirmacao por ate 500 ms quando a ativacao e aceita.
   Rejeicoes incluem o resultado da ativacao e HWND em foreground no erro.
3. Keydown e keyup sao separados por 40 ms, com tentativa de liberar a tecla
   mesmo em interrupcao. A eficacia desse pulso no deslocamento segue pendente.
4. Provider inclui online=false quando o titulo da janela nao corresponde ao
   personagem. Isso evita tratar uma estrutura antiga legivel como sessao ativa;
   nao equivale a um indicador nativo autenticado de login.
5. Auditoria opt-in -LiveAudit usa a UI, IPC e RPM reais, registra erros de IPC,
   tenta a rota por aproximadamente dois segundos, pausa e fecha apenas sua
   propria instancia. Nao troca endpoints por simulacao nem modifica a rota.
6. nativeVerified permanece false em RPM. Nenhuma versao de pulse ou roster
   foi inventada para abrir o gate de combate.

## Fonte original consultada

- ../Extracted_Source/renderer/alert-audio.js: contrato de fila e reproducao
  dos arquivos de audio; nenhum disparo real e presumido por existencia do asset.
- ../Extracted_Source/shared/schema.js: estrutura original de configuracoes.
- ../Extracted_Source/lib/walker-profiles.cjs: wrapper de bytecode, nao fonte
  legivel do motor. O renderer legivel em readable/renderer/walker.js foi usado
  para identificar os controles existentes e o contrato de iniciar/parar.

O backend teclado e a auditoria sao extensoes locais, nao codigo recuperado
do motor original.

## Runner executado

Comando: node tools/validate.cjs

| Etapa | Resultado |
| --- | --- |
| build | exitCode 0 |
| node | 476 testes, 468 aprovados, 8 ignorados, 0 falhas |
| electron | 476 testes, 476 aprovados, 0 ignorados, 0 falhas |
| smoke | exitCode 0 |
| audit | exitCode 0; esta etapa e simulada, nao prova comportamento no jogo |

Logs completos: validation.json e validation-*.txt.

## Para continuar

Fechar as instancias antigas do bot antes de relancar: elas conservam o codigo
antigo em memoria e podem manter providers escrevendo no mesmo snapshot.
Entrar novamente no personagem antes do proximo teste de movimento. Depois:

    .\ABRIR_WALKER_TECLADO.ps1 -ClientPid 26100 -PlayerName Nobutdopai -Elevate -LiveAudit

O proximo criterio e observar mudanca coerente nas coordenadas RPM e no jogo,
nao apenas eventsSent ou status=walking. Combate, HP/roster e os alertas reais
continuam exigindo evidencia propria antes da aprovacao.
