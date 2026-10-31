# Native runtime: dispatch, navigation and randomization

## Scope and reproduction

Static-only observation of dumps/msftedit_text_32336.bin, SHA-256
7c0fd219dc24f3fa273ded518eca8ea840d3395f00d14e78beacb4ffd7c50ea4.
No process, pipe, credential, native execution or binary patch was used.
Base VA = 0x7ff85c470000; file offset = RVA - 0x1000.

Run python tools/native_runtime_evidence.py and
node --test tests/native_runtime.test.cjs. native_runtime_evidence.json retains
91 exact instruction anchors, 34 selected disassembly blocks, RTTI and import
linkage; native_runtime_disasm.txt retains the readable assembly. The source
hash is checked before extraction. Neither linear disassembly nor the observed
runtime-function-table rows is a complete recovered CFG. The table is found
from bytes in the payload, not from the stomped msftedit PE header.

## 1. Two different calls, not one

The quoted snippet used file offsets as though they were RVAs. At actual
RVA 0x8461a the bytes are ff5010, not e83e180500. The latter call occurs at
file offset 0x84633 / RVA 0x85633. This distinction changes both destinations.

| RVA | Bytes | Observation |
| --- | --- | --- |
| 0x845fd | 498b4d78 | rcx = [r13 + 0x78], callback implementation pointer |
| 0x8460a | 488b01 | rax = [rcx], callback vtable |
| 0x8461a | ff5010 | call [rax + 0x10], third vtable slot |
| 0x8562c | 488d1515160600 | rdx = RVA 0xe6c48, creatureType |
| 0x85633 | e83e180500 | call 0xd6e76 = 0x85638 + 0x5183e |
| 0xd6e76 | ff25bcb50000 | jump through IAT slot 0xe2438 |

The import descriptor at RVA 0x21bdd0 contains INT 0x21c2a8, DLL-name RVA
0x21d048 (VCRUNTIME140.dll), and IAT 0xe2410. Entry 5 at INT RVA 0x21c2d0
contains hint/name RVA 0x21cfba, whose name at +2 is memcmp. Thus the exact
slot is 0xe2410 + 5*8 = 0xe2438. Its recorded pointer is 0x7ff88218f010;
no external memory was dereferenced. The compare inputs are rcx = string
storage (SSO checked at 0x85618), rdx = creatureType, r8 = min(string length,
r12). eax is tested at 0x85638. This is a string comparison, not virtual route
dispatch. The user's unadjusted 0xd5e76 and 0xe5c48 are not these targets.

## 2. Worker-bound resolution of the virtual call

This is a conditional static binding, not a measurement of every live Runtime.
The worker constructs the second callback of its bundle as follows:

| RVA | Bytes | Observation |
| --- | --- | --- |
| 0xd261c | 488d0535061300 | vtable 0x202c58 |
| 0xd262b | 488d050ed8ffff | stored function pointer 0xcfe40 |
| 0xd28a9 | e8b2b9f6ff | copy bundle through 0x3e260 |
| 0xd28b4 | e867b3f6ff | construct Runtime through 0x3dc20 |
| 0x3dc41 | e89a040000 | move bundle through 0x3e0e0 |
| 0x3e105 | 488b4f38 | read source callback implementation |
| 0x3e11d | 48894378 | place resulting implementation at Runtime + 0x78 |
| 0xc6378 | ff5008 | call stored function pointer at implementation + 8 |

Vtable 0x202c58 -> COL 0x207870 -> TypeDescriptor 0x222c70. The recorded
name is std::_Func_impl_no_alloc for a function returning pka::bot::Failure,
taking Command const& and function<Failure()> const&. Slot 2 is 0xc6360.
The adapter passes a hidden Failure output pointer in rcx, Command in rdx,
and preflight callback in r8. With the worker binding, its stored target is
0xcfe40. Therefore 0x8461a -> 0xc6360 -> 0xcfe40, not memcmp and not a proven
Runtime::route call. Other callback bundles could supply different functions.

0xcfe40 checks the preflight callback at 0xd0343 (ff5010); this is NOT a
second, unidentified client-send hook. It then calls 0xc8db0 at 0xd041e
(e88d89ffff), and on the continuing branch copies a command record into
global-state + 0x178 at 0xd04ea (0f118378010000), including a sequence at
global-state + 0x1b0 at 0xd0515 (488983b0010000). This stages a pending
record; it does not prove client consumption, a pipe opcode, or a server ACK.
The record consumer and final client hook remain open. Internal offsets are
not newly invented telemetry fields.

