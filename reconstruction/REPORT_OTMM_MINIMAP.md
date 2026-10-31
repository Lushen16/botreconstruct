# Auditoria do leitor OTMM e do minimapa do Walker

**Data:** 2026-10-26  
**Escopo:** `RE_PKA/reconstruction/otmm.cjs`, `app/main.cjs`, `app/ui/walker.js`, `app/ui/style.css`, `shared/walker.js`  
**Mapa de referência:** `%APPDATA%/PokeAlliance/PokeAllianceV3/minimap854.otmm` (9.728.057 bytes)  
**Comparação:** OTClient `edubart/otclient` e OTClientV8 `tibia-devs/OTA-otclientv8` (`src/client/minimap.h`, `src/client/minimap.cpp`)

---

## 1. Resumo executivo

1. **O formato OTMM está corretamente implementado** no leitor: cabeçalho de 22 bytes, blocos de 64×64 tiles, zlib e sentinela. O parser é mais estrito que o do OTClient e rejeita arquivos truncados, versão inválida e blocos corrompidos.
2. **A máscara de colisão está correta para paredes, mas o nome `walkable` engana.** `flags = 5` é `WasSeen | NotWalkable` (`0b0101`), não `NotPathable`. O `WALKABLE_MASK = 0x6` rejeita paredes corretamente; porém também rejeita os raros tiles `NotPathable` sem `NotWalkable` (`flags = 3`, 18.118 tiles).
3. **Bug de correção importante:** `getRegion` zera as flags quando `color >= 216`. Isso apaga a colisão de **9.964.422 tiles vistos (29,7% do total visto)**; 9.776.001 deles são totalmente caminháveis (`flags = 1`). A UI os trata como “fora do mapa conhecido”.
4. **Água é caminhável no arquivo:** a cor 40 (`#3300CC`) tem 99,78% dos tiles com `flags = 1` (walkable + pathable). Isso é consistente com um jogo em que se pode surfar/nadar. Se o Walker não deve entrar na água, isso precisa ser uma política explícita por cor; as flags não bloqueiam.
5. **Obstáculos transitáveis** (`NotPathable` sem `NotWalkable`, `flags = 3`) existem, mas são raros: 18.118 tiles (0,05%). Para posicionamento manual, o `WALKABLE_MASK = 0x6` é conservador demais; para roteamento automático, é o comportamento desejado. A decisão precisa ser separada em `canStand` e `canRoute`.
6. **Coordenadas:** a imagem da região é desenhada em `(0,0)`, mas a região é 1 tile maior que o canvas. O marcador do jogador fica deslocado do centro em 0,5–1,5 tile (até 31 px nos casos medidos; 4 px no default 760×520 @8 com o centro testado). A correção é um offset `dx/dy` usado também no hit-test.
7. **Bordas:** qualquer viewport que cruze `x < 0` ou `x + width > 65535` lança `Regiao de mapa invalida.` — 10/10 casos de borda testados falharam. Falta clamp em `main.cjs`.
8. **Desempenho:** a `getRegion` atual leva 12,9–14,1 ms em 381×261, 65–148 ms em 951×501 e **746–813 ms / ~540 MB** em 2048×2048. A versão block-wise com typed arrays leva 0,2–3 ms e 17,6 ms no caso 2048² (até ~100× mais rápida nos casos grandes). O payload tipado é ~2,3× menor e serializa 13–22× mais rápido.
9. **O main process bloqueia:** `mapRegion` roda síncrono no handler IPC, dentro da fila serial do `Controller`, e ainda faz `fs.statSync` a cada requisição. Um fetch grande trava todos os outros canais IPC. Precisa ir para um worker.
10. **Riscos:** `MAX_OUTPUT` de 128 MB permite zip bomb; cache de 256 blocos com `clear()` causa thrash; canvas sem DPR borra em HiDPI; `pointermove` redesenha o canvas inteiro sem throttle.

---

## 2. Formato OTMM confirmado

### 2.1 Cabeçalho

| Offset | Tamanho | Campo | Valor observado |
|---:|---:|---|---|
| 0 | 4 | magic | `"OTMM"` (`0x4D4D544F` little-endian) |
| 4 | 2 | dataOffset (`start`) | 22 |
| 6 | 2 | version | 1 |
| 8 | 4 | flags | 0 (não usado) |
| 12 | 2 | tamanho da descrição | 8 |
| 14 | 8 | descrição | `"OTMM 1.0"` |

O OTClient lê `start` em 4 e faz `seek(start)` antes dos blocos. O leitor usa `headerSize` com o mesmo significado. A descrição é uma string prefixada por `u16` (não é um “signature length” independente); o código atual valida `14 + len <= headerSize`, o que aceita padding e é compatível.

### 2.2 Blocos

Cada registro, após o `dataOffset`:

| Offset | Tamanho | Campo |
|---:|---:|---|
| 0 | 2 | `x` do bloco (múltiplo de 64) |
| 2 | 2 | `y` do bloco (múltiplo de 64) |
| 4 | 1 | `z` (0–15) |
| 5 | 2 | `len` do zlib |
| 7 | `len` | dados zlib de 64×64×3 bytes |

Cada tile tem 3 bytes, na ordem:

```text
offset 0: flags  (uint8)
offset 1: color  (uint8, paleta 6×6×6)
offset 2: speed  (uint8, dezenas de ms por tile)
```

