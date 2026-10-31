# Creature stream (Windows)

Run from the official reconstruction directory. The scanner is read-only and never sends combat
commands. The defaults are confirmed in the live PokeAlliance_dx.exe layout:
ID at struct + 0x5C (uint32), HP at + 0xC0 (uint8, 0..100 percent), and canAttack
at + 0xC4 (uint8, converted with value > 0: 0 is false, 1/2 are true).
Position remains at + 0x30 and name at + 0x80. HP is a percentage, not absolute
hit points. Type is optional via --type-offset 0x0C and does not block combat.

## Start in background

```powershell
$scanner = .\tools\start_creature_stream.ps1 -ProcessId 27964 -IntervalMs 300 -ScannerArgs @('--player-name', 'PlayerName')
$scanner
```

Replace the PID and player name with the current values before running. No
field-offset flags are needed. The launcher
returns ScannerPid and log paths and uses a hidden window. Only one streaming
writer may own a given output file. Its .lock file may remain after shutdown;
the OS releases the actual lock when the process exits.

For foreground operation and graceful Ctrl+C shutdown:

```powershell
python tools/scan_creatures.py --pid 12345 --stream --interval-ms 300 --output live-creatures.json
```

Both commands use the same confirmed defaults. To override another verified
layout, use -IdOffset, -HpOffset and -CanAttackOffset in the launcher, or
--id-offset, --hp-offset and --canattack-offset in the Python CLI. Existing
offset overrides in -ScannerArgs remain supported and take precedence.

## Consume

```powershell
node tools/hunt_daemon.cjs --config hunt.json --session session.json --pid 12345 --creatures live-creatures.json --tick-ms 200 --max-age-ms 1000
```

This remains dry-run unless an explicit actuator and --actuate are provided.
The session producer must independently refresh its verified telemetry. The bot
may also use createCreatureSource(file, { pid, maxAgeMs: 1000 }) as creatureSource.
The daemon and bot must not invoke the full one-shot scanner on every tick.

Each creature contains id, hp, canAttack and position plus the existing name,
healthPercent and pos aliases. Output uses same-directory temporary files and
os.replace; readers see either the previous or the next complete snapshot.
Transient missing/locked files or malformed JSON reuse the last valid snapshot
only until its original timestamp expires. Cache timestamps are never renewed.
Invalid PID, producer errors, partial discovery, timestamp regression and stale
data block consumption. A newly published empty list, zero HP or canAttack=false
is authoritative and is not hidden by the cache. TargetEngine already retains
the selected ID while eligible, even when list order or nearest candidate changes.

## Cost and limitations

The default 300ms loop rereads only discovered structs using one persistent
process handle. Full discovery runs separately, at most once per 10 seconds
after the preceding discovery finishes, with <=1 MiB chunks and waits of at
least 20ms or four times the preceding chunk's work duration (whichever is
larger). Both loops sleep; there is no per-tick process spawn or busy
polling. --interval-ms accepts 200..500; --discovery-ms defaults to 10000.
Initial discovery publishes an explicit pending error until it completes.
New entities can appear only after another discovery completes. Large heaps,
slow reads, scheduler delays and disk contention can exceed the requested
cadence; this is not a hard real-time guarantee. The memory signature still has
the scanner's existing false-positive and stale-allocation limitations; prefer
a name whitelist and reverify offsets after client updates. CPU usage needs measurement on the live
client; synthetic tests establish scheduling, not live-game performance.

To stop a hidden scanner, use Stop-Process -Id $scanner.ScannerPid. This is a
forced stop: an unpublished unique .tmp file can remain, but live-creatures.json
is never truncated. Consumers block after maxAgeMs without fresh data.

## Tests

```powershell
python tests/creature_stream_test.py
node --test tests/creature_stream.test.cjs tests/scan_creatures.test.cjs tests/hunt_daemon.test.cjs tests/target-engine.test.cjs tests/hunt.test.cjs
```
