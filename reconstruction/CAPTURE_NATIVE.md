# Capture: evidencia estatica e implementacao local (23/10/2026)

## Identidade, coordenadas e reproducao

Fonte: dumps/msftedit_text_32336.bin, 2.650.112 bytes, SHA-256
7c0fd219dc24f3fa273ded518eca8ea840d3395f00d14e78beacb4ffd7c50ea4.
Arquitetura x86-64. E um recorte de memoria, nao um PE original autenticado.
Base observada 0x7ff85c470000. RVA inicial do recorte: 0x1000.
Offset no arquivo = RVA - 0x1000; VA = base + RVA.

REA/Ghidra deste host rejeitou raw x86-64. A continuacao usa Capstone 5.0.7
somente para desmontagem estatica. Nao executa o payload, nao le memoria viva,
nao abre pipes e nao acessa credenciais. Reproducao:

    python tools/analyze_capture_native.py
    python tools/analyze_capture_native.py --start 0x4a880 --end 0x4ad58 --stem native_capture_guard
    python tools/analyze_capture_native.py --start 0x84340 --end 0x848e2 --stem native_capture_send
    python tools/capture_native_evidence.py
    node --test tests/capture_engine.test.cjs tests/capture_native.test.cjs

Os JSON/TXT native_capture*, native_capture_vm* e native_capture_distance*
preservam bytes, offset e instrucao. Sao intervalos lineares selecionados,
nao uma alegacao de CFG completo. native_capture_evidence.json agrupa 49
ancoras, tres descritores e as cadeias RTTI verificadas pelos testes.

## Ligacao de tickLoot e send

Em tickLoot, entrada candidata RVA 0xa46e0, a instrucao em 0xa56d5
(offset 0xa46d5), bytes 488d0574600400, carrega vtable 0xeb750.
O ponteiro anterior aponta para COL 0x206cb0, TypeDescriptor 0x221790,
nome em 0x2217a0 contendo lambda_2 de tickLoot@Runtime@bot@pka.
O slot 0x4e440 chama o corpo da lambda em 0x4a880: RVA 0x4e44d,
offset 0x4d44d, bytes e82ec4ffff. Isso liga o contexto
do metodo ao codigo, em vez de depender de proximidade de uma string.

Em send, entrada candidata 0x84340, 0x84522 (offset 0x83522),
bytes 488d05f76f0600, carrega vtable 0xeb520. COL 0x2067b0,
TypeDescriptor 0x220da0: lambda_1 de send@Runtime@bot@pka.
Os nomes RTTI completos, locators e slots ficam no JSON de evidencia.

## CaptureRank: ramo deterministico

tickLoot percorre telemetry.items (0xa4be2, offset 0xa3be2,
488d15cb4a0400). Nao ordena inspection nem usa a ordem de captureEntries
como criterio de desempate neste comparador. A busca e uma substituicao
sequencial do melhor candidato, depois dos filtros anteriores.

Historico interno por corpo, relativo ao ponteiro r14:
lastAttemptAt +0x0, lastSeenAt +0x8, attempts +0x10, failures +0x14.
Esses nomes sao identificadores locais inferidos dos acessos, nao novos
campos do JSON. Escritas de tempo e contadores corroboram a interpretacao.

Defina F(c) = (attempts(c) == 0 && failures(c) < 3).
A ordem lexicografica recuperada, para candidatos ja elegiveis e numeros
finitos, e:

1. F verdadeiro antes de falso.
2. Menor lastAttemptAt.
3. Menor max(abs(dx), abs(dy)): distancia Chebyshev.
4. Maior item.stack.
5. Primeiro na iteracao original, em empate completo.

| RVA | Offset | Bytes | Interpretacao |
| --- | --- | --- | --- |
| 0xa4fd1 | 0xa3fd1 | 41837e1000 | attempts == 0 |
| 0xa4fd8 | 0xa3fd8 | 41837e1403 | failures < 3 (jae exclui fresco) |
| 0xa5020 | 0xa4020 | 413ad0 | compara os indicadores F |
| 0xa5029 | 0xa4029 | f2410f1006 | carrega tempo do candidato |
| 0xa50e6 | 0xa40e6 | 660f2fc8 | compara melhor/candidato; seta prefere mais antigo |
| 0x5d1e5 | 0x5c1e5 | f20f5ffe | maxsd entre modulos de dx/dy |
| 0xa50b4 | 0xa40b4 | 488d15dd120400 | descritor de desempate 0xe6398 |
| 0xa50c2 | 0xa40c2 | e859b9fbff | interpreta o descritor em 0x60a20 |
| 0xa50f1 | 0xa40f1 | 4c897d10 | substitui o melhor; falso preserva anterior |

### Predicados codificados

Descritor 0xe6398: ponteiro para RVA 0xf60d0, comprimento 18,
seed 0x3fa81295, aridade 4. A mistura por byte esta em 0x60b3d..0x60b6b:
mixed = seed - index * 0x61c88647 (uint32);
mixed = (mixed xor (mixed >> 16)) * 0x85ebca6b (uint32);
decoded = encoded xor ((mixed >> 13) & 255) xor (mixed & 255).

Resultado: 560056028c5600560249560356018c48425c.
Argumentos comprovados em 0xa5042..0xa5092:
[candidateDistance, candidate.stack, bestDistance, best.stack].
Predicado: candidateDistance < bestDistance OR
(candidateDistance == bestDistance AND best.stack < candidate.stack).

