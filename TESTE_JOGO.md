# Teste contra o cliente aberto

O preflight consulta processos, pipes e configuracao de chave sem enviar comandos
de jogo. Com --verify ele tenta o handshake e aguarda telemetria por ate 3 segundos.
Somente telemetria que passa pelo gate dos motores resulta em status verified e
exit code 0. blocked e unverified retornam 2; falha na gravacao retorna 1.
A presenca de pipe e chave por si so nao comprova funcionamento.

No PowerShell, na pasta deste projeto:

    $env:PKA_PID = 'PID_DO_CLIENTE'
    node tools/live_preflight.cjs --verify

A chave deve ser fornecida ao processo por PKA_CHANNEL_KEY ou pelo arquivo
PKA_CHANNEL_KEY_FILE no formato ja aceito por native-adapter.cjs (pid e key).
Nao coloque chaves em comandos compartilhados, relatorios ou controle de versao.
Este fluxo nao extrai credenciais de outros processos nem inicia loaders.

Para abrir a interface somente depois da verificacao nativa:

    .\PREPARAR_TESTE_JOGO.ps1 -ClientPid PID_DO_CLIENTE -PlayerName 'NOME_DO_JOGADOR'

Para inspecionar leitura RPM mesmo com canal ausente, use explicitamente
-ObserveOnly. Isso nao habilita os motores nem produz confirmacao nativa.
A interface abre com motores desligados; sua ativacao permanece manual.

Com dois clientes, PKA_PID e obrigatorio: nenhum deles e escolhido silenciosamente.
O provider recebe --pid, usa live-snapshot.json por padrao e aceita
PKA_SESSION_FILE para outro caminho. PKA_PLAYER_NAME e opcional, mas deve ser
informado para validar o nome da entidade local em vez de depender so da cadeia
de ponteiros. Nenhum nome de jogador e presumido a partir de um snapshot antigo.
O ultimo estado/erro do provider fica em local-data/live-provider-status.json.

O contrato do pipe pka-runtime-2-PID e preservado; nao foi implementado um novo
servidor dentro do cliente. Se o pipe estiver ausente, permanece pendente obter
o runtime real e sua inicializacao documentada. Um servidor de testes local nao
substitui esse componente. O preflight nao autentica pela interface original,
nao configura a chave automaticamente e nao afirma equivalencia dos efeitos
de combate com base em ACK ou testes unitarios.
