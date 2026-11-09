# Pending validation

Phase A wrote code, the CI workflow and the tests for ENGINE.md phases 1 to 8. Phase B built, ran and gated every witness below, fixed what failed, and recorded the results. The status index right below lists each section. Results are quoted in "Phase B witness results" and in the CI record.

Each entry names the file, the ENGINE.md phase and the witness it needs. The status index gives the result of that witness. Entries that still lack a witness are marked OPEN in the index.

## Phase B status index

| Section | Witness run in Phase B | Result |
|---|---|---|
| Phase 1: toolchain and fixed-memory module | `check-engine-core` on 64 and 128 MiB, `check-engine-leak`, `check-engine-artifacts`, CI run 42538780790 | PASS. The leak variant grows its memory (`check-engine-leak`), so the fixed-memory witness is not vacuous. |
| Phase 2: Jolt world parity | `check-engine-world` 13 PASS, `check-world` 13 PASS, native phase 2 | PASS. Float32 tolerance 1e-5 for the engine (deviation). |
| Phase 3: the bridge | `check-engine-bridge` 7 PASS | PASS. The rotation gate noted as missing is still missing: the bridge gate checks bounds and alignment only. OPEN. |
| Phase 4: body pools and allocation witness | `check-engine-pools` 7 PASS, native phase 4 17 PASS | PASS. Gate 6 (zero allocations after warm-up) passes. |
| Phase 5: PlanetShape and the page cache | `check-engine-planet` 9 PASS, native phase 5 24 PASS | PASS for the gates. OPEN: the frame-time p99 against spoint's streamer was never measured. |
| Phase 6: vegetation field | `check-engine-vegetation` 7 PASS | PASS. Finding: in the timed run, 200 spheres over 256 ticks cost 361.77 ms with the field and 307.77 ms with one body per tree. Timings are printed, not thresholded. The cube-sphere keying decision is still open for the dispatcher. |
| Phase 7: bit-compatible wire codecs | `check-engine-codecs` 11 PASS, including the schema packet gates | PASS. |
| Phase 8: client resource pools | `check-client-resource-pools` 13 PASS, browser page `client-resource-pools.html` | PASS for the gates. The page ran in the gm playwriter browser: no compile after play, 8 lights, 8 textures and 8 meshes live after churn, and no page error. A page error was found and fixed in this Phase B (its texture layer count did not match the wasm table). See "Materials and textures (phase 8)". |
| Gap closure 1: generation wrap | `check-engine-pools` (retirement gate), `check-client-resource-pools`, native phase 4 (65535 cycles) | PASS. |
| Gap closure 2: schema-driven input codec | `check-engine-codecs` schema packet gates | PASS. |
| Gap closure 3: material table as slots | `check-engine-materials` 15 PASS, `check-client-resource-pools` | PASS. |
| Service-worker isolation shim | `check-engine-isolation` 9 PASS; public site `anentrypoint.github.io/jayzee/play/` in the gm playwriter browser | PASS. The public site reports `crossOriginIsolated` true and `SharedArrayBuffer` defined, before and after the reload (profile caveat in the section below). |
| Renderer (phases 10 and 11) | `check-engine-render` 17 PASS; WebGPU and WebGL2 pages at 64 and 1024 tiers on the real NVIDIA RTX 3060 Laptop adapter (see "Real-adapter runs" under the renderer section) | PASS. The two backends agree on the checksum at each tier, and every run has zero allocations after warm-up. The 64-tier WebGPU slowdown was a top-tier upload in the frame and is fixed: in the clean replicate (set 2) the 64-tier p99 medians are equal, 3.1 ms each. At 1024 the median frame is equal across backends (47.0 ms against 47.1 ms over six runs), and the p99 is dominated by long-frame stalls that appear in both backends. The earlier 4.62 and 3.90 speedups are withdrawn. See "WebGPU and WebGL2 repeats after the 64-tier fix". |
| Memory, arena and allocator | `check-engine-core`, `check-engine-tiers` 6 PASS, native host witness | PASS. Post-warm-up carves are zero at 64 and 1024 players. |

Still OPEN after Phase B: the phase 5 frame-time comparison; the phase 3 rotation gate; the `USE_WEBGPU` migration (`emdawnwebgpu`); the `ENGINE_THREADS` branch, which is not compiled; `scripts/browser/run-player-webgpu.mjs`, which still needs `PLAYWRIGHT_CORE`; the 1024-tier long-frame stalls in both backends (up to 705 ms in WebGPU, not reproduced; the largest of six diagnosed runs was 251 ms): the cause is recorded in "Stalls at 1024, Phase B diagnosis", with no code fix verified; the 362.9 ms WebGL2 outlier is not reproduced and is covered by the same section; the `requestAdapter()` null after a browser restart: the cause is recorded in "Null adapter after the browser restart", and the flag fix is verified, while a launcher-level fix is still open.

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
- engine/build.sh, ENGINE.md phase 1. Now configures through emcmake and builds the engine/CMakeLists.txt target (changed in phase 2). Witness: the module builds with emsdk 4.0.10 and HEAPU8 is exported. Status: unvalidated, and the flags are not yet proven on emsdk 4.0.10.
- engine/CMakeLists.txt, ENGINE.md phases 1 and 2. Carries the Emscripten link flags that build.sh used to pass (MODULARIZE, EXPORT_ES6, ENVIRONMENT=web,node, EXPORTED_RUNTIME_METHODS=HEAPU8,HEAP32,HEAPU32,HEAPF64, ALLOW_MEMORY_GROWTH=0 with MAXIMUM_MEMORY set to the tier, STRICT=1, -ffp-contract=off, -fno-exceptions, -fno-rtti). Witness: scripts/check-engine-artifacts.mjs fixed-variant gate reads this file. Status: unvalidated. -fdebug-prefix-map was dropped in phase 2 and must come back if the local and CI hashes differ.
- engine/artifacts.json, ENGINE.md phase 1. The artifacts map is empty. Phase B fills the sha256 from the CI build, then checks the local build hash against it. If the local and CI hashes differ, the reproducibility flags need work (for example debug-prefix-map or a fixed link time). Witness: check-engine-core.mjs hash gate PASS.
- .github/workflows/engine-core.yml, ENGINE.md phase 1. All actions are pinned by commit SHA (checkout v4.2.2, setup-node v4.4.0, cache v4.2.3, upload-artifact v4.6.2). emsdk is cloned at 62a853cd3b3134398ce85cde8bb5cbb2ef0194cb and installed as 4.0.10. Witness: the workflow runs green on push, with the hash gate passing. Status: unvalidated.
- scripts/check-engine-core.mjs, ENGINE.md phase 1. Hash gate and memory gate. Witness: PASS on the fixed build, FAIL on the leak build. Status: unvalidated.
- scripts/check-engine-artifacts.mjs, ENGINE.md phase 1. Static gate in npm test. Ran once before the Phase A rule (exit 0 at that time); that is not a witness and it must run again in Phase B. Its fixed-variant gate now reads engine/CMakeLists.txt, and a new gate checks that build.sh uses emcmake and cmake --build. Status: unvalidated under the new rule.

## Phase 2: Jolt world parity

- engine/src/world.h and engine/src/world.cpp, ENGINE.md phase 2. The Jolt world: one PhysicsSystem with a single-threaded job system, object layers NON_MOVING and MOVING, a static ground box whose top is y = 0 (4096 m half extent), dynamic spheres with restitution and linear damping from the options, static boxes, and a positions and velocities region in the module memory that is refreshed after every step. Witness: scripts/check-engine-world.mjs. Unvalidated. Specific risks to check on the first build: the type of JPH::Trace (silentTrace must match it), the implicit conversions from raw pointers to ShapeRefC, and the Init limits (4161 bodies, 16384 body pairs, 10240 contact constraints) against the 64 MiB tier.
- Semantic mismatches with the JS World that the phase 2 witness must report, not hide: (a) Jolt sleeps bodies unless mAllowSleeping is false, which the engine sets, so the engine never sleeps; (b) drag is mapped to Jolt linear damping, which is dv/dt = -c v with c in [0, 1), so drag at or above 1 is refused; the kernel's drag definition is not established here; (c) restitution and friction use Jolt's contact model, not the kernel's, and mFriction stays at Jolt's default 0.2; (d) Jolt keeps float32 positions, so the 1e-9 rest and box-top tolerances in worldSuite.mjs may fail on the engine while the JS World passes them. The gate reports which assertions fail.
- engine/src/engine_core.cpp, ENGINE.md phases 1 and 2. Exports engine_init, engine_world_configure, engine_world_add_box, engine_spawn, engine_set_position, engine_set_velocity, engine_set_tick, engine_tick, engine_ticks, engine_memory_bytes, engine_body_count, engine_positions and engine_velocities. engine_tick keeps the phase 1 leak branch under ENGINE_LEAK_ON_TICK. Witness: scripts/check-engine-core.mjs memory gate on both builds. Unvalidated.
- src/engine/EngineWorld.js, ENGINE.md phase 2. Same API as World, backed by one module instance per world. Each instance has its own 64 MiB fixed memory, so the suite's 15 worlds create 15 modules, and the engine does not reuse them. Phase 3 or 4 may change this to handles in one module, and the choice is an open decision for the dispatcher. Witness: scripts/check-engine-world.mjs. Unvalidated.
- src/world/options.js and src/world/World.js, ENGINE.md phase 2. The validation moved out of World.js into options.js so both worlds refuse the same inputs. World.js behaviour is unchanged by intent. Witness: scripts/check-world.mjs must still PASS all 11 gates. Unvalidated.
- scripts/lib/worldSuite.mjs, scripts/check-world.mjs, scripts/check-engine-world.mjs, ENGINE.md phase 2. The 11 world gates are now one suite (worldSuite.mjs) that both checks run. check-engine-world.mjs is not in the npm test chain yet, because it needs the built module. Witness: check-world PASS on 11 of 11 and check-engine-world results recorded gate by gate. Unvalidated.
- package.json, ENGINE.md phase 2. Adds the check:engine-world script, not in the test chain. Phase B adds it to the chain only after it passes.

## Phase 3: the bridge

- engine/src/bridge.h and engine/src/bridge.cpp, ENGINE.md phase 3. Fixed regions in module memory: a control block of 16 words (input head and tail, epoch, event head and tail, dropped events, body count, tick low and high), an input ring of 256 slots of 20 bytes (sequence, body, three float velocities), and an event ring of 256 slots of 16 bytes. engine_tick(steps) calls tickBatch once: it bumps the epoch, applies each queued input as a velocity set at the start of the batch, steps the world, and pushes one TICKED event. Witness: scripts/check-engine-bridge.mjs gates 2 to 7. Unvalidated.
- Decision recorded in the code: an input is applied at the start of its batch, not on a per-tick schedule, so an input queued during a batch of 64 ticks takes effect at the next batch boundary. ENGINE.md does not say which, so this is a choice for the dispatcher to accept or change.
- engine/src/world.h and world.cpp, ENGINE.md phase 3. The transform region (position and rotation quaternion per body, seven float32 values) is written by sync from GetRotation. Witness: the bridge gate checks only that the region is in bounds and aligned. Its values are not witnessed, so a rotation gate is still missing and is recorded here for Phase B.
- engine/src/engine_core.cpp, ENGINE.md phase 3. New exports engine_transforms, engine_control, engine_inputs and engine_events. engine_tick now routes through tickBatch, with the leak variant kept as a per-tick loop. Witness: check-engine-core on both builds, and check-engine-bridge gate 3 for the one-call rule. Unvalidated.
- src/engine/bridge.js, ENGINE.md phase 3. createBridge wraps the regions, with pushInput, tick, epoch, tickCount, bodyCount, droppedEvents, drainEvents and transform. Its constants are checked against bridge.h by gate 1 of the bridge gate. Unvalidated.
- src/engine/EngineWorld.js, ENGINE.md phase 3. step() goes through the bridge. tick reads engine_ticks directly, so importState's engine_set_tick is visible at once. loadEngineModule is now exported for the gates. Witness: check-engine-world and check-engine-bridge. Unvalidated.
- scripts/check-engine-bridge.mjs, ENGINE.md phase 3. Seven gates, not in npm test until Phase B passes them. Package script check:engine-bridge added to package.json.
- Gate 3 of check-engine-bridge counts every _engine_ export. The count rule holds only if the wrapper that the gate installs is the one the bridge calls, which the bridge does through module._engine_tick at call time.