Os opcodes binarios sao ligados pela tabela 0x61164/0x61130:
0x8c -> 0x60ca0 (comisd + seta), 0x49 -> 0x60cc8 (igualdade),
0x48 -> 0x60cd5 (AND), 0x42 -> 0x60cdf (OR), 0x01 -> 0x60cb4 (<=).
0x56 carrega argumento, 0x45 literal double e 0x5c retorna; os gates
diretos estao em 0x60b6d..0x60b87, antes dessa tabela de operacoes binarias.
O teste decifra os bytes preservados e compara 1.296 pares distancia/stack
com o comparador local; nao executa a VM nativa.

API local: compareCaptureCandidates e rankCaptureCandidates recebem
{item, distance, history}; exigem historico explicito e nao o inventam a
partir de inspection. Nao fazem filtros, aleatoriedade ou retencao do historico.

## CaptureApproach: planejamento recuperado, execucao ainda parcial

O gate recuperado em 0xa4ec0 usa descritor 0xe6368 e expressao
sameFloor && distance <= maxCaptureDist && !arg3, com arg3 zero no trecho.
Nao e uma regra universal de adjacencia <= 1. Nao foi estabelecida uma
chamada direta a Runtime::route nesse trecho. Isso nao prova ausencia de
navegacao dentro de um servico chamado indiretamente.

O fluxo comprovado e SELECIONADO -> REVALIDACAO -> PEDIDO_DE_DESPACHO
-> COOLDOWN. Os nomes sao rotulos locais, nao strings/enum do binario.
Nao ha evidencia suficiente para criar um estado APPROACHING fiel.

| RVA | Offset | Bytes | Interpretacao |
| --- | --- | --- | --- |
| 0xa54eb | 0xa44eb | 488d15be070400 | copia corpse.pos para argumentos |
| 0xa5553 | 0xa4553 | 8b05e7420400 | chave itemId recebe a ball selecionada |
| 0xa55b1 | 0xa45b1 | 488d151c070400 | le corpse.id, depois atribui targetId |
| 0xa5640 | 0xa4640 | 488d1565400400 | le corpse.stack |
| 0xa575b | 0xa475b | 488b0de6400400 | nome useWith |
| 0xa57ad | 0xa47ad | e88eebfdff | chama Runtime::send RVA 0x84340 |
| 0x845fd | 0x835fd | 498b4d78 | carrega servico de Runtime + 0x78 |
| 0x8461a | 0x8361a | ff5010 | callback std::function; binding do worker -> 0xc6360 -> 0xcfe40 (NATIVE_RUNTIME.md) |
| 0xa57c8 | 0xa47c8 | f20f1103 | registra tempo da tentativa |
| 0xa57d1 | 0xa47d1 | f20f1186f8020000 | registra proximo tempo apos somar atraso |
| 0xa57e6 | 0xa47e6 | ff4314 | incremento de falhas se send retorna falso |
| 0xa58f6 | 0xa48f6 | 41ffc6 | incremento de tentativas se send retorna verdadeiro |

Os bytes completos e os acessos seguintes estao nos artefatos, inclusive o
reset de failures em 0xa58fd. Em 0xa577e o argumento final e 300
(c74424402c010000); sua unidade/funcao nao foi provada, logo nao vira
raio, timeout ou cooldown inventado na API nova.

O objeto useWith contem copia da posicao do corpo com itemId = ball,
targetId = corpse.id, stack = corpse.stack. O encoder local ja conhece
useWith (tipo 14); nao foi criado opcode de captura. O teste conecta
somente o plano offline ao encoder existente, sem transportar o comando.

A lambda de revalidacao em 0x4a880 confirma id e stack, exige distancia XY
zero entre posicoes selecionada/atual (0x4aae0 e 0x4aae5), e compara a chave
interna gerada por 0x46d70 (0x4ab04/0x4ab41). Nao acrescentamos um teste de
andar que a lambda nao contem. Quando instance existe, a rotina a utiliza;
o fallback inclui um hash de posicao ainda nao reconstruido.

API local: prepareCaptureDispatch recebe um candidato previamente elegivel,
ballId, posicao, alcance e keyOf explicitos. revalidateCaptureTarget exige a
chave preservada do candidato e um resolvedor fornecido pelo chamador;
nenhum fallback silencioso e permitido. recordCaptureDispatchResult recebe
o atraso efetivo ja calculado, na mesma unidade do clock informado. Aceitacao
por send nao e prova de captura no servidor nem de recebimento de ACK.
O helper nao implementa o calculo nativo do atraso, jitter ou fila completa.

## Cobertura e pendencias remanescentes

CaptureRank e CaptureApproach ficam implementable no contrato LOCAL e partial
na matriz. Isso significa comparador e planejamento/revalidacao recuperados,
nao automacao completa. As APIs novas nao estao ligadas ao tick do aplicativo.
selectCaptureCandidate continua a API anterior baseada em inspection e nao
e apresentada como reproducao integral dos filtros nativos de telemetry.items.

Permanecem desconhecidos: selecao no modo aleatorio, ciclo completo dos
historicos/filas, hash de chave sem instance e atraso nativo efetivo. O destino
do binding do worker em 0x8461a foi ligado a 0xcfe40 nesta etapa; isso nao
identifica o receptor de uma sessao real. O hook final, navegacao do cliente e
resultado real no jogo ainda exigem evidencia adicional. Os testes validam
o subset finito declarado, nao equivalencia global com o modulo original.