O bloco descomprimido tem sempre `64 * 64 * 3 = 12.288` bytes. A sentinela é `0xFFFF, 0xFFFF, 0xFF` (5 bytes) e não tem campo `len`. O `OTClient` grava apenas blocos com `wasSeen()`; por isso um bloco ausente significa “nunca visto” e o leitor devolve `null`/fundo.

### 2.3 Estatísticas do mapa de runtime

| Métrica | Valor |
|---|---:|
| Arquivo | 9.728.057 B (9,28 MiB) |
| Blocos | 34.119 |
| Andares | 0–15 |
| `first` (centro do 1º bloco) | (480, 2144, 0) |
| BBox dos blocos | x 0–6592, y 128–5440 |
| Tiles totais | 139.751.424 |
| Vistos | 33.581.351 (24,0%) |
| Não vistos | 106.170.073 (76,0%) |
| `flags = 8` (Empty, não visto) | 67.033.940 |
| `flags = 0` (não visto, não Empty) | 39.136.133 |
| `flags = 1` (visto, walkable + pathable) | 20.088.065 (59,8% dos vistos) |
| `flags = 5` (visto, NotWalkable) | 13.323.221 (39,7%) |
| `flags = 7` (visto, NotPathable + NotWalkable) | 151.947 |
| `flags = 3` (visto, NotPathable) | 18.118 |
| Vistos com `color = 255` | 9.964.422 (29,7%) |
| Água (`color = 40`) | 7.011.016 |
| Água com `flags = 1` | 6.995.359 (99,78%) |
| Cores distintas nos vistos | 25 (nenhuma entre 216–254) |

O andar com mais tiles vistos é o **7** (11.381.010); o andar 1 tem 4.715.889. O andar 0 tem apenas 4.702 tiles vistos (é um andar quase vazio no arquivo).

### 2.4 Compatibilidade e robustez