## Phase 4: body pools and allocation witness

- engine/src/world.h and engine/src/world.cpp, ENGINE.md phase 4. Slots are the storage index. A handle is the generation in the top 16 bits and the slot in the low 16 bits, so a fresh world's first handles are 0, 1, 2 and phase 2 ids keep their meaning. A free-slot stack reuses despawned slots. spawnBatch creates bodies with CreateBody, then runs AddBodiesPrepare and AddBodiesFinalize on a copy of the IDs, because Prepare shuffles its array. despawn runs RemoveBody and DestroyBody and bumps the slot's generation. Witness: scripts/check-engine-pools.mjs gates 1 to 5. Unvalidated.
- Allocation counters in world.cpp. Jolt's Allocate, Reallocate, Free, AlignedAllocate and AlignedFree are replaced with counting wrappers after RegisterDefaultAllocator. The aligned path stores the malloc block just before the aligned pointer. Witness: check-engine-pools gate 6, zero allocations after warmup over 10000 cycles. This is the most likely failure in phase 4. Jolt may allocate on its first contacts or on the first AddBodies, so the warmup in gate 6 must cover those paths. If the gate shows a count, record where the allocations come from before changing the gate.
- Known limits to record in Phase B: a slot's 16-bit generation wraps after 65536 reuses of that slot, so a very old handle could match again. Despawned slots keep their last position values in the region, which JavaScript never reads but a raw reader would see. The stage region holds up to 4096 rows, which matches kMaxBodies.
- engine/src/engine_core.cpp, ENGINE.md phase 4. New exports engine_stage, engine_stage_handles, engine_spawn_batch, engine_despawn, engine_mark_warmup, engine_allocations_since_warmup and engine_allocations_total. The set handle and set velocity exports take a handle, not an index. Witness: check-engine-pools gates 4 and 6, and check-engine-bridge (its inputs still name a body by handle, and handle 0 is still the first body). Unvalidated.
- src/engine/EngineWorld.js, ENGINE.md phase 4. Bodies are tracked in a set of live handles. count is the set size. spawnMany writes rows into the stage region as float32 and reads handles back from the handle region. despawn, markWarmup and allocationsSinceWarmup are new. Hash, snapshot and state export gather positions in slot order, so a world with holes hashes the same way a contiguous world does. Witness: check-engine-pools and check-engine-world. Unvalidated.
- scripts/check-engine-pools.mjs, ENGINE.md phase 4. Six gates, not in npm test until Phase B passes them. Package script check:engine-pools added.



## Phase 5: PlanetShape and the page cache

- Files: engine/src/planet_frame.h/.cpp (cube-sphere port of src/terrain-pure/cubeSphereCells.js: FACE_FRAME, EDGE_TABLE, pickFace, worldToFaceLocal, worldToCell, packCellKey, resolveCell, heightAt, state()), engine/src/page_cache.h/.cpp (64 slots of 16 by 16 float samples: stage, commit, releaseKey, applyPending), engine/src/surface_shape.h (shared Jolt Shape overrides), engine/src/sphere_contact.h (contact conversion to CollideShapeResult), engine/src/planet_shape.h/.cpp (PlanetShape with subtype User1; collide functions for (User1, Sphere) and (Sphere, User1)), engine/src/world.h/.cpp (configurePlanet removes the flat ground body and sets zero world gravity; applyRadialGravity from a PhysicsStepListener), engine/src/bridge.cpp (applyPending at tick start, before the input drain), engine/src/engine_core.cpp (planet and page exports), engine/CMakeLists.txt (sources and exports), src/engine/EngineWorld.js (planet and page methods), scripts/check-engine-planet.mjs, package.json (check:engine-planet, not in npm test).
- ENGINE.md phase: 5. Witness needed: scripts/check-engine-planet.mjs, run after the build. Gates: locateCell, resolveCell and cellKey match cubeSphereCells.js; a commit is resident only after the next tick; a release leaves the table at the next tick; a zero radius or zero cell size is refused; a sphere settles at R plus its radius within 0.05 m; 2000 ticks of scripted flight after warm-up give zero allocations, an unchanged physics body count and unchanged memory.
- NOT measured here and still owed: frame-time p99 against spoint's streamer on the same path (ENGINE.md phase 5 witness).
- Decisions made in code, for the dispatcher to confirm:
  - The far field is flat, height 0. Spoint's procedural height is not ported. heightAt counts each fallback in engine_planet_gap_queries.
  - heightAt and the collide function sample only the owning face's page, at the sphere centre. There is no neighbour resolve at a seam and no footprint sampling.
  - Pending commits apply at tick start. Within one batch, releases apply before commits. A commit to a key that is already resident replaces the older slot.
  - CastRay returns no hit, GetTrianglesNext returns 0 and CollidePoint is a no-op. No cast shape is registered. CharacterVirtual and cast queries against the planet are therefore unsupported. ENGINE.md phase 5 asks for triangles for the patch under a contact and for sRegisterCastShape, which this does not do.
  - PlanetShape bounds are radius plus maxHeight. A page above maxHeight is outside the broadphase bounds, and nothing refuses it.
  - Radial gravity writes through BodyInterface::AddLinearVelocity inside OnStep.
  - Reconfiguring the planet removes the previous planet body. The flat ground returns only after World is configured again.
- Jolt calls not checked against the headers in a build: CollideShapeCollector::ShouldEarlyOut, the CollideShapeResult constructor argument types (Vec3 or RVec3), CollideShapeSettings::mMaxSeparationDistance, PhysicsStepListener registration, PhysicsSystem::GetNumBodies, RVec3::sZero, Vec3::sReplicate, Mat44::Inversed, PhysicsMaterial::sDefault.GetPtr, MassProperties default construction. surface_shape.h guards the JPH_DEBUG_RENDERER overloads, and this build does not define that macro.
- Parity risk: the atan in the wasm libm and in V8 can differ in the last bit, so a point on a cell boundary may map to the neighbouring cell. The parity gates report that as a FAIL, with no tolerance.
- Precision: Jolt body positions are float32. At R = 1000 the step is about 6e-5 m. Larger planets need a precision review.
- Open against ENGINE.md: the non-planet ENGINE.md phase 5 text for the sphere, capsule and box cast pairs and for CharacterVirtual is not coded.

## Phase 6: vegetation field

- Files: engine/src/vegetation.h/.cpp (Field of 32 by 32 XZ cells of 8 m, 32 instances per cell, classes trunk, rock and pass-through; VegetationShape with subtype User2; collide functions for (User2, Sphere) and (Sphere, User2)), engine/src/world.h/.cpp (attachVegetation, addTrunk, kMaxLegacyTrunks, Init body capacity raised by 1024 for the one-body-per-tree arm), engine/src/engine_core.cpp (vegetation, trunk and physics body exports), engine/CMakeLists.txt, src/engine/EngineWorld.js (configureVegetation, placeTree, attachVegetation, vegetationPlaced, addTrunk, physicsBodies), scripts/check-engine-vegetation.mjs, package.json (check:engine-vegetation, not in npm test).
- ENGINE.md phase: 6. Witness needed: scripts/check-engine-vegetation.mjs, run after the build. Gates: one vegetation body for 1024 trunks; a sphere is stopped by a trunk; a control sphere outside the reach passes it; a rock stops a sphere and a pass-through class does not; 40 dropped spheres stay above the ground; the field adds 1 body and the one-body-per-tree arm adds 1024, with timings printed and not thresholded; a full cell refuses a 33rd tree, and out-of-field and oversized placements are refused.
- Deviations from ENGINE.md for the dispatcher to decide:
  - ENGINE.md keys the per-cell table by cube-sphere cell. Phase 6 uses a planar XZ grid on the flat ground. Cube-sphere keying for vegetation is not coded, and it must be decided before the phase 6 witness is run on the planet.
  - ENGINE.md tests against the class's prebuilt shape transformed in place. This code tests analytic capsules and yaw-rotated boxes, so no Jolt sub-shape is built per class.
  - Promotion of touched instances to pooled dynamic bodies is not coded. The phase 6 witness does not need it.
  - Horizontal reach is capped at 2 m and scale at 2. Larger values are refused by place.
  - Trunk geometry is a vertical segment from the base up 6 m times the scale, with radius 0.4 times the scale. A rock is an axis-aligned box of half-size 0.6 times the scale, rotated about Y by yaw.
  - Inside a rock box the contact axis falls back to +Y.
  - The one-body-per-tree arm exists only for the cost comparison. It raises Init's body capacity by 1024, so the phase 2 world witness must be run again.
- Jolt calls to check in a build: the (User2, Sphere) registration order, and CapsuleShape's half height, which is the half length of the cylinder part.

## Phase 7: bit-compatible wire codecs
- Files: `engine/src/codec.h` and `engine/src/codec.cpp` (29-byte entity and 22-byte player records, the smallest-three quaternion word, and the input packet, version 1 with a 2-byte header and 12-byte records), exports in `engine/src/engine_core.cpp` through shared scratch buffers (4096 bytes and 2048 doubles), sources and exports in `engine/CMakeLists.txt`, `scripts/gen-engine-codec-fixtures.mjs` (writes `scripts/fixtures/engine/codec-cases.json` from `src/wire/binSnapshot.js` and `src/protocol/input.js`, not run), `scripts/check-engine-codecs.mjs` (bit-compatibility gate, not run), and package scripts `check:engine-codecs` and `gen:engine-codec-fixtures`. The check is not in `npm test`.
- Witness gates, not run: entity and player encode bytes equal the JS codec's bytes; entity, player and smallest-three decodes equal the JS decoder value for value and bit for bit; smallest-three encode words equal the JS words; input packets encode and decode byte for byte; every case the JS codec refuses, the C++ codec refuses; a truncated record is refused.
- Decisions and deviations for the dispatcher to decide:
  - Only the input packet in `src/protocol/input.js` is ported in the first pass. The schema-driven `src/protocol/inputCodec.js` is ported in Gap closure 2.
  - Rounding: JS `Math.round` rounds a half toward +Infinity. `jsRound` takes the floor and adds one when the fraction is at least 0.5, which matches that rule for the magnitudes the wire carries. It is not proven for values near 2^53.
  - A refusal returns `kRange` (-2) from the export, where JS throws a RangeError. The gate checks only that the code is negative. The refusal reasons are not carried across.
  - The smallest-three arithmetic runs in double, as the JS does, and packs into a uint64 before storing the word. The word is at most 2^32, so it is exact in a double.
  - Decodes of random uint32 words check refusals as well as values, since the JS decoder refuses words whose stored squares exceed 1.
  - The scratch buffers are module-wide and not reentrant. The engine is single-threaded, so this is not a concurrency fault, but a caller must copy results out before the next codec call.
- Checked by reading the JS source, not by running it: the field offsets, the scale and velocity ranges, the quaternion levels, steps, span and shifts, the input packet layout, and the yaw step count. Those values were transcribed from `src/wire/binSnapshot.js`, `src/wire/quantize.js` and `src/protocol/input.js`, and the gate is what proves them equal.
- To check in a build: the Emscripten exports for the byte and double scratch pointers, and the pointer-to-index conversion in the gate (byte offset for `HEAPU8`, byte offset divided by 8 for `HEAPF64`); `-ffp-contract=off` keeps the decode arithmetic unfused.
- The fixture file does not exist until `gen:engine-codec-fixtures` is run in Phase B. The gate fails on a missing fixture, not on a mismatch.