## 3. Route and movement boundaries

Route candidate range 0x7df00..0x7f810 contains the closure construction
0x7ee9d (488d058cc90600), linked through vtable 0xeb830, COL 0x206eb0,
TypeDescriptor 0x221d50 to a lambda inside Runtime::route. This identifies
the containing method by construction context; the lambda entry itself is
not the route entry. The RTTI signature returns JSON, taking two JSON const&
arguments plus flags/unsigned argument. Exact semantic names for every flag
are not asserted.

| RVA | Bytes | Observation |
| --- | --- | --- |
| 0x7e02b | 488d15928c0600 | reads tiles |
| 0x7e0d2 | 488d15f78b0600 | reads walkable |
| 0x7e269 | 488d15187a0600 | reads creatures |
| 0x7eb06 | ff5010 | invokes configured callback from Runtime + 0xf8 |
| 0x7ef1e | e8bd24feff | calls search 0x613e0 with closure and bounds |
| 0x61518 | e8d3bbffff | search calls XY Chebyshev helper 0x5d0f0 |
| 0x61541 | e8daf4ffff | search calls predicate VM 0x60a20 |
| 0x61cd5 | f20f58c6 | score accumulation adds xmm6 to xmm0 |
| 0xac4ce | e82d1afdff | tickTravelLure calls route 0x7df00 |
| 0xacf0b | 8b0da3980300 | loads walk command name |
| 0xacf46 | e8f573fdff | tickTravelLure calls send 0x84340 |

The recorded search consumes a validation closure and distance/score state.
It is not merely a direct Chebyshev movement command. Complete open/closed
set semantics, edge costs, predicate programs and tie handling still need
reconstruction before calling this a verified A* implementation. Chebyshev
in a heuristic/helper is not an exclusive alternative to A*. No claim is
made that route itself sends a named-pipe packet or writes game input.

## 4. TravelLure and random: recovered subset

TravelLure::plan candidate range 0x6f610..0x71ac0 constructs its named
predicate at 0x70fae (488d0523a50700), vtable 0xeb4d8 -> COL 0x206730 ->
TypeDescriptor 0x220a40. Slot 2 at 0x4e3f0 adds 8 to the closure pointer and
jumps to 0x455c0; this predicate consults internal history, not a PRNG.

Plan calls 0x622b0 at 0x7102b (e88012ffff). That helper evaluates sides +1
and -1 via calls at 0x626ac (e8bf61feff) and 0x626c3 (e8a861feff) to
0x48870, compares their best values at 0x628d5 (660f2ff0), then evaluates
a cross-product comparison at 0x6293c (66440f2fc7). The sign-to-direction
meaning and all fallback branches are not reconstructed into a local planner.

Plan also samples 1..100 through 0x64ea0 at 0x6ff0e (e88d4fffff), compares
to 38 at 0x6ff15 (83f826), and conditionally samples 1..100 again at
0x70246 (e8554cffff), comparing to 45 at 0x7024b (83f82d). These establish
two conditional percentile decisions, not a uniform random-radius algorithm.
They do not establish when LureRecovered is true.

The separate random-window helper at 0x8ed30 has a fully bounded formula:

    low = max(1, trunc(randomMinSeconds or numeric fallback 45))
    high = max(low, trunc(randomMaxSeconds or numeric fallback 100))
    seconds = low + trunc(unitSample * (high - low + 1))
    until = now + seconds * 1000

"Fallback" means absent/non-numeric input, not falsy JavaScript coercion.
For unitSample in [0,1), finite integer bounds and no signed overflow, this
samples inclusive INTEGER SECONDS. The native float-to-signed-int overflow
behavior is outside the local helper's contract and explicitly rejected.

| RVA | Bytes | Observation |
| --- | --- | --- |
| 0x8ed5f | 488d1532810500 | randomMinSeconds |
| 0x8ed89 | 0f4ff0 | clamp low to at least 1 |
| 0x8ed8c | 488d151d810500 | randomMaxSeconds |
| 0x8edb3 | 0f4cd8 | clamp high to at least low |
| 0x64ebb | ff5010 | obtains double from injected random callback |
| 0x64ebe | 2bdf | high - low |
| 0x64ec0 | ffc3 | inclusive span + 1 |
| 0x64ecf | f20f59c1 | multiply unit sample by span |
| 0x64ed3 | f20f2cc0 | truncate to integer |
| 0x64ed7 | 03c7 | add low |
| 0x8eed8 | 69c8e8030000 | multiply sampled seconds by 1000 |
| 0x8eee6 | f20f58f7 | add caller-provided clock |

