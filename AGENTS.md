# AGENTS.md

Non-obvious facts for automated edits. Architecture and measured costs live in docs/ARCHITECTURE.md.

## Rules

- Source files carry no comments. Put a fact the code cannot express here, after checking it is still true.
- Kernel files in src/kernel use only the numeric subset jz accepts: typed arrays, numbers, loops, and functions that take their state as arguments. No objects, closures, classes or allocation.
- Edit source, never dist/. `npm test` rebuilds dist/kernel.wasm before the suites run.
- A kernel signature change touches `src/kernel/step.js`, `src/world/World.js` and the kernel tests together. `step` passes its arguments positionally.
- Keep `MODULES` in `src/kernel/build.js` in step with the imports. A missing file fails the build with an unresolved import.
- `node --test` with no arguments discovers `test/oracle.js` too. It holds no tests, so it runs as an empty file.

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