## Phase 8: client resource pools
- Files: `src/client/resourcePools.js` (a slot pool with generation handles, and light, texture-array, mesh and pipeline-registry pools over preallocated typed arrays), `scripts/check-client-resource-pools.mjs` (gate, not run, not in `npm test`), `scripts/browser/client-resource-pools.html` and `scripts/browser/client-resource-pools-browser.js` (witness page, not run), the package script `check:client-resource-pools`, and one scope line in `scripts/check-hygiene.mjs` for `src/client/resourcePools.js`.
- Witness, not run: adding and removing lights, textures and meshes during play leaves frame-time p99 unchanged, and no pipeline compiles after seal. The page measures JavaScript-side frame time only, with a registry stand-in for compiled pipelines. The WebGPU render cost is phase 10's witness.
- Decisions and deviations for the dispatcher to decide:
  - This phase is JavaScript. ENGINE.md's slot rules belong to the wasm renderer (phase 10), so the module does not reach the GPU yet. Its pools are the slot layer phase 10 reads.
  - The materials table is coded in Gap closure 3.
  - A handle is generation times 65536 plus slot. Generations 1 to 65534 are issued, and a slot retires at its last generation instead of wrapping (see Gap closure 1).
  - Mutators throw a RangeError on a stale or unknown handle. `add` checks its input before it takes a slot, so a refused input leaves the pool unchanged, and returns -1 when the pool is full.
  - Mesh indices are the mesh's own vertex indices. The renderer adds the vertex offset that `rangeInto` returns. Each slot has a fixed vertex and index capacity, so a mesh cannot grow into its neighbour.
  - `seal()` compiles every registered pipeline. If a compile throws, the registry stays unsealed and its compile count is partial.
- Unverified: the hygiene scope line was added without running `check:hygiene`. The no-allocation claim is witnessed only as buffer identity after churn, not by a heap diff. The page's own handle arrays allocate each frame, so its p99 includes that cost, and the cost has not been measured.

## Gap closure 1: generation wrap, phases 4 and 8
- Change: a slot retires at its last issued generation instead of wrapping, so no handle it issued can match again. C++ body pool (phase 4): generations 0 to 65534 are issued, and `despawn` at generation 65534 sets 65535, counts the slot in `retired_`, and never returns it to the free list. JS slot pool (phase 8): generations 1 to 65534 are issued, and `release` at 65534 sets 65535 and counts the slot in `retired`. A retired slot cannot be acquired.
- Capacity: retired slots leave the capacity. C++ `spawnBatch` checks `capacity - live - retired`. The JS wrapper's full check counts retired slots, and `EngineWorld.retiredSlots` reads the new `engine_retired_slots` export. The JS pool's `count()` excludes retired slots, and `retired()` reports them.
- Files: `engine/src/world.h`, `engine/src/world.cpp`, `engine/src/engine_core.cpp`, `engine/CMakeLists.txt` (export `_engine_retired_slots`), `src/engine/EngineWorld.js`, `scripts/check-engine-pools.mjs` (phase 4 gate 'a slot retires at its last generation...'), `src/client/resourcePools.js`, `scripts/check-client-resource-pools.mjs` (phase 8 gate 'a slot retires at its last generation...').
- Witness, not run: phase 4, 65,535 spawn and despawn cycles on one slot of a capacity-2 world. Every issued handle is refused by despawn, the next spawn lands in slot 1, `retiredSlots` is 1, and a further spawn is refused. Phase 8, 65,534 acquire and release cycles on a one-slot pool. Every issued handle resolves to -1, `retired()` is 1, `count()` is 0, and a release of the last handle returns false.
- Decisions: the C++ and JS pools start at different generations (0 and 1), so they issue 65,535 and 65,534 handles per slot. The JS start at 1 keeps handle 0 free as the "none" sentinel for the material table.
- Cost: each slot is lost after its last generation, which is one slot per 65,535 uses (C++) or 65,534 (JS). The loss is not measured. A long-running host should watch `retiredSlots` against its budget.

## Gap closure 3: material table as slots, phase 8
- Change: `createMaterialPool({ capacity, textures })` in `src/client/resourcePools.js` holds materials as slots. Nine floats per slot are in one `Float32Array` (r, g, b, a, roughness, metallic, emissive r, g, b), and the albedo texture handle is in one `Uint32Array`, where 0 means no albedo. Material objects are never stored. The pool exposes `add`, `set`, `read` (which writes into a caller array and returns the albedo handle), `albedoOffset`, `isLive` and `remove`.
- Refusals: colour and roughness and metallic must be finite and in 0 to 1. The emissive values must be finite and zero or more. A non-object is a TypeError. An albedo must be 0 or a live handle of the texture pool, which is checked on add and on set. Every check runs before a slot is taken, so a refused material leaves the table unchanged.
- Dangling albedo: when the texture under a material is removed, `albedoOffset` returns -1, so the renderer can fall back. The old handle stays stale when the layer is reused, because texture handles are generation-checked.
- `createTexturePool` gains `isLive`, which the material pool uses to check albedo.
- Files: `src/client/resourcePools.js`, `scripts/check-client-resource-pools.mjs` (three gates: slot round trip and refusals, full table and removal, albedo validation and dangling textures, and a churn gate with the same backing buffers).
- Witness, not run, phase 8: the material gates in `scripts/check-client-resource-pools.mjs`. The browser page does not yet draw from the table, so the frame-time witness has not been extended to materials.
- Deviation: the material table is JavaScript, as the rest of phase 8 is. Its slots are the layer the phase 10 renderer will read, which ENGINE.md places in the wasm module.

