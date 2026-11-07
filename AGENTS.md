# AGENTS.md

Non-obvious facts for automated edits. Architecture and measured costs live in docs/ARCHITECTURE.md.

## Rules

- Source files carry no comments. Put a fact the code cannot express here, after checking it is still true.
- Kernel files in src/kernel use only the numeric subset jz accepts: typed arrays, numbers, loops, and functions that take their state as arguments. No objects, closures, classes or allocation.
- Edit source, never dist/. `npm test` rebuilds dist/kernel.wasm before the suites run.
- A kernel signature change touches `src/kernel/step.js`, `src/world/World.js` and the kernel tests together. `step` passes its arguments positionally.
- Keep `MODULES` in `src/kernel/build.js` in step with the imports. A missing file fails the build with an unresolved import.
- scripts/lib/gate.mjs holds the shared PASS and FAIL reporter. A new gate imports it, runs each claim through gate(label, fn), and ends with finish().

## Facts that bite

- `World#hash` is FNV-1a over the float64 bit patterns, read as uint32 words in JavaScript. It is not in the kernel. A negative zero and a positive zero hash differently.
- `resolvePairs` records each body's cell from positions at the start of the call. A body that moves into another cell mid-pass is searched in its recorded cell until the next call. Solver iterations close the gap.
- The cell filter in `resolvePairs` is what keeps a bucket collision from duplicating a pair. Remove it and pairs are counted twice whenever two neighbour offsets share a bucket. The bucket-collision test guards this.
- `cells` must hold three int32 per body, and `head` must be at least one bucket. `World` sizes `head` to two buckets per body with a minimum of 64.
- `RESTING_SPEED` in `src/kernel/respond.js` is 1 m/s. Impacts slower than that cancel the normal velocity instead of bouncing. Changing it changes what counts as resting.
- `World#advance` caps catch-up at 8 ticks. Time past that cap is dropped on purpose.
- Each `World` owns a wasm instance. Its memory is released only when the world is garbage collected, so a long-running process should drop worlds it no longer uses.
- A kernel call costs roughly 15 to 25 ns per typed-array access in compiled wasm. A loop that reads a value more than once should keep it in a local.
- The package needs Node 22 or newer. `.nvmrc` pins 24.
- Commit as lanmower, with no trailers, under the owner rule in CLAUDE.md.
- `Authority` takes one input per player per tick, so `InputBuffer.next` must equal the world tick plus one. Add every player before the first `step`; a player added later starts at sequence 1 and falls out of step.
- `Predictor#predict` defaults `buttons` to 0. The sequence it assigns is the world tick plus one, so predict only once per tick.
- `Predictor#reconcile` keeps unacknowledged inputs until a state covers them. Under sustained loss the pending list grows with the gap between acknowledgements.
- The netcode witness uses one seeded generator for intents, loss and delay. Changing the order of random draws changes its numbers, not its verdict. The 4-tick control is expected to show gaps and must keep doing so, or the witness no longer tests what it claims.
- Redundancy works only up to the playout delay. Each input has `delay + 1` chances before its playout time, so raising the redundancy above that buys nothing.
- `World#importState` resets the accumulator, so a restore partway through a fixed step drops that remainder on purpose.
- `decodeDelta` compares a base by tick and body count. `StateSender` and `StateReceiver` both keep 64 states by tick. The receiver keeps every state the sender can still use as a base, because the sender only uses an acknowledged tick within its own 64-tick history. Changing one depth without the other breaks that guarantee.
- Bodies are compared with `Object.is`, so a −0 change is a real change and is sent. A body that jitters between two bit patterns is sent every tick, which costs bytes but not correctness.
- `manifest.bin` in a spawn world is a run of frames, each a big-endian uint32 length followed by its payload, and the frames end exactly at the file's end. Frame 0 is the index `{v, hashes}` and `hashes` is an object whose values are the 80 value hashes. Frame 1 is the sheet, and its sha256 equals `head.sheet`. Later frames are not parsed yet.
- Spawn ledger names use `~XX` hex escapes (`~2f` is `/`, `~3a` is `:`). `decodeName` throws on a bare tilde or a non-ASCII escape. The encoder is not documented, so there is no `encodeName`.
- The feed walk is offset-based: 22-entry steps, a 44-entry page cap, and it stops after two empty pages. Repeated worlds are dropped.
- `scripts/fixtures/spawn` is trimmed from the spawn probe scan `4e709464ecfc408f980ac3b5b46b0ee3` and its feed listing of 2848 entries, which were not recorded in this repo. The gate reads only the fixtures.
- Policy: no unit tests. Every check is a gate script under scripts/ that runs against the built kernel and the real modules, prints PASS or FAIL lines, and exits non-zero on failure. `npm test` runs the build, the kernel, world, protocol, netcode, snapshot and spawn gates, and the type check.
