# Decodificacao do tile engine nativo (MapView -> Map -> Tile)

**Data:** 2026-10-27
**Alvo:** `PokeAlliance_dx.exe` PID 8456, base do modulo `0x7ff7c62b0000`, imagem `C:\Users\yago\AppData\Local\PokeAlliance Games\PokeAlliance\PokeAlliance_dx.exe`
**Metodo:** somente leitura (`OpenProcess PROCESS_QUERY_INFORMATION | PROCESS_VM_READ` + `ReadProcessMemory`). Nada foi escrito no processo.
**Ferramentas:** `tools/otclient_rtti.py`, `tools/probe_tilemap.py` (novo), `tools/find_module_xrefs.py` (novo)

---

## 1. Conclusao

O client e derivado do OTClient (RTTI: `MapView`, `Tile`, `Creature`, `Item`,
`ItemType`, `UIMinimap`, `ProtocolGame`). O grid de tiles **e acessivel**:

- `MapView` e um objeto unico, com vtable por RTTI. Ele **nao contem** o grid;
  carrega apenas o estado da camera/view (confirmado em `src/client/mapview.h`).
- O grid vive no singleton global `extern Map g_map` (`Map::m_tileBlocks[16]`),
  que e **nao-polimorfico** -> **sem RTTI**. Nao foi localizado por RTTI.
- Porem cada `Tile` e polimorfico (vtable por RTTI) e guarda `m_position`
  inline. Logo o grid e reconstruivel a partir das instancias vivas de `Tile`.

Isto contradiz a conclusao anterior ("grid nao acessivel"): a enumeracao de
posicoes funciona. O que segue **nao** resolvido pela via nativa e a
**cor/walkability por tile** (secao 4).

---

## 2. RTTI resolvido neste build

| Classe | vtable | instancias |
|---|---|---:|
| `MapView` | `0x7ff7c81f5210` | 1 |
| `Tile` | `0x7ff7c81ebf48` | 4016 |
| `Item` | `0x7ff7c81efcd0` | 4908 |
| `Creature` | `0x7ff7c81ec578` | 1 |
| `ItemType` | `0x7ff7c81f36a8` | 1 |
| `UIMinimap` | `0x7ff7c81f0560` | 1 |
| `Map` | — | **sem RTTI** (global `g_map`) |
| `Minimap` | — | **sem RTTI** (global `g_minimap`) |

`Map` e `Minimap` nao tem vtable (classes sem funcao virtual); a entrada antiga
de `KNOWN_VTABLES` que apontava `Map`/`Tile` para o mesmo endereco era um
falso-positivo e foi removida.

---

## 3. Layout verificado (este build)

`Tile` (stride `0x130` = 304 bytes):

| Offset | Campo | Verificacao |
|---:|---|---|
| `+0x00` | vtable | = `0x7ff7c81ebf48` |
| `+0x08` | auto-ponteiro | = endereco do proprio tile |
| `+0x50` | `m_things` (`std::vector<std::shared_ptr<Thing>>`) begin/end/cap | begin/end/cap coerentes; 1 elemento = ground |
| `+0x68` | `Position.x` (int32) | faixa x 3302..3340 |
| `+0x6c` | `Position.y` (int32) | faixa y 2258..2284 |
| `+0x70` | `Position.z` (int16) | valores 6..12 (andares) |

`Thing`/`Item`:

| Offset | Campo | Verificacao |
|---:|---|---|
| `+0x00` | vtable (`Item` = `0x7ff7c81efcd0`) | ok |
| `+0x20` | `m_position.x/y/z` | coincide exatamente com o tile hospedeiro |
| `+0x3c` | `1.0f` (matriz identidade) | ok |

O `m_position` do ground item e **igual** ao `m_position` do tile (mesma
posicao), confirmando a associacao tile -> ground.

Snapshot ao vivo (player `Nobutdopai`, telemetria `(3320, 2264, z9)`):
4016 tiles, janela carregada x 3302..3340 (39), y 2258..2284 (27),
andares 6..12; 4011 tiles com ground item, 5 sem.

---

## 4. Cor/walkability: o que a memoria nativa NAO da direto

`Tile::getMinimapColorByte()` devolve `m_minimapColor` (uint8, default 0) e,
se 0, cai no `getMinimapColor()` do ground item. Varredura dos 4016 tiles:

- O byte em `Tile +0x73` assume apenas 3 valores (`247` x2862, `200` x1149,
  `0` x5) -> **nao e a cor de terreno** (a paleta real teria ~25 classes).
- Nenhum byte inline do `Tile` se comporta como cor (varredura de `+0x18..+0x87`
  por instancia; os offsets de maior entropia sao fragmentos de ponteiros de heap).

Portanto a cor/walk por tile, na via nativa, exige:
1. o global `g_minimap` (`Minimap::m_tileBlocks`, sem RTTI) - nao localizado; a
   funcao que monta `"minimap.otmm"` foi localizada por xref, mas ela nao faz
   `lea` direto para o global (acesso fica em chamadas internas); ou
2. a cadeia `Item + m_clientId -> g_things (ThingTypeManager) -> ThingType`
   (`m_minimapColor` + flags `isNotWalkable`/`isNotPathable`) - tambem globais
   sem RTTI.

Nenhuma das duas foi concluida. Nao ha resultado fabricado.

---

## 5. O que E funcional para o cavebot (verificado)

A cor+walkability por tile ja existe na forma exata que o bot precisa, e **o
client a persiste sozinho**: `%APPDATA%\PokeAlliance\PokeAllianceV3\minimap854.otmm`.
O `MinimapBlock` do OTClient (fonte do arquivo) e literalmente
`MinimapTile{flags,color,speed}` por tile - ou seja, a saida do proprio tile
engine (o que `Minimap::updateTile` grava a partir de `Tile::getMinimapColorByte()`
e `isWalkable`/`isPathable`).

Verificacao ao vivo:

```
node -e "const {OtmmReader}=require('./reconstruction/otmm.cjs'); ..."
blocks 34119  floors 0..15  first {x:1760,y:2464,z:0}
getRegion(3310,2255,9,24,20) -> 480 tiles vistos; flags {1:268, 5:212}
```

O leitor (`reconstruction/otmm.cjs`) ja preserva as flags e o handler
(`reconstruction/app/main.cjs:137-149`) ja faz clamp de x/y. O caminho
`minimap854.otmm` -> `mapRegion` esta ligado e devolve `{pixels, flags}` reais.

Nota: em `minimap854.otmm`, agua (color 40) e `flags=1` (caminhavel) - ver
`REPORT_OTMM_MINIMAP.md`. Walkability de parede (`flags=5`) e confiavel.

---

## 6. Reproducao

```
python tools/otclient_rtti.py --pid 8456 --class MapView --class Tile --class Item
python tools/probe_tilemap.py --selftest
python tools/probe_tilemap.py --pid 8456 --near 3320,2264,9 --limit 12 --dump-items
python tools/probe_tilemap.py --pid 8456 --limit 5000 --dump-items --output tilemap-live.json
python tools/find_module_xrefs.py --pid 8456 --needle ".otmm"
```

---

## 7. Limites

- Offsets de membro (`Tile+0x68`, `Item+0x20`, vetor `+0x50`) sao deste build;
  re-derivar em update. As vtables sao regeneradas por RTTI a cada execucao.
- A associacao tile->ground le `m_things[0]`; tiles com mais de um thing (criatura
  em cima, itens empilhados) nao foram exercitados.
- Cor/walk nativo segue pendente (secao 4). Para o cavebot, a via OTMM cobre.