## Gap closure 2: schema-driven input codec, phase 7
- Port: `src/protocol/inputCodec.js` (`tryEncodeInputPacket` and `decodeInputPacket`) is ported in `engine/src/codec.h` and `engine/src/codec.cpp` as `encodePacket` and `decodePacket`. `InputCase` has the same order as `INPUT_CASE_CODES`, and a refusal returns `-1 - code`, so the code is `-1 - result`.
- Layout: each entry is 24 doubles. They are the sequence, the button bits (a uint32, masked to the schema's button count), yaw, pitch, expr, the analog flag (0 or 1), analog forward, analog right, then up to 16 axes. An undefined field is passed as 0, which the JS also reads as 0. The schema crosses the boundary as counts only (up to 32 buttons and 16 axes). Names, reserved-name checks and duplicate checks stay in JS.
- Outputs: encode writes the packet into the byte scratch and writes the clamped, wrapped and dropped counts to `engine_codec_counts()`. Decode writes the entries into the value scratch and the epoch to `engine_codec_packet_epoch()`. The value scratch grows to 8192 doubles, so 256 entries of 24 values fit.
- Deviations for the dispatcher to decide: (1) the C++ refuses more than 256 entries under the Count case, where JS takes any length. Up to 256 entries, the eight-record cap and the dropped count match. (2) The C++ refuses a button word that is not a uint32, which the JS never produces. (3) Refusals carry the code only, not the JS message. (4) The JS schema validation stays in JS. (5) The C++ caps extra axes at 16, where the JS accepts any number, so a schema with more than 16 axes is refused by the C++ and not by the JS.
- Files: `engine/src/codec.h`, `engine/src/codec.cpp`, `engine/src/engine_core.cpp`, `engine/CMakeLists.txt` (exports `_engine_codec_encode_packet`, `_engine_codec_decode_packet`, `_engine_codec_packet_epoch`, `_engine_codec_counts`), `scripts/gen-engine-codec-fixtures.mjs` (a packet section: three schemas, 200 encodes, the decodes of every accepted packet with dropping, truncation, a trailing byte, flags, a NaN axis and a bad count, plus crafted packets), and `scripts/check-engine-codecs.mjs` (two gates, schema packet encode and schema packet decode).
- Witness, not run, phase 7: encode bytes and the three counts equal the JS; decode values equal bit for bit; every refusal carries the same code index; the dropping path keeps the same records.

## Phase B: planet gate stall (fixed)

- Evidence before the fix. `scripts/check-engine-planet.mjs` ran to its 900 s timeout with one PASS line. A native reproduction (`build/diag/planet_repro.cpp`, a host build against the Jolt library) aborted with `std::system_error: Resource deadlock avoided` from `BodyInterface::GetCenterOfMassPosition` inside the radial gravity step listener. Jolt runs step listeners with the body mutexes held, so a listener must use the no-lock body interface.
- Cause and fix. `RadialGravity::OnStep` now passes `context.mPhysicsSystem->GetBodyInterfaceNoLock()` to `World::applyRadialGravity` (`engine/src/world.cpp`). The same reproduction then showed the first flight step allocating a 131160-byte job page lazily. A warm-up job created in `World::configure` pages it before warm-up.
- Witness after the fix. `node scripts/check-engine-planet.mjs`, run on the committed state:

```
PASS releasing a page that is not resident is refused
PASS scripted flight after warm-up: zero allocations, unchanged body count and memory, pages streamed each 50 ticks
PASS a sphere dropped above the planet settles at R plus its radius within 0.05 m and at rest
PASS a released page leaves the table at the next tick
PASS a planet with a zero radius or a zero cell size is refused
PASS a committed page is visible only after the next tick, and the height it gives is the sample
PASS locateCell matches worldToCell from cubeSphereCells.js for 400 points on the planet
PASS resolveCell matches resolveCell from cubeSphereCells.js for 300 cells, edges included
PASS cellKey matches packCellKey for every resolved cell
RESULT: PASS
```

- Status: fixed. The native witness phase 5 also passes (see the native witness results below).
- Settle claim, tightened in Phase B. The gate used to check only the distance from the planet centre within 0.05 m after 1200 ticks, so a ball that was still moving through that shell would pass. It now also requires `world.velocity(handle)` to be at most 0.05 m/s. `node scripts/check-engine-planet.mjs` after the change: `PASS=9 FAIL=0`, `RESULT: PASS`.

## Phase B: CI record on engine-phase-b-ci

- Candidate and pin. The branch was fast-forwarded from 17b20fb to 57c1091 (the Phase B sources and gates), then to 211b8a7 (the artifact pin, `engine/artifacts.json`). PR #1 stays open and is not changed.
- Run 42538426531 (workflow_dispatch) on 57c1091, before the pin. The three builds succeeded: fixed 64 MiB, fixed 128 MiB, leak 64 MiB. The hash step failed as designed, because the manifest pinned the old 147e48a4. Its log shows `- '147e48a44fa4167a9d3daed9ad0a0407a58667910ec23a9b4e3f862e4247ab0c'` expected and `+ '4439bcb2f0bf75bf657dc417bc825abb8c18ad6c011e47b92170309930f275e8'` actual. The hash step stopped the job, so the engine gates were skipped in that run. The same run's PR-triggered twin 42538427138 failed the same way.
- The three hashes the build steps printed, which were pinned in 211b8a7:
  - 4439bcb2f0bf75bf657dc417bc825abb8c18ad6c011e47b92170309930f275e8  engine-core-64mib.wasm
  - 034fdc94b5fbc188ac6b115a5951f35ae31129c47dc86cb2f609434244ec5912  engine-core-128mib.wasm
  - 36d8c93f05bff54d9a397cc6cdd73a21f972a3260e3ae614b7c58437044445d0  engine-core-64mib-leak.wasm
  Each equals the local build of the same sources.
- Run 42538780790 (workflow_dispatch) on 211b8a7, the verification. Conclusion `success`, and every step `success`: both fixed-tier hash checks, the leak check, and the engine gate loop with `client-resource-pools`. Its gate lines, in order, with the PASS count before each RESULT: core 64 MiB 3 PASS, RESULT: PASS; core 128 MiB 3, RESULT: PASS; leak 3, RESULT: PASS; artifacts 6; world 13; bridge 7; pools 7; planet 9; vegetation 7; codecs 11; materials 15; interest 4; render 17; isolation 9; tiers 6; client-resource-pools 13. Every gate ended `RESULT: PASS`.
- Run 42538784360 (pull_request on PR #1, the same commit 211b8a7): conclusion `success`.
- Earlier runs, kept for the record. 42527924856: renderer compile errors, fixed in ecc5e16. 42528093877 and 42528259611: undefined WebGL2 context functions, fixed by `-lGL -lhtml5` in 64f9f6f. 42528467695: the pin did not match, fixed in 17b20fb. 42528628800 on 17b20fba: success with the old pin.
- Leak variant: the grep-based step is replaced by `scripts/check-engine-leak.mjs`, which pins the hash and asserts the memory growth. The log line `FAIL memory.buffer.byteLength is unchanged` from the old step is no longer used.

## Phase A rollout (witnessed in Phase B)

Every item below was `unvalidated` in Phase A, when nothing was compiled. Phase B built the module, ran each witness named here and recorded the output in "Phase B witness results" below. An item marked UNVERIFIED still lacks a witness.

### Memory plan, arena and allocator (ENGINE.md Memory, Bridge, phase 4)
- Files: `engine/src/arena.h/.cpp` (one static arena of `ENGINE_ARENA_BYTES`, set in CMake to the tier minus 4 MiB), `engine/src/budget.h/.cpp` (`budget::Capacity` and `plan`), `engine/src/pool_alloc.h/.cpp` (size-class blocks carved from the arena, Jolt hooks), `engine/src/world.h/.cpp`, `engine/src/bridge.h/.cpp`, `engine/src/engine_core.cpp` (`engine_init(players, workers, budgetBytes)`, `engine_layout`, `engine_arena_used`, `engine_arena_seal`, `engine_allocation_failures`), `src/engine/EngineWorld.js` (`resolvePlan`, `loadEngineModule`, `seal`, `arenaUsed`, `allocationFailures`, `layout`), `src/engine/bridge.js` (`readLayout`, `createBridge(module, layout)`).
- Witness: `scripts/check-engine-core.mjs` memory gates with the new init arguments; `scripts/check-engine-bridge.mjs` gates 1 to 7 (slot counts now come from `readLayout`); `scripts/check-engine-pools.mjs` gate 6 (allocations since warm-up zero); `engine/test/witness_phase4_pools.cpp`; `engine/test/witness_phase3_bridge.cpp`.
- Decisions taken in code, for the dispatcher to accept or change:
  - The memory is one module with one static arena. The budget chooses the player count inside that arena, so the budget never changes the wasm memory size. This answers Problems item 1 without a tier-per-build model, and it means the module always reserves `ENGINE_ARENA_BYTES`.
  - Body, pair and contact maxima are derived from the body tier: Jolt bodies = bodies + statics + trunks + 3, pairs = bodies × 4, contacts = bodies × 5 / 2. The old fixed `+1` covered only the ground body.
  - Body tiers: `players ≤ 16: 512 + 32p`, `≤ 256: 1024 + 16p`, `≤ 1024: 2048 + 8p`.
  - `allocationsSinceWarmup` counts arena carves after `markWarmup`. A Jolt allocation served from a free block is not counted. `allocationsTotal` counts every carve, including init.
  - `ENGINE_THREADS` selects `JobSystemThreadPool(maxJobs, maxBarriers, workers − 1)`. Only the single-threaded path is in scope for Phase A.
  - Leak variant keeps its `malloc` on purpose, as the witness. Cached views assume fixed memory, so the leak variant reads detached views once memory grows.
- Per-unit costs, as estimated in code: body 119 bytes plus 1024 for Jolt; static, trunk or fixed body 512; contact 384; pair 128; Jolt fixed 524,288; Jolt temp 16 MiB; pool prime 669,696; page slot 1033 (×64); vegetation cell 772 (×1024); material 64; texture 32; light 32; input slot 20 (×8 per player); event 16 (×256); interest cell 516 (×1024); snapshot 29 × 128 per player; baseline history 29 × 128 × 8 per player; codec 69,648; worker scratch 65,536 each; slack 1 MiB.
- Totals from `budget::plan` in Phase B, measured with `build/diag/plan_table.cpp` on the 124 MiB arena of the 128 MiB build (the plan includes the terms Phase A left out: temp 2048 bytes per body, the 2 MiB render reserve, and the quad-tree node pages): 64 players 36,102,224 bytes (34.4 MiB) with one worker and 36,560,976 (34.9 MiB) with eight; 256 players 57,920,592 (55.2 MiB) and 58,379,344 (55.7 MiB); 1024 players 109,344,848 (104.3 MiB) and 109,803,600 (104.7 MiB). The 1024 plan needs the 128 MiB build. At the 64 MiB budget, 1024 players does not fit, so `plan` falls back to 256 players, which fits (owner decision 2026-11-08).
- UNVERIFIED: the Jolt per-body, per-static, per-contact and per-pair costs are estimates. Witness: measure `PhysicsSystem::Init` and a full body footprint in Phase B against these.
- Verified on emscripten 4.0.10 (Phase B): the memory exports are called by `check-engine-core`, `check-engine-tiers` and `check-engine-leak`, and the tier fallback is checked by `check-engine-tiers`. The `ENGINE_THREADS` branch is still not compiled.

### Proposed by jayzee: capacity table for ENGINE.md Memory

This is proposed text for the dispatcher to place under the Memory section. The contract file is not edited here.

> **Proposed by jayzee.** The budget chooses the player count. Everything else follows from it, and the arena holds all of it.
>
> | Players | Bodies | Arena, 1 worker | Arena, 8 workers | Snapshot segment per client | Baseline history per client |
> |---|---|---|---|---|---|
> | 64 | 2048 | 34.4 MiB | 34.9 MiB | 4,752 B | 33,856 B |
> | 256 | 5120 | 55.2 MiB | 55.7 MiB | 4,752 B | 33,856 B |
> | 1024 | 10240 | 104.3 MiB, over the 64 MiB tier, so a 64 MiB device runs 256 | 104.7 MiB | 4,752 B | 33,856 B |
>
> Per-client snapshot segment is `16 + 37 × visiblePerClient` with 128 visible. Baseline history is `baselineDepth × (8 + 33 × visiblePerClient)` with depth 8. The 1024-player row needs a larger tier than 64 MiB.

Phase B replaced the estimates above with the measured plan totals (see the memory section). The table below uses those totals.

### Materials and textures owned by C++ (phase 8, ENGINE.md Client resources)
- Files: `engine/src/textures.h/.cpp` (texture slots, handle allocator with generations 1 to 65534 and retirement), `engine/src/materials.h/.cpp` (40-byte material slots, ten words, albedo as a texture handle), `engine/src/exports_materials.cpp`, `src/engine/materials.js` (`createMaterials`, `createTextures`, constants), `src/client/resourcePools.js` (`createMaterialPool` and `createTexturePool` now require a wasm host and throw a TypeError without one), `scripts/check-client-resource-pools.mjs` (material and texture gates removed), `scripts/check-engine-materials.mjs` (the material and texture gates against the module), `scripts/check-hygiene.mjs` (one scope line).
- Witness: `scripts/check-engine-materials.mjs` for the three material gates and the churn gate; `engine/test/witness_phase8_resources.cpp` for the native refusals, retirement at generation 65534, and churn of 10000 cycles with unchanged arena and view offset.
- Deviations: handles and albedo are `double` on the boundary, so a fraction is refused by C++ rather than truncated by `ToInt32`. Format codes 1 (RGBA8 UNORM) and 2 (RGBA8 sRGB) are chosen here; the brief named none. C++ holds slot metadata only. The texture pool's pixels are a JavaScript `Uint8Array` passed in, not a region in engine memory. The renderer reads texture pixels from engine memory, so this must be carved in Phase B before the renderer can draw an albedo from the pool. The browser page `scripts/browser/client-resource-pools-browser.js` now passes the wasm table and a JavaScript pixel buffer.
- UNVERIFIED: no per-call object creation in the pools is witnessed only by reading. A JavaScript `Number` passed to an `f32` export is rounded at the boundary; the gate uses values exact in f32.

### Interest management and snapshot delta (large player counts)
- Files: `engine/src/interest.h/.cpp` (CSR grid over XZ cells, per-client visibility lists, `bytesFor`, `bind`), `engine/src/snapshot_delta.h/.cpp` (baseline ring and delta writer), `engine/src/exports_interest.cpp`, `src/engine/interest.js` (`createInterest`), `scripts/check-engine-interest.mjs`, `engine/src/world.h` (`slotExtent()`).
- Witness: `scripts/check-engine-interest.mjs`. Constants: 1024 bodies with 64 clients; an unchanged delta is 16 bytes of header; a moved body appears once; visible count never exceeds `visiblePerClient`.
- Decisions for the dispatcher: the ring stores 33 bytes per entry (body index plus record), because removed-body detection needs each baseline's index. The newest state is the current visibility list, so the usable baselines are `baselineDepth − 1`. Rotation is the identity and scale is (1, 1, 1), because the World has no per-body rotation word or scale yet. Ticks are 32-bit in the interest API; the host passes the low 32 bits. Clients store integer cell indices, not positions, so interest state is integer. Truncation is counted per update, not cumulatively.
- Known gap: `interest::update` is fed `slotExtent()` (the fresh-slot count), not the live count, so a world with holes reads every slot it has ever issued.
- Phase B: the emscripten build compiles `std::sort`, `std::lower_bound` and `memcpy` under `-fno-exceptions -fno-rtti` (CI). `check-engine-interest` passes its four claims. The assumption that `set_position` takes effect after one `engine_tick` is not separately witnessed.

### Renderer in the module, WebGPU and WebGL2 (phases 10 and 11)
- Files: `engine/src/render/render_frame.h/.cpp` (GPU-free frame plan: page layers, body records, prop compaction, material resolve, frustum planes, FNV checksum), `engine/src/render/render_backend.h`, `engine/src/render/render_webgpu.h/.cpp` (through `webgpu_cpp.h`, three WGSL modules), `engine/src/render/render_webgl2.h/.cpp` (GLSL ES 3.00, CPU culling, instanced draws), `engine/src/exports_render.cpp` (25 exports), `src/engine/renderer.js` (`loadRenderer`, `createRenderer`, `chooseBackend`), `scripts/check-engine-render.mjs`, `scripts/browser/engine-render.html` and `engine-render-browser.js` (one page for phase 10 with `?phase=10` and phase 11 with `?phase=11`).
- Witness, run in Phase B on the real adapter: `engine-render.html?phase=10` (WebGPU) and `?phase=11` (WebGL2) at both tiers, with `allocations_since_warmup == 0`, the per-frame API call count, the checksum and the adapter info. See "Real-adapter runs" below.
- Deviations: single-threaded only. No render pthread or OffscreenCanvas flag, so UNVERIFIED for ENGINE.md's threading row. No `WEBGL_multi_draw`: one instanced draw per prop class plus one terrain draw. Lights are one flat fixed buffer with a count, not clusters. Props are a built-in cube until the shape library has vertex and index buffers. Terrain placement comes from the host (`placePage`), because the planet frame has no cell-to-world inverse. WebGPU culls on the GPU, but the witness's visible counts come from the CPU plan, since reading GPU counts back needs mapping. A swapchain view is created each frame and counted in the API calls. Capacities are constants (four prop classes, 10240 body slots, 64 page layers, 64 albedo layers, 256 lights and materials), not `budget::Capacity`.
- Body slots (Phase B): `rnd::kBodySlots` is `budget::kTopTierBodies`, 10240, so every tier renders every body it holds. `engine_render_init` still refuses with `kRange` when `world().bodyCapacity()` is above `kBodySlots` (`engine/src/exports_render.cpp`). No tier can reach that refusal, because the largest tier holds exactly 10240 bodies and `check-engine-tiers` refuses a world of 10241. The 4096 cap of Phase A is gone. Before the Phase A guard the renderer drew only the first 4096 bodies and reported no error.
- Witness (Phase B): `check-engine-render` asserts `kBodySlots = budget::kTopTierBodies` and `EXPECT_BODY_SLOTS = 10240` (17 PASS). The refusal itself is not called in a witness, because no tier can reach it (see the bullet above).
- The witness budgets (64 API calls per frame, 600 frames) are placeholders, not measurements.
- UNVERIFIED (ENGINE.md Open items and phase text): shared device across threads; OffscreenCanvas presentation from the emscripten port; one indirect-args buffer cost (phase 10 measure); the wasm-to-JS glue cost per WebGPU call (benchmark); R32Float terrain pages and unfiltered `textureLoad`; JSPI on Safari (no `WaitAny` is used, but the check is still owed).
- The Dawn names compile and link under emscripten 4.0.10 (CI run 42538426531 and the local builds), and the WebGPU witness runs them. Still open: the Dawn port is the legacy `USE_WEBGPU` one, which emscripten warns is deprecated for `emdawnwebgpu`; the migration is a separate change. The surface format is fixed at BGRA8Unorm.
- Not implemented: the three.js control page. ENGINE.md phase 10 needs it for the reference images.
- Upload gap: a page re-staged while still resident needs `engine_render_mark_page(slot)` after commit. The streamer must call it, and no streamer is in Phase A.

### Witnesses for phases 2 to 8 in C++ (second witness, native host build)
- Files: `engine/test/harness.h`, `engine/test/witness_phase2_world.cpp` through `witness_phase8_resources.cpp`, `engine/test/main_all.cpp`, `engine/test/build_host.sh` (compile line as text, not run).
- Gate counts: phase 2 has 16 checks and 14 printed values; phase 3 has 21; phase 4 has 17; phase 5 has 24; phase 6 has 33; phase 7 has 23; phase 8 has 46.
- Expected numbers are constants in the files, and the list of names each witness uses is in the phase reports. Phase 4 runs 65535 spawn and despawn cycles on one slot of a capacity-2 world: generations 0 to 65534, the retired count is 1 after 65535, and the next spawn lands in slot 1. The churn of 10000 bodies in batches of 16 on capacity 64 has zero allocations after warm-up.
- The host build uses `ENGINE_ARENA_BYTES=268435456ull`, which is larger than the wasm arena. The witness agent suspected that a 64 MiB arena cannot hold the phase 6 witness's two 16 MiB temp allocators at once. That is UNVERIFIED and is checked in Phase B by measuring `arena::used()` at the phase 6 witness.
- Phase B checked the witness names: `engine/test/build_host.sh` compiles and runs all of them (194 PASS, 0 FAIL).

### Integration fixes made after the agents reported
- `engine_init` now binds the planet state, the vegetation field, the codec scratch, the materials, the textures and the interest state. Before this, the first `tickBatch` dereferenced a null planet pointer. The witness agent found it.
- The codec exports read `codecScratch->bytes`, `values`, `counts` and `packetEpoch`, not the removed statics.
- `budget.cpp` no longer has three `static_assert`s on names that do not exist in the headers.
- `engine/CMakeLists.txt`: the new sources, the 53 new exports from the sources, `ENGINE_ARENA_BYTES`, and `-sUSE_WEBGPU=1 -sMIN_WEBGL_VERSION=2 -sMAX_WEBGL_VERSION=2`.
- The gates that called `_engine_init()` with no arguments now pass the plan. `scripts/check-engine-bridge.mjs` reads slot counts from the layout, and its two assertions against removed C constants are gone. `src/engine/renderer.js` passes the plan too.
- `scripts/check-engine-render.mjs` expects `kBodySlots = 4096`, which matches the render constant.
- The interest export feeds `slotExtent()`, not `count()`.

### Service-worker isolation shim

- Files: `site/coi-sw.js` and `docs/play/coi-sw.js` (the same bytes; the gate compares them), `src/engine/isolation.js` (`ISOLATION_HEADERS`, `VARIANT`, `isolationPlan`, `registerIsolationShim`), `scripts/check-engine-isolation.mjs` (eight gates), `site/index.html` and `docs/play/index.html` (register `./coi-sw.js` when `!self.crossOriginIsolated && 'serviceWorker' in navigator`), and the `check:engine-isolation` entry in `package.json`.
- Row: ENGINE.md Threads row (owner decision 2026-11-08, service-worker shim on GitHub Pages).
- Behaviour: the shim sets `Cross-Origin-Embedder-Policy: require-corp` and `Cross-Origin-Opener-Policy: same-origin` on each same-origin response. The first load registers it, and the page reloads on `controllerchange`, so `crossOriginIsolated` is false until that reload.
- `isolationPlan` picks the threaded variant only when the page is already isolated and threads are requested. Otherwise it picks the single build, and it asks for registration when a service worker exists. No threaded build is produced in Phase A, so the threaded branch is code only.
- Witness (Phase B): `scripts/check-engine-isolation.mjs` passes nine claims (RESULT: PASS). These are the plan for each combination, registration calls with `./coi-sw.js`, unsupported cases, the header values, the docs copy equal to the site copy, and both pages guarded. OPEN: the public-site witness is not run. It needs `docs/play` served from GitHub Pages, and it must confirm `crossOriginIsolated === true` after the one reload and that `SharedArrayBuffer` is defined. That run has not been made, so the isolation row stays open.
- Known gap, recorded not fixed: opaque (status 0) cross-origin `no-cors` responses are returned unchanged. Under `require-corp` they stay blocked, so a page that loads an opaque cross-origin subresource fails to load it. The shim does not fix this.

### Deviations for the dispatcher

Phase A items below are unchanged unless marked Phase B. Phase B items are recorded here for the dispatcher to accept or change.

- Memory (Memory, Bridge, phase 4): one static arena of the tier minus 4 MiB, carved at init, with `budget::plan` choosing the player count inside it.
- Memory (phase 4, `allocations_since_warmup`): counts fresh arena carves. Phase B: a large freed block (above 64 KiB) is reused first-fit by capacity, not by exact size, because Jolt resizes its body arrays by one element per tick and exact reuse carved each resize.
- Memory (`engine_init`): the signature is `engine_init(players, workers, budgetBytes)`. The Jolt job system is `JobSystemSingleThreaded`; the thread-pool branch is not compiled.
- Memory (Jolt limits): body, static, pair and contact maxima derived from the body tier.
- Memory (tier fallback, owner rule 2026-11-08): `plan` tries 1024, 256 and 64 in turn, and `layout.players` reports the tier chosen.
- Memory (Phase B, Jolt quad tree): the broadphase node pages (256 nodes, 32 KiB each) are paged in lazily by Jolt. `budget::poolCounts` primes `joltQuadNodePages(capacity)` extra 64 KiB pool blocks at initialize, and `totalBytes` charges them. At 1024 players that is 60 pages.
- Memory (Phase B, Jolt temp): 2048 bytes per body on top of the 16 MiB base. Jolt's `TempAllocatorImpl` aborts when exhausted, and 10240 bodies exhausted 16 MiB.
- Memory (Phase B, render reserve): `kRenderBytes` is 2 MiB, static-asserted against `sizeof(RenderState)`.
- Memory (Phase B, warm-up): `World::configure` runs one warm-up job, so the job free list pages before warm-up. The quad-tree pages are primed as above.
- Memory (Phase B, sizes): the 1024-player plan is 104.3 MiB, so it needs the 128 MiB build. A 64 MiB device runs 256 players.
- Physics (Phase B, Jolt settings): `mPenetrationSlop` is 0 (Jolt default 0.02), and `mNumPositionSteps` equals the iterations (Jolt default 2). Cause: with slop 0.02 the ground rest was 0.3455 with drag 0.1, and a stack did not separate with more iterations. The float32 residuals (rest 3.75e-6, box top 9.5e-8) and Jolt's speculative contacts are inside the engine world gate's tolerance of 1e-5. The JavaScript world keeps 1e-9.
- Physics (Phase B, RadialGravity): the step listener uses the no-lock body interface, because Jolt holds body mutexes in step listeners.
- Materials and textures (phase 8, Client resources): C++ owns the slot tables and the handles, which cross the JS boundary as doubles. Texture format codes 1 (RGBA8 unorm) and 2 (RGBA8 sRGB). Texture pixels stay in JS memory and are not yet in engine memory.
- Pools (Phase B, gate): Jolt stores float32, so -0 can come back as +0. `check-engine-pools` normalizes both sides with `+ 0`.
- Interest (snapshot, large player counts): 33-byte ring entries; `baselineDepth - 1` usable baselines; rotation fixed to identity and scale to (1, 1, 1); 32-bit ticks; `update` is fed `slotExtent()`.
- Renderer (phases 10 and 11): single-threaded; no multi-draw; one flat light buffer, not clusters; props are a built-in cube; capacities are constants.
- Renderer (Phase B, body slots): `kBodySlots` is `budget::kTopTierBodies`, 10240, replacing the Phase A cap of 4096. `engine_render_init` still refuses a larger world with `kRange`, which no tier can reach.
- Renderer (Phase B, present): `surface.Present()` is removed. Emscripten refuses it, and the canvas presents at the end of the task.
- Renderer (Phase B, page layers): 64 page layers, one per page slot in the budget.
- Renderer (Phase B, WebGPU witness): superseded. The first Phase B pass ran the WebGPU witness in a self-launched Chromium that forced SwiftShader, and that runner has since been removed. Both witnesses now run in the gm playwriter browser, which reports the NVIDIA adapter. See "Adapter defects" below.
- Renderer (Phase B, witness scale): the witness page draws 512 bodies at the 64 tier, not the 2048 the 64-player plan holds, and 10240 at the 1024 tier. The checksum is pinned to the 512 scale.
- Renderer (Phase B, warning kept): the Dawn port is the legacy `USE_WEBGPU`. Emscripten 4.0.10 warns that it is deprecated for `emdawnwebgpu`, which implements a different `webgpu.h`. The migration is a separate change. Recorded, not fixed.
- Build (Phase B, warning kept): `-sMAXIMUM_MEMORY` is set on the fixed module with `ALLOW_MEMORY_GROWTH=0`. Emscripten warns that it is inert without growth. The flag stays so the fixed module's maximum is in its link line, and `check-engine-artifacts` asserts it. Recorded, not fixed.
- Leak variant (Phase B): `scripts/check-engine-leak.mjs` replaces the grep-based step. Its claims are the pinned hash and a memory buffer above the tier after 10000 ticks.
- Threads (ENGINE.md Threads row): the service-worker shim is the isolation route. Opaque cross-origin subresources stay blocked under `require-corp`. No threaded build is produced.

## Phase B witness results for the Phase A rollout

Each block quotes the output of a run made in Phase B on the committed state. The CI logs are run 42538780790 (`engine/artifacts.json` at 211b8a7). Local logs are not committed.

### Memory plan, arena and allocator (phase 4)
- `scripts/check-engine-core.mjs` on engine-core-64mib.wasm and engine-core-128mib.wasm: `PASS engine_init returns 0 and the memory starts at the tier named by the glue`, `PASS memory.buffer.byteLength is unchanged after 10000 ticks, and the tick counter reads 10000`, `RESULT: PASS`.
- `scripts/check-engine-bridge.mjs`: 7 PASS, `RESULT: PASS`. `scripts/check-engine-pools.mjs`: 7 PASS, `RESULT: PASS`.
- `scripts/check-engine-tiers.mjs`: 6 PASS, `RESULT: PASS`. Lines: `PASS a 64 MiB build given 1024 players and a 64 MiB budget runs the 256 tier and reports it`; `PASS a 128 MiB build given 1024 players and a 128 MiB budget runs the 1024 tier with 10240 bodies`; `PASS a 128 MiB build given 1024 players and only a 64 MiB budget falls back to the 256 tier`; `PASS the 1024 tier holds 10240 bodies: a full world spawns, steps and keeps its memory fixed`; `PASS the 1024 tier refuses a world larger than its 10240 bodies`; `PASS the 1024 tier carves nothing from the arena after warm-up, with 10240 bodies settling`.
- Post-warm-up carves, measured with `build/diag/tier_count2.cpp` (native, against the host Jolt library, with `plan`, `poolCounts` and the arena size of each tier): `carves since warmup 0` at 64 players (60 MiB arena, 2048 bodies) and `carves since warmup 0` at 1024 players (124 MiB arena, 10240 bodies, 540 ticks after warm-up). Before the fixes at 1024 players the same probe reported `carves since warmup 5`: four quad-tree pages (32 KiB each, from `QuadTree::UpdatePrepare`) and one 163,824-byte array resize, which exact-size reuse did not serve.
- Plan totals (`build/diag/plan_table.cpp`): see the memory section above.
- Native witness `engine/test/build_host.sh`, phases 2 to 8: `RESULT: PASS`, 194 PASS lines, 0 FAIL. Per phase, PASS lines: phase 2 17, phase 3 24, phase 4 17, phase 5 24, phase 6 33, phase 7 23, phase 8 48. The Phase A doc listed 16, 21 and 46 for phases 2, 3 and 8. Those were estimates before the code ran. The witness prints one PASS per check, so the measured numbers are the record.

### Materials and textures (phase 8)
- `scripts/check-engine-materials.mjs`: 15 PASS, `RESULT: PASS`.
- `scripts/check-client-resource-pools.mjs`: 13 PASS, `RESULT: PASS`.
- Native phase 8 (see above): 48 PASS lines, including `PASS phase 8: 10000 material add and remove cycles all succeed` and `PASS phase 8: the arena used bytes are unchanged over 10000 material cycles`.
- Browser page `scripts/browser/client-resource-pools.html`, run in the gm playwriter browser (`#out` read after the page wrote its JSON, 600 frames each for baseline and churn):
  `{ "compiledAtLoad": 2, "compileCountAfterPlay": 2, "baseline": { "p99Ms": 0.09999996423721313, "frames": 600 }, "churned": { "p99Ms": 0.6000000238418579, "frames": 600 }, "lightsLive": 8, "texturesLive": 8, "meshesLive": 8 }`, with no page error.
  - The pipeline compile count is 2 at load and stays 2 after play, so no compile happens during play.
  - Live counts after churn are 8 of each, which is the last churn batch of `CHURN_PER_FRAME` 8. The page does not assert these, and the gate covers the counts.
  - Defect found and fixed in this Phase B. The first run threw `texture layers 32 must match the wasm table capacity 512` from `createTexturePool`. The page passed `layers: 32` while the engine table holds 512, so the page never drew. The page now takes `layers` and the pixel buffer from the host's `capacity`, as `check-engine-materials.mjs` already does. The first run's error is the record; the result above is from after the fix.
  - Timing lines are the page's own p99 of `performance.now` around two registry gets per frame. They are not a budget.

### Interest management (large player counts)
- `scripts/check-engine-interest.mjs`: 4 PASS, `RESULT: PASS`.

### Renderer in the module (phases 10 and 11)
- `scripts/check-engine-render.mjs`: 17 PASS, `RESULT: PASS`.
Real-adapter runs (Phase B, WebGPU and Vulkan enabled on this machine). All four were run in the gm playwriter browser (pid 3562307, launched with `--user-data-dir=/workspace/.playwriter/browser-profile --remote-debugging-port=10252 --no-first-run --no-default-browser-check --no-sandbox`; the NVIDIA WebGPU comes from the profile's labs flags, see "WebGPU open items" below), one page per run, reading `window.engineRenderResult`. Each run is one 600-frame pass with the first 60 frames dropped, so each timing is a single run and has no variance estimate.

- WebGPU, 1024 tier (`engine-render.html?phase=10&tier=1024`): adapter `{"api":"webgpu","vendor":"nvidia","architecture":"ampere","device":"0x2520","description":"NVIDIA GeForce RTX 3060 Laptop GPU","isFallbackAdapter":false}`, backend `webgpu`, `frameTimeP99Ms` 78.60000002384186, `apiCallsPerFrame` 34, `allocationsSinceWarmup` "0", `createsAfterSeal` 0, `checksum` "-3826851758512048142", `visible` [729,746,747,750], `errors` [], `ok` true.
- WebGPU, 64 tier (`engine-render.html?phase=10&tier=64`), same adapter: `frameTimeP99Ms` 8.899999976158142, `apiCallsPerFrame` 34, `allocationsSinceWarmup` "0", `checksum` "-5415737363265412373", `visible` [18,20,21,20], `ok` true.
- WebGL2, 1024 tier (`engine-render.html?phase=11&tier=1024`), same GPU through ANGLE: adapter `{"api":"webgl2","vendor":"Google Inc. (NVIDIA Corporation)","renderer":"ANGLE (NVIDIA Corporation, NVIDIA GeForce RTX 3060 Laptop GPU/PCIe/SSE2, OpenGL 4.5.0)"}`, backend `webgl2`, `frameTimeP99Ms` 362.89999997615814, `apiCallsPerFrame` 45, `allocationsSinceWarmup` "0", `createsAfterSeal` 0, `checksum` "-3826851758512048142", `ok` true.
- WebGL2, 64 tier, same GPU: `frameTimeP99Ms` 34.69999998807907, `apiCallsPerFrame` 45, `allocationsSinceWarmup` "0", `checksum` "-5415737363265412373", `ok` true.

Withdrawn. The single-run timings above (WebGPU 78.6 ms against WebGL2 362.9 ms at 1024, and 8.9 ms against 34.7 ms at 64) did not reproduce. The 4.62 and 3.90 ratios that were computed from them are withdrawn, and no speedup is claimed from single runs. The three-repeat medians in "WebGPU and WebGL2 repeats" replace them. The cause of the 362.9 ms WebGL2 outlier is not established.

- The checksum agrees between the two backends at each tier (1024: -3826851758512048142, 64: -5415737363265412373).
- The SwiftShader WebGPU 1024 run in `build/diag/webgpu1024.json` (`frameTimeP99Ms` 140.4) is a software adapter. It is a defect record and not a baseline; the speedup above does not use it. See the defect below.
- The witness budgets (64 API calls per frame, 600 frames) are still placeholders.
- The `engine_render_init` refusal is not witnessed directly. No tier can reach it (see the renderer section).

### WebGPU open items, closed in the Phase A pass

- Decision, runner and dependency. The self-launched runner `scripts/browser/run-engine-render.mjs` is deleted. Jayzee does not depend on playwright-core, and the gm playwriter browser is the project's browser (INVARIANT 11), so the WebGPU and WebGL2 witnesses run there. Trade-off: the witness needs a headed browser with a display and cannot run in CI. `scripts/browser/run-player-webgpu.mjs` also reads `PLAYWRIGHT_CORE` and is not touched by this pass. It is recorded as OPEN in the same way.
- Cause of the SwiftShader adapter on direct launches. It is headless mode. `chromium.real --headless=new` loads `/usr/lib/chromium/libvk_swiftshader.so` in its GPU process and gets the SwiftShader adapter (`vendor google, architecture swiftshader, isFallbackAdapter true`), and WebGL2 reports `ANGLE (Google, Vulkan 1.3.0 (SwiftShader ...))`. The same binary launched headed, on the display, with `--enable-unsafe-webgpu --enable-features=Vulkan,WebGPUService`, gets the NVIDIA adapter (`isFallbackAdapter false`). Probe: `build/diag/probe/` (a local page that posts its adapter info to a local node server), run in four variants:

  | variant | WebGPU adapter | WebGL2 renderer |
  |---|---|---|
  | headed, no flags | none (`navigator.gpu.requestAdapter()` returns null) | NVIDIA, ANGLE over OpenGL 4.5 |
  | headed, `--enable-unsafe-webgpu --enable-features=Vulkan,WebGPUService` | NVIDIA ampere, not fallback | NVIDIA, ANGLE over OpenGL 4.5 |
  | `--headless=new` with the same flags | SwiftShader, fallback | SwiftShader |
  | `--headless=new`, no flags | none | SwiftShader |

- The gm playwriter browser's flags. Its command line has no GPU flags, as the earlier note said, but its profile `/workspace/.playwriter/browser-profile/Local State` carries the labs flags `enable-unsafe-webgpu`, `enable-vulkan@1` and `enable-webgpu-developer-features` in `enabled_labs_experiments`. So its NVIDIA WebGPU comes from the profile, not from the command line. If that profile is reset, the WebGPU adapter disappears, and the fix is the command-line flags above.
- Proof of the backend. Dawn's adapter comes from the Vulkan loader, shown three ways. (a) The NVIDIA GPU process of the gm browser (pid 3562360 at the time) maps `/dev/nvidia0`, `libnvidia-glvkspirv.so.580.178.04` and `libvulkan.so.1.4.341`, and the ICD file `/etc/vulkan/icd.d/nvidia_icd.json` is present. (b) With `VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/lvp_icd.json` set for the headed run, the WebGPU adapter changes to the SwiftShader fallback, so the choice follows the Vulkan ICD. (c) With `--disable-features=Vulkan`, the hardware adapter is also gone and only the fallback remains. Chromium's own log does not name Dawn or Vulkan at `--v=1`, so this is inference from the loader, not a log line. The adapter info has no backend field, so the backend is not read from the API directly. OPEN: a direct backend-type query.
- Timing repeats. Three repeats per backend per tier, medians and spread, are in "WebGPU and WebGL2 repeats" below.

### Dawn backend readout, the 64-tier slowdown, and the 362.9 ms outlier (Phase A)

- Withdrawn, as measured. The single-run speedups of 4.62 times at 1024 and 3.90 times at 64 are withdrawn. The medians below replace them.
- Dawn backend readout, captured over CDP. `scripts/browser/gpu-backend-readout.mjs [port] [out]` opens `chrome://gpu` in the gm playwriter browser's debug port (default 10252) with `PUT /json/new`, reads the page's text through `Runtime.evaluate` (including shadow roots), and closes the target. Run as `node scripts/browser/gpu-backend-readout.mjs 10252 build/diag/gpu-text.txt`, it saved 3263 lines, and the "Dawn Info" section lines below come from that capture. Its "Dawn Info" section lists four adapters, each with a backend name in its header and a "WebGPU Status" line:
  - `<Unknown GPU> OpenGLES backend - ANGLE (NVIDIA ...)`, WebGPU status Available.
  - `<CPU> Vulkan backend - SwiftShader Device (Subzero)`, Blocklisted.
  - `<Discrete GPU> Vulkan backend - NVIDIA GeForce RTX 3060 Laptop GPU`, WebGPU status Available.
  - `<CPU> Vulkan backend - llvmpipe (LLVM 21.1.8, 256 bits)`, Blocklisted.
  The page's `navigator.gpu` adapter is the discrete NVIDIA Vulkan one. Two runs show it: the adapter flips to the SwiftShader fallback when `VK_ICD_FILENAMES` points at lavapipe, and when `--disable-features=Vulkan` is set. The OpenGLES ANGLE adapter does not load the Vulkan ICD, so it is not expected to change in either run, and it did not become the page's adapter. This is inference from which adapter disappears. It is not a backend-type field read from the page, which the API does not expose. So the readout is the Vulkan backend from `chrome://gpu`, and the page's adapter is matched to it by that test, not by the vendor string.
- The 64-tier slowdown, cause found and fixed in the submission path. The WebGPU frame wrote the whole top-tier body buffer every frame, `kBodySlots` (10240) records, and dispatched the cull over `kBodySlots` too, while the 64 tier holds at most 2048 bodies (`scene.bodyCount` is the world capacity). The WebGL2 path uploads only the records it draws. Microbenchmark in the same browser, CPU time per call (300 calls each): `queue.writeBuffer` of 327,680 bytes 0.297 ms; of 65,536 bytes 0.047 ms; of 8,192 bytes 0.008 ms; `getCurrentTexture().createView()` 0.001 ms; an empty submit 0.003 ms; a bind group 0.002 ms. The fix in `engine/src/render/render_webgpu.cpp` uploads `scene.bodyCount` records and dispatches `ceil(bodyCount / 64)` groups. The cull shader already stops at `counts.y` (`bodyCount`), so the change is only the size. A/B run after the fix (`build/diag/ab64.json`, the page before the max-frame field): WebGPU p99 3.7, 3.3, 3.1 ms against WebGL2 3.0, 2.9, 3.1 ms, where the set before the fix had WebGPU at 4.0 ms median.
- The 64-tier residual. In the A/B run WebGPU was still about 0.2 ms slower. In set 2 (below) the p99 medians are equal at 3.1 ms, so no residual is recorded for the closed pass. The per-call costs above account for about 0.1 ms of the small remaining uploads and encoder calls. Candidates for any remaining gap are WebGPU's GPU-side cull with a compute pass and indirect draws, where WebGL2 culls on the CPU, and the wasm-to-JS glue cost per WebGPU call. The page's timer measures CPU time only, so a GPU-side wait would show here too. Separating them needs GPU timestamp queries, which this pass did not add.
- The 362.9 ms WebGL2 1024 outlier, unexplained. Its page result is gone (the value was read from the page and not saved), so there is no frame-by-frame record. The later repeats show long-frame stalls in both backends at 1024 (see "WebGPU and WebGL2 repeats after the 64-tier fix", set 2: WebGPU up to 705 ms, WebGL2 up to 98 ms). The page now records the maximum frame time (`frameTimeMaxMs`). The cause is recorded in "Stalls at 1024, Phase B diagnosis" below, and the exact 362.9 ms value was not reproduced in three WebGL2 runs there.
- A defect in the witness runs, recorded. `navigator.gpu.requestAdapter()` returned null on the first request after the gm playwriter browser was restarted (its pid changed from 3562307 to 3727756 during this pass). The next page load returned the NVIDIA adapter. The witness harness retries a run up to three times when the adapter is null, and it records `attempts`. Cause: see "Null adapter after the browser restart" below.
- The wasm artifacts changed, since `engine/src/render/render_webgpu.cpp` is compiled into all three builds. The pins in `engine/artifacts.json` now hold the local builds: 64 MiB `eb9a0bc9…`, 128 MiB `8475e5fb…`, leak `cde10937…`. The gate loop passes locally. The CI run on the push checks these pins against its own builds.

### WebGPU and WebGL2 repeats after the 64-tier fix (Phase B)

Two sets of three runs per backend per tier, on the build with the fix (`engine/artifacts.json` pins). Each run is a fresh page in the gm playwriter browser, 600 frames, the first 60 dropped. `frameTimeP99Ms` and `frameTimeMedianMs` come from `window.engineRenderResult`, and every run is `ok`, with zero allocations after warm-up and the same checksum per tier as every other run. The raw runs are in `build/diag/phaseb.json` (set 1), and `build/diag/phaseb-set2-64.json` and `build/diag/phaseb-set2-1024.json` (set 2).

Set 1 (runs 1 to 3). The machine's 1-minute load was 4 to 7 on 12 cores during this set, and the two WebGL2 64-tier runs and the first WebGPU 64-tier run have p99 values far above their frame medians, so this set is disturbed at 64.

| tier | backend | p99, runs 1 to 3 | p99 median | p99 spread (max − min) | median frame, runs 1 to 3 |
|---|---|---|---|---|---|
| 64 | WebGPU | 6.4, 3.8, 3.3 | 3.8 ms | 3.1 ms | 3.4, 2.7, 2.4 |
| 64 | WebGL2 | 2.9, 23.5, 26.8 | 23.5 ms | 23.9 ms | 2.2, 4.3, 4.8 |
| 1024 | WebGPU | 91.8, 58.2, 69.0 | 69.0 ms | 33.6 ms | 53.0, 48.8, 49.4 |
| 1024 | WebGL2 | 55.1, 55.8, 56.6 | 55.8 ms | 1.5 ms | 47.9, 47.5, 47.7 |

Set 2 (runs 4 to 6), run after set 1 at a 1-minute load of 4 to 7.

| tier | backend | p99, runs 4 to 6 | p99 median | p99 spread | median frame, runs 4 to 6 | max frame, runs 4 to 6 |
|---|---|---|---|---|---|---|
| 64 | WebGPU | 3.1, 3.2, 3.1 | 3.1 ms | 0.1 ms | 2.2, 2.1, 2.3 | 4.2, 3.4, 3.4 |
| 64 | WebGL2 | 3.1, 3.1, 2.9 | 3.1 ms | 0.2 ms | 2.2, 2.3, 2.1 | 3.4, 3.5, 3.5 |
| 1024 | WebGPU | 73.0, 144.2, 57.3 | 73.0 ms | 86.9 ms | 44.8, 45.2, 43.8 | 86, 705, 67 |
| 1024 | WebGL2 | 71.2, 79.1, 48.8 | 71.2 ms | 30.3 ms | 46.8, 44.8, 42.7 | 80, 98, 53 |

What the numbers support.

- 64 tier, the fix. Set 2 is the clean replicate, and the WebGPU and WebGL2 p99 medians are equal (3.1 ms each), with the median frame equal too (2.2 ms each). The set-1 64-tier gap was the top-tier upload that the fix removes, and set 1 cannot be used to compare the two backends at 64, because its WebGL2 runs and its first WebGPU run are disturbed.
- 1024 tier, the median frame. Over all six runs the median frame is 47.0 ms for WebGPU (runs 43.8 to 52.95) and 47.1 ms for WebGL2 (runs 42.7 to 47.9). That is no measured difference, so no speedup is claimed.
- 1024 tier, the p99. The p99 is raised by long frames, not by the median. In WebGPU run 5 the p99 of 144 ms means at least five frames of 144 ms or more, and the same run has a single 705 ms frame. WebGL2 has frames of 98 ms at most. This is the same kind of stall in both backends, and the p99 spread (30 to 87 ms) is wider than the median spread. The 362.9 ms WebGL2 outlier of the first pass is most likely this kind of stall, but it was not reproduced exactly, so its cause stays unexplained.
- Speedup. This pass records no speedup. The 1.25 times figure of the previous pass is withdrawn, because it came from a 64-tier WebGPU build that uploaded the top tier.

### WebGPU and WebGL2 repeats before the 64-tier fix (three runs per backend per tier)

Each run is a fresh page in the gm playwriter browser on the NVIDIA RTX 3060 Laptop adapter (WebGPU: `isFallbackAdapter` false, vendor nvidia; WebGL2: ANGLE over OpenGL 4.5 on the same GPU). Each run is 600 frames with the first 60 dropped. The value is `frameTimeP99Ms` from `window.engineRenderResult`. The raw runs are in `build/diag/repeats.json`.

| tier | backend | run 1 | run 2 | run 3 | median | spread (max − min) |
|---|---|---|---|---|---|---|
| 64 | WebGPU | 4.1 | 4.0 | 3.7 | 4.0 ms | 0.4 ms |
| 64 | WebGL2 | 3.2 | 3.1 | 3.3 | 3.2 ms | 0.2 ms |
| 1024 | WebGPU | 59.7 | 68.2 | 67.9 | 67.9 ms | 8.5 ms |
| 1024 | WebGL2 | 51.3 | 69.8 | 68.6 | 68.6 ms | 18.5 ms |

- Speedup from the medians. At 1024, WebGL2 median ÷ WebGPU median = 68.6 ÷ 67.9 = 1.01, so WebGPU is 1.01 times as fast. That is within the spread of both backends, so there is no measured difference. At 64, WebGPU median ÷ WebGL2 median = 4.0 ÷ 3.2 = 1.25, so WebGL2 is 1.25 times as fast. The 64-tier ranges do not overlap (WebGPU 3.7 to 4.1, WebGL2 3.1 to 3.3), so the gap held in all three runs of this set.
- Correctness, every run. `ok` true, no errors, `allocationsSinceWarmup` "0". The checksum is the same for every run of a tier and for both backends: 64 tier -5415737363265412373, 1024 tier -3826851758512048142.
- Withdrawn. The earlier single runs (WebGPU 78.6 ms and WebGL2 362.9 ms at 1024; 8.9 ms and 34.7 ms at 64) and the ratios computed from them (4.62 and 3.90) are not reproduced. The 362.9 ms WebGL2 value is an outlier in this set's terms: the three WebGL2 1024 runs here are 51.3 to 69.8 ms. Its cause is not established.
- Scope. Three runs is a small sample, and a p99 over 600 frames includes the page's CPU work (`engine_tick` and the CPU culling plan), so these numbers compare the two whole frames, not the GPU draw alone. A different GPU or driver may change the answer.

### Stalls at 1024, Phase B diagnosis

- What the recorded value measures. The harness's `frameTimeMs` is the synchronous time of `module._engine_tick` plus `renderer.frame()` inside its rAF callback. It is not the rAF interval, so a rAF throttle cannot produce these values. Each timed frame is 540 frames after the first 60.
- Method. A diagnostic copy of the harness in `build/diag/engine-render-diag.html` (git-ignored, not committed) times the tick and the render call separately, records rAF gaps and the long-task and long-animation-frame entries, and posts its raw samples to a local collector. A sampler logs busy CPU, the run queue and the load each 500 ms. A throttle logger reads `/sys/fs/cgroup/cpu.stat` each 100 ms. Raw files are in `build/diag/raw` and `build/diag/load-run*.log`, `build/diag/throttle-run*.log`, all local.

| run (1024 tier) | tick median ms | tick max ms | render median ms | render max ms | frame median ms | frame max ms | frames over 150 ms | Pearson, frame vs throttle | long-frame script pause ms |
|---|---|---|---|---|---|---|---|---|---|
| WebGPU r1 | 102.6 | 248.5 | 0.8 | 30.2 | 103.9 | 251.2 | 39 | not logged | 0 |
| WebGPU r2 | 88.1 | 147.0 | 0.6 | 23.8 | 89.0 | 147.6 | 0 | 0.41 | 0 |
| WebGPU r3 | 93.4 | 222.0 | 0.7 | 25.7 | 94.2 | 223.1 | 1 | 0.58 | 0 |
| WebGL2 r1 | 87.0 | 168.0 | 0.3 | 19.7 | 87.4 | 168.4 | 4 | not logged | 0 |
| WebGL2 r2 | 82.3 | 120.7 | 0.3 | 2.1 | 82.6 | 121.2 | 0 | 0.41 | 0 |
| WebGL2 r3 | 87.4 | 121.3 | 0.3 | 24.0 | 88.3 | 121.6 | 0 | 0.47 | 0 |

- The tick is the time. In every run the tick is almost all of the callback time (render median under 1 ms). In WebGPU r1 all 540 timed frames exceeded 40 ms, and every one was tick-dominant, while the render call never exceeded 30 ms. The GPU submit path does not account for the long frames. This rules it out for these values.
- GC and page pauses are ruled out. The long-animation-frame entries report a script pause of 0 ms in all six runs, and the long-task entries carry the whole block as script time.
- Load and throttling correlate with the tick. The host is an AMD Ryzen 7 6800H (8 cores, 16 threads). The container's cgroup quota is 12 CPUs (`cpu.max` 1200000 100000), and its counters show 117,189 throttled periods of 2,193,570 at the time of reading. During the WebGPU r1 run the co-tenant busy share was 0.73 to 0.85 and the run queue was 30 to 60 threads. The WebGPU r1 tick median rose from 96.9 ms at a run queue of 10 to 30, to 107.3 ms at 30 to 50, and to 112.9 ms at 50 and above (Pearson 0.47 between tick and run queue). Frame time correlates with the throttled time inside each frame in all four logged runs (0.41 to 0.58). The throttle counter sums over threads, so this is a correlation, not a cause proven by a per-thread trace.
- Not proven. A plain CPU loop in Node under the same host load, run for 20 s, had a largest gap of 27 ms and no gap of 100 ms or more. The quota alone did not show multi-period freezes in that window, so the 150 to 250 ms spikes are not shown to be freezes. They are slower tick calls.
- Warm-up. The first two frames take 1.6 to 2.4 s in the tick, and frames 2 to 11 take 120 to 440 ms. These are outside the timed window, and any figure that includes the first 60 frames carries them.
- Cause recorded. The 1024-tier stalls are the single-threaded wasm tick running slower under CPU sharing and cgroup quota throttling on a loaded host. They are not a GPU stall and not a GC pause. The exact 705 ms WebGPU value (set 2) and the 362.9 ms WebGL2 outlier were not reproduced in three runs per backend, and their raw frame records were not saved. Their cause is the same class, but that is not proven for those values.
- Fix. None verified. The change that would count as a stall fix is not made, so no push follows from this section. To settle the cause, run the diagnostic copy with the co-tenant load stopped, or with the frame median read alongside the recorded host load. Until then, the 1024 p99 and max values should be reported with the load beside them.
- The label. The harness reports this synchronous time as a frame time, so the 1024 p99 is a CPU tick figure. Split the reported value into tick and render before it is used as a GPU frame time.

### Null adapter after the browser restart

- Reproduced. On a fresh launch of the project browser (pid 3866299), `navigator.gpu` exists and `requestAdapter()` returned null on five calls over 2 s (`build/diag/adapter-probe.html`, a page that calls it five times).
- Cause. The project root changed from `/workspace` to `/workspace/jayzee` at the restart. Before it, the browser used `/workspace/.playwriter/browser-profile`, whose `Local State` holds `enabled_labs_experiments` as `enable-unsafe-webgpu`, `enable-vulkan@1` and `enable-webgpu-developer-features`. After it, the browser used `/workspace/jayzee/.playwriter/browser-profile`, created at 03:42 to 03:43, and that profile has no labs key. Without the labs flags the WebGPU adapter is null. That is the headed, no-flags row of the Chromium probe table above.
- Fix verified. With the browser stopped, the three flags were written into the new profile's `Local State`. After the relaunch, `requestAdapter()` returned the NVIDIA ampere adapter, with `isFallbackAdapter` false, on five of five calls. The 1024-tier WebGPU runs above used this adapter.
- Caveats. A running Chromium rewrites `Local State`, so an edit made while it runs is lost. The key was gone while the process was still running, which is why the edit was made with the browser stopped. The launcher's config (`defaults/mcp.json`) has no browser-argument setting, so the command-line alternative, `--enable-unsafe-webgpu --enable-features=Vulkan,WebGPUService`, cannot be set from this repo. The durable fix is open: either the launcher accepts browser arguments, or the flags are restored after each change of project root.
- The earlier report of null on the first request, with the adapter on the next page load, is not reproduced. Five of five calls were null in the fresh browser, and the adapter came back only after the profile fix. That earlier transient is not explained.

### Adapter defects found in this Phase B (WebGPU and Vulkan)
- Defect 1, the self-launched runner forced SwiftShader. `scripts/browser/run-engine-render.mjs` passed `--use-vulkan=swiftshader`, `--use-webgpu-adapter=swiftshader` and `--use-angle=swiftshader`, so its WebGPU runs measured the CPU adapter. Evidence: `build/diag/webgpu1024.json` (`frameTimeP99Ms` 140.4, checksum -3826851758512048142), against 78.6 for the same module on the NVIDIA adapter (above). Fix in this Phase B: those three flags are removed, the feature list is `Vulkan,WebGPUService`, and the runner exits non-zero when the page reports `isFallbackAdapter` true or the vendor `google`. Closed in the Phase A pass: the runner is deleted (see the decision above), so its flags are no longer used.
- Defect 2, direct Chromium launches got a SwiftShader WebGPU adapter. Cause found in the Phase A pass: headless mode, not the flags. See "WebGPU open items, closed in the Phase A pass" above. The earlier probes that reported SwiftShader were all headless (`--dump-dom` and the playwright runner). Fixed by the choice of a headed browser on the gm playwriter path. The direct recipe for a headed launch is the flags in that section.
- What the NVIDIA runs show, and what they do not. The gm GPU process loads the NVIDIA Vulkan driver, and the WebGPU adapter follows the Vulkan ICD. The WebGL2 runs report ANGLE over OpenGL 4.5 on the same driver, so they do not use Vulkan. The adapter info does not name the WebGPU backend type.
- Defect 3, fixed: the phase 8 page threw on `createTexturePool` (see the phase 8 record above).

### Witnesses for phases 2 to 8 (native host build)
- Phase 2 world: `RESULT: PASS` in the native run. Native INFO lines: `INFO phase 2: ground rest y after 600 ticks 0.499933719635`, `INFO phase 2: box rest y after 600 ticks 1.49999976158`.
- `scripts/check-engine-world.mjs`: 13 PASS, `RESULT: PASS`, with the engine float32 tolerance of 1e-5.
- `scripts/check-engine-vegetation.mjs`: 7 PASS, `RESULT: PASS`. `scripts/check-engine-codecs.mjs`: 11 PASS, `RESULT: PASS`.

### Planet (phase 5)
- `scripts/check-engine-planet.mjs`: 9 PASS, `RESULT: PASS` (quoted in full in the planet section above). Native phase 5: 24 PASS lines.

### Service-worker isolation shim
- `scripts/check-engine-isolation.mjs`: 9 PASS, `RESULT: PASS`.
- Public-site witness, run after the push (d0af9c1) in the gm playwriter browser on `https://anentrypoint.github.io/jayzee/play/`: `{ first: { crossOriginIsolated: true, sab: 'function', sw: true }, after: { crossOriginIsolated: true, sab: 'function', sw: true } }`, with the page reloaded once. Caveat: this browser profile had visited the site before, so the service worker may have been registered before the first load. A fresh profile's first load is not witnessed here.

### Gate summary
- Every local engine gate and the CI run agree: artifacts 6, world 13, bridge 7, pools 7, planet 9, vegetation 7, codecs 11, materials 15, interest 4, render 17, isolation 9, tiers 6, client-resource-pools 13, core 64 MiB 3, core 128 MiB 3, leak 3. Each ends `RESULT: PASS`.
- Warnings in the final builds: `USE_WEBGPU is deprecated` (3 lines, one per build), kept and recorded in the deviations. The `MAXIMUM_MEMORY` warning is also recorded there. All other compiler warnings were fixed.
- Open: the `USE_WEBGPU` migration; the `ENGINE_THREADS` branch; the Jolt per-body cost estimates in the memory plan (the plan totals are measured, the per-body costs are not).


## Phase A pass: durable labs flags and 1024 phase timers

Each change below is in the Phase A commit. The witness column says what Phase B has to show before the change counts as verified.

| # | Change | Witness |
|---|---|---|
| 1 | `scripts/browser/webgpu-profile.mjs` (new). Adds the three labs flags (`enable-unsafe-webgpu`, `enable-vulkan@1`, `enable-webgpu-developer-features`) to `browser.enabled_labs_experiments` in a profile's `Local State`. It keeps other keys and other labs, leaves the bytes alone when nothing is missing, and only seeds the project profile at `<root>/.playwriter/browser-profile`. | `scripts/check-webgpu-profile.mjs`, gates 1 to 4 |
| 2 | `scripts/browser/chromium-webgpu.sh` (new, executable). Seeds the project profile when a `--user-data-dir` argument points at it, then execs Chromium with every argument unchanged. A corrupt `Local State` is reported and the file is left alone, and Chromium still starts. | gates 5 to 8 |
| 3 | `PLAYWRITER_BROWSER_PATH` set to the wrapper in the gm playwriter entry, `/config/.gmnew/current/defaults/mcp.json`. This file is outside the repo and is an external change. It takes effect only after the playwriter server restarts. | Phase B: a fresh profile launch shows the seeded `Local State` and a non-fallback NVIDIA adapter |
| 4 | `scripts/check-webgpu-profile.mjs` (new), added to `npm test` as `check:webgpu-profile` after `check:engine-artifacts`. Its fake Chromium stub is now created with mode 755. The first run failed with exit 126 (permission denied) on the stub, not on the wrapper. | gate run in npm test |
| 5 | `scripts/browser/serve-root.mjs` (new). Static server for the repo root that serves `.wasm` as `application/wasm`. | Phase B adapter probe loads through it |
| 6 | `scripts/browser/adapter-probe.html` (new). Calls `requestAdapter()` five times, 500 ms apart, and records vendor, architecture, device, description and `isFallbackAdapter` for each call. | Phase B adapter info, per launch |
| 7 | `scripts/browser/thread-cpu-sampler.mjs` (new). Reads `/proc` every 20 ms for threads whose command line contains the browser profile, and logs the changed per-thread jiffies. | Phase B stall windows |
| 8 | `scripts/browser/analyse-stalls.mjs` (new). Joins each outlier's wall window with the sampler log and reports per-thread CPU for the window and for the run. | Phase B stall evidence |
| 9 | `engine/src/phase_timer.h` and `phase_timer.cpp` (new). A `Scope` per phase (pages, inputs, physics, readback) that adds its elapsed milliseconds to a total. Under `ENGINE_PHASE_TIMERS` only; without it the scope is empty. | Phase B timed build |
| 10 | `engine/src/bridge.cpp` `tickBatch`. A scope around `applyPending` (pages) and `drainInputs` (inputs). No behaviour change. | Phase B timed build and the fixed build sha |
| 11 | `engine/src/world.cpp` `World::step`. A scope around the physics `Update` (physics) and around the sync loop (readback). No behaviour change. | as row 10 |
| 12 | `engine/src/engine_core.cpp`. `engine_phase_total_ms(id)` and `engine_phase_count()` exported under `ENGINE_PHASE_TIMERS` only. | as row 10 |
| 13 | `engine/CMakeLists.txt`. Option `ENGINE_PHASE_TIMERS` (default OFF), name suffix `-timed`, the two exports added only when it is on, and `phase_timer.cpp` in the sources. The fixed link flags are unchanged, so `check:engine-artifacts` still passes. | `check:engine-artifacts` and the timed build |
| 14 | `engine/build.sh`. A `timed` variant (leak OFF, timers ON, suffix `-timed`). The `fixed` and `leak` variants keep their flags and suffixes. | the fixed 128 MiB sha compared with the pin `8475e5fb` |
| 15 | `scripts/browser/engine-render-browser.js`. `?timed=1` loads the `-timed` glue and records one row per frame: tick, render, total and gap in ms, and the four phases. The result adds `timed`, `tickMedianMs`, `outlierThresholdMs` (2 times the frame median), `outliers` (frame, wall ms, total, tick, render, gap and phases for each frame above the threshold), `phaseMedianMs` and `phaseMaxMs`. | Phase B timed runs |
| 16 | `package.json`. The `check:webgpu-profile` script and its entry in the `test` chain. | `npm test` |

What did not change: the harness's frame metric is still the synchronous tick plus render, and the fixed-variant gates read the same exports and link flags as before.

Pending in Phase B: the outcome of each row, the fixed 128 MiB sha against the pin, and the stall cause with its evidence.
