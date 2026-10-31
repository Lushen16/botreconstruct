# TargetEngine

Classe CommonJS independente em `target-engine.cjs`, sem dependencias externas.
O pipeline em `reconstruction/automation.cjs` usa esta classe por meio do adaptador
`reconstruction/engines/target-engine.cjs`. A selecao e o lock sao do motor puro;
o adaptador preserva combo nativo, identidade do Pokemon e regras de lure.
Com `target.skills` configurado, a rotacao emite `hotkey` pelo sink do protocolo,
aceitando somente F1..F12 e impondo GCD minimo de 250 ms, inclusive entre cura e combate.
Na configuracao legada do adaptador, `target.monsters: []` significa todos os nomes;
na API pura abaixo, a lista vazia continua desativando a selecao.

Para leitura externa por arquivo, use `node tools/run_bot.cjs --pid PID --key-file
channel-key.json --config perfil.json --creatures creatures.json --dry`.
O arquivo deve ser atualizado pelo scanner; dados com mais de 1000 ms, timestamp
futuro, JSON incompleto, PID divergente ou identidade/andar inconsistentes bloqueiam
o tick e liberam o lock. O scanner nao substitui a verificacao nativa da sessao.
Na API, passe `createCreatureSource(file)` de `tools/creature_bridge.cjs` como
`options.creatureSource` em `createAutomation`; `options.creatureMaxAgeMs` ajusta o TTL.
Tambem e possivel fornecer o objeto do scanner em `snapshot.creatureSnapshot`.

```js
const TargetEngine = require('./target-engine.cjs');

const config = {
  monsters: ['Shiny Charizard', 'Dragonite', '*'],
  maxDistance: 8,
  priorityMode: 'highestPriorityList',
  globalCooldownMs: 250,
  skills: [
    { key: 'f1', name: 'Ataque principal', cooldownMs: 1000, minDistance: 0, maxDistance: 5 },
    { key: 'f2', name: 'Finalizador', cooldownMs: 2000, maxDistance: 3, onlyIfHpBelow: 30 },
  ],
};
const engine = new TargetEngine(config);

function onSnapshot(player, creatures) {
  const target = engine.selectTarget(player, creatures);
  const action = engine.getCombatAction(player);
  return { target, action, pauseWalker: engine.isFighting() };
}
```

- Instancie uma vez por sessao, nao a cada tick. Atualize a selecao antes de pedir a acao.
- O chamador decide se pausa o Walker ou persegue o alvo e executa cada acao retornada uma vez.
- `getCombatAction` reserva o cooldown ao retornar a acao; nao confirma entrega ao jogo.
- `selectTarget(player, creatures, config)` e `getCombatAction(player, config)` aceitam
  configuracao por chamada. Para overrides, passe a mesma configuracao aos dois metodos.
- Defaults: todos os nomes, distancia 8, prioridade nearest e GCD 250 ms.
- Uma lista de monstros vazia desativa a selecao. Nomes ignoram caixa e espacos externos;
  apenas `*` e curinga. Na prioridade de lista, nomes explicitos usam seu indice e os
  demais nomes usam o indice do curinga. Empates de prioridade/HP usam menor distancia;
  empates restantes preservam a ordem do scanner.
- Distancias minima/maxima sao inclusivas; filtros de HP usam comparacoes estritas, em percentuais.
- Skills sem cooldown usam 0 ms e sem alcance usam 0 ate infinito.
- O lock e liberado quando desaparece do snapshot, morre, muda de andar, sai do alcance
  ou deixa de corresponder as regras. Cooldowns permanecem ao trocar/liberar o alvo.
- Snapshots ausentes/invalidos liberam o lock; skills invalidas sao ignoradas.
- `isFighting()` representa o ultimo snapshot processado, inclusive durante cooldown.
  O chamador deve liberar o alvo com `clearTarget()` se a bridge parar de enviar dados.
- Relogio injetavel para testes: `new TargetEngine(config, { now: () => clockMs })`.

Validacao: `node --test tests/target-engine.test.cjs tests/engines.test.cjs tests/scan_creatures.test.cjs`.
