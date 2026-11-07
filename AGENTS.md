# AGENTS.md

Non-obvious facts for automated edits. Architecture lives in docs/ARCHITECTURE.md.

## Rules

- Source files carry no comments. Put a fact that the code cannot express here, after checking it is still true.
- Kernel files in src/kernel use only the numeric subset jz accepts: typed arrays, numbers, loops, and functions that take their state as arguments. Do not add objects, closures, classes or allocation to them.
- Edit source, never dist/. Run npm test after any kernel change: it rebuilds dist/kernel.wasm before the suites run.
- The kernel is compiled once by scripts/build-kernel.mjs, about 20 seconds. Do not compile at runtime.
- Node 24 rejects a directory argument to node --test, so the test script lists its files. Keep that list in step with test/.

## Facts that bite

- hashState quantizes to 1/4096. A change smaller than that does not move the hash. Test a change of at least 0.001.
- RESTING_SPEED in src/kernel/respond.js is 1 m/s. Impacts slower than that cancel the normal velocity instead of bouncing. Changing it changes what counts as resting.
- resolvePairs clamps positions outside the grid to edge cells. Two bodies within the contact distance still land in neighbouring cells, so no pair is missed. Bodies beyond the grid all share edge cells, which costs time, not correctness.
- resolvePairs builds its grid from positions at the start of the pass. Bodies moved by an earlier pair in the same pass can be missed by a later one. One tick is enough for the resting and falling cases tested.
- World#advance caps catch-up at 8 ticks. Time past that cap is dropped on purpose.
- A JS typed array passed to a kernel export is copied in and back out on every call. That is the cost of keeping kernels free of host state.
- jz reads a module's imports from the modules map at compile time only. A new kernel file must be added to MODULES in src/kernel/build.js, or the build fails with an unresolved import.
