# Pending validation

Phase A writes code, the CI workflow and the tests for ENGINE.md phases 1 to 8. Nothing in this file has been built, run, gated or witnessed. Phase B builds, runs every witness below, fixes what fails and pushes.

Each entry names the file, the ENGINE.md phase and the witness it needs. Status is always `unvalidated` until Phase B records a red and a green run.

## Problems in docs/ENGINE.md (for the dispatcher)

The dispatcher owns docs/ENGINE.md, so these are recorded here and not edited.

- Memory section, "One WebAssembly.Memory sized at start from the device budget ... INITIAL_MEMORY equal to the budget". A wasm memory size is fixed at link time, so a runtime budget cannot set INITIAL_MEMORY. Proposed fix: one build per memory tier, each linked with ALLOW_MEMORY_GROWTH=0 and INITIAL_MEMORY and MAXIMUM_MEMORY set to the tier, and boot loads the largest tier that fits the budget. Decision needed.
- Bridge, "JS calls engine_init(budget) once". Phase 1 has no region table, so the phase 1 code exports engine_init() with no argument. Phase 3 can restore a budget argument if the tier model is accepted.
- Phase 2 witness, "the existing world, netcode and determinism suites pass against the C++ core". The JS World is a point integrator with a ground plane, box collision and a fixed FNV hash over float64 words. Jolt is a rigid-body engine with float32 positions. A bit-equal hash between the two is not reachable, and the phase 2 witness must say which suite assertions are behavioural (ground rest, identical runs, state round trip) and which are numeric. The World suite currently uses relational assertions (equal, notEqual) on hashes, so the witness can keep them if the Jolt hash replaces the kernel hash inside the engine.
- Phase 2 Jolt version. The pin used here is JoltPhysics v5.3.0 (commit 0373ec0dd762e4bc2f6acdb08371ee84fa23c6db). The spoint dependency is jolt-physics 1.1.0 from npm, and that release is not confirmed to be built from v5.3.0. The matching Jolt commit is not established.
- Threads. "Two builds with one API" and the cross-machine hash witness for the multithreaded Jolt job system are open items. Phase A builds only the single-threaded variant.
- Phase 1 witness text is consistent with the code, but phase 1 has no red witness on the fixed build. The red witness is the leak variant built with ENGINE_VARIANT=leak, which grows memory and must fail the memory gate.
- Changing docs/ENGINE.md during Phase A: the dispatcher wrote the file at 21:09. The Phase A session edited the memory and bridge lines to the tier model at 21:18 and then reverted that edit with git checkout at 21:18:54, so the file on disk equals commit edafae8. If the dispatcher wrote a change between those two events, it was overwritten and the dispatcher should check.

## Phase 1: toolchain and fixed-memory module

- engine/src/engine_core.cpp, ENGINE.md phase 1. Exports engine_init, engine_tick, engine_ticks and engine_memory_bytes. Witness: scripts/check-engine-core.mjs memory gate, PASS after 10000 ticks on the fixed build, and FAIL on the leak build. Status: unvalidated.
- engine/build.sh, ENGINE.md phase 1. Emscripten flags (MODULARIZE, EXPORT_ES6, ENVIRONMENT=web,node, EXPORTED_RUNTIME_METHODS=HEAPU8, ALLOW_MEMORY_GROWTH=0, MAXIMUM_MEMORY, STRICT=1, -ffp-contract=off, -fdebug-prefix-map). Witness: the module builds with emsdk 4.0.10 and HEAPU8 is exported. Status: unvalidated, and flags not yet proven on emsdk 4.0.10.
- engine/artifacts.json, ENGINE.md phase 1. The artifacts map is empty. Phase B fills the sha256 from the CI build, then checks the local build hash against it. If the local and CI hashes differ, the reproducibility flags need work (for example debug-prefix-map or a fixed link time). Witness: check-engine-core.mjs hash gate PASS.
- .github/workflows/engine-core.yml, ENGINE.md phase 1. All actions are pinned by commit SHA (checkout v4.2.2, setup-node v4.4.0, cache v4.2.3, upload-artifact v4.6.2). emsdk is cloned at 62a853cd3b3134398ce85cde8bb5cbb2ef0194cb and installed as 4.0.10. Witness: the workflow runs green on push, with the hash gate passing. Status: unvalidated.
- scripts/check-engine-core.mjs, ENGINE.md phase 1. Hash gate and memory gate. Witness: PASS on the fixed build, FAIL on the leak build. Status: unvalidated.
- scripts/check-engine-artifacts.mjs, ENGINE.md phase 1. Static gate in npm test. Ran once before the Phase A rule (exit 0 at that time); that is not a witness and it must run again in Phase B. Status: unvalidated under the new rule.

