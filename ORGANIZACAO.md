# Organização da reconstrução oficial

## Cópia ativa

C:\Users\yago\Documents\Clone\RECONSTRUÇAO OFIcial

Esta pasta substitui RE_PKA. O projeto T3 existente foi atualizado para
Reconstrução Oficial e aponta para esta raiz. A associação da conversa é
verificada separadamente da configuração do projeto.

## Preservado

- reconstruction, tools, tests, runtime e readable.
- local-data: configurações, perfis e rotas do usuário.
- Fixtures, capturas, dumps, inventários e evidências; extensão ou idade não
  comprovam que um arquivo está morto.
- ../Extracted_Source e ../Shiba_Bots_App: referência e dependência do build.

## Versões retiradas da área ativa

Em ../ARQUIVO_RECONSTRUCOES_2026-10-28 foram arquivados:

- PKA_Tools_Reconstrucao_2026-10-22.
- production.
- BotCoordinator.js, HealerEngine.js, TargetEngine.js e WalkerEngine.js soltos.
- Caches Python regeneráveis de tests/tools e a pasta vazia BotAplicavel.

O manifesto MANIFESTO_LIMPEZA.json registra origens e destinos. Esses itens
foram arquivados, não apagados: preservar trabalho único tem prioridade sobre
liberar espaço. Nenhum ganho de espaço em disco é alegado.

## Validação e T3

Após renomear: node tools/validate.cjs terminou com código 0. Node: 476 testes,
468 aprovados e 8 ignorados; Electron: 476 aprovados, zero falhas. Build,
smoke e auditoria de UI também terminaram com código 0. Não são provas de jogo.

O cadastro do projeto T3 aponta para a pasta oficial. Esta conversa foi
renomeada, mas ainda aparece como No project e mantém o workspace scratch.
Os controles consultados não ofereceram mover esta conversa para outro projeto.
Não foi alterado o projeto scratch compartilhado por outras conversas.

## Operação

Abra ABRIR_RECONSTRUCAO.bat nesta pasta. O launcher resolve sua própria raiz.
O jogo não foi encerrado durante a organização. Instâncias antigas do bot e
seus dois providers Python foram encerrados para liberar a renomeação.
As limitações funcionais continuam documentadas em VERIFICACAO_UI_REAL.md.
