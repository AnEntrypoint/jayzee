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
- `resolve-found.json` is spawn's resolve response, reported by the spawn agent and not captured from the probe. `found` and `not_found` are parsed. `not_found` is `resolve-not-found.json`, a live response reported by the spawn agent. `redirect` and `gone` appear in the openapi description but no body has been captured, so they throw until a fixture exists.
- `src/protocol/messages.js` mirrors spoint's `src/protocol/MessageTypes.js` at d5e3860: 105 ids and 12 unreliable names. `scripts/fixtures/spoint-messages.json` is generated by importing that spoint module, not written by hand. Several ids are declared but unused in spoint (for example `DELTA_UPDATE` and `PLAYER_JOIN`), and they are kept so the id space matches.
- A missing head is a 404 with `{"error":"head_not_found"}`. Any other non-200 status is an error.
- A ledger key is `world.assets/<2 hex>/<encoded>.yaml`. The two-hex bucket is not derived from anything here, so it is only checked for shape.
- The feed walk is offset-based: 22-entry steps, a 44-entry page cap, and it stops after two empty pages. Repeated worlds are dropped.
- `scripts/fixtures/spawn` is trimmed from the spawn probe scan `4e709464ecfc408f980ac3b5b46b0ee3` and its feed listing of 2848 entries, which were not recorded in this repo. The gate reads only the fixtures.
- `src/fire/fireKernel.js` ports spoint's `src/shared/fire/fireKernel.js` at d5e3860 without its HMR hooks. spoint's `createFireLattice` and its `cubeFaceOf` import from `terrain/PlacementLattice.js` are not ported. The kernel takes any lattice with `walk`, `cellsPerFace`, `faceCount` and `windInFaceAxes`.
- The fire hash is `cellHash` in `src/fire/fireKernel.js`. It is a murmur-style integer mix over the seed, step, face, I and J, masked to 24 bits, and it is not FNV. The spot roll reads the low 16 bits, the spot distance bits 16 and 17, the lateral offset bits 20 and 21, and rain reads the low 8 bits. `checksum()` folds per-cell hashes by sum (int32) and xor (uint32) and returns a uint32.
- `seed` goes through `^`, so it is coerced to int32. A seed of 2^32 + 1 is the same as seed 1.
- A tile is 8 by 8 cells (`TILE_AXIS_CELLS` is 8, 64 cells). Its activity and interior masks are Uint32 words, with cells 0 to 31 in the low word and 32 to 63 in the high word. Bit 31 is set in those words, so they must stay unsigned.
- Cell widths: `state` and `cls` are Uint8, and `fuel`, `heat` and `timer` are Uint16. `addHeat` clamps heat to 65535, and `timer` holds `stepIndex & 0xffff`, so it wraps every 65536 steps. `tileFace` is Uint8 and `FACE_FREE` (255) marks a freed tile, so a lattice face index must stay below 255. Class parameters are Uint16, except `smoke`, which is Uint8 and wraps silently above 255.
- Heat moves as `(heatOut * weight) >> 8`, where each weight is an Int32 clamped to [4, 255]. `rainRoll` is capped at 255, so a rain value above 255 behaves like 255.
- `wind` keeps the raw value and the effective wind is clamped to plus or minus 16 (`FIRE_MAX_WIND_COMPONENT`). The snapshot keeps the raw value, so a restore clamps it again.
- `Math.floor(fuelInit * regrowFuelFraction)` is the only non-integer operation. With a fraction below 1, regrown fuel never equals the class fuel, so a regrown tile is never quiet and is never reclaimed.
- The undo log grows until `takeDelta()`. A caller that wants one delta per step must call `takeDelta()` and `releaseDelta()` at each step boundary, or the next `undoDelta` reverts several steps.
- `src/fire/behaviour` takes samplers, the frame and io sinks as arguments and never reads an app context. Callers bind appCtx at the edge.
- The fire lattice walk is symmetric only in the sense that some step from a neighbour returns to the origin. Across a cube edge the step changes axis, so the opposite direction in the new face's coordinates is not the way back.
- The keyframe encoder's `advance(budgetMs)` makes no progress with a budget of 0, because its deadline is reached on entry. Use a positive budget.
- `createFireTimeline#startAt` throws once the timeline has advanced at all, so it must be the first call.
- `createChecksumLedger` applies one `limit` (default 64) to both local history and received remote checksums.
- `IGNITE_AREA` wire rows carry the radius but no source byte, because the kernel does not read one for area ignition.
- `fireQueries.js` uses float arithmetic on purpose. The integer-only rule covers the kernel and the wire, not these queries.
- `src/sandbox/ses.js` does not import SES. `preflightSes` takes an `importSes` function, and when it resolves, locks down with `errorTaming: 'unsafe'`, `stackFiltering: 'verbose'` and `overrideTaming: 'severe'`. A `SES_ALREADY_LOCKED_DOWN` error from lockdown counts as success.
- `preflightSes` returns `ok` or one refusal code: `ses-not-installed`, `lockdown-missing`, `lockdown-failed`, `compartment-missing` or `intrinsics-not-hardened`. A preflight that throws becomes `preflight-threw`. Every refusal fails closed with no Compartment.
- `createSesEvaluator` memoises one preflight. On a refused preflight, `evaluate` throws `SandboxUnavailableError` (code `SANDBOX_UNAVAILABLE`) before the blocklist is read, so a blocked source gets the throw, not null, while SES is unavailable.
- The blocklist is a substring match, so it also rejects the same text inside strings and comments. A blocked or empty source returns null and logs one line, and it does not throw.
- `timingSafeTokenEqual` returns false for non-string input and for tokens with different UTF-8 byte lengths. It uses `node:crypto` `timingSafeEqual` when Node is present.
- `resolveWithinRoot(root, candidate)` returns the resolved path, or null when it lands outside the root. The root itself is accepted, and a sibling that shares the root's prefix is rejected. An absolute candidate is taken as a filesystem path, so a URL path must drop its leading slash first.
- `COEP_VALUE` is `require-corp`.
- The simulated link in `src/transport/simTransport.js` follows spoint's random-draw order. With `reorderPct` above zero a payload can arrive before its own minimum latency, measured at 1011 of 2000 early with latency 20 and no jitter. A minimum-latency claim must run with reorder at zero.
- The anticheat modules in `src/anticheat` take their clock as an argument and throw when it is missing or not finite. Spoint's versions default to `Date.now()`, so a port that drops the argument would make the rate limit and outlier flags depend on wall time.
- spoint's `LagCompensator` clamps a rewind request older than the window to the oldest retained tick. It does not refuse it. A 5000 ms window retains only 255 ticks, because the sample ring holds 256 entries. `src/netcode/lagCompensation.js` keeps both behaviours.
- `src/replay/file.js` writes standard msgpack, not spoint's msgpackr record dialect. spoint's replay files are refused (marker `0xd4`), and jayzee's files read in spoint as a Map with bad magic. The format has no checksum, so a flipped payload byte is accepted.
- `src/wire/binSnapshot.js` refuses a truncated record and a flag above 255. spoint's `SnapshotBinFormat` silently accepts a 28-byte record and masks flags, so a byte-for-byte cross-check against spoint only agrees on valid input.
- `src/render` holds only the headless subset of spoint's client/core. spoint's `CascadeShadowSelect.js` patches `THREE.ShaderChunk` at import, and `GroundSample.js` and `PlacementRing.js` import `PlanetFrame.js`, so none of the three is ported.
- `HotReloadQueue` in spoint does not coalesce: it keeps each entry and runs each one. Coalescing is in spoint's HmrRuntime and is keyed by `src/hot/updateKey.js`, which uses url and path for app events, not the app name. A duplicate event therefore reloads once only if the caller uses the coalescer.
- `scripts/fixtures/savi/ENDPOINTS.md` is a byte copy of savi's `ENDPOINTS.md` (sha256 `ad00d9b6871f29513813bd071497a52b743180596a0494b766a5ea1926144df9`). The doc's header says 62 paths from an `openapi.json` that is not in this repo, but its published, per-game, disabled and manual-only headings sum to 93 with the three published sections totalling 63. The gate checks the 93 and the four headings. It does not reconcile the 62.
- Policy: no unit tests. Every check is a gate script under scripts/ that runs against the built kernel and the real modules, prints PASS or FAIL lines, and exits non-zero on failure. `npm test` runs the build, the kernel, world, protocol, messages, netcode, snapshot, spawn, fire, fire-modules, sandbox and savi-endpoints gates, and the type check.