The worker has a double-generator closure at vtable 0x202d00, slot 2
0xc6400. It calls word generator 0xc5d50 twice, at 0xc641a and 0xc6428,
forming (secondWord * 2^21 + (firstWord >> 11)) * 2^-53. The exact scale
bytes at RVA 0x202d68 are 000000000000a03c. Word generator code contains
624-word state initialization (0xd25d9), seed multiplier 0x6c078965
(0xd25c7), twist mask 0x9908b0df (0xc5da5) and temper shifts 11,7,15,18
(0xc5edb/0xc5eee/0xc5efb/0xc5f02). These are MT19937-compatible operations;
the live seed/state and therefore the original random stream are not known.

native-random.cjs implements only the integer/deadline and two-word conversion
subset with explicit input validation. lure-engine.cjs now uses integer-second
deadlines instead of the previous millisecond-granularity sampling. Its existing
mode-selection, wait/walk alternation, 8s/3s recovery and normalization remain
local approximations; this timing correction does NOT verify full native lure.
No local replay claims the original seed or exact live random sequence.

## 5. Tick graph is conditional, not the proposed fixed list

Several independent tick RTTI closures occur in the same candidate range
0x906b0..0x9272c: constructions at 0x91347, 0x91634, 0x91ea5 and 0x9243c.
The third closure's adapter 0x4e610 collects three boolean gates, reads
telemetry and tail-jumps to tickLoot at 0x4e697 (e944600500).

The module closure at 0x91634 invokes adapter 0x4e4b0; its call at 0x4e4fd
(e86e570400) reaches 0x93c70. That module function calls tickRevive at
0x9400c (e85f400100) and 0x947c0 (e8ab380100) on different branches, and
tickHoenn at 0x95193 (e828630000). Main tick also constructs a healer-context
closure earlier, not after an unconditional revive call.

The walker closure at 0x9243c invokes adapter 0x4e6b0, which calls 0x7d280
at 0x4e6cd (e8aeeb0200), 0xa6120 at 0x4e6e2 (e8397a0500), tests Runtime
+0x818, then conditionally calls 0xad320 at 0x4e729 (e8f2eb0500). Function
0xad320 calls tickTravelLure at 0xaf2f2 (e889ceffff), and route at 0xaf3f6
(e805ebfcff). tickTravelLure routes and dispatches walk as shown earlier.
These are static candidate edges, not a claim that every edge executes per tick.

Full branch predicates, all early exits and comboStep transitions remain open.
In particular, do not replace this graph with the requested illustrative
revive -> healer -> target -> loot -> hoenn -> travel order.

## 6. Four rule contracts remain blocked

BestTileScore: candidate function 0x92730..0x93c63 constructs a tickBestTile
closure through 0x93b04 (e8a78cf9ff -> 0x2c7b0). The outlined constructor
loads vtable 0xeb6e0 at 0x2c7b8 (488d0521ef0b00); its RTTI names tickBestTile.
The adapter calls 0x41f00 at 0x4e20d. That helper revalidates the selected
entity and position; it is not the complete score formula. The caller loads
the existing order command at 0x93b48 (488d151d340500), then calls send at
0x93b81 (e8ba07ffff). Hoenn references bestTileRange at 0x9da1e and wait/retry
settings nearby. These are construction/preflight/dispatch edges, not a score
formula or proof of all candidate costs and tie-breaks.

NextTeam: tickHoenn consumes roster at 0x9b683; this does not identify the
selection/cycle predicate for the next team. ComboBuffDone: comboTick RTTI
exists; buffUsed at 0x9ff0a is inside tickHoenn, not proof of buff completion.
HealerDeployReady: gate at 0x9be3c and pokeReadyTimeoutMs at 0x9d271 identify
context, not the complete readiness/timeout predicate.

remaining-rules-v1.json records these concrete leads but keeps all four rules
blocked. decision-rules-v1.json keeps their unsupported status. Existing
commands remain the only IPC contract; no fields, enum values or packet types
were created to fill missing behavior. Counts remain 13 implemented, 13 partial,
4 unsupported, and 12 locally implementable / 4 blocked contracts.
