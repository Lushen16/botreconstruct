# Background e Catch integrado — 30/10/2026

## Pipeline implementado

Electron inicia a fonte read-only de Items e entrega seus snapshots a
RpmCombatRuntime. O ciclo consulta looting.captureEntries, identifica Items pelo
corpseId observado, aplica andar/distância/captureAfterCombat/captureDelay,
revalida o corpo e projeta seu tile no viewport calibrado. O helper envia a
tecla da bola e o clique somente via PostMessageW no HWND do PID selecionado.
Não há aquisição de foco, SendInput ou keybd_event nesse transporte.

Fluxo: scan_items → item-source → CaptureRuntime → captureRequest →
combat_actuator → guarda RPM → tecla → guarda RPM → clique → retorno ao Walker.
A guarda anterior ao clique reduz corridas, mas não torna RPM/input uma transação.
O stack conta todos os Things do vetor, não apenas os Items filtrados.

EngineRuntime também integra o coordenador ao transporte useWith do adapter.
Esse backend nativo é distinto de PostMessageW: somente keyboard-rpm implementa
o despacho de teclas/mouse em background. A captura intercepta decisões antes
de avançar Walker/combo; cura/revive mantêm prioridade.

## Configuração necessária

Preservados os contratos originais em ../Extracted_Source/shared/schema.js:
looting.captureEnabled, maxCaptureDist, captureAfterCombat, captureDelay e
captureEntries com corpseId, ballId e fallbackBallId. Não há IDs universais
preenchidos automaticamente. Use IDs confirmados no cliente atual.

O transporte local em local-data/keyboard-combat.json mantém viewport e bindings.
Acrescente captureHotkeys, um objeto cujas chaves são IDs decimais de bolas e
cujos valores são teclas simples realmente configuradas no jogo (F1–F12 ou
letra/dígito). A associação é declarada pelo operador: o sistema não comprovou
a semântica de actionBarSettings.action=6 e não infere essa associação.
Uma hotkey deve selecionar a bola para uso no tile, não lançar imediatamente.
Além de captureHotkeys, exige-se captureBindingVerification contendo source
igual a live-confirmation, verifiedAt (ISO), configSha256 (hash do config.otml
confirmado) e useWithActions (valores numéricos efetivamente confirmados no
cliente como uso no tile). Esse registro é uma confirmação operacional explícita,
não prova estática ou telemetria nativa, e não é criado automaticamente.
Não preencha useWithActions com 6 apenas porque esse valor aparece no arquivo:
a semântica precisa ser confirmada no jogo. Até lá o gate permanece fechado.
O runtime cruza o ID, slot e tecla atuais com esse registro; hash diferente,
modos desconhecidos e teclas compartilhadas por bolas diferentes bloqueiam.
O helper confere novamente o hash antes da tecla e antes do clique.
Ausência de mapeamento/confirmação bloqueia o despacho; nenhum perfil é alterado.

A contagem de inventário não é obtida pela fonte de chão. Quando indisponível,
usa-se a bola primária configurada sem alegar disponibilidade. Fallback depende
de itemCounts confiável no backend que o forneça; não é inferido de input ou
ausência de itens no chão. Encontrar um corpo não prova qual alvo o originou.

Electron usa local-data/live-items.json; PKA_ITEMS_FILE permite uma fonte externa
com o mesmo contrato, sem iniciar outro scanner. PKA_PYTHON seleciona o Python.
O scanner é encerrado com o provider da aplicação. tools/catch_engine.py agora
é um launcher do Electron, com --pid e --player obrigatórios; não presume morte,
não possui PID/HWND fixo e não emite movimentos artificiais de retomada.
Os scripts históricos corpse_looter.py e hunt_loop_z6.py não são chamados por
esse pipeline e não constituem o transporte background suportado aqui.

## Evidência de identidade

Executável SHA-256:
473df25c1edd23e7464ad3ba9b923a603051a8b4ae8004a95c06402f678294e6.
Perfil pka-item-d4-v1; Item vtable RVA 0x1F3FCD0, getter RVA 0x706010,
bytes 0fb781d4000000c3: leitura uint16 em Item+0xD4.
Setter RVA 0x752060 e consulta de tipo RVA 0x752D90 corroboram o campo.
Tile vtable RVA 0x1F3BF48, vetor +0x50/+0x58/+0x60, stride 16;
posição Tile+0x68 e Item+0x20. Endereços são rebased por sessão.
Valores +0x2C/+0x30 do probe legado são candidatos históricos, não IDs usados
por essa integração. A antiga atribuição +0x38 foi corrigida no relatório.

## Limites e resultado observável

Snapshots parciais, expirados, com erro, outro PID/hash/layout, jogador divergente
ou associação de Item instável não autorizam captura. Falha de RPM, timeout e
desaparecimento da criatura nunca criam um corpo. Envio parcial/incerto pausa o
runtime; não há repetição automática. O mesmo corpo aceito não é reenviado até
desaparecer do conjunto observado no modo após combate. No modo contínuo,
um corpo ainda observado volta a ser elegível após captureDelay e nova guarda;
isso não é retry de falha incerta. A restrição de um envio após combate é local,
não uma reconstrução integral da fila/histórico nativos.

success/eventsSent significam mensagens aceitas na fila do Windows, não ação
aplicada no cliente. effectVerified permanece false. Não houve nesta entrega
input real nem validação de um corpo conhecido no jogo. Permanecem pendentes
a confirmação RPM ao vivo do corpo, IDs efetivos de bolas e associação hotkey,
e a aceitação do input pelo jogo em segundo plano. PostMessage não garante
que o cliente processe input quando minimizado; não existe fallback de foco.

## Validação reproduzível

node tools/validate.cjs executa build, testes Node/Electron e smoke/audit simulados.
tests/rpm_combat_runtime.test.cjs cobre combate → corpo → bola → retomada;
tests/capture_runtime.test.cjs cobre o coordenador e o adapter;
tests/item_source.test.cjs cobre os gates de identidade/frescor;
tests/capture_binding.test.cjs cobre associação e confirmação do modo da bola;
tests/background_input_transport.test.cjs cobre Win32 simulado e envio parcial.
Esses testes não comprovam captura, background real ou efeito no servidor.
Se faltar native_capture_disasm.txt, reproduza a evidência existente com
python tools/analyze_capture_native.py (exige o dump preservado e Capstone).

## Arquivos desta implementação

- Transporte: tools/walker_input.py, tools/combat_actuator.py,
  reconstruction/walker-input-runtime.cjs, reconstruction/keyboard-combat.cjs.
- Identidade/fonte: tools/item_identity.py, tools/scan_items.py,
  reconstruction/item-source.cjs.
- Integração: reconstruction/capture-runtime.cjs, capture-input.cjs,
  capture-binding.cjs, rpm-combat-runtime.cjs, engine-runtime.cjs, automation.cjs
  e reconstruction/app/main.cjs.
- Entrada legada: tools/catch_engine.py, agora launcher sem atuador independente.
- Testes: background_input_transport, capture_runtime, capture_binding,
  item_identity, item_source, rpm_combat_runtime, walker_input_runtime e
  live_provider_access em tests/*.test.cjs; tests/fixtures/capture-client.otml
  é uma configuração exclusivamente sintética.
- Documentação: este arquivo, CATCH_ENGINE_REVERSE.md e LOOTING_ENGINE_REVERSE.md.
- Resultado reproduzível da suíte: validation.json e logs validation-*.txt.