- O parser valida magic, versão, `headerSize`, `signatureLength`, `z>=16`, `len` e tamanho descomprimido. Testes com arquivo vazio, magic inválido, versão 2, bloco truncado, header inválido e arquivo sem blocos foram todos rejeitados com mensagens claras.
- `encodeOtmm` round-trip funciona: um bloco sintético em (64,128,0) com tile (1,40,17) volta como `flags=1`, `color=40`, RGB `51,0,204` (#3300CC).
- O filtro de “Abrir mapa” aceita `.otmm` **e** `.otm`, mas o parser só entende OTMM. Um `.otm` real falha com a mensagem genérica. Remover `.otm` do filtro ou tratar o formato separadamente.
- O `readFileSync` não tem limite de tamanho. Um arquivo enorme pode estourar a memória do main antes de qualquer validação. Adicionar um limite (por exemplo, 64 MiB) via `statSync` antes de ler.

---

## 3. Flags de colisão: o que os dados realmente dizem

### 3.1 Enum do OTClient

```cpp
enum MinimapTileFlags {
    MinimapTileWasSeen   = 1,
    MinimapTileNotPathable = 2,
    MinimapTileNotWalkable = 4,
    MinimapTileEmpty       = 8   // OTClientV8/opentibiabr; não existe no edubart master
};
```

O `Minimap::updateTile` grava:

```cpp
minimapTile.color = tile->getMinimapColorByte();
minimapTile.flags |= MinimapTileWasSeen;
if(!tile->isWalkable(true)) minimapTile.flags |= MinimapTileNotWalkable;
if(!tile->isPathable())     minimapTile.flags |= MinimapTileNotPathable;
minimapTile.speed = min(ceil(tile->getGroundSpeed() / 10.0f), 255);
// sem tile:
minimapTile.color = 255;
minimapTile.flags |= MinimapTileEmpty;
minimapTile.speed = 1;
```

### 3.2 Cuidado com a aritmética dos bits

| Flags | Binário | Composição | Significado prático |
|---:|---|---|---|
| 0 | `000` | — | nunca visto, tile existente desconhecido |
| 1 | `001` | WasSeen | visto, caminhável e roteável |
| 3 | `011` | WasSeen + NotPathable | visto, pode pisar, mas o pathfinder evita |
| 5 | `101` | WasSeen + NotWalkable | visto, **não pode pisar** (parede/montanha/obstáculo) |
| 7 | `111` | WasSeen + NotPathable + NotWalkable | visto, bloqueado e não roteável |
| 8 | `1000` | Empty | não visto e sem tile (fora do mapa) |

**`5 = 4 + 1`**: é `NotWalkable`, não `NotPathable`. A conclusão de que “40% dos tiles vistos são rejeitados indevidamente” seria falsa; eles são paredes/obstáculos e devem ser rejeitados.

### 3.3 O que o mapa contém

Por cor (top 10, tiles vistos):

| Cor | Hex | Vistos | Flags dominantes | Leitura |
|---:|---|---:|---|---|
| 86 | `#666666` | 11.607.047 | 5 (11.581.941) | montanha/parede, NotWalkable |
| 255 | — | 9.964.422 | 1 (9.776.001) | visto, sem cor de minimapa |
| 40 | `#3300CC` | 7.011.016 | 1 (6.995.359) | água, walkable + pathable (surf) |
| 129 | `#999999` | 1.261.489 | 1 (1.181.512) | piso de pedra |
| 24 | `#00CC00` | 961.076 | 1 (945.896) | grama |
| 179 | `#CCFFFF` | 630.972 | 5 (577.222) | gelo/parede, NotWalkable |
| 186 | `#FF3300` | 528.178 | 5 (469.242) | parede vermelha, NotWalkable |
| 121 | `#996633` | 405.310 | 1 (401.252) | terra |
| 12 | `#006600` | 355.956 | 5 (340.250) | árvore/obstáculo |
| 207 | `#FFCC99` | 275.073 | 1 (272.797) | areia/estrada |

Um render da floor 7 confirma visualmente: a água (azul) não aparece na máscara de colisão; as montanhas/casas/paredes (cinza/vermelho) aparecem maciçamente como `NotWalkable`.

### 3.4 O bug das flags apagadas

`getRegion` faz:

```js
if (!tile || !tile.seen || tile.color >= 216) {
  // fundo
  flags[index] = 0;
  continue;
}
flags[index] = tile.flags;
```

Consequência: **todo tile visto com `color >= 216` perde as flags**, mesmo que seja caminhável. Isso afeta 9.964.422 tiles (29,7% dos vistos), sendo 9.776.001 com `flags = 1`.

Distribuição exata do que a UI `W()` aceita/rejeita hoje:

| Categoria | Tiles | % dos vistos | Comportamento atual |
|---|---:|---:|---|
| `flags = 1` com cor < 216 | 10.312.064 | 30,7% | aceito |
| `flags = 3` com cor < 216 (NotPathable) | 18.066 | 0,05% | rejeitado pela máscara 0x6 |
| `flags = 5` com cor < 216 (NotWalkable) | 13.167.665 | 39,2% | rejeitado corretamente |
| `flags = 7` com cor < 216 | 119.134 | 0,35% | rejeitado corretamente |
| visto com `color >= 216` (flags zeradas) | 9.964.422 | 29,7% | rejeitado como “fora do mapa conhecido” |
| Total visto | 33.581.351 | 100% | aceita 30,7% |

Dentro dos 9.964.422 com cor 255: 9.776.001 são `flags = 1` (caminháveis), 155.556 são `flags = 5`, 32.813 são `flags = 7` e 52 são `flags = 3`.

### 3.5 Correção recomendada

Separar os conceitos e preservar as flags:

```js
const SEEN = 1, NOT_PATHABLE = 2, NOT_WALKABLE = 4, EMPTY = 8;

// Pode ficar em pé / receber waypoint?
const canStand = f => (f & SEEN) !== 0 && (f & (NOT_WALKABLE | EMPTY)) === 0;

// O pathfinder pode atravessar?
const canRoute = f => canStand(f) && (f & NOT_PATHABLE) === 0;

// Água é uma classificação visual; no arquivo ela é walkable.
const isWater = color => color === 40;
```

No `getRegion`, preservar `flags` mesmo quando a cor for 216–255 (o pixel continua sendo o fundo):

```js
flags[dst] = f;                 // sempre
if (f & 1) px32[dst] = LUT[color]; // só pinta se visto
```

**Cuidado:** ao preservar as flags, a UI atual passaria a aceitar `flags = 8` (Empty), porque `8 & 6 === 0`. A atualização da UI é obrigatória junto com a do leitor:

```js
// antes
const a = g.flags[...];
if (!a) throw Error('Waypoint fora do mapa conhecido.');
if (6 & a) throw Error('Waypoint bloqueado no mapa (parede ou água).');

// depois
const a = g.flags[...];
if (!(a & 1)) throw Error('Waypoint fora do mapa conhecido.');
if (!canStand(a)) throw Error('Waypoint bloqueado (parede, vazio ou água bloqueada).');
if (!canRoute(a)) warn('Tile transitável, mas o pathfinder evita; a rota pode não ser automática.');
```

Recomendação de produto:

- **Waypoint manual:** usar `canStand` (aceita `flags = 3`, bloqueia 5/7/8/0).
- **Rota automática:** usar `canRoute` (rejeita 3/5/7/8/0).
- **Água:** se o jogo permite surf, manter como está e corrigir o texto do erro (não é “água” que bloqueia; é `NotWalkable`). Se não permite, adicionar uma política explícita `blockWater` por cor 40, ciente de que 99,78% da água seria bloqueada.
- **Empty:** incluir sempre `EMPTY` nas duas máscaras.

Contagens com a regra nova: `canStand` = 20.106.183 (59,9% dos vistos; +9.776.053 sem cor e +18.118 `NotPathable`), `canRoute` = 20.088.065 (59,8%). A UI atual aceita 10.312.064 (30,7%).

### 3.6 `speed`

O byte `speed` é `ceil(groundSpeed / 10)`; o OTClient expõe `speed * 10` ms por tile. Exemplos no mapa:

| Cor | `speed` dominante | Custo aproximado |
|---:|---:|---:|
| 86 (montanha) | 15 | 150 ms/tile |
| 40 (água) | 17 | 170 ms/tile |
| 255 (sem cor) | 10 | 100 ms/tile |
| 41 (`#3300FF`) | 50 | 500 ms/tile |
| 215 (`#FFFFFF`) | 22 | 220 ms/tile |

Hoje o campo é lido mas não usado. Ele pode alimentar o custo da rota (A*/Dijkstra) e a estimativa de tempo do Walker. Não usar para colisão.

### 3.7 Paleta

`paletteRgb` implementa o cubo 6×6×6 e coincide com `Color::from8bit` para 0–215. Para 216–255 o OTClient devolve preto, mas o bloco só desenha `c != 255`; 255 é transparente. O leitor devolve `BACKGROUND` (#1A2028) para todos `>= 216`. Nos dados só existe 255; o impacto visual é nulo. Se quiser exatidão: 216–254 → preto, 255 → fundo. `color = 40` → `#3300CC`, confirmado.

---

## 4. Coordenadas, viewport e centralização

### 4.1 Fórmula atual

`shared/walker.js` e `walker.js`:

```js
viewport(center, canvasW, canvasH, scale) {
  return {
    x: Math.floor(center.x - canvasW / scale / 2),
    y: Math.floor(center.y - canvasH / scale / 2),
    z: center.z,
    width:  Math.ceil(canvasW / scale) + 1,
    height: Math.ceil(canvasH / scale) + 1
  };
}
```

A região tem `width * scale` pixels, que é **maior** que o canvas em `scale..2*scale-1` pixels (1 tile extra). O desenho atual faz:

```js
ctx.drawImage(minimap, 0, 0, minimap.width * g.scale, minimap.height * g.scale);
```

e o marcador usa:

```js
const a = p => ({ x: (p.x - g.x + 0.5) * g.scale, y: (p.y - g.y + 0.5) * g.scale });
```

Como a imagem é maior e começa em `(0,0)`, o centro do tile central cai em `(cw/2 + δ, ch/2 + δ)`, com `δ` entre ~`scale/2` e ~`1,5*scale`. Medições:

| Canvas | Scale | Offset atual | Offset com correção |
|---|---:|---:|---:|
| 760×520 | 8 | 4 px | 0 px |
| 760×520 | 2 | 1 px | 0 px |
| 160×180 | 24 | 28 px | 0 px |
| 1900×1000 | 8 | 4 px | 0 px |

O pior caso medido foi 31 px; o limite teórico é 1,5 tile (12 px no default `scale=8`). O mesmo erro afeta o hit-test `X()`:

```js
X(e) { return { x: g.x + Math.floor(e.x / g.scale), ... }; }
```

### 4.2 Correção

Calcular o offset de desenho e usá-lo em **todas** as transformações:

```js
const dx = f.width  / 2 - (center.x - g.x + 0.5) * g.scale;
const dy = f.height / 2 - (center.y - g.y + 0.5) * g.scale;

ctx.drawImage(minimap, dx, dy, minimap.width * g.scale, minimap.height * g.scale);

const a = p => ({
  x: (p.x - g.x + 0.5) * g.scale + dx,
  y: (p.y - g.y + 0.5) * g.scale + dy
});

const X = e => ({
  x: g.x + Math.floor((e.x - dx) / g.scale),
  y: g.y + Math.floor((e.y - dy) / g.scale),
  z: g.z
});
```

O `dx/dy` deve ser recalculado a cada `Y()` (ou armazenado em `g` quando a região chega). Com a fórmula exata, o erro de centralização é **0 px** e o round-trip `tile -> pixel -> tile` tem **0 falhas** para escalas 2–24 e canvases 160–3840.

Observação: durante um pan, `p.center` pode estar fora da região `g`; usar `p.center` na fórmula faz a imagem antiga deslizar junto com o cursor, o que é o comportamento desejado até a nova região chegar.

### 4.3 Bordas

O handler faz clamp de `width/height` (1–2048), mas não de `x/y`:

```js
const x = viewport && Number.isInteger(viewport.x) ? viewport.x : ...
const y = ...
if (!map) throw ...
return map.getRegion(x, y, z, width, height);
```

`getRegion` rejeita `x < 0`, `y < 0`, `x + width > 65535`, `y + height > 65535`. Testes com centros em (0,0), (10,10), (60,3000) e (65534,65534) em escalas 2/8/24 falharam **10/10**. Isso acontece ao andar perto da borda do mapa, ao abrir um mapa customizado pequeno ou ao redimensionar a janela.

Correção no main, antes de chamar `getRegion`:

```js
const clamp = (v, span) => Math.max(0, Math.min(v, 65535 - span));
x = clamp(x, width);
y = clamp(y, height);
```

O retorno já ecoa `x/y`; a UI usa `g.x/g.y`, então o clamp é transparente. Idealmente, `mapInfo` também devolve os limites reais do índice (min/max de bloco) e a UI limita o pan a esses limites, evitando deslizar para o vazio.

---

## 5. Desempenho e arquitetura

### 5.1 Caminho quente atual

`getRegion` percorre tile a tile e, para cada um:

1. Chama `this.tile({x, y, z})`, que monta a chave de string `x + ',' + y + ',' + z` e consulta `Map` (mesmo com `_lastBlock`, a string é criada).
2. Chama `paletteRgb(color)`, que aloca um array de 4 números por pixel.
3. Escreve em `Uint8ClampedArray` e `Uint8Array`.
4. No final, `Array.from(pixels)` e `Array.from(flags)` criam arrays comuns e duplicam a memória.

O `Array.from` é o que transforma 0,2 ms de cópia em ~1 ms de alocação, e o `paletteRgb` é o que domina o custo por pixel. Em uma região de 381×261 são ~100 mil arrays de 4 elementos e ~100 mil strings.

### 5.2 Benchmarks

Mediana de 15 execuções, cache quente, Node no Windows, três centros (3000,4000 esparso; 1000,2500; 500,2200 denso):

| Viewport | Tiles | Atual | Block-wise + typed | Ganho |
|---|---:|---:|---:|---:|
| 760×520 @8 | 96×66 | 0,77–0,82 ms | 0,02–0,23 ms | 3,5–37× |
| 760×520 @4 | 191×131 | 3,19–3,48 ms | 0,07–0,08 ms | 42–52× |
| 760×520 @2 | 381×261 | 12,9–14,1 ms | 0,21–0,54 ms | 26–63× |
| 1900×1000 @2 | 951×501 | 65,1–147,5 ms | 0,68–2,68 ms | 48–104× |
| 2048×2048 | 4,19 M | 746–813 ms | 17,6 ms | ~42× |

O caso 2048×2048 aloca ~16 MB de pixels + 4 MB de flags e sobe o RSS para ~540 MB no caminho atual; no block-wise, ~20 MB de payload. O handler permite 2048×2048, então esse caso é alcançável por uma janela grande em scale 1 ou por uma chamada maliciosa.

### 5.3 Payload IPC

`v8.serialize` isolado (sem contar o `getRegion`):

| Região | Arrays comuns (serializado) | Serialize | Typed arrays (bytes) | Serialize |
|---|---:|---:|---:|---:|
| 381×261 | 1.099 KB | 2,94 ms | 486 KB | 0,22 ms |
| 951×501 | 5.177 KB | 13,73 ms | 2.326 KB | 0,71 ms |
| 2048×2048 | 47,9 MB | 131,7 ms | 20,0 MB | 5,92 ms |

O `v8.serialize` é um proxy do custo de structured clone do Electron. A conclusão não muda: arrays comuns de 4 milhões de números são caros; `Uint8ClampedArray`/`Uint8Array` são binários, ~2,3× menores e 13–22× mais rápidos de serializar.

### 5.4 Custo de parse

`new OtmmReader(file)`:

- `readFileSync`: 2,9 ms (9,28 MiB)
- Parse do índice: ~16,4 ms no total
- 34.119 blocos, RSS ~72–82 MB no processo de teste (o buffer de 9,3 MB + índice de strings + overhead do Node)

Isso é aceitável no startup, mas não deve rodar a cada requisição. O `loadDefaultMap` atual faz `fs.statSync` em **toda** chamada de `mapRegion`, mesmo com mapa customizado (linha 86 antes do early return). Cachear o `stat` (TTL de 5 s ou `fs.watch`) elimina isso.

### 5.5 Main process e fila IPC

`Controller.invoke` serializa **todos** os handlers:

```js
const operation = this.pending.then(() => handler(...args));
this.pending = operation.catch(() => {});
```

Um `mapRegion` de 140 ms atrasa autosave, snapshots e qualquer outro canal. Combinado com o handler síncrono, o main process fica bloqueado. Mesmo com a versão rápida (3 ms), o ideal é tirar o decode do main.

### 5.6 Cache

```js
if (this.cache.size >= 256) this.cache.clear();
this.cache.set(key, block);
```

Uma região 2048×2048 toca 1.024 blocos; o cache de 256 limpa várias vezes e termina com 118 blocos (medido). Um pan seguinte re-descomprime tudo. Com 34.119 blocos e 12.288 B por bloco, um LRU de 1.024 blocos custa ~12 MB e cobre uma viewport 4K em scale 2 (31×17 = 527 blocos). Recomendação: LRU de 1.024–2.048 blocos, ou limite por bytes (32 MB), sem `clear()` total.

### 5.7 Zip bomb e limites

`MAX_OUTPUT = 128 * 1024 * 1024` permite que um bloco comprimido pequeno descomprima até 128 MB (o teto) antes de o tamanho ser rejeitado. O correto é:

```js
zlib.inflateSync(data, { maxOutputLength: BLOCK_BYTES })
```

Teste: os 34.119 blocos reais descomprimem com `maxOutputLength = 12.288` sem erro; um bloco de 1 MB de zeros é interrompido com `ERR_BUFFER_TOO_LARGE` antes de alocar. Também adicionar limite de tamanho do arquivo (64 MiB) e de região (2048×2048, já existe).

### 5.8 Implementação block-wise recomendada

```js
const BG32 = (255 << 24) | (BACKGROUND[2] << 16) | (BACKGROUND[1] << 8) | BACKGROUND[0];
const LUT = new Uint32Array(256);
for (let c = 0; c < 256; c++) {
  if (c >= 216) { LUT[c] = BG32; continue; }
  const r = Math.floor(c / 36) * 51;
  const g = Math.floor((c % 36) / 6) * 51;
  const b = (c % 6) * 51;
  LUT[c] = (255 << 24) | (b << 16) | (g << 8) | r;
}

getRegion(x, y, z, width, height) {
  // validações e clamp...
  const pixels = new Uint8ClampedArray(width * height * 4);
  const px32 = new Uint32Array(pixels.buffer);
  const flags = new Uint8Array(width * height);
  px32.fill(BG32);

  const bx0 = x - (x % BLOCK_SIZE), by0 = y - (y % BLOCK_SIZE);
  const bx1 = x + width - 1, by1 = y + height - 1;

  for (let by = by0; by <= by1; by += BLOCK_SIZE) {
    for (let bx = bx0; bx <= bx1; bx += BLOCK_SIZE) {
      const block = this.getBlock(bx, by, z);
      if (!block) continue;
      const lx0 = Math.max(x, bx), lx1 = Math.min(x + width - 1, bx + BLOCK_SIZE - 1);
      const ly0 = Math.max(y, by), ly1 = Math.min(y + height - 1, by + BLOCK_SIZE - 1);
      for (let ty = ly0; ty <= ly1; ty++) {
        const sy = ty - by, dy = ty - y;
        let src = (sy * BLOCK_SIZE + (lx0 - bx)) * 3;
        let dst = dy * width + (lx0 - x);
        for (let tx = lx0; tx <= lx1; tx++, src += 3, dst++) {
          const f = block[src];
          flags[dst] = f;                 // preserva 8/0/3/5/7
          if (f & 1) px32[dst] = LUT[block[src + 1]];
        }
      }
    }
  }
  return { x, y, z, width, height, pixels, flags };
}
```

Validação diferencial: 200 regiões aleatórias (tamanhos 1–400×1–300, andares 0–15), comparando pixel a pixel e flag a flag com a implementação atual: **0 diferenças**. Para isolar a mudança de performance, o protótipo desse teste aplicou a mesma regra antiga de flags (`color >= 216 -> 0`); a preservação de flags é uma mudança de comportamento deliberada, coberta por T06.

### 5.9 IPC e worker

Contrato novo:

```js
// main -> renderer
{
  x, y, z, width, height,
  pixels: Uint8ClampedArray,  // width*height*4
  flags: Uint8Array           // width*height
}
```

No renderer:

```js
const image = new ImageData(
  pixels instanceof Uint8ClampedArray
    ? pixels
    : new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.byteLength),
  width, height
);
```

Sem `Array.from`, sem segundo `Uint8ClampedArray` desnecessário.

Arquitetura:

1. **Worker:** `utilityProcess.fork` (isolamento) ou `worker_threads.Worker` (simplicidade) no main. O worker carrega o `OtmmReader`, guarda o mapa e responde a `{id, x, y, z, width, height}` com `ArrayBuffer`s transferidos.
2. **Handler assíncrono:** `ipcMain.handle('pka:mapRegion', ...)` retorna uma Promise. O handler não pode ficar na fila serial do `Controller`; isente `mapInfo`/`mapRegion` da fila ou use um `ipcMain.handle` dedicado com a mesma checagem de origem.
3. **Coalescência:** a UI já tem `w/h` (single-in-flight); o worker pode descartar requisições com `id` antigo.
4. **Troca de mapa:** `openMap`/`resetMap` enviam `{type:'load', file}` ao worker; o main recebe `info` e atualiza o estado. Em erro, mantém o mapa anterior.
5. **Zero-copy opcional:** `MessageChannelMain` entre worker e renderer via preload; para 0,5–2,4 MB por fetch, a cópia do `ipcMain.handle` já é aceitável.

### 5.10 UI: redraw, pan e DPR

- **`pointermove` sem throttle:** cada evento chama `Y()` (redesenha canvas + rota + waypoints) e `Q()` (DOM). Em rotas grandes, isso pode custar 10–30 ms por evento. Agende `Y()`/`Q()` em `requestAnimationFrame` e só redesenhe quando o tile sob o mouse mudar.
- **`wheel`:** cada evento chama `ee()` → `J()` (fetch) + `Q()`. Faça o zoom visual imediato com a imagem atual (escalada) e agende um único fetch no próximo frame/50 ms.
- **Canvas novo por fetch:** `J()` faz `document.createElement('canvas')` a cada resposta. Reutilize um canvas (`m`), redimensionando apenas quando necessário.
- **Branco durante o fetch:** `f.width = a` limpa o canvas antes do `await`; a tela fica vazia por 15–140 ms. Desenhe a imagem antiga (e `Y()`) imediatamente, depois substitua quando a nova chegar.
- **Pan:** hoje a imagem antiga fica em `(0,0)` até a resposta; o mapa não acompanha o cursor. Desenhe-a com o delta do arrasto e faça o fetch com debounce/histerese.
- **Margem/histerese:** busque uma região com 2–4 tiles de margem e só refaça o fetch quando o centro sair dessa margem. Em follow, isso reduz de 1 fetch por passo para 1 a cada 2–4 passos.
- **DPR:** o canvas tem bitmap = `clientWidth/clientHeight` CSS. Em DPR 2, o navegador amplia 2× com bilinear → borrado. Correção:

```js
const dpr = window.devicePixelRatio || 1;
const cw = Math.max(160, Math.floor(f.clientWidth));
const ch = Math.max(160, Math.floor(f.clientHeight));
if (f.width !== Math.round(cw * dpr) || f.height !== Math.round(ch * dpr)) {
  f.width = Math.round(cw * dpr);
  f.height = Math.round(ch * dpr);
}
const ctx = f.getContext('2d');
ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
```

A viewport continua em pixels CSS (`cw/ch`), então o payload não aumenta. O mapa é ampliado por nearest-neighbor (`imageSmoothingEnabled = false`) e o texto/marcadores ficam nítidos na resolução do dispositivo. Alternativa de uma linha: `image-rendering: pixelated` no `.walker-map-canvas`; resolve o mapa, mas deixa texto/marcadores blocky em HiDPI.

Importante: no `J()` atual, `a`/`o` são largura/altura CSS e `f.width = a` usa pixels CSS. Com DPR, separe `cssW/cssH` (para `viewport()`) de `f.width = round(cssW*dpr)` / `f.height = round(cssH*dpr)`. Reaplique `setTransform(dpr,...)` após qualquer mudança de `width/height`, porque isso reseta o contexto.

---

## 6. Recomendações priorizadas

### P0 — correção e robustez

1. **Preservar flags no `getRegion`** e atualizar `W()` para `canStand`/`canRoute` com `EMPTY` (senão Empty passa).
2. **Clamp de `x/y`** no handler (`0 .. 65535 - width/height`) e, idealmente, limites do mapa no `mapInfo`.
3. **Block-wise + typed arrays + LUT** no `getRegion`; remover `Array.from` e `paletteRgb` por pixel.
4. **`maxOutputLength: BLOCK_BYTES`** e limite de tamanho de arquivo.
5. **Cache LRU de 1.024+ blocos** (ou por bytes), sem `clear()` total.
6. **Mover o decode para worker** e tirar `mapRegion` da fila serial do `Controller`.

### P1 — experiência e custo

7. **Offset `dx/dy`** no desenho, marcador, rota, hover e hit-test.
8. **rAF throttle** em `pointermove`/`Y()`/`Q()`; debounce do wheel.
9. **Reutilizar canvas** e desenhar a imagem antiga durante o fetch.
10. **Margem/histerese** no follow e pan.
11. **DPR-aware canvas** (ou `image-rendering: pixelated` como paliativo).
12. **Cache de `stat`** no `loadDefaultMap`.
13. **Política de água** explícita e texto de erro correto.

### P2 — evolução

14. **Dirty rects/strips** no pan (só buscar a borda nova).
15. **Atlas de blocos** ou cache de região composta, se o worker ainda não bastar.
16. **`speed` no custo da rota** e estimativa de tempo.
17. **Testes determinísticos no CI** (fixtures OTMM pequenas + fuzz diferencial).

---

## 7. Testes de validação

### 7.1 Matriz

| ID | Teste | Como | Esperado | Estado atual |
|---|---|---|---|---|
| T01 | Cabeçalho/versão/assinatura | mutar bytes e construir | rejeitar com erro claro | PASS |
| T02 | Bloco truncado / sem blocos | mutar `len`/remover blocos | rejeitar | PASS |
| T03 | Zip bomb | bloco deflate de 1 MB | rejeitar antes de alocar >12 KB | FAIL atual; PASS com `BLOCK_BYTES` |
| T04 | Paleta | LUT 0–255 vs `Color::from8bit` | idêntica | PASS; 40 = `#3300CC` |
| T05 | Matriz de flags | tiles sintéticos 0/1/3/5/7/8/9 | `canStand`/`canRoute` corretos | a implementar |
| T06 | Flags preservadas | `color=255`, `flags=1` | `flags & 1` = 1; pixel = fundo | FAIL atual (flags=0) |
| T07 | Diferencial | 200 regiões aleatórias | 0 diffs pixel/flag | PASS (0 diffs) |
| T08 | Round-trip de coordenadas | escalas 2–24, canvas 160–3840 | 0 falhas | PASS (com ou sem `dx/dy`; o offset corrige o centro, não o round-trip) |
| T09 | Centralização | mesma matriz | erro 0 px | PASS com `dx/dy`; hoje até 31 px |
| T10 | Bordas | centros 0/10/65534, 3 escalas | não lançar | FAIL atual (10/10 lançam) |
| T11 | Cache | região 2048² | ≥512 blocos retidos | FAIL atual (118) |
| T12 | Performance | tabela 5.2 | 381×261 < 3 ms; 951×501 < 10 ms | FAIL atual; PASS block-wise |
| T13 | Payload | `v8.serialize` | 381×261 < 512 KB / < 0,5 ms | FAIL atual (1.099 KB / 2,9 ms); PASS typed (486 KB / 0,22 ms) |
| T14 | Soak | 60 s pan/follow | RSS estável, sem long task | a implementar |
| T15 | Colisão na UI | clicar em 1/3/5/7/8/0 | aceitar/rejeitar conforme política | a implementar |
| T16 | DPR | screenshot 2× | texto/mapa nítidos | a implementar |

### 7.2 Critérios de aceite

- Nenhuma chamada de `mapRegion` válida (1 ≤ w,h ≤ 2048; coordenadas dentro de 0–65535) lança exceção; regiões na borda são clampadas.
- `getRegion` 381×261 ≤ 3 ms no worker; 951×501 ≤ 10 ms; 2048² ≤ 30 ms.
- Main thread: p95 de trabalho por requisição ≤ 4 ms (idealmente ~0, com worker).
- Payload 381×261 ≤ 512 KB; sem `Array.from`; sem arrays comuns de pixels.
- `flags` preservadas para todo tile visto; `canStand` aceita `flags=1` com cor 255 e `flags=3` (com aviso), rejeita 5/7/8/0.
- Centro do jogador no pixel central do canvas (erro 0) e hit-test inverso com 0 falhas.
- 60 s de pan/follow: RSS delta < 50 MB, sem long tasks > 50 ms, cache limitado.
- Zip bomb rejeitada sem alocar > 12 KB; arquivo > 64 MiB rejeitado.

### 7.3 Comandos usados nesta auditoria

Os scripts estão em `C:\Users\yago\.t3\scratch\2026-10-23-council-v2-5-spectral-https-34d2fcd4`:

```powershell
node --max-old-space-size=4096 validate-otmm.cjs "C:\Users\yago\AppData\Roaming\PokeAlliance\PokeAllianceV3\minimap854.otmm"
node --max-old-space-size=2048 bench-stable.cjs "C:\Users\yago\AppData\Roaming\PokeAlliance\PokeAllianceV3\minimap854.otmm"
node --max-old-space-size=2048 bench-final.cjs "C:\Users\yago\AppData\Roaming\PokeAlliance\PokeAllianceV3\minimap854.otmm"
node test-parser.cjs
node test-bomb.cjs "C:\Users\yago\AppData\Roaming\PokeAlliance\PokeAllianceV3\minimap854.otmm"
node check-offset.cjs
node analyze-w-predicate.cjs "C:\Users\yago\AppData\Roaming\PokeAlliance\PokeAllianceV3\minimap854.otmm"
```

Resultados observados:

```text
A differential 200 random regions: PASS
B palette LUT vs Color::from8bit: PASS
C center offset current max 31.0 px; with draw offset max 0.0 px
D edge viewports rejected: 10
E blocks touched by 2048x2048: 1024; cache size after: 118 (cap 256)
F seen flag samples: [1, 2115], [5, 1658], [7, 10]
inflate all with maxOutputLength=BLOCK_BYTES: 34119 blocks, bad 0
bomb stopped: ERR_BUFFER_TOO_LARGE
```

> Observação: o diferencial do `validate-otmm.cjs` usa a mesma regra antiga de flags nos dois lados para isolar a mudança de performance. A regra nova (`flags` preservadas) é coberta por T05/T06 e pelos fixtures `colorless.otmm`/`empty.otmm`/`notpath.otmm`.

### 7.4 Fixtures recomendadas

- `valid-min.otmm`: 1 bloco 64×64, 1 tile visto, sentinela.
- `valid-two-floors.otmm`: 2 blocos, andares 0 e 15, tiles nas bordas do bloco.
- `truncated.otmm`, `bad-magic.otmm`, `version2.otmm`, `no-blocks.otmm`, `bomb.otmm`.
- `edge.otmm`: bloco em (0,0) e bloco em (65408,65408), para testar clamp.
- `colorless.otmm`: `flags=1, color=255`; `empty.otmm`: `flags=8, color=255`; `notpath.otmm`: `flags=3`.
- `palette.otmm`: um tile para cada cor 0–215 e 255.

---

## 8. Decisões pendentes

1. **Água:** o arquivo diz que 99,78% da água é caminhável. O jogo permite surf/nadar? Se sim, manter e corrigir o texto “parede ou água”. Se não, adicionar `blockWater` por cor 40 (bloqueia 99,78% da água) e documentar.
2. **`flags = 3` (NotPathable):** waypoint manual deve ser permitido? Recomendação: permitir com aviso; rota automática rejeita.
3. **Visto sem cor (`color = 255`):** mostrar como fundo (como o OTClient) mas manter as flags e permitir waypoint; ou desenhar um padrão sutil para diferenciar de “nunca visto”. A primeira opção é mais simples e fiel ao cliente.
4. **Limite do mapa:** limitar o pan ao bbox do índice ou permitir 0–65535? Recomendação: bbox + margem, para não mostrar um vazio infinito.

---

## 9. Arquivos e linhas de referência

- `RE_PKA/reconstruction/otmm.cjs`
  - `:15` `WALKABLE_MASK = 0x6`
  - `:35` `readFileSync` sem limite
  - `:79–103` `getBlock`, cache e `maxOutputLength`
  - `:91–93` `MAX_OUTPUT = 128 MB`
  - `:98` `cache.clear()`
  - `:105–120` `tile()` e `walkable`
  - `:122–151` `getRegion` e `Array.from`
  - `:135` reset de flags para `color >= 216`
- `RE_PKA/reconstruction/app/main.cjs`
  - `:20` `defaultMapFile`
  - `:77–83` `mapStat()` / `statSync`
  - `:85–104` `loadDefaultMap`
  - `:144–154` handler `mapRegion` (clamp de width/height, sem clamp de x/y)
  - `:153` `map.getRegion(...)` síncrono
- `RE_PKA/reconstruction/controller.cjs`
  - `:113–120` fila serial `invoke`
- `RE_PKA/reconstruction/app/ui/walker.js`
  - linha 1 (minificado): `viewport`, `J()` (fetch), `Y()` (render), `X()` (hit-test), `W()` (validação), `Z()`/`ee()` (pan/zoom), `update()`
- `RE_PKA/reconstruction/shared/walker.js`
  - linha 1: `viewport(center, cw, ch, scale)`
- `RE_PKA/reconstruction/app/ui/style.css`
  - `:300` `.walker-map-canvas` (sem `image-rendering`)
- `RE_PKA/reconstruction/app/preload.cjs`
  - `:18–19` `mapRegion: 1`

---

## 10. Fontes

- OTClientV8: `https://raw.githubusercontent.com/tibia-devs/OTA-otclientv8/master/src/client/minimap.h`
- OTClientV8: `https://raw.githubusercontent.com/tibia-devs/OTA-otclientv8/master/src/client/minimap.cpp`
- OTClient (edubart): `https://raw.githubusercontent.com/edubart/otclient/master/src/client/minimap.h`
- OTClient (edubart): `https://raw.githubusercontent.com/edubart/otclient/master/src/client/minimap.cpp`
- OpenTibiaBR: `https://raw.githubusercontent.com/opentibiabr/otclient/main/src/client/minimap.h`
- OTClient `Tile::isWalkable`/`isPathable`: `https://raw.githubusercontent.com/tibia-devs/OTA-otclientv8/master/src/client/tile.cpp` (linhas 684–710)







