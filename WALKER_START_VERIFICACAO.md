# Verificação do botão Iniciar

## Correção

O launcher normal selecionava EngineRuntime mesmo sem credenciais do canal.
A posição RPM aparecia no minimapa, mas a sessão não tinha walkerKeyboard;
o modelo da interface mantinha Iniciar desabilitado.

Agora o launcher normal escolhe WalkerInputRuntime quando não há credenciais,
preservando backend explicitamente escolhido, diagnóstico e simulação.
Sem nome configurado, o título vivo da janela precisa confirmar o nome RPM.
O nome fica fixado no início para impedir troca de personagem durante a rota.
nativeVerified continua false; nenhuma autenticação nativa foi inventada.

## Auditoria real

Fonte: live-ui-audit.json, início em 2026-10-29T01:22:04.047Z
(28/10/2026, 22:22, horário de São Paulo). Cliente PID 26100.

- Iniciar encontrado com disabled=false.
- Backend observado: keyboard-rpm.
- Clique chegou ao IPC pka:runtime.
- Início rejeitado: Walker teclado exige rota no mesmo andar.
- Nenhum input de movimento aceito pelo Walker nesta tentativa.
- As amostras registraram personagem no andar 7; a rota selecionada estava no 9.

O classificador anterior atribuía qualquer mudança de posição ao Walker,
mesmo após rejeição do início. Foi corrigido com testes de regressão. O relatório
preserva as amostras e registra a reclassificação como start-not-confirmed.
Movimento manual não comprova funcionamento do atuador.

## Validação automatizada

node tools/validate.cjs: build, Node, Electron, smoke e audit com código 0.
Node: 483 testes, 475 aprovados e 8 ignorados. Electron: 483 aprovados.
Zero falhas. Esses testes não substituem a validação de uma rota no jogo.

## Próximo teste

Com o personagem conectado, selecione uma rota Walk/Wait no mesmo andar atual
ou volte ao andar da rota existente. A rota original não foi alterada para
contornar a validação. O teste real de caminhada continua pendente.
