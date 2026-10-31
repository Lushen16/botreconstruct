# Auditoria de confirmacao e testes de combate

Data: 2026-10-28. Escopo: auditoria de interface e regressoes; nenhum input enviado ao jogo.

## Referencias consultadas diretamente

- `../Extracted_Source/shared/schema.js`: `healMoveSlot` aceita 1..100; `healResetSlot` aceita 0..50; `autoRevive.interval` representa espera apos a ultima skill e tem default 1500 ms.
- `../Extracted_Source/shared/healer.js`: `autoPlan` exige identificacao unica dos nomes de cura/retorno no roster, telemetria verificada e versoes pulse/automation compativeis.
- `../Extracted_Source/renderer/target.js`: exposicao das configuracoes de combo e Revive.

Esses contratos nao revelam toda a implementacao nativa de cura, troca, dano ou reset de cooldowns. A retencao do Walker ate confirmacao coerente e um requisito de integracao explicitamente solicitado pelo usuario; estes testes nao a apresentam como codigo nativo recuperado.

## Alteracoes desta frente

- Auditoria de cura exige `talk` com o `mN` configurado, rejeita outras skills e canais, desativa reset no cenario e reinicia a fixture depois do autosave.
- Recuperacao de HP permanece pendente: registrar uma skill aceita nao comprova cura. O simulador nao recebeu uma regra de cura inventada.
- Regressoes exercitam troca sem confirmacao durante 60 segundos, roster vazio/duplicado, nome vazio, slot incoerente e flags de troca. Confirmacao coerente libera o Walker.
- Kill usa dois ataques com relogio deterministico, verifica HP intermediario, morte e limpeza do alvo. O dano e apenas uma fixture opt-in, nao uma mecanica original comprovada.
- Revive exige a hotkey F5 correta apos os 1500 ms configurados, sem antecipacao e com criatura ainda presente. Isso verifica o despacho, nao o efeito real do item ou reset dos cooldowns.

## Validacao reproduzivel

`node --test tests/audit_contract.test.cjs tests/healer_confirmation_review.test.cjs tests/local_runtime.test.cjs`

A auditoria visual e a suite consolidada precisam ser executadas sobre um estado estavel das duas frentes. Testes dos motores nao substituem interacao pela interface nem verificacao no cliente real.
