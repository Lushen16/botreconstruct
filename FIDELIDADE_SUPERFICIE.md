# Fidelidade da superficie e fechamento da retomada

Data: 2026-10-28, America/Sao_Paulo. A execucao parada do OpenCode foi interrompida antes das novas edicoes. As alteracoes existentes foram preservadas e a validacao abaixo cobre as duas frentes juntas.

## Evidencia original consultada

Foram executadas funcoes dos modulos originais no Electron 44.7.2 compativel, usando apenas strings de dados e diretorios temporarios de teste. Nenhum comando foi enviado ao jogo e nenhum arquivo de Extracted_Source foi modificado.

| Artefato original | SHA-256 | Observacao |
| --- | --- | --- |
| ../Extracted_Source/lib/legacy.jsc | 155d1aed676e0416c0feb352c789393702248e41e60594431ae47810c58150df | parseLuaData: tabelas vazias, mistas, chaves, delimitadores, erros e prototipo |
| ../Extracted_Source/lib/walker-profiles.jsc | c2176e31714360212cead743da27095d86e1847df4ba2452971b325a6cc1d455 | WalkerProfiles.list/read/load sobre fixtures temporarias |
| ../Extracted_Source/shared/schema.js | Verificado diretamente | healMoveSlot 1..100 e espera configurada apos ultima skill |
| ../Shiba_Bots_App/dll/resources/app.asar | 0cc1cf89ee210714c150ed6270c9f44afc90e1d0bc2a790c6ab7b9eb77438e24 | preloads e assets; identidade verificada por tools/build_app.cjs |

## Causa da falha parada

O teste esperava objeto vazio em labelScripts, mas o parser original retorna array vazio para uma tabela Lua vazia. Essa expectativa foi corrigida somente depois de reproduzir a funcao original. A comparacao diferencial adicional revelou que os registros do original usam prototipo nulo, tambem preservado agora.

## Correcoes comprovadas

- reconstruction/route-store.cjs: preserva campos posicionais em tabelas mistas e suporta chaves explicitas, delimitador ponto-e-virgula e escapes decimais observados. Rejeita lixo apos o documento, chaves duplicadas/perigosas, valores nao finitos e entradas fora do limite.
- Serializacao preserva chaves nao-identificadoras e caracteres de controle em vez de produzir Lua invalido ou transformar Infinity em zero.
- Listagem exclui diretorios e nomes reservados, inclusive wk_INDEX.lua, e ordena perfis conforme os vetores observados. Identificadores com separadores de caminho sao rejeitados.
- Carregamento mapeia loop e comboLureDelay e devolve avisos para campos sem equivalente; a fixture completa compara config e warnings com WalkerProfiles.load original.
- tests/route_store.test.cjs verifica hashes dos dois bytecodes antes de usa-los como referencia e exige igualdade estrutural, inclusive prototipos, para os vetores de parser.
- Auditoria e regressoes de Healer/Walker/kill/Revive da outra frente estao incluidas; detalhes em AUDITORIA_CONFIRMACAO_HEALER.md.

## Look, atalhos e contrato publico

Os testes existentes comparam exatamente os membros, argumentos e resultados dos preloads recuperados. A delegacao de showLook, shortcuts e rotas e testada no Controller. O build conserva os assets originais do Look e gera seu preload separado.

Isso NAO prova equivalencia integral dos handlers de main.jsc. Dimensoes/comportamento visual da janela Look, atalhos globais no cliente real e todos os detalhes de persistencia do original nao possuem cobertura diferencial integral nesta rodada. A comparacao de rotas cobre os vetores explicitados nos testes, nao a totalidade da linguagem Lua nem todos os perfis possiveis.

## Validacao consolidada executada

Comando: node tools/validate.cjs. Relatorio: validation.json.

| Etapa | Resultado real |
| --- | --- |
| build | exit 0 |
| Node | 446 testes, 438 pass, 0 fail, 8 skipped, exit 0 |
| Electron compativel | 446 testes, 446 pass, 0 fail, 0 skipped, exit 0 |
| smoke | exit 0 |
| auditoria UI em simulacao | 11 verificacoes obrigatorias aprovadas, exit 0 |

Os oito testes ignorados em Node sao executados no Electron compativel. Logs completos em validation-build.txt, validation-node.txt, validation-electron.txt, validation-smoke.txt e validation-audit.txt. Detalhes da interface em app-audit.json.

## Limites e bloqueio externo

Consulta passiva em 2026-10-28 17:16 -03:00: processos PokeAlliance_dx com PIDs 17832 e 26100. Nenhum pipe pka-runtime-2-* foi observado na enumeracao. PKA_CHANNEL_KEY e PKA_CHANNEL_KEY_FILE nao estavam configurados no ambiente desta execucao; valores de credenciais nao foram lidos nem exibidos.

O jogo aberto, sozinho, nao disponibiliza o canal exigido por reconstruction/native-adapter.cjs. Validacao no cliente depende desse canal e de credencial fornecida pelo fluxo do runtime. Esta rodada nao modifica autenticacao, injeta componentes ou envia inputs ao jogo.

app-audit.json mantem explicitamente pendentes: recuperacao real de HP, notificacao de alerta pela UI, morte do alvo pela UI, Revive pela UI e canal real. Os testes de motor para os tres cenarios intermediarios nao os convertem em verificacao ponta a ponta do jogo.
