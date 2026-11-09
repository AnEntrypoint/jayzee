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
| Renderer re-run with the adapter (this pass) | `engine-render.html` phases 10 and 11 at the 64 and 1024 tiers on the NVIDIA RTX 3060 Laptop adapter (WebGPU backend `webgpu`, WebGL2 backend `webgl2`); two timed 1024 pairs | PASS for the witnesses: the checksums agree across backends at each tier, `ok` is true, and allocations after warm-up are zero. At 1024 the timed median is WebGPU 39.5 ms and WebGL2 37.6 ms, so WebGPU is 0.95x WebGL2 (no speedup). The `.mcp.json` route is witnessed for a gate that the project file starts, and it is a gm defect for a gate that gm starts. See "The .mcp.json route". |
| Phase A A/B: pre and post WebGPU, and WebGL2 at 1024 (interleaved) | `engine-render.html?tier=1024&timed=1`, two rounds of WebGPU pre, WebGPU post and WebGL2, one run at a time | PASS for the witnesses: the checksum `-3826851758512048142` and visible `[729,746,747,750]` match in every run, and allocations after warm-up are zero. The visible-record upload lowered the WebGPU median by 3.00 ms and 4.65 ms (pre to post). WebGPU is still 0.98x WebGL2 at the median (0.7 to 0.9 ms slower), so there is no speedup. See "Phase A A/B". |
| Paired host-sharing runs (round 1 and round 2, G0 and G1), the project-profile page probe, and the 64-tier timed build | `paired-run.mjs` x4 with a page result each, `paired-report.mjs`, `npm test`, and 23 named check gates | PASS for the witnesses: four run records and four page results, each page with `errors` empty, zero allocations after warm-up and the expected checksum. Verdict `mixed` on two pairs. See "Phase B: paired host-sharing rows, closed". |
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

## Phase B: adapter witnesses, timed 1024 runs, and the launcher move

### Changes in this pass (the Phase B commit, after f38d704)

- The wrapper setting moved out of gm's shipped config. `/config/.gmnew/current/defaults/mcp.json` is outside any repo, and it is gm's file for every project. The `PLAYWRITER_BROWSER_PATH` entry is no longer in it. The file is byte-identical to the pre-change copy (`/config/.gmnew/current/.gmnew-previous/defaults/mcp.json`, dated 04:07, before the change): sha256 `1836fb52c00f6f38c27a6f6fd3112194a21b08ec4b7b3453e6c5538f4bd6d9e2` for both. `cmp` reports them identical. gm's own update record `.gmnew-update.json` (04:46, gm version `7b6e993-276`) also touched the defaults directory, so the restore is confirmed by comparison, not by a step of mine.
- The new location is the project-scope `.mcp.json` at the repo root. It is the gm playwriter entry copied field for field (`command`, `args`, `ignore`, `deny`, both timeouts), with `env` set to `PLAYWRITER_TELEMETRY=0` and `PLAYWRITER_BROWSER_PATH=/workspace/jayzee/scripts/browser/chromium-webgpu.sh`. The pinned launcher (`pw/bin/playwriter-project`) reads `PLAYWRITER_BROWSER_PATH` only from its own process environment and loads no project file, so `.mcp.json` is the only repo-side place the setting can live. The route is witnessed in "The .mcp.json route" below, for a gate that the project file starts. The absolute path is machine-specific.
- `scripts/browser/thread-cpu-sampler.mjs` matched every process whose command line contained the profile path, so it sampled itself. Its own main thread logged about 296 s of CPU over the first WebGPU run, which made that run's sampler log invalid. The fix matches only processes whose command line carries `--user-data-dir=<profile>`, skips the sampler's own pid, and defaults to a 50 ms period.
- `scripts/browser/launch-witness.mjs` and `scripts/browser/timed-run.mjs` are the launch drivers used for the witnesses below. They read `PLAYWRIGHT_CORE` for the `playwright-core` path, as `run-player-webgpu.mjs` does. `timed-run.mjs` waits for `window.engineRenderResult.done`. Its first version waited for text in `#result`, and that text was not seen before the run finished, so the driver timed out while the page had finished.
- Build note. The timed 128 MiB configure with the plain `build.sh` stalled on a GitHub clone of JoltPhysics, because FetchContent fetches it on each new build directory. The configure was rerun with `FETCHCONTENT_SOURCE_DIR_JOLTPHYSICS` pointing at the existing checkout in `build/engine-fixed-128mib/_deps/joltphysics-src`. That checkout is commit `0373ec0dd762e4bc2f6acdb08371ee84fa23c6db` (v5.3.0), the same `GIT_TAG` as `engine/CMakeLists.txt`. This is a build-environment change, and `build.sh` itself is unchanged.

### Builds

- Fixed 128 MiB, rebuilt with the Phase A sources: sha256 `8475e5fbfc335497c9542737f9461e5d9fb030350b487e46961d4872c83c75f8`. It equals the pin in `engine/artifacts.json`, so the timer instrumentation does not change the fixed artifact. `git status engine/out` is clean.
- Timed 128 MiB (`-DENGINE_PHASE_TIMERS=ON`): `engine/out/engine-core-128mib-timed.wasm`, sha256 `b05358c92377782aa351339e46b17f339f8be6562a930f30fd09b1f9abfae3a0`. It exports `_engine_phase_total_ms` and `_engine_phase_count`. The fixed module exports neither.

### Adapter witnesses

Both launches used the wrapper, `scripts/browser/chromium-webgpu.sh`, with `WEBGPU_CHROMIUM=/usr/lib/chromium/chromium.real` (the binary the gate starts), `DISPLAY=:1`, and the adapter probe page at `http://127.0.0.1:8765/scripts/browser/adapter-probe.html`. The probe calls `requestAdapter()` five times.

- Fresh profile launch. The project profile was moved to `.playwriter/browser-profile.before-phaseA` first, so the wrapper created a new profile and seeded it before Chromium started. Adapter: NVIDIA GeForce RTX 3060 Laptop GPU, vendor `nvidia`, architecture `ampere`, device `0x2520`, `isFallbackAdapter` false, on 5 of 5 calls. `Local State` `browser.enabled_labs_experiments`: `enable-unsafe-webgpu`, `enable-vulkan@1`, `enable-webgpu-developer-features`.
- Restart. The browser was closed, and a second launch started on the same profile on a new debugging port. Adapter: the same NVIDIA ampere adapter, `isFallbackAdapter` false, on 5 of 5 calls. Labs unchanged.
- Not witnessed here: a launch through the playwriter gate. The gate was started before the setting existed, and its environment has no `PLAYWRITER_BROWSER_PATH`. The witness above runs the same wrapper the gate would run, but not the gate's own path. The gate-level check waits for the next playwriter server start.

### Timed 1024-tier runs, one backend at a time

Both runs used `scripts/browser/engine-render.html?tier=1024&timed=1`, with WebGPU as phase 10 and WebGL2 as phase 11. Each run used the thread sampler at 50 ms and nothing else running. Frame time is the synchronous tick plus render, and the tick is almost all of it. Phase values are per-frame milliseconds over the 540 timed frames.

| Run | Backend and adapter | Frame median | p99 | max | Tick median | Outlier threshold (2 x median) | Outliers | Physics median / max | Readback max | Allocations after warm-up |
|---|---|---|---|---|---|---|---|---|---|---|
| WebGPU r2 (corrected sampler) | webgpu, NVIDIA RTX 3060 ampere | 83.85 | 104.2 | 172.9 | 82.7 | 167.7 | 1 | 79.7 / 169.4 | 26.4 | 0 |
| WebGL2 (corrected sampler) | webgl2, ANGLE over NVIDIA RTX 3060 OpenGL 4.5 | 83.15 | 105.0 | 119.2 | 82.45 | 166.3 | 0 | 79.2 / 116.7 | 27.3 | 0 |
| WebGPU r1 (sampler invalid, see above) | webgpu, NVIDIA RTX 3060 ampere | 88.05 | 139.7 | 602.6 | 87.25 | 176.1 | 2 | 84.35 / 533.8 | 28.2 | 0 |

- WebGPU r2 outlier, frame 89: total 172.9 ms, tick 171.5 ms, physics 169.4 ms, readback 2.1 ms, render 1.4 ms, gap to the previous frame 82.2 ms. The renderer main thread logged about 60 ms of CPU inside that frame's window (`build/diag/analysis-webgpu-1024-r2.json`). So about 110 ms of the 171 ms tick was wall time with the tick thread not running. The GPU readback is 2.1 ms in that frame, so it is not the GPU readback.
- WebGL2 run: no frame above threshold.
- The WebGPU r1 numbers came from a run in which the sampler measured its own CPU at about 20% of a core. Treat them as contaminated. The 705 ms outlier is still not reproduced in r2 or in the WebGL2 run.
- Full result JSON is in `build/diag/timed-webgpu-1024-r2.json` and `build/diag/timed-webgl2-1024.json`. `build/` is git-ignored, so the numbers above are the record.

### Stall cause, with this evidence

- The outlier pattern is the same as before: the single-threaded wasm tick is wall-time slow while its thread is not on CPU. The sampler shows that for frame 89. The physics phase carries the whole excess. Readback, render and GPU submit account for almost none of it. GC is not indicated by these phases.
- Still not proven: why the tick thread is descheduled for about 110 ms. The shared CPU quota is the likely cause, but this run did not record host run-queue or throttle counters for that window. The fix is still not made, so this is not a fix.

### Gates and push

- `npm test`: exit 0. `RESULT: PASS` 218 times, `RESULT: FAIL` 0 times. Lines beginning `PASS ` 4451, lines beginning `FAIL ` 0. One PASS label contains the word `FAILED` (`MODEL_LOAD_FAILED sets the failure label…`); it is a label, not a failure. Log in `/tmp/npm-test.log` (outside the repo).
- Commits in this round: `67e8ade` (earlier doc commit), `f38d704` (Phase A), and the commit that carries this section, the sampler fix, `.mcp.json`, and the two witness drivers. The push is one `git push origin main` covering all of them.

## Phase B re-run: WebGPU witnesses and the 1024 tier

Run on 2026-11-09 (UTC) on the project browser: gate pid 4041849, port 9721; browser pid 4095457, debug port 10221, profile `/workspace/jayzee/.playwriter/browser-profile`. The profile's `Local State` has `browser.enabled_labs_experiments` = `enable-unsafe-webgpu`, `enable-vulkan@1`, `enable-webgpu-developer-features`. Pages were served by `scripts/browser/serve-root.mjs 8765`. Each run was one page load in one tab, and the runs were one after another. No timed run overlapped another, and no thread sampler ran during these runs.

### Adapter

- WebGPU (phase 10, backend `webgpu`): `{"api":"webgpu","vendor":"nvidia","architecture":"ampere","device":"0x2520","description":"NVIDIA GeForce RTX 3060 Laptop GPU","isFallbackAdapter":false}`. The probe `scripts/browser/adapter-probe.html` returned this adapter on 5 of 5 `requestAdapter()` calls. The first call was 27 ms after the page started, in a tab opened after the browser start at 03:33:13 UTC.
- WebGL2 (phase 11, backend `webgl2`): `{"api":"webgl2","vendor":"Google Inc. (NVIDIA Corporation)","renderer":"ANGLE (NVIDIA Corporation, NVIDIA GeForce RTX 3060 Laptop GPU/PCIe/SSE2, OpenGL 4.5.0)"}`.
- No adapter was unavailable in this pass, so no adapter defect was fixed.

### Witnesses

Every run has `ok` true and `errors` empty. Allocations after warm-up are `"0"`, and `createsAfterSeal` is 0 in all four.

| Run | Backend | Checksum | `visible` | `apiCallsPerFrame` |
|---|---|---|---|---|
| 64 tier, untimed | webgpu | -5415737363265412373 | [18,20,21,20] | 34 |
| 64 tier, untimed | webgl2 | -5415737363265412373 | [18,20,21,20] | 45 |
| 1024 tier, timed | webgpu | -3826851758512048142 | [729,746,747,750] | 34 |
| 1024 tier, timed | webgl2 | -3826851758512048142 | [729,746,747,750] | 45 |

At 64, WebGPU median 2.1 ms, p99 2.9 ms, max 3.5 ms. WebGL2 median 2.0 ms, p99 2.9 ms, max 3.1 ms.

### 1024 tier timings, side by side

Milliseconds, 600 frames per run, timed.

| Source | Backend | Median | p99 | Max | Tick median | Outliers | Physics median / max | Readback median / max |
|---|---|---|---|---|---|---|---|---|
| `build/diag/webgpu1024.json` (refreshed this pass; the 02:04 copy is `webgpu1024.prev.json`) | webgpu | 39.5 | 47.10 | 51.70 | 39.1 | 0 | 37.7 / 49.1 | 1.4 / 2.1 |
| `build/diag/timed-webgl2-1024-r3.json` | webgl2 | 37.60 | 42.70 | 43.90 | 37.35 | 0 | 36.0 / 42.3 | 1.3 / 2.1 |
| Earlier pair in this pass, console only, not saved | webgpu | 38.2 | 44.6 | 47.2 | 37.8 | 0 | n/a | n/a |
| Earlier pair in this pass, console only, not saved | webgl2 | 36.45 | 40.7 | 42.5 | 36.2 | 0 | n/a | n/a |

The previous `webgpu1024.json` from 02:04 UTC has p99 140.4 ms, and it has no median or phase fields and no `timed` flag. Its timing is not comparable with these rows.

### Speedup

Speedup is WebGL2 median divided by WebGPU median. Both pairs give about 0.95, so WebGPU is slower and there is no speedup at 1024 on this adapter.

- File pair: 37.60 / 39.50 = 0.95, WebGPU 5.0% slower at the median.
- Earlier pair: 36.45 / 38.20 = 0.95, WebGPU 4.8% slower at the median.
- p99: WebGPU is 10% higher in the file pair (47.10 against 42.70) and 9.6% higher in the earlier pair (44.6 against 40.7).

There are two pairs and one run each, so there is no variance estimate.

The earlier timed medians in this file (WebGPU r2 83.85 ms, WebGL2 83.15 ms) were measured with the thread sampler running. This pass ran without it, and its medians are about half those values. The cause is not recorded, so this pass's numbers are not compared with those.

### Defects and open items

- Null adapter, from "Null adapter after the browser restart": did not recur. The first `requestAdapter()` after the 03:33 browser start returned the NVIDIA adapter. The launcher-level fix stays OPEN.
- `.mcp.json` route from ee68993: NOT witnessed in this pass. Corrected in "The .mcp.json route" below. The browser pid 4095457 did run through the wrapper: `browser.log` line 3635 is its `seeded` line, which `webgpu-profile.mjs` prints when `chromium-webgpu.sh` runs it. Its `/bin/bash /usr/bin/chromium` cmdline is what remains after the wrapper's `exec`, so the cmdline does not show the wrapper. The gate (pid 4041849) was started by gm at 03:09:47 UTC, after `.mcp.json` was written at 02:51:55 UTC, so the file existed first. Its environment had no `PLAYWRITER_BROWSER_PATH` because gm's chain does not read the project file.
- No new WebGPU defect in this pass: no errors in either backend, no outlier at 1024 in either backend, and the largest frame was 51.7 ms (WebGPU). The 705 ms long-frame stall from the "Stalls at 1024" section did not reproduce.

## Phase A: WebGPU frame uploads the visible records (cause and changes)

Cause, from the code. The 1024-tier gap in the timed pair above (WebGPU median 39.5 ms against WebGL2 37.6 ms) is in the tick. The physics phase is 37.7 ms against 36.0 ms, and the render part is about 0.4 ms against about 0.25 ms, so the gap is not in the render calls. The WebGPU frame does two things the WebGL2 frame does not:

- It uploads every body record each frame: `writeBuffer(bodyBuf, 0, plan.bodyRecords, bodyCount * 32)`, 10240 records and about 327 KB. It then culls them again on the GPU. `planFrame` has already culled on the CPU, and the per-class visible records are in `plan.propRecords`. WebGL2 uploads only those, 2972 records (about 95 KB) at the recorded visible counts 729, 746, 747 and 750.
- It runs a counter reset, a cull dispatch and a finalize dispatch each frame to repeat that cull.

Whether this uses up the 1.7 ms of physics time is an inference from the phase split, and Phase B measures it.

Changes, one local commit each, not pushed:

- `engine/src/render/render_webgpu.cpp`, phase 10. Removes the cull and finalize shaders and pipelines, the body and counter buffers, and the dispatch. Uploads `plan.propRecords` per class with `propCount`, and writes the prop draw args from the same counts. Witness needed: `npm run check:engine-render`, then the timed WebGPU 1024 run: checksum `-3826851758512048142`, visible `[729,746,747,750]`, allocations after warm-up `"0"`, and the median and p99 against the WebGL2 1024 run.
- `engine/src/render/render_frame.h`, phases 10 and 11. Removes `kCullGroupSize` and `kArgsDispatchWord`, and sets `kArgsWords` to 20. Witness needed: the four wasm builds (64 MiB, 128 MiB fixed, 64 MiB leak, 128 MiB timed) and `npm run check:engine-render`.
- `scripts/check-engine-render.mjs`, the indirect-args gate. It now asserts queue-written args and no compute dispatch in the WebGPU frame. Witness needed: `npm run check:engine-render`.
- `docs/ENGINE.md`, the indirect-args and culling bullets. Design text only.
- `engine/artifacts.json`, the pins. These are stale after the render change, since `render_webgpu.cpp` is compiled into all three builds. Witness needed: the rebuilt hashes written into the pins, then `npm run check:engine-artifacts`. Done in `15c3a37`: the pins equal the rebuilt hashes, and `check:engine-artifacts` gave 6 PASS.

## Phase A A/B: pre and post WebGPU, and WebGL2 at 1024

Run 2026-11-09 (UTC). Two rounds. In each round the three runs went one after another and never overlapped: WebGPU pre, WebGPU post, WebGL2. Each run is 600 timed frames at the 1024 tier with `timed: true`, `ok: true` and `errors: []`. The files are `build/diag/phaseA-ab1-{pre-webgpu,post-webgpu,webgl2}.json` and the same names with `ab2`.

Builds. Pre is `engine/out/engine-core-128mib-timed-pre.wasm`, sha256 `b05358c92377782aa351339e46b17f339f8be6562a930f30fd09b1f9abfae3a0`, which is the code at HEAD before `8308331`. Post is `engine/out/engine-core-128mib-timed.wasm`, sha256 `47841a34eaf11ec75f1b16711e4ed877dcd5225fca52ec54ef47d8c00d66a759`, the same bytes as `-timed-post.wasm`. WebGL2 ran on the post build.

Milliseconds, from the result files.

| Round | Run | Median | p99 | Max | Tick median | Physics median | Readback median | API calls per frame | Outliers |
|---|---|---|---|---|---|---|---|---|---|
| 1 | WebGPU pre | 43.70 | 48.40 | 49.5 | 43.3 | 41.6 | 1.6 | 34 | 0 |
| 1 | WebGPU post | 40.70 | 44.90 | 48.5 | 40.4 | 38.9 | 1.4 | 29 | 0 |
| 1 | WebGL2 | 39.80 | 49.90 | 54.5 | 39.6 | 38.3 | 1.4 | 45 | 0 |
| 2 | WebGPU pre | 43.05 | 52.30 | 57.2 | 42.6 | 41.1 | 1.5 | 34 | 0 |
| 2 | WebGPU post | 38.40 | 53.60 | 58.3 | 38.1 | 36.9 | 1.2 | 29 | 0 |
| 2 | WebGL2 | 37.70 | 49.10 | 55.4 | 37.5 | 36.3 | 1.1 | 45 | 0 |

Every run has checksum `-3826851758512048142`, visible `[729,746,747,750]`, allocations after warm-up `"0"` and `createsAfterSeal` 0.

Load. Not recorded for these runs. The result files have no load fields. The run wrote `/proc/loadavg` before and after each run to the gm run log (`krm4ed170`), and that log is no longer available (`run://krm4ed170/log` is not found). So the load before and after each run is unknown. The 1-minute load read at the end of this check was 18.19 on 12 cores, after the batch had finished, and it does not describe any run.

Findings.

- The visible-record upload helped the WebGPU frame. Pre to post, the median fell by 3.00 ms in round 1 (43.70 to 40.70) and by 4.65 ms in round 2 (43.05 to 38.40). API calls per frame fell from 34 to 29. The pre medians differ by 0.65 ms between rounds, and the post medians by 2.30 ms. Two rounds cannot give a precise size for the gain, but it is well above that spread.
- WebGPU is not faster than WebGL2. At the median, WebGPU post is 0.90 ms slower in round 1 (WebGL2 is 0.978 of it) and 0.70 ms slower in round 2 (0.982). The goal "faster than WebGL2" is not met, and no speedup is recorded.
- p99 does not decide it. Round 1 has post 44.90 against WebGL2 49.90, and round 2 has post 53.60 against WebGL2 49.10. The sign flips between rounds, so no p99 claim is made.
- The gap that remains is in the physics phase, not in the render path. Physics medians are 38.9 and 36.9 for WebGPU post and 38.3 and 36.3 for WebGL2, a 0.6 ms gap in both rounds. The physics phase is the shared tick code, and the render share is under 1 ms. The cause of the 0.6 ms is not established, and it was not tested.

Excluded from the comparison.

- `build/diag/phaseA-webgpu-1024-timed.json`: median 99.65 ms, with load 23 to 29 on 12 cores and about 1000% CPU from other processes. Invalid.
- `build/diag/phaseA-b1-webgpu.json` and `phaseA-b1-webgl2.json`: the WebGPU file has 88 outliers. The run fell in the same heavy-load period, and its load was not recorded. Not used.
- `build/diag/phaseA-b2-webgpu.json` and `phaseA-b2-webgl2.json`: a pair with no pre run beside it. The load noted in that pass was about 3 to 4 on the 1-minute average. It cannot be compared with the pre baseline, so it is not used.

Gates, run in the Phase A pass before this section (not re-run here): `check:engine-artifacts` 6 PASS, `check:engine-render` 17 PASS, `check:engine-core` 3 PASS, `check:engine-tiers` 6 PASS, `check:engine-leak` 3 PASS. The pins in `engine/artifacts.json` (`15c3a37`) are 64 MiB `99035297…`, 128 MiB `a6f7d7fe…` and leak `fae9256a…`.

## The .mcp.json route

Negative witness, a gate that gm starts. Gate pid 12583 on port 9721 was started by gm's chain after that chain was killed and respawned. Its environment had 0 `PLAYWRITER_BROWSER_PATH` entries. The browser it started, pid 12638 (`/usr/lib/chromium/chromium.real`), added no line to `.playwriter/browser.log`, which kept its one `seeded` line (line 3635). The wrapper did not run for it.

Positive witness, a gate that the project file starts. Gate pid 101717 on port 9721 started at 06:49 local (04:49 UTC). Its environment has `PLAYWRITER_BROWSER_PATH=/workspace/jayzee/scripts/browser/chromium-webgpu.sh` and `PLAYWRITER_PROJECT_DIR=/workspace/jayzee`. Its launch chain is `npm exec playwriter-project` (pid 100716, which also carries the variable), then `sh`, then the gate. When the gate launched its browser, pid 122269 (debug port 10221, started 06:53:06 local), the command line was `/bin/bash /usr/bin/chromium --user-data-dir=/workspace/jayzee/.playwriter/browser-profile --remote-debugging-port=10221`, the wrapper's `exec` target, with `chromium.real` as its child. `browser.log` gained line 10886, a `seeded` line, at 06:53. The wrapper ran for this browser.

Cause. gm starts its playwriter server from its own defaults (`/config/.gmnew/current/defaults/mcp.json`), which has no `PLAYWRITER_BROWSER_PATH`. No file under `/config/.gmnew/current` references the project `.mcp.json`, as checked earlier. A server started from the project file gets the `env` block of `.mcp.json`, and a server gm starts does not. So the route works when the project file starts the server and fails when gm does.

Corrections to the earlier text. The 03:33 UTC browser (pid 4095457) did run through the wrapper, which `browser.log` line 3635 shows. The gate (pid 4041849) was not started before `.mcp.json` existed. The file was written at 02:51:55 UTC, and the gate started at 03:09:47 UTC. Its missing variable came from gm's chain, not from timing.

Defect in gm, not edited here. A gate that gm starts never gets the wrapper. The owner has two options: (a) make gm read the project `.mcp.json` `env` for the playwriter entry, or (b) set `PLAYWRITER_BROWSER_PATH` in gm's shipped defaults. Option (b) applies to every project, and the path is specific to this machine. This is the owner's decision.

Current state. Gate 101717 is running, and its browser 122269 is open on the project profile and holds a lease. The page server (`scripts/browser/serve-root.mjs 8765`, pid 20303) is stopped. No timed run is active.

## Physics phase at 1024, WebGPU against WebGL2: trace and Phase A changes

Trace, from the code.

- `tickBatch` (`engine/src/bridge.cpp`) runs `pages`, then `inputs`, then `World::step`. Only `physics.Update` is inside the physics scope (`engine/src/world.cpp`, `World::step`). `Update` runs on `JobSystemSingleThreaded` unless `ENGINE_THREADS` is set, so the window is one thread of wasm code with no GPU call inside it.
- The render side runs after the tick, in the same rAF step (`scripts/browser/engine-render-browser.js`): `engine_render_frame`, then `planFrame`, then `frameBackend`. `frameBackend` is the only backend-dependent code, and it runs after the physics window of the same frame.
- Both backends run the same module on the same inputs, and the checksum is equal (`-3826851758512048142` at 1024). So the physics code and its data are the same for both backends. A physics-phase difference can come only from what the previous frame left in memory and caches, or from other work on the CPU during the window.
- In our code: `planFrame` wrote each body's 32-byte record into `plan.bodyRecords` every frame (10240 bodies, about 327 KB). Nothing reads that array. The hash reads the same words from a local, and the visible records are copied from the local words. It is dead storage that both backends pay for each frame, and it pushes the physics working set out of cache.
- Not in our code: backend-specific cost inside the physics window. WebGPU's extra work (queue writes, encoder, pass) runs after the window. Any CPU use by the GPU process or by driver threads is outside the wasm code and is not measured by any counter in the repo before Phase B.

Phase A changes. Local commit, not pushed.

1. `engine/src/render/render_frame.cpp`, `engine/src/render/render_frame.h`: `planFrame` computes each body's record in a local array, and `FramePlan::bodyRecords` is removed. Witness: `engine/test/witness_phase10_plan.cpp` (new) pins the checksum `0x3fb5a6de438de68e` and the visible counts `2489, 2489, 2487, 2483` for a fixed 10240-body scene at frame 599. The witness printed exactly those values on the unchanged code, and it passes after the change (`engine/test/build_host.sh`: `RESULT: PASS`).
2. `engine/src/phase_timer.h`, `engine/src/exports_render.cpp`: two phases, `kPlan` (around `planFrame`) and `kBackend` (around `frameBackend`), under the existing `Scope`. The enum count goes from 4 to 6. The fixed build has no timers, so the scopes compile to nothing. Witness: the Phase B rows carry `plan` and `backend`.
3. `engine/artifacts.json`: pins for the rebuilt fixed 64 MiB (`c678dd95…`), fixed 128 MiB (`bbcb9361…`) and leak 64 MiB (`c411d496…`). The timed 128 MiB build (`2b28cd23…`) is not pinned. Witness: `check:engine-artifacts` 6 PASS, `check:engine-core` 3 PASS, `check:engine-leak` 3 PASS, `check:engine-tiers` 6 PASS, `check:engine-render` 17 PASS.
4. `scripts/browser/engine-render-browser.js`: `PHASE_NAMES` includes `plan` and `backend`. The result gains `rowColumns` and `rows`, one compact row per timed frame (tick, render, gap, and each phase). Witness: Phase B results.
5. `scripts/browser/timed-result.mjs` (new): `stampLoad` reads `/proc/loadavg` (1, 5 and 15 minute averages, runnable and total threads), the CPU count and the wall time. `mergeLoad` adds `load.before` and `load.after` and refuses a missing stamp. Witness: `check:timed-result`, 6 PASS.
6. `scripts/check-timed-result.mjs` (new gate) and `package.json`: `check:timed-result` is in the `npm test` chain.
7. `scripts/browser/timed-run.mjs`: stamps load before the spawn and after the wait, and writes `load` into the result file. Witness: not run. This driver starts its own Chromium, and the Phase B runs went through the project's playwriter browser.
8. `scripts/browser/summarise-timed.mjs` (new): prints the medians, p99s, load before and after each run, the phase medians, and the correlation between each frame's physics time and the previous frame's render time. Witness: Phase B output.
9. `engine/test/witness_phase10_plan.cpp`, `engine/test/main_all.cpp`, `engine/test/build_host.sh`: the native witness is wired in. `build_host.sh` compiles `render_frame.cpp`. `package.json` adds `check:engine-host-witness` to the `npm test` chain.

What Phase A does not establish: that change 1 closes the WebGPU gap. It removes per-frame memory traffic that both backends share. Phase B shows whether the physics phase moves, and whether the gap moves with the render time of the previous frame.

Page fix, found in Phase B and committed with it. The first Phase B attempt read the phase totals before the render call, so the `plan` and `backend` deltas were always 0 (540 of 540 values). The page now reads them after `renderer.frame()`. That attempt was run under foreign load and is not used. Its file was overwritten by the re-run of round 1.

## Phase B: timed WebGPU and WebGL2 at 1024, alternating, load per run

Build: `engine/out/engine-core-128mib-timed.wasm`, sha256 `2b28cd2381f4385b4226d2c0e3a9f55090024b9b2ed0f56d1212613715c044d3`, the Phase A commit. Three rounds, each WebGPU (phase 10) then WebGL2 (phase 11), one run at a time, in the project's playwriter browser. Each file is `build/diag/phaseB-{webgpu,webgl2}-r{1,2,3}.json` and holds `load.before` and `load.after` from `/proc/loadavg`, and `top` (the six busiest processes before and after).

Conditions, not hidden. Round 1 started while a foreign Chromium (profile `/tmp/playwright_chromiumdev_profile-2IZOJL`, another lane's, GPU process at about 950% CPU) was still running. Its load was 14.0 before and 10.3 after. The foreign browser exited during that run. Rounds 2 and 3 ran with load 7.0 to 3.6. The machine was not idle for any run.

| Run | Median ms | p99 ms | Max ms | Tick median | Physics median | Physics p99 | Plan median | Backend median | Readback median | Outliers | API calls | Load before to after | Physics vs previous render, r |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| r1 WebGPU | 39.65 | 50.4 | 55.0 | 39.3 | 38.00 | 48.3 | 0.1 | 0.2 | 1.3 | 0 | 29 | 14.03 to 10.27 | 0.24 |
| r1 WebGL2 | 39.35 | 46.9 | 49.3 | 39.1 | 37.70 | 44.9 | 0.1 | 0.1 | 1.4 | 0 | 45 | 9.60 to 7.34 | 0.18 |
| r2 WebGPU | 39.50 | 45.7 | 48.1 | 39.15 | 37.80 | 44.1 | 0.1 | 0.2 | 1.3 | 0 | 29 | 6.99 to 5.78 | 0.17 |
| r2 WebGL2 | 39.30 | 46.1 | 48.5 | 39.1 | 37.80 | 44.2 | 0.1 | 0.1 | 1.3 | 0 | 45 | 5.48 to 4.31 | 0.08 |
| r3 WebGPU | 39.60 | 50.5 | 55.8 | 39.3 | 38.05 | 48.3 | 0.1 | 0.2 | 1.3 | 0 | 29 | 4.31 to 3.82 | 0.41 |
| r3 WebGL2 | 37.20 | 44.8 | 51.9 | 36.9 | 35.80 | 42.9 | 0.1 | 0.1 | 1.0 | 0 | 45 | 3.59 to 3.13 | 0.08 |

Every run has checksum `-3826851758512048142`, visible `[729,746,747,750]`, allocations after warm-up `0`, `ok` true and no errors.

Summary, from the rows above.

- Median, WebGPU against WebGL2: means 39.58 and 38.62, so WebGPU is 0.97 times WebGL2. Round by round the gap is 0.30, 0.20 and 2.40 ms, with WebGPU slower in all three rounds.
- p99: medians 50.4 (WebGPU) and 46.1 (WebGL2). WebGPU's p99 is higher in rounds 1 and 3 and lower in round 2.
- Physics: means 37.95 (WebGPU) and 37.10 (WebGL2). The gap is 0.3, 0.0 and 2.25 ms by round. The 0.6 ms gap of the earlier A/B does not come back as a steady value. Round 3 is the largest, and its WebGL2 run had the lowest load of any run.
- Plan is 0.1 ms per frame in both backends. The dead store that Phase A removed is therefore cheap, and it cannot account for the gap.
- Correlation of each frame's physics time with the previous frame's render time is positive in every round for WebGPU (0.24, 0.17, 0.41) and smaller for WebGL2 (0.18, 0.08, 0.08). This is weak coupling, measured over 539 frames per run, and it does not establish a cause. It is consistent with the previous frame's WebGPU render (cache or memory effects) touching the physics window, but nothing here shows that.

Verdict. WebGPU is not faster than WebGL2 at 1024 after the Phase A change, and it is slower in every round (0.97 times on the means). The cause of the remaining gap is not established. The one candidate that is in our code and was measurable (the plan's per-frame store) costs 0.1 ms, so removing it cannot close the gap. The weak WebGPU coupling to the previous frame's render is the only signal in this run, and the load on this machine changed between rounds.

Not done: the load-recording change was made to the repo driver (`scripts/browser/timed-run.mjs`), but the runs above went through the project's playwriter browser, which the driver does not use. The stamp module, the merge and the summariser are the same code in both paths.

## WebGPU re-run with Vulkan enabled: adapter and backend (Phase A, before timed runs)

Phase A is this record and no code change. The adapter is available, so no adapter defect is recorded.

Machine and driver, from `vulkaninfo --summary` and `lspci`:

- GPU0: NVIDIA GeForce RTX 3060 Laptop GPU (vendor `0x10de`, discrete), Vulkan API 1.4.312, driver NVIDIA proprietary 580.178.04 (`/proc/driver/nvidia/version`), ICD `/etc/vulkan/icd.d/nvidia_icd.json`.
- GPU1: llvmpipe (CPU, Vulkan API 1.4.335). The loader enumerates it, and it is not the adapter that WebGPU selects.

Chromium, from the project browser (gate pid 101717, debug port 10221, browser pid 122269, profile `/workspace/jayzee/.playwriter/browser-profile`):

- Command line: `--use-vulkan --enable-features=Vulkan,VaapiVideoDecoder --ignore-gpu-blocklist`.
- `Local State` labs: `enable-unsafe-webgpu`, `enable-vulkan@1`, `enable-webgpu-developer-features`.
- WebGPU adapter, from `navigator.gpu.requestAdapter()` and `GPUAdapter.info` in `scripts/browser/adapter-probe.html`: `{"vendor":"nvidia","architecture":"ampere","device":"0x2520","description":"NVIDIA GeForce RTX 3060 Laptop GPU","isFallbackAdapter":false}`. The probe's five calls (at 12, 541, 1042, 1542 and 2043 ms) all returned it, with no error. Direct call: 25 features, `maxBufferSize` 4294967292, `maxStorageBufferBindingSize` 2147483644.
- Backend: Vulkan. The browser's GPU process (pid 122338) maps Chromium's `libvulkan.so.1` (`/usr/lib/chromium/libvulkan.so.1`), the loader `libvulkan.so.1.4.341`, and the NVIDIA Vulkan driver `libnvidia-glvkspirv.so.580.178.04`, with the NVIDIA device nodes `/dev/nvidia0` and `/dev/nvidiactl`. This is evidence from the loaded libraries and the labs flags. Chromium's `chrome://gpu` page gives no text through Playwright (its DOM is empty), so no text readout of the backend was obtained.
- WebGL2 for comparison: ANGLE over OpenGL 4.5 on the same NVIDIA device (`libGLX_nvidia` is mapped by the same GPU process), as recorded in the earlier runs.

Run plan, Phase B: the timed 1024 build `engine/out/engine-core-128mib-timed.wasm` (sha256 `2b28cd2381f4385b4226d2c0e3a9f55090024b9b2ed0f56d1212613715c044d3`, the Phase A build). Three alternating rounds, WebGPU (phase 10) then WebGL2 (phase 11), one at a time in the project browser. Each file in `build/diag/` records `load.before` and `load.after` from `/proc/loadavg`. Medians and p99s are then quoted side by side from those files, and the speedup is computed only from them.

## WebGPU re-run with Vulkan enabled: timed 1024 results (Phase B)

Files: `build/diag/vulkan-{webgpu,webgl2}-1024-r{1,2,3}.json`, each with `load.before`, `load.after` and the six busiest processes before and after. Build `engine/out/engine-core-128mib-timed.wasm`, sha256 `2b28cd23…`. The runs went one at a time in the project browser, alternating WebGPU then WebGL2.

Conditions. The machine was shared. Other lanes ran a `zig test`, a node replay and `fx-test`, and the load stayed between 3.4 and 4.8 for every run. No foreign browser was running. The runs were alone with respect to this project's own work, and not alone with respect to the machine.

| Run | Backend | Median ms | p99 ms | Max ms | Tick median | Physics median | Physics p99 | Plan median | Backend median | Readback median | Outliers | API calls | Load before to after | Runnable before to after |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| r1 | WebGPU | 43.70 | 54.2 | 58.1 | 43.4 | 41.80 | 52.1 | 0.1 | 0.2 | 1.5 | 0 | 29 | 3.38 to 4.80 | 6 to 4 |
| r1 | WebGL2 | 39.80 | 51.0 | 53.0 | 39.6 | 38.30 | 48.8 | 0.1 | 0.1 | 1.3 | 0 | 45 | 4.66 to 4.37 | 5 to 3 |
| r2 | WebGPU | 40.60 | 46.8 | 48.7 | 40.3 | 38.95 | 44.7 | 0.1 | 0.2 | 1.3 | 0 | 29 | 4.37 to 4.72 | 5 to 4 |
| r2 | WebGL2 | 39.70 | 45.9 | 47.2 | 39.5 | 38.20 | 44.2 | 0.1 | 0.1 | 1.3 | 0 | 45 | 4.42 to 4.29 | 3 to 6 |
| r3 | WebGPU | 39.40 | 44.4 | 45.9 | 39.0 | 37.80 | 42.6 | 0.1 | 0.2 | 1.3 | 0 | 29 | 4.10 to 3.73 | 5 to 4 |
| r3 | WebGL2 | 38.70 | 44.5 | 47.6 | 38.5 | 37.20 | 42.9 | 0.1 | 0.1 | 1.2 | 0 | 45 | 3.59 to 3.89 | 6 to 5 |

Every run has checksum `-3826851758512048142`, visible `[729,746,747,750]`, allocations after warm-up `0`, `ok` true, no errors. The adapter is the NVIDIA RTX 3060 for WebGPU and ANGLE over that device for WebGL2.

Side by side, from the files:

- Median, WebGPU against WebGL2, round by round: 43.70 against 39.80, 40.60 against 39.70, and 39.40 against 38.70. The gaps are 3.90, 0.90 and 0.70 ms, WebGPU slower in every round.
- Mean of medians: WebGPU 41.23 ms, WebGL2 39.40 ms.
- p99, round by round: 54.2 against 51.0, 46.8 against 45.9, and 44.4 against 44.5. The median of the three p99s is 46.8 ms for WebGPU and 45.9 ms for WebGL2.

Speedup, from the mean medians only: WebGL2 divided by WebGPU is 39.40 / 41.23 = 0.956. WebGPU is about 4.6% slower at the median. There is no speedup in this run. Round 1 carries most of the gap (WebGPU's physics phase is 41.8 ms against 38.3 ms), and rounds 2 and 3 are within 0.7 to 0.9 ms. Physics is the dominant phase in both backends, and the plan and backend phases are 0.1 to 0.2 ms.

Consistency with the earlier re-run. The earlier 1024 runs in this doc (round 1 of the Phase B table, 39.65 ms against 39.35 ms) were on the same build and gave a smaller gap. The round-1 gap here is larger and comes with a larger WebGPU physics p99. The machine state was different (other lanes), and I have not separated those causes.

Verdict. The Vulkan-enabled WebGPU adapter works, and the WebGPU witnesses pass (checksum, visible counts, zero allocations, `ok`). WebGPU is not faster than WebGL2 at 1024 in this run. The result is 0.956 times WebGL2, slower in all three rounds.

## Physics phase, WebGPU against WebGL2 at 1024: audit and cause (Phase A)

Question. Round 1 of the Vulkan run puts the physics phase at 41.8 ms for WebGPU and 38.3 ms for WebGL2. Physics is backend-independent code, so the question is whether a submit, readback or sync lands inside the physics timer, or whether the timer boundaries differ between backends.

Audit, from the code.

- The physics scope wraps only `runtime_->physics.Update(dt, 1, &temp, &jobs)` (`engine/src/world.cpp`, `World::step`). The readback scope wraps the sync loop after it. Nothing else is in either scope.
- `tickBatch` (`engine/src/bridge.cpp`) runs `pages`, `inputs`, then `World::step`. It makes no render call and no GPU call.
- The render frame is a separate export, `engine_render_frame` (`engine/src/exports_render.cpp`). It runs `planFrame`, then `frameBackend`, and `webgpu::frame` ends in `queue.Submit`. The page calls `engine_tick` and then `renderer.frame()` in the same `requestAnimationFrame` step, so every submit comes after the previous tick has returned and before the next tick begins.
- The job system is `JobSystemSingleThreaded` when `ENGINE_THREADS` is off (`engine/src/world.cpp`, the single-threaded branch), so `Update` runs on the calling thread and nowhere else.
- Jolt's trace is `silentTrace` (`engine/src/world.cpp`, `JPH::Trace = silentTrace`). No `printf`, `fputs` or emscripten import is reached from the physics path. A grep of `world.cpp`, `planet_shape.cpp`, `vegetation.cpp`, `pool_alloc.cpp`, `arena.cpp` and `bridge.cpp` finds no `printf`, `fputs`, `emscripten` or `EM_ASM` call. The only callback inside `Update` is `RadialGravity::OnStep` (`engine/src/world.cpp`), which is wasm code.
- Timer boundaries are the same for both backends. They are the same wasm and the same scope code, and the per-frame phase sums match the tick in both backends (WebGPU round 1: tick 43.4, physics 41.8 + readback 1.5 = 43.3; WebGL2 round 1: tick 39.6, physics 38.3 + readback 1.3 = 39.6).

Conclusion from the audit. No submit, readback or sync is inside the physics timer, and the timer boundaries are identical. The physics window is the same wasm instructions on the same state for both backends, so the gap must come from the environment the window runs in.

Hypothesis, to test. The GPU's work changes its power draw, and on this laptop the CPU and the discrete GPU share a package power budget. A higher GPU draw can lower the CPU clock during the physics window. If that is the cause, the gap should disappear when the backend frame is skipped, because the GPU then receives no per-frame work. If the gap stays with the frame skipped, the cause is not the GPU work, and I will look for something else.

Phase A changes (code and docs only, no wasm change, so the build stays `2b28cd23…`).

1. `scripts/browser/timed-result.mjs`: `stampLoad` also records `cpuFreqKhz` (the mean of `scaling_cur_freq` over the cpus) and `gpu` (`nvidia-smi` utilisation, power, SM clock and temperature). Both are `null` when the source is unavailable. Witness: `check:timed-result`, 10 PASS, including the parsers, the sysfs reader over a temporary tree, and the `nvidia-smi` reader with a failing query.
2. `scripts/browser/engine-render-browser.js`: the `draw=0` query skips `renderer.frame()`, so the backend frame and its submit are not run, while the tick and the phase timers run as before. The result records `draw`. With `draw=0` the stats fields are not read, and `ok` means no errors. Witness: the Phase B runs with `draw=0`, whose files record `draw` 0 and `ok` true.
3. `scripts/browser/summarise-timed.mjs`: the table gains `draw`, CPU MHz before and after, GPU utilisation and power before and after, and the SM clock after. A file without these fields prints `null`.

Phase B plan. Rebuild is not needed, because no C++ changed. Confirm the wasm sha. Run the alternating WebGPU and WebGL2 1024 pairs (three rounds), then the same pair with `draw=0` (two rounds). Quote the medians and p99s side by side, and state the physics phase for each.

## Physics phase, WebGPU against WebGL2 at 1024: Phase B result

Conditions. The machine is shared. Other lanes ran gm C++ builds (`cc1plus`), an oscraft `cargo` test binary and an oscraft renderer during these runs. Load is the 1-minute `/proc/loadavg` before and after each run. A run is kept only when both stamps are under 8, its checksum and visible counts match the control, and it reports no errors. The wasm is `2b28cd23…` in every run, and no C++ changed in Phase B.

Kept draw-on pairs, WebGPU first in each round. Four pairs meet the rule: Phase C rounds 1 to 3 (`build/diag/phaseC-*`, loads 2.2 to 4.1) and Phase D round 1 (`build/diag/phaseD-*-r1`, loads 7.8 to 8.0).

| Round | Backend | Median ms | p99 ms | Physics ms | Tick ms | Load before→after |
|---|---|---|---|---|---|---|
| C1 | WebGPU | 42.15 | 51.3 | 40.3 | 41.9 | 4.10→3.64 |
| C1 | WebGL2 | 41.40 | 48.7 | 39.7 | 41.2 | 3.64→3.18 |
| C2 | WebGPU | 40.00 | 49.2 | 38.2 | 39.7 | 3.00→2.62 |
| C2 | WebGL2 | 39.80 | 47.8 | 38.1 | 39.5 | 2.49→2.23 |
| C3 | WebGPU | 41.25 | 50.3 | 39.5 | 41.0 | 2.23→2.43 |
| C3 | WebGL2 | 40.90 | 56.0 | 39.2 | 40.65 | 2.64→3.42 |
| D1 | WebGPU | 47.30 | 65.8 | 45.25 | 46.9 | 7.78→7.96 |
| D1 | WebGL2 | 49.60 | 59.3 | 47.6 | 49.4 | 7.96→7.86 |

Paired differences, WebGPU minus WebGL2, within each round:

| Round | Median ms | p99 ms | Physics ms |
|---|---|---|---|
| C1 | +0.75 | +2.6 | +0.60 |
| C2 | +0.20 | +1.4 | +0.10 |
| C3 | +0.35 | −5.7 | +0.30 |
| D1 | −2.30 | +6.5 | −2.35 |

Pooled over the four kept pairs: mean of medians WebGPU 42.68 ms and WebGL2 42.93 ms, so WebGL2 divided by WebGPU is 1.006. Median of medians WebGPU 41.70 and WebGL2 41.15. Median of p99s WebGPU 50.8 and WebGL2 52.4. Mean physics WebGPU 40.81 and WebGL2 41.15, mean paired physics difference −0.34. Median paired physics difference +0.20. These numbers are from four pairs, so they do not separate the backends beyond noise.

Runs not kept, recorded with their load and not used. All eight are from Phase D rounds 2 to 5, where load rose past 8 and stayed there. Every one has a matching checksum, so the load rule is the only failure.

| Run | Median ms | p99 ms | Physics ms | Load before→after |
|---|---|---|---|---|
| D2 WebGL2 | 50.60 | 67.7 | 48.6 | 8.82→8.07 |
| D2 WebGPU | 52.30 | 71.2 | 49.95 | 8.07→8.84 |
| D3 WebGPU | 52.80 | 68.6 | 50.55 | 8.53→8.89 |
| D3 WebGL2 | 56.85 | 103.2 | 54.55 | 8.89→10.15 |
| D4 WebGL2 | 56.10 | 123.3 | 54.05 | 11.90→17.91 |
| D4 WebGPU | 51.60 | 112.4 | 49.40 | 17.91→15.69 |
| D5 WebGPU | 48.35 | 67.2 | 46.40 | 15.69→11.78 |
| D5 WebGL2 | 48.00 | 62.0 | 46.10 | 11.78→9.24 |

Draw-off pair, not kept. The two runs are WebGPU draw0 r1 (`build/diag/phaseC-webgpu-draw0-r1.json`, median 44.00, p99 60.20, physics 42.30, load 3.42→3.90) and WebGL2 draw0 r1 (`build/diag/phaseC-webgl2-draw0-r1.json`, median 104.25, p99 241.60, physics 101.50, load 3.90→6.54). `draw=0` skips the backend frame and the stats, so neither run records a checksum and neither can pass the checksum rule. The WebGL2 physics value, 101.5 ms, is above every draw-on run and about 2.5 times the clean draw-on physics values, and it is not usable. No kept draw-off pair exists, so the power hypothesis from the Phase A plan is not decided.

Verdict on the physics gap. The round-1 gap from the Vulkan Phase B run (41.8 ms WebGPU against 38.3 ms WebGL2) is not reproduced. In the four kept pairs the paired physics difference has no consistent sign: +0.60, +0.10, +0.30 and −2.35 ms. Only the first and last exceed 0.5 ms, and they point in opposite directions. The three WebGPU-slower rounds are not larger than the round-to-round spread of WebGL2 itself.

Cause, and the fix decision. The audit above found no WebGPU submit, readback or sync inside the physics scope, and the timer boundaries are the same for both backends. A gap that changes sign under the same build and the same wasm therefore has no code cause to fix. The Phase A commit `b41aed2` is unchanged by this Phase B result, and no code change is made for it.

Remaining open item. The power hypothesis (GPU work lowers the CPU clock during the physics window) is untested, because the draw-off pair has no kept run. Settling it needs a clean WebGPU and WebGL2 `draw=0` pair with a checksum-equivalent control and load under 8 for both runs. That is not available while the other lanes hold load near 8 to 18.

## Physics phase: decision (closes the item)

Decision. The physics gap is measurement noise under the stated load bound (every kept run under 8). It is not a cause to fix, so the Phase A commit `b41aed2` is unchanged and no code changes. The draw-off power hypothesis is not confirmed and not disproven: no kept draw-off pair exists, and the item does not need it.

Kept pairs, WebGPU first in each round, from `build/diag/phaseC-*` and `phaseD-*`. The CPU MHz and GPU W stamps are before→after per run.

| Pair | Backend | Physics ms | CPU MHz | GPU W | Load | Paired physics diff, WebGPU − WebGL2 |
|---|---|---|---|---|---|---|
| C1 | WebGPU | 40.3 | 2921.7→2742.4 | 19.96→20.32 | 4.10→3.64 | +0.60 |
| C1 | WebGL2 | 39.7 | 2881.3→2486.7 | 20.13→19.85 | 3.64→3.18 | |
| C2 | WebGPU | 38.2 | 3413.3→2122.2 | 19.94→19.58 | 3.00→2.62 | +0.10 |
| C2 | WebGL2 | 38.1 | 2582.4→2285.0 | 20.23→19.98 | 2.49→2.23 | |
| C3 | WebGPU | 39.5 | 2758.5→2898.4 | 20.02→19.80 | 2.23→2.43 | +0.30 |
| C3 | WebGL2 | 39.2 | 3436.2→2078.8 | 19.48→10.25 | 2.64→3.42 | |
| D1 | WebGPU | 45.25 | 3516.7→3732.8 | 9.45→10.19 | 7.78→7.96 | −2.35 |
| D1 | WebGL2 | 47.6 | 3319.0→3299.6 | 10.34→11.10 | 7.96→7.86 | |

Over these four pairs the paired physics difference has mean −0.34 ms, median +0.20 ms and standard deviation 1.18 ms. The 95% interval on the mean (t, 3 degrees of freedom) is about −2.2 to +1.5 ms. Neither the mean nor the median reaches the 0.5 ms threshold, and the sign is not consistent.

Runs not kept, shown only as a sensitivity check and not used: D2 paired diff +1.35, D3 −4.00, D4 −4.65 and D5 +0.30. Their loads were 8.1 to 17.9. The largest magnitudes come from D3 and D4. In D3 the WebGL2 run had the higher load and the higher physics time. In D4 the WebGPU run had the higher mean load (16.8 against 14.9) and the lower physics time, so load ordering does not explain both. These runs are too loaded to read, and they are not used.

Stamps and load across all 16 draw-on runs (Phase C and D). Correlation of physics time with the mean 1-minute load of the run is +0.80. CPU MHz tracks load (+0.79), so the clock is a load proxy and not evidence of throttling. Physics time against the mean GPU power is −0.32. The clock-throttle reading of the power hypothesis is not supported: the clock rises and falls with load, and physics time follows load.

Draw-off hypothesis. The hypothesis predicts a persistent WebGPU-slower physics gap that disappears with the backend frame skipped. There is no persistent gap under the bound, so there is nothing for it to explain. The only draw-off pair cannot test it: WebGPU draw0 r1 (`build/diag/phaseC-webgpu-draw0-r1.json`, physics 42.30, load 3.42→3.90) passes the load bound but records no checksum, and WebGL2 draw0 r1 (physics 101.50, load 3.90→6.54) records none either and is 2.5 times the clean physics values. Neither is kept.

Consequence for the item. The physics item in Phase B is closed as noise. Any future physics gap claim needs a kept pair with load under 8 and a paired difference above 0.5 ms with a consistent sign across at least four pairs, and a draw-off run that records its checksum (`draw=0` currently skips the stats, so it cannot).

## Long-frame stalls at 1024: capture and cause (Phase A)

Question. The 1024 tier shows long frames: WebGPU up to 705 ms (set 2) and WebGL2 362.9 ms (an unsaved outlier). The earlier diagnosis recorded host CPU sharing as the cause and did not prove it. This section captures the stall frames with the phase split, and tests whether they land in the same frames in both backends.

Test 1, same frame in both backends, from the 16 saved draw-on runs (`build/diag/phaseC-*`, `phaseD-*`). A stall is a physics phase above 1.5 times that run's physics median. The simulation is deterministic (the checksum is identical in every run), so a simulation-driven cost would recur at the same frame index in both backends.

| Round | WebGPU spikes | WebGL2 spikes | Frames shared |
|---|---|---|---|
| C1 | 0 | 0 | 0 |
| C2 | 0 | 0 | 0 |
| C3 | 1 | 0 | 0 |
| D1 | 2 | 0 | 0 |
| D2 | 0 | 1 | 0 |
| D3 | 0 | 20 | 0 |
| D4 | 66 | 136 | 0 |
| D5 | 0 | 1 | 0 |

No frame index is a spike in both backends in any round. The spikes are rare in the clean rounds (load under 4) and common in the loaded rounds (D3 and D4, load 8 to 18). The spikes are the physics phase, not the render call. The tick is the time, and physics is most of the tick.

Test 2, where the render-side stalls sit. WebGPU D1 frame 233 spent 95 ms in the render call, all of it in the wasm backend scope. WebGPU D1 frame 174 spent 67 ms in the render call with the backend scope at 0 ms, so the time is outside the scoped calls. In the other 15 runs the render call stays under 8 ms. The backend scope covers `frame()`, which calls `surface.GetCurrentTexture` (Fifo present mode, `render_webgpu.cpp`), the upload writes, and `queue.Submit`. The scope does not separate these, so the blocking call is not yet known.

Cause, as far as the saved data goes. The physics spikes do not repeat across backends and scale with host load, so they are not simulation cost. They are host CPU sharing, consistent with the earlier cgroup finding, but the active-body count per frame is needed to rule out sim work inside a spike. The WebGPU render stalls point at the present path or GPU contention, and are not yet attributed to a call.

Phase A changes (code and pins; no change to the logic of any frame).

1. `engine/src/phase_timer.h`: three phases added, `kAcquire` (6), `kUpload` (7), `kSubmit` (8), and `kCount` is now 9.
2. `engine/src/render/render_webgpu.cpp`: `frame()` scopes the upload writes as `kUpload`, `surface.GetCurrentTexture` and the view creation as `kAcquire`, and `queue.Submit` as `kSubmit`.
3. `engine/src/render/render_webgl2.cpp`: `frame()` scopes its buffer and texture uploads as `kUpload`, so both backends split the same way.
4. `engine/src/world.h`, `engine/src/world.cpp`, `engine/src/engine_core.cpp`, `engine/CMakeLists.txt`: `World::activeBodies()` reads the Jolt active rigid body count, and `engine_sim_active_bodies` is exported in the timed build only (added to `_engine_sim_active_bodies` in the export list).
5. `scripts/browser/engine-render-browser.js`: the per-frame rows gain an `active` column after `gapMs`, and the phase names gain `acquire`, `upload` and `submit`.
6. `engine/artifacts.json`: the three pinned hashes are updated, because the wasm bytes changed. The logic is the same. The new scopes are no-ops in the fixed build, but they change the code layout. Rebuilt from the edited source: fixed 64 MiB `9d8229e5…` (was `c678dd95…`), fixed 128 MiB `aacc85b5…` (was `bbcb9361…`, which is reproduced by a build from HEAD with the edits stashed), leak 64 MiB `d0bdd282…` (was `c411d496…`). The fixed 128 MiB build gave `aacc85b5…` on two separate builds from the same source.
7. The timed 128 MiB module builds from the same source as `6159f169…`. It is not pinned.

Witness for Phase A. `check:engine-artifacts` 7 PASS, `check:engine-core` 4 PASS, `check:engine-leak` 4 PASS, `check:engine-render` 18 PASS, `check:engine-host-witness` 197 PASS, `check:timed-result` 11 PASS. Each is `RESULT: PASS`. The render gate reports 18 PASS, where the earlier record says 17. That gate is not changed here, so the extra line needs a look before it is quoted.

Phase B plan. Run the alternating WebGPU and WebGL2 timed 1024 runs (draw on) with load and CPU and GPU stamps per run, and quote the stall frames with their phase split side by side. Record whether the physics spikes coincide across backends again, now with the active-body count per frame, and whether the WebGPU render stalls land in acquire, upload or submit.

## Long-frame stalls at 1024: Phase B result

Conditions. Six timed draw-on runs at 1024, three alternating rounds, each run alone on the page server. Load and CPU and GPU stamps are taken before and after each run (`build/diag/phaseE-*-r*.json`). Load stayed between 2.1 and 4.1 in every run, below the 8 bound, and every run has `ok` true, no errors, the checksum `-3826851758512048142` and visible `[729,746,747,750]`. The wasm is the timed 128 MiB module `6159f169…`, built from the Phase A source.

Medians and p99s, side by side (frame time, ms):

| Round | WebGPU median | WebGPU p99 | WebGPU max | WebGL2 median | WebGL2 p99 | WebGL2 max |
|---|---|---|---|---|---|---|
| r1 | 44.60 | 54.0 | 72.2 | 43.55 | 53.2 | 54.8 |
| r2 | 42.80 | 51.7 | 53.5 | 42.60 | 50.3 | 54.5 |
| r3 | 42.30 | 55.2 | 58.4 | 36.95 | 43.8 | 48.0 |

Physics median, load, CPU and GPU stamps per run (before→after):

| Run | Physics median ms | Load | CPU MHz | GPU W |
|---|---|---|---|---|
| WebGPU r1 | 42.6 | 3.86→4.07 | 4374→2658 | 19.90→20.66 |
| WebGL2 r1 | 41.7 | 4.07→3.52 | 3414→3053 | 20.69→20.13 |
| WebGL2 r2 | 40.8 | 3.24→2.60 | 3410→1974 | 20.32→20.44 |
| WebGPU r2 | 41.0 | 2.60→2.67 | 2646→3169 | 20.50→20.61 |
| WebGPU r3 | 40.4 | 2.67→2.52 | 3856→2265 | 20.64→11.77 |
| WebGL2 r3 | 35.6 | 2.52→2.13 | 2564→1775 | 11.73→10.61 |

The round-3 gap in medians (WebGPU 42.30, WebGL2 36.95) is not explained by a stall. Every frame in that WebGL2 run is below its own 1.5 times median, so the difference is in the typical frame, and this section does not claim a cause for it.

Stall frames. A stall is a frame above 1.5 times its run's median.

- WebGPU r1: frames 538 and 539 are the only stalls in the six runs. Their total is 72 and 71 ms, and the tick is the whole of it (tick 72 and 71 ms, physics 70 and 69 ms, render 1 and 0 ms). Acquire, upload and submit are all under 0.2 ms in those frames. The active-body count is 10240 in every frame of every run, so the sleep state does not change across the stall.
- WebGL2 r1, r2, r3 and WebGPU r2 and r3: no frame above 1.5 times its run's median.
- Shared frames: zero, in all three rounds. Frame 538 and 539 are normal in the WebGL2 r1 run, which ran on the same simulation state (same checksum, same frame index). A cost in the simulation state would show there too, so the stall is not a simulation-state cost.
- The WebGPU render stalls seen earlier (frame 233, 95 ms in the backend scope, and frame 174, 67 ms outside it) did not recur in these runs. Their maximum acquire, upload and submit in the six runs are 0.2, 0.4 and 0.2 ms.
- The 705 ms WebGPU value and the 362.9 ms WebGL2 outlier from the earlier sets did not recur here either.

Cause of the remaining stall (WebGPU r1, two frames). The stall is in the physics phase. It is not a render stall, and it is not a simulation-state effect, because the same frame in the matching WebGL2 run is normal and the active-body count is flat. The remaining candidate is host CPU sharing (a co-tenant process or a cgroup throttle), which the earlier diagnosis recorded. This is not proven here. A per-thread CPU time would prove or refute it, and the browser does not expose one for the wasm thread, so the cause is recorded as likely host sharing, not as proven.

Verdict on the item. The stall is not reproduced at the level of the earlier 705 ms and 362.9 ms values. One two-frame stall in six runs remains, in the physics phase, not in our render path, and the evidence points to host CPU sharing. No code fix is made, since none is supported by the data. The Phase A changes stay as instrumentation so that a future stall can be attributed to a phase and a backend call at once.

## Host CPU sharing as the cause of the remaining stall (Phase A, written before the runs)

Hypothesis H. The two-frame physics stall (WebGPU r1, frames 538 and 539) is cgroup CPU throttling. The root cgroup has `cpu.max` 1200000 100000, a quota of 12 CPUs per 100 ms period on a 16-thread host, and `cpu.stat` counts `throttled_usec` as wall time with the whole group descheduled. Within a throttle window the page's thread cannot run, so a frame's wall time grows by the throttled time.

Method. `scripts/browser/cgroup-sampler.mjs` reads `throttled_usec` every 2 ms into a log, with the wall time of each sample. `scripts/browser/stall-attribution.mjs` interpolates the cumulative throttled time over each frame's wall window (`startMs` is now a row column) and labels every stall frame `throttled` when its throttled time is at least half its excess over the run median, `unexplained` otherwise, and `uncovered` when the sampler did not span the frame. `scripts/browser/cpu-load.mjs` starts a fixed number of busy processes for a fixed window and records the window. Each run is WebGPU, draw on, timed 1024. Three runs have no generator (G0) and three run a 12-worker generator for 90 s from the start of the run (G1). The sampler runs 90 s in both.

Predictions, each of which can fail.

- P1. In every run, every stall frame is `throttled`, with throttled time at least 0.5 times its excess. A stall labelled `unexplained` disproves H as the cause of that stall.
- P2. The generator raises the number of stall frames. Total stalls in G1 exceed total stalls in G0. If G1 has no more stalls than G0, the generator does not load the throttle, and H is not supported by the test.
- P3. Frames with no throttled time in their window do not stall beyond the baseline. A stall in a frame with zero throttled time disproves H for that frame.
- Coverage. No stall frame is `uncovered`. If one is, the sampler did not span the run and the run is void for P1.

Engine side of the Phase 5 p99. `scripts/streamer-p99.mjs` runs the engine's planet flight in Node (6000 ticks at 30 m/s, the path that `scripts/check-engine-planet.mjs` uses) and times the streamer step each tick: `locateCell`, and `writePage` plus `releasePage` when the cell changes. Measured here: p50 0.00057 ms, p99 0.00394 ms, max 30.52 ms over 6000 steps. The 30.52 ms maximum is one step, not checked yet.

Spoint side of the Phase 5 p99. Not measured in this pass. Spoint's `src/terrain/HeightfieldStreamer.js` does its work in its own `setTimeout` and promise chain, and `cover(points)` only enqueues. There is no per-step entry point to time from outside without patching spoint. The engine's frame-time p99 on a planet path is also not measured: the browser harness orbits a fixed scene and stages its 16 pages once. The ENGINE.md witness (frame-time p99 against spoint's streamer on the same path) therefore stays OPEN, with these two causes.

Phase A changes. `scripts/browser/engine-render-browser.js` (row column `startMs`); `scripts/browser/stall-attribution.mjs`, `scripts/browser/cgroup-sampler.mjs`, `scripts/browser/cpu-load.mjs`; `scripts/streamer-p99.mjs`; `scripts/check-stall-attribution.mjs` and `scripts/check-streamer-p99.mjs`, both in the `npm test` chain before `check:engine-host-witness`.

Deviation, recorded after the first two runs. The starvation signal in the pre-registration was summed `throttled_usec`. That counter adds the throttled time of every CPU in the group, so a 168 ms frame read 707 ms of it (`build/diag/phaseF-*` analysis of G1 r1). It is not a wall-clock state and cannot test H. From the third run the sampler also logs `cpu.pressure` `full` (`fullUs`), the wall time in which every runnable task of the group was stalled, and the verdicts use it as `starved`. The prediction is unchanged: P1 to P3 and the coverage rule apply to `starved` time as they did to throttled time.

Phase B result (WebGPU, draw on, timed 1024, one run at a time on a shared host).

| Run | Condition | Median ms | p99 ms | Max ms | Physics median ms | Load before→after | Stalls over 1.5× median | Starved, wall (full PSI) | Summed throttled_usec over window |
|---|---|---|---|---|---|---|---|---|---|
| G0 r1 | no generator | 52.60 | 65.10 | 86.20 | 50.30 | 13.93→10.99 | 1: frame 567, 86.2 ms | not sampled | 0 ms over 227–347 s (see caveat) |
| G1 r1 | 12 workers, 120 s | 109.50 | 166.50 | 184.20 | 105.75 | 8.07→10.87 | 7: frames 68, 310, 393, 486, 534, 537, 538 | not sampled | 359,475 ms over 120 s |
| G0 r2 | no generator | 71.30 | 98.70 | 102.40 | 68.15 | 11.20→11.86 | 0 | 0.40 ms mean per normal frame (518.6 ms in window) | 0 ms over 120 s |
| G1 r2 | 12 workers, 120 s | 83.00 | 94.90 | 97.30 | 79.80 | 8.87→13.48 | 0 | 9.03 ms mean per normal frame (10,164.6 ms in window) | 128,282 ms over 120 s |

Caveat on G0 r1. Two samplers wrote `build/diag/throttle-g0r1.log`. The first (227.1 to 347.1 s, which covers the run's rows at 236.9 to 268.2 s) gave the attribution above, with summed throttled time flat at 49,838,212,654 µs from first sample to last. The second, started from a shell call I read as failed, overwrote the same path with 280.1 to 400.1 s. The file on disk now is the second. The evidence for G0 r1 is the attribution output recorded at the time, not the file.

Frame 567 of G0 r1. Tick 57.6 ms (physics 55.8 ms). Render 28.6 ms, of which the backend scope accounts for 0.1 ms. So that stall has about 28 ms outside every timed scope. It is a JavaScript or emscripten glue cost, not the GPU submit. It is not yet attributed.

What the runs show.

- P1 (every stall is starved): cannot be tested. G0 r1 has one stall with no starvation sample, and throttled time was flat over its window. That disproves cgroup quota throttling for that stall. It does not rule out other CPU contention, since no PSI was taken in that run.
- P2 (generator raises stalls): one pair supports it (7 against 1), and the other pair shows none (0 against 0). Two runs per condition are not enough, and the no-generator runs were themselves at background load 11 to 14, so the comparison is confounded.
- P3 (no stall without starvation): the generator raises wall-clock starvation about 22 times (0.40 to 9.03 ms per normal frame), and r2 did not produce a stall. So starvation alone did not produce stalls in r2.

Verdict on H. Not proven. Partly ruled out: cgroup quota throttling for the G0 r1 stall, from the flat throttled counter. The generator raises starvation a lot, but two runs per condition do not show that it raises stalls. No fix is made in our process, since none is supported. The cause of the physics-phase freezes and of the 28 ms outside the scopes in frame 567 is not identified.

Engine streamer p99 (the engine side of the Phase 5 witness, Node, 6000 steps on the planet flight). Phase A run: p50 0.000571 ms, p99 0.003937 ms, max 30.524 ms. Phase B run with load 12.52 before and after: p50 0.000361 ms, p99 0.002825 ms, max 0.563 ms. The 30.5 ms maximum did not recur, and no sample was taken for it. Spoint's streamer side is not measured, and the frame-time p99 on a planet path remains OPEN (see the Phase A section above).

Witnesses. `check:stall-attribution` 7 PASS (`RESULT: PASS`). `check:streamer-p99` 3 PASS (`RESULT: PASS`). No wasm changed in this pass, so no rebuild and no pin change.

## Phase A: CI grade gate, spoint streamer driver, paired runs (code, docs and tests only, not built or run)

CI fix, `scripts/check-terrain-static.mjs`. The gate `terrain grade equals spoint for 4 colours under 3 grade option sets` compared `ambient.terrainGrade` output with the spoint fixture by `assert.deepEqual`, which is exact. The `ci` job failed on 074a8fa and e1b623c under Node 22. Change: each channel is compared with `near`, the file's existing helper, which allows an absolute difference below 1e-12. Cause, partly checked. A diagnostic probe with the local Node v24.22.0 (not a CI witness, not part of the gate) found all 12 rows exact, zero difference. The likely cause is that `Math` functions used in the grade path can differ in the last bit between V8 releases, so an exact compare that passes on one Node version can fail on another. The Node 22 difference itself is not reproduced here. Witness to come in Phase B: `check:terrain-static` on Node 22 (the CI version) and on Node 24.

Spoint streamer call time, `scripts/streamer-spoint-p99.mjs` with its gate `scripts/check-streamer-spoint-p99.mjs`. The driver imports spoint's `src/terrain/HeightfieldStreamer.js` from `/workspace/spoint` and calls `createTerrainStreamer` with a stub physics object (`addHeightField`, `removeBody`, `setBodyTransform`, `setTerrainBodyId`, `getTerrainBodyId`, `liveWorldCount`, `wasmHeapBytes`), the planet flight path's `(x, z)` as chart coordinates, `extent` 510 and `resolution` 4, and an analytic stand-in height function. It never calls `start()`, so no tick timer runs. For each path point it awaits `cover([point])` and times the promise. Spoint's console lines are counted and silenced during the run. What this measures: the time of spoint's `cover()` call, including its sampling and the yields inside it, against the stub physics and the stand-in height function. It does not measure frame time, and it is not the engine's planet terrain. Its gate imports spoint, so it is a script, like `check-marching-drift.mjs`, and it is not in `npm test`. The gate checks one field per point, a second field only for a far point, zero builds with an empty wasm heap, one timed step per point, and console restoration.

Paired host-sharing runs, `scripts/browser/paired-run.mjs` and `scripts/browser/paired-report.mjs`, with the pure-logic gate `scripts/check-paired-report.mjs` (in `npm test`, before `check:engine-host-witness`). `paired-run.mjs` takes a label, the condition (`G0` or `G1`), a round, an output directory, a duration, a worker count and a tick count. It starts `cgroup-sampler.mjs` over that duration, starts `burn` for G1 only, and loops the engine's planet flight through `streamerSteps` inside the same window, so the streamer p99 comes from the same window as the sampler. It writes `<label>.sampler.txt` and `<label>.run.json`. The page run is driven through playwriter, outside this script, which writes `<label>.page.json` into the same directory. `paired-report.mjs <dir>` joins each run record, its sampler and its page result. For each run it computes the summed throttled delta and the `full` pressure delta inside the window, the frame stall count from `attributeStalls`, and the streamer p99. It pairs runs by round and gives a verdict on P2: `supported` if G1 has more stalls than G0 in every pair, `not-supported` if it never does, `mixed` otherwise, and `insufficient` below two pairs. The gate covers the record validation, the pairing and its refusals, the window deltas, and the verdict cases. It does not run a page or a load.

Integration. `package.json` adds `check:streamer-spoint-p99` (script level, not in the chain) and `check:paired-report` (in the chain, after `check:streamer-p99`).

Not yet done in Phase A: the frame-time p99 comparison on the planet path, the paired G0 and G1 runs, and the Node 22 witness of the CI gate. They are Phase B, and the summary above does not claim any of them.

## Phase B: witnesses, defects, and the paired rows that stay open

Node 22 witness (the CI version). The first Node 22 run of `npm test` stopped at `check:height-cpu`. Five `sampler hv2-* heights match spoint bit for bit` gates failed with differences of one to four units in the last place (for example `hv2-default` index 2: got -3.1308016237455525, want -3.130801623745556). The cause is the same class as the grade gate: values computed with `Math` differ in the last bits across V8 releases. Fix: `scripts/check-height-cpu.mjs` compares computed values with `close` (a relative 1e-12, absolute below magnitude 1), and keeps `Object.is` for the uniform defaults, which are literals. Witness: a second full `npm test` under Node v22.23.4 (`/tmp/node22/bin/node`, the official Linux binary, not a CI witness of the runner itself): `EXIT 0`, 4674 PASS lines, no FAIL. The grade gate and the height gate both pass under Node 22 with the fix. A probe of the old exact grade compare under Node 22 gave a worst difference of 1.1e-16, which confirms the cause.

Node 24 witness. The full chain on Node 24.22.0 ran before the height-gate tolerance change, with 4674 PASS and EXIT 0. `check:height-cpu` passes under Node 24 after the change. A complete Node 24 rerun is not done (see the host decision below).

Spoint streamer call time. `scripts/check-streamer-spoint-p99.mjs` (script level, not in `npm test`): 5 PASS, `RESULT: PASS`. Its first run had two defects, both fixed: the gate read the bodies after `stop()` had cleared them (the driver now snapshots them before `stop()`), and the gates ran concurrently while each `coverSteps` swapped `console.log`, so output was swallowed and console was left wrapped (the gates now run in sequence). `node scripts/streamer-spoint-p99.mjs 6000`: 6000 steps, builds 2, p50 0.000832 ms, p99 0.005511 ms, max 4.514 ms (one field build), console lines 0. This is `cover()` call time against the stub physics and the analytic stand-in height, not frame time and not the planet's terrain.

Engine streamer p99 (the same flight path). `node scripts/streamer-p99.mjs 6000`: p50 0.000301 ms, p99 0.002434 ms, max 0.507 ms. The two sides measure different things (an engine cell lookup and page write against a spoint field build) and are not compared as frame time.

Paired host-sharing runs, first attempt (round 1 and round 2, G0 and G1, 240 s windows). Every run failed; no run produced a page result with frame data. Causes, each one checked:

- `r1-G0` paired-run aborted on the JavaScript heap (exit 134). Cause: the streamer loop created a new engine world on every 6000-step pass and kept every step in a JavaScript array. Fixed: one world per window (`planetWorld` plus `streamerPass` in `scripts/streamer-p99.mjs`), and the steps are kept in typed arrays.
- `r1-G1` paired-run stopped with `RangeError: Maximum call stack size exceeded` at `Math.max(...streamer.steps)`. Fixed: the maximum is a loop (`reduce`).
- `r1-G0` page: `WebGPU returned no adapter`. Cause: the driver was given `/tmp/chrome-r1-G0` as its profile. `scripts/browser/webgpu-profile.mjs` seeds the WebGPU labs only for the project profile `/workspace/jayzee/.playwriter/browser-profile` and reports `not the project profile` for any other directory, so the chromium it starts has no WebGPU adapter.
- `r1-G1`, `r2-G0` page: `NO_DEVTOOLS`. Cause: running chromium directly on a `/tmp` profile fails with `Failed to create a ProcessSingleton for your profile directory` (`Failed to create socket directory`), so no DevTools port opens. The project profile is the one to use.
- `r2-G1`: stopped by me by PID (sequence 505632, paired-run 522236, timed-run 522237) once the first attempts showed the failures above. Nothing was left running from that sequence. The page server on 8765 (PID 505209) is still up.

Why the paired rows were open. Each paired run needed its own page result inside the sampler window, and the first attempts produced none, for the causes recorded above. They are closed in the section "Phase B: paired host-sharing rows, closed" at the end of this file.

Detached jobs found at resume (pids from the request). PID 3881549 (`build/diag/sampler.mjs`, `load-run2.log`, `500`) is still running; a later check found it alive with `load-run2.log` at 42519 lines. An earlier note in this doc said it had exited, which was wrong: the process check I used did not match its command line. PID 3881547 (`build/diag/collect.mjs`, an HTTP receiver on 8766) and PID 3881551 (`build/diag/throttle.mjs`, a 100 ms `setInterval` that writes `throttle-run2.log`, 208470 lines so far) have no exit condition and do not exit on their own. Neither was stopped. `build/diag/raw` holds six page results (`webgpu-1024-r1..r3`, `webgl2-1024-r1..r3`, posted 03:52 to 03:59), and none arrived after 03:59, so no page result for the paired runs exists. These jobs keep writing while they run, so any new run on this host adds load to their record.

Decision (closed). The owner chose to keep PIDs 3881547, 3881549 and 3881551 running, and they were kept running through the paired runs. Each paired run started only when the host 1-minute load was below 3, as the section at the end of this file records.

Witnesses in this round. `check:paired-report` 7 PASS (`RESULT: PASS`), `check:streamer-p99` 3 PASS (`RESULT: PASS`), `check:streamer-spoint-p99` 5 PASS (`RESULT: PASS`), Node 22 full `npm test` `EXIT 0` with 4674 PASS, `check:terrain-static` under Node 22 PASS, `check:height-cpu` under Node 22 PASS.


## Phase B: paired host-sharing rows, closed

Scope. Four paired runs, round 1 and round 2, G0 and G1, each with a 240 s sampler window from `scripts/browser/paired-run.mjs` (G1 with 12 burn workers), and one WebGPU page render per run (`engine-render.html?phase=10&tier=1024&timed=1`) through the project browser at `.playwriter/browser-profile`. Each page render produces 600 frames, about 24 s, so it covers part of the 240 s window. The stall attribution counts the 540 frames inside the window. The files are in `build/diag/paired-B/`.

Witness values, quoted from the run records (`*.run.json`) and the page results (`*.page.json`):

| Run | Streamer samples | Streamer p50 / p99 / max (ms) | Page median / p99 / max (ms) | Throttled delta (us) | Full delta (ms) | Stalls (starved / unexplained) |
|---|---|---|---|---|---|---|
| r1-G0 | 145386000 | 0.000121 / 0.000380 / 5.574 | 40.2 / 44.1 / 45.6 | 0 | 87.857 | 0 (0 / 0) |
| r1-G1 | 60672000 | 0.000290 / 0.000721 / 30.167 | 83.85 / 98.6 / 123.1 | 427896639 | 38604.317 | 0 (0 / 0) |
| r2-G0 | 131724000 | 0.000131 / 0.000641 / 6.740 | 39.9 / 47.3 / 54.2 | 0 | 185.398 | 0 (0 / 0) |
| r2-G1 | 36294000 | 0.000281 / 0.000682 / 33.817 | 104 / 298.2 / 399.3 | 905090462 | 58630.099 | 199 (110 / 89) |

All four page results have `ok` true, `errors` empty, backend `webgpu` on the NVIDIA GeForce RTX 3060 Laptop GPU (not a fallback adapter), `allocationsSinceWarmup` "0", checksum -3826851758512048142 and visible [729,746,747,750].

Paired report, `node scripts/browser/paired-report.mjs build/diag/paired-B`: `verdict` "mixed", `starvationRatio` 355.8376461546907. Round 1 has no stalls in either condition (0 against 0, not raised). Round 2 has 199 stalls under G1 against 0 under G0 (raised). With two pairs the verdict is mixed. These runs do not decide P2. A decision needs more pairs.

Project-profile page probe (before the paired runs, through the project browser): adapter NVIDIA GeForce RTX 3060 Laptop GPU, api webgpu, `isFallbackAdapter` false, 600 frames, median 38.35 ms, p99 66.30 ms, max 82.40 ms, `errors` empty, `allocationsSinceWarmup` "0", checksum -3826851758512048142, visible [729,746,747,750]. The file is `probe-profile.page.json`.

Defects found in this round, each fixed or recorded:

1. Streamer driver, `scripts/streamer-p99.mjs` `streamerPass`. Committed pages stayed in `kPendingCommit`, because nothing ticked the world, and `engine_page_release` refuses a page that is not resident (engine status -2). That was the first failure of r1-G0. Fix: one `world.step()` per flight step, before the timer starts, so the engine applies pending pages as it does at the start of a tick (`bridge.cpp` `tickBatch`). The timed region holds the same streamer work as before. Witness: four passes of 6000 steps, 24000 steps in total, resident 4, no refusal, and `check:streamer-p99` 3 PASS. Streamer numbers from before this fix are not comparable with the runs above.
2. `percentile` in `scripts/streamer-p99.mjs`. `Array.sort` with a comparator throws on a huge Float64Array ("Custom comparefn not supported for huge TypedArrays"), which was the second failure of r1-G0. Fix: `Float64Array.from(values).sort()`. Witness: 3,000,000 values give p50 1499.999, p99 2969.999, max 2999.999, and `check:streamer-p99` 3 PASS.
3. The 64-tier timed page had no build. `engine/out/engine-core-64mib-timed.mjs` did not exist, only the 128 MiB timed build did, so the page failed with "Failed to fetch dynamically imported module". Fix: `ENGINE_VARIANT=timed ENGINE_TIER_MIB=64 bash engine/build.sh`, which exited 0 and printed the wasm sha256 ca51b8e938f90e1e01f0b0ae639841c80cfd69f14e9e9f91f44e86e78b5fd107. Witness, tier 64 timed: phase 10 is webgpu with `errors` empty, checksum -5415737363265412373, visible [18,20,21,20] and allocations "0". Phase 11 is webgl2 with the same checksum, visible and allocations.
4. Three paired-run jobs were killed by gm worker restarts (the first r1-G0 attempts and the first r2-G0 attempt). A restart kills the process group of every running job. The outputs of those attempts were discarded and each run was repeated under a new job name. None of the four reported runs was affected.
5. Round 2 G0 did not run in its first two attempts. The load gate read 7.45 and then 4.5, so the run was skipped. It was not a death. It ran once the load read 2.29.

Gates and browser witnesses run in this round:

- `npm test` on Node 24.22.0 gives EXIT 0, 4674 PASS lines and 0 FAIL lines (`build/diag/paired-B/npm-test.log`).
- 23 named check gates, each run as `npm run <name>`, all EXIT 0 with RESULT: PASS (`build/diag/paired-B/gates-summary.txt`): check:client-resource-pools, check:engine-artifacts, check:engine-bridge, check:engine-codecs, check:engine-core, check:engine-host-witness, check:engine-isolation, check:engine-leak, check:engine-planet, check:engine-pools, check:engine-render, check:engine-tiers, check:engine-vegetation, check:engine-world, check:height-cpu, check:hygiene, check:paired-report, check:stall-attribution, check:streamer-p99, check:streamer-spoint-p99, check:terrain-static, check:timed-result, check:webgpu-profile.
- Engine render pages, `scripts/browser/engine-render.html`, timed=1. Tier 1024 WebGPU: checksum -3826851758512048142, median 42.6 ms, p99 51.4 ms. Tier 1024 WebGL2: the same checksum, median 43.9 ms, p99 49.5 ms. Tier 64 WebGPU and WebGL2: see defect 3. Allocations after warm-up are zero on all four pages.
- `scripts/browser/client-resource-pools.html`: `compiledAtLoad` 2, `compileCountAfterPlay` 2, lights, textures and meshes live 8 each, baseline p99 0.1 ms and churned p99 0.2 ms over 600 frames each.
- Public site `https://anentrypoint.github.io/jayzee/play/`: `crossOriginIsolated` true and `SharedArrayBuffer` a function, before and after reload.

Still open, not closed by this section: the phase 3 rotation gate; the phase 5 frame-time p99 comparison against spoint; the `USE_WEBGPU` migration to emdawnwebgpu; the `ENGINE_THREADS` branch, which is not compiled; `scripts/browser/run-player-webgpu.mjs`, which still needs PLAYWRIGHT_CORE; the 1024-tier long-frame stalls in both backends (round 2 G1 shows a p99 of 298.2 ms and a maximum of 399.3 ms in the page, and no code fix is verified); the launcher-level fix for the null `requestAdapter()` after a browser restart; the P2 verdict, which needs more paired rounds; and CI for the new commit, which runs on GitHub and was not run here.


## Stall pass: diagnosis, changes and the P2 ledger

Diagnosis, from the existing artifacts of round 1 and round 2 (read only, nothing run). A stall is one synchronous page frame, tick (the engine physics step) plus render. In r2-G1 the 199 stalled frames are dominated by the tick: the stalled-frame median physics time is 195.4 ms against 94.7 ms for normal frames, while every render phase stays below 5 ms. Every row of G0 and G1 has `active` 10240, so all 10240 bodies are active on every step. The engine sets `mAllowSleeping = false` at `engine/src/world.cpp`, so the physics cost never drops at rest. The labels `starved` and `unexplained` come from cgroup full pressure, which needs every runnable task stalled. A page thread that is starved while other threads run is labelled `unexplained`. The stall threshold is 1.5 times each run's own median, so G1's threshold (about 156 ms) is not G0's (about 60 ms), and the two counts answer different questions.

Changes, Phase A, not yet built or run:

1. `engine/src/world.cpp`: bodies may sleep (`mAllowSleeping = true`). Cause: the physics step is the frame's dominant cost and every body is active on every step. Witnesses: `check:engine-world`, `check:world`, `check:engine-pools`, `check:engine-bridge`, `check:engine-core`, `check:engine-tiers`, `check:engine-leak`, and the 1024 and 64 page checksums and frame times in Phase B. The phase 2 deviation (a), that the engine never sleeps, changes with this.
2. `scripts/browser/stall-probe.mjs` and `scripts/check-stall-probe.mjs` (new, in `npm test`): classifies each stalled frame by the renderer main-thread CPU from the thread sampler log, against cgroup some pressure, and reports the tick share of each stall. The verdicts are `cpu-bound`, `starved` and `blocked`. Witness: `check:stall-probe` (six gate lines, synthetic cases), then the probe on the Phase B G1 runs.
3. `scripts/browser/stall-attribution.mjs`: `attributeStalls` takes `baseMs`, and `pressureMsBetween` takes the pressure key. `starvedMs` keeps its behaviour. Witness: `check:stall-attribution`, the new common-baseline gate line.
4. `scripts/browser/paired-report.mjs`: G1 stalls are counted against the median of the G0 run in the same round, so both conditions use one threshold. The count against G1's own median stays in `g1OwnBaseStallCount`. Witness: `check:paired-report` (new gate line), then the Phase B report.
5. `scripts/check-engine-bridge.mjs`: a rotation gate, a sphere dropped straight down keeps the identity rotation and a unit quaternion (ranked item 3, phase 3). Witness: `check:engine-bridge`.
6. `package.json`: `check:stall-probe` added to the `npm test` chain after `check:paired-report`.

Ranked items folded into this pass. Item 2 (the 1024 WebGPU stalls) is changes 1 to 4. Item 3 (the phase 5 frame-time p99 against spoint) is not folded and stays open. Item 4 (the phase 3 rotation gate) is change 5. Item 5 (ENGINE_THREADS) shares the cause, a single-threaded physics step, and stays open unless change 1 does not remove the cost. Item 6 (PLAYWRIGHT_CORE) needs no code change: its witness runs in Phase B with PLAYWRIGHT_CORE set. USE_WEBGPU and the launcher-level null adapter are not folded, and stay open.

Measurement note. The thread sampler records jiffies at USER_HZ 100, so each frame's main-thread CPU is accurate to about 10 ms.

Witnesses in Phase B are appended below this line.

### Phase B: paired runs under the sleeping build, the P2 verdict and the open cause

Build. The engine variants were rebuilt with `mAllowSleeping = true`, and the pins in `engine/artifacts.json` now name the new local builds: fixed 64 `0690234f…`, fixed 128 `e3f52a62…`, leak 64 `9b6590bd…`. `check:engine-bridge` runs the rotation gate by measured bounds. A sphere dropped straight down ends within 8.7e-4 rad and 0.49 mm at 240 ticks, because float32 contact round-off is amplified by the bounce, so an exact identity claim cannot hold. `check:engine-core` and `check:engine-leak` both PASS.

Paired runs (`scripts/browser/paired-run.mjs`, 240 s window, G1 with 12 burn workers, phase 10 at tier 1024 timed in the project browser). Each run started with 1-minute load below 3 (2.33, 2.88, 2.79 and 2.97).

| Run | Page p99 / median / max (ms) | Frames | Streamer p99 (ms) |
| --- | --- | --- | --- |
| r1-G0 | 48.5 / 41.25 / 56.0 | 540 | 0.00053 |
| r1-G1 | 294.1 / 112.15 / 342.8 | 540 | 0.00069 |
| r2-G0 | 54.0 / 45.2 / 56.6 | 540 | 0.00047 |
| r2-G1 | 172.4 / 97.2 / 253.7 | 540 | 0.00070 |

Paired report, `node scripts/browser/paired-report.mjs build/diag/paired-C`: `verdict` `supported`, `starvationRatio` 103.69173018128768. Round 1: G0 has 0 stalls (threshold 61.875 ms from its median 41.25 ms), and G1 has 540 frames over that threshold. Its count against its own median is 110. Round 2: G0 has 0 stalls (threshold 67.8 ms), and G1 has 534 frames over it. Its own-median count is 15. P2, that G1 has more stalls than G0 in every pair, holds under both counts. The common-baseline count saturates, because the G1 median frame is 2.3 to 2.7 times the G0 median, so nearly every G1 frame counts. The own-median count is the one that counts discrete stalls.

Stall probe, `scripts/browser/stall-probe.mjs` on the G1 windows. Round 1: 110 stalls (starved 86, blocked 24, cpu-bound 0), stall tick median 199.6 ms against 106.85 ms in normal frames. Round 2: 15 stalls (blocked 14, starved 1, cpu-bound 0), stall tick median 156.2 ms against 96.3 ms. The tick is the stall, so the cost is the physics step, not the render path.

Active bodies. The timed page's `active` column, from `engine_sim_active_bodies`, is 10240 in every one of the 540 frames of all four runs. So the sleeping change has no measured effect, and no body sleeps. Tick medians: G0 40.9 ms (round 1) and 44.8 ms (round 2), and G1 110.9 ms and 96.5 ms.

Cause, recorded and not resolved. `applyRadialGravity` (`engine/src/world.cpp:399-410`) calls `bodies.AddLinearVelocity` on every live body on every tick. Each body therefore gets a fresh velocity before Jolt's sleep test, and none stays at rest long enough to sleep. The physics step stays proportional to 10240 bodies on every tick, and under the 12-worker burn it takes two to three times as long, which produces the stall frames. Change 1 (`mAllowSleeping = true`, commit 3f5325a) is kept, with no measured effect. The next change, made in Phase A of the next pass, stops the per-tick radial velocity from waking resting bodies (apply it only to bodies that are awake), then reruns the `active` column and the four paired runs. If sleeping still does not remove the cost, ENGINE_THREADS is the next lever.

P2 verdict: `supported` in both pairs. The stall problem is not resolved. G1 stall frames remain in both rounds, and the 1024 long-frame stalls are the same physics-phase cost under host load, so they stay open with the cause above.

Witnesses (Phase B):

- `npm test`: EXIT=0, PASS=4681, FAIL=0, RESULT: PASS 224 (224 gates). Log `build/diag/paired-C/npm-test.log`. Includes `check:stall-probe` and `check:paired-report`.
- Engine render, phase 10, tier 64, timed, webgpu: 600 frames, errors 0, outliers 0, bodies 512, p99 2.9 ms, median 2.2 ms, checksum -5415737363265412373.
- Engine render, phase 11, tier 64, timed, webgl2: 600 frames, errors 0, outliers 0, bodies 512, p99 2.6 ms, median 2.0 ms, checksum -5415737363265412373 (the same checksum as the webgpu phase 10 run at tier 64).
- Engine render, phase 11, tier 1024, timed, webgl2: 600 frames, errors 0, outliers 0, bodies 10240, p99 45.5 ms, median 37.5 ms, max 49.3 ms, checksum -3826851758512048142.
- `scripts/browser/run-player-webgpu.mjs` with `PLAYWRIGHT_CORE=/data/cache/npm/_npx/7d835fc058142333/node_modules/playwright-core/index.mjs`: EXIT=0, backend webgpu, errors none, 4 of 4 VAT phase checks pass, dot pixels 228 from 3 instances, 5 draws. Log `build/diag/paired-C/player-webgpu.log`.
- `scripts/browser/client-resource-pools.html` in the project browser: compiledAtLoad 2, compileCountAfterPlay 2, lights, textures and meshes live 8, 8 and 8, baseline p99 0 ms and churned p99 0.2 ms, 600 frames each.
- Public site `https://anentrypoint.github.io/jayzee/play/` in the project browser: crossOriginIsolated true, SharedArrayBuffer a function, service worker controlling the page.

Still open, not closed by this section: the gravity wake cause above (the sleep change has no measured effect); the phase 5 frame-time p99 against spoint; the `USE_WEBGPU` migration to emdawnwebgpu; the `ENGINE_THREADS` branch, which is not compiled; the launcher-level null adapter after a browser restart; and CI for the pushed commits, which runs on GitHub and was not run here.

### Gravity wake: cause, and the Phase A changes of this pass

Cause, read from the Jolt source (`/tmp/jolt-src`, `Jolt/Physics/Body/BodyInterface.cpp` lines 624 to 636). `applyRadialGravity` (`engine/src/world.cpp`, called from the step listener at line 98) adds the planet pull to every live body on every tick through `BodyInterface::AddLinearVelocity`. That call activates an inactive body whenever the new velocity is not near zero (lines 634 and 635). Every body is therefore woken on every tick, resting or not, and the sleep test never completes. The 10240 in the `active` column of the page is this wake, and change 1 of the stall pass (`mAllowSleeping = true`) cannot take effect while it lasts. The stall frames are the physics step of bodies that never sleep.

Changes (Phase A, not built or run when written):

1. `engine/src/world.cpp`, `applyRadialGravity`: a body that is not active is skipped, so a resting body gets no velocity and keeps sleeping. Witness: `check:engine-sleep`, gates 1 and 2 (bodies sleep at radius height within 1200 ticks, and a sleeping body does not move or wake over 120 ticks), then the `active` column of the Phase B paired runs.
2. `engine/src/world.cpp`, `configurePlanet`: after the planet body is replaced, every live body is activated, so each one re-tests its support. Witness: `check:engine-sleep`, gate 4 (a reconfigure gives 64 active bodies).
3. `scripts/check-engine-sleep.mjs` (new, `npm run check:engine-sleep`). It builds the render page's scene: a 2048-capacity world at 60 ticks per second, a ground box, 64 bodies on a grid and the planet. It has four gates: the settle, the still sleeper, the moved body that wakes and settles again, and the planet reconfigure. It needs the built engine glue, so like `check:engine-bridge` it runs with the engine gates and not in `npm test`. Witness: its RESULT line in Phase B, first against the pre-fix build (expected to fail on gate 1), then against the rebuilt build.
4. `scripts/browser/stall-probe.mjs`, `probeStalls`: reports `activeMin` and `activeMax` over the run's frames, and each stall's `active` count, so the wake shows beside the stall verdicts. It is null when the run has no `active` column. Witness: `check:stall-probe`, the new gate line "probeStalls gives the active-body range over the frames…" (in `npm test`).

Ranked remaining work, at the start of this pass:

1. Gravity wake (this pass). Cause found and recorded above. Changes 1 to 4 are Phase A, and their Phase B witnesses follow below. Status: fixed in source, witnessed in Phase B.
2. P2 stall verdict. The last report gave `supported` with `starvationRatio` 103.69173018128768. Round 2 alone: G1 534 frames over the G0 threshold against 0 (G0 threshold 67.8 ms). G1 own-median stalls 15 against 0. Status: open until the Phase B paired runs show the `active` column falling and the stalls fall with it.
3. Phase 5 frame-time p99 against spoint. Open, not folded: it needs spoint's own page run in the browser, which is not this probe. It shares no probe with the stall pass, so it is not measured here.
4. `ENGINE_THREADS`. Open and recorded. It becomes the next lever only if the wake fix leaves the physics step above its budget.
5. `USE_WEBGPU` migration to emdawnwebgpu. Recorded, not unblocked by this pass.
6. Launcher-level null adapter after a browser restart. Recorded, not unblocked.
7. CI for pushed commits. Recorded; it runs on GitHub after the push.

### Gravity wake, round 2 pass: Phase A changes

Order note. These source changes were written and built before this entry. That breaks the Phase A rule (changes before any build, run or witness). The witnesses below are the ones observed for each change in this pass. Phase B re-runs every one of them on the final build.

Cause, extended. Two defects sit under the wake. The first is that `applyRadialGravity` added velocity to inactive bodies, and Jolt activates a body when its velocity changes (`BodyInterface.cpp:634-635`). The second is that a body that did sleep at planet altitude fell asleep in mid-air, because the planet's float32 positions move in 0.5 m steps at radius 6.37e6 m, so the sleep test saw no motion. The first fix alone therefore created that regression. Jolt's `Body::SetAllowSleeping(true)` also calls `ResetSleepTimer()` (`Body.cpp:74-79`), so setting it every tick kept the timer at zero and nothing ever slept.

Changes:

1. `engine/src/world.cpp`, `applyRadialGravity`. Inactive bodies are skipped. An active body may sleep only while its speed after the pull is under 0.5 m/s, and the flag is written only when its value changes. Witnesses: `check:engine-sleep` gates 1 to 3 PASS on the final timed 64 build. Probe `probe-air`: a body released 2 m above the surface stays awake and lands at radius + 0.5 m. Probe `probe-flat`: the no-planet control sleeps at tick 80.
2. `engine/src/world.cpp`, `configurePlanet`. Every live body is activated after the planet body is replaced. Witness: `check:engine-sleep` gate 4 (64 active after a reconfigure).
3. `engine/src/world.cpp`, `configurePlanet`. The planet scene sets `mPointVelocitySleepThreshold` to 2.0 m/s, which gives a 1 m sleep tolerance over 0.5 s. Not separately measured: whether the threshold is needed on top of changes 1 and 2. Phase B measures it and removes the line if the sleep holds without it.
4. `engine/src/world.h` and `engine/src/world.cpp`. `applyRadialGravity` takes a `JPH::PhysicsSystem&`, and `Body.h` is included. Witness: the timed 64 build compiles and the gates above pass.
5. `scripts/check-engine-sleep.mjs`, rewritten. The scene matches the render page: a 2048-capacity world at 60 ticks a second, 64 bodies on a 2 m grid released above the planet's surface, and the planet at radius 6371 km. Four gates: falling bodies stay awake for 60 ticks and then rest and sleep within 1200 ticks at radius + 0.5 m; a sleeping body does not move or wake over 120 ticks; a moved body wakes and settles again; a planet reconfigure wakes all 64 bodies. The glue is `engine-core-64mib-timed.mjs`, because the other glue does not export `engine_sim_active_bodies`. Witness: `check:engine-sleep`, RESULT PASS (4 gates). The first run used the non-timed glue, which failed on that missing export, and the glue was corrected before the PASS.
6. `scripts/browser/engine-render-browser.js`. The ground box is removed, because the planet centre is the origin and the box lay inside the planet. The planet is configured before the spawns, and bodies spawn at the surface using `engine_planet_height` and the tier's lift. The 1024 tier moves to a 1.2 m grid pitch, because the 0.6 m pitch overlapped the 0.5 m radius bodies. Measured on round 1 G0: the 0.6 m pitch gave a tick median of 147.3 ms and 0 active bodies at the end of the run; the 1.2 m pitch gave a tick median of 3 ms, 0 active bodies at the end of the run, and frame p99 22 ms. Witness: the round 1 G0 and G1 runs in `build/diag/paired-D`.

Measured in this pass, not yet a witness: round 1 G1 on the 1.2 m grid gave a frame median of 5.5 ms, a frame p99 of 60 ms, a frame max of 76.1 ms, and 0 active bodies at the end of the run. Round 2 has not run yet.

Ranked remaining work, at the start of Phase B:

1. Gravity wake at planet altitude. Source fixed (changes 1 to 6). Round 1 pair measured on the 1.2 m grid. Status: open until the round 2 pair and the final-build witnesses are in.
2. P2 stall verdict. Round 2 is not run in this pass. Status: open; the verdict is decided by the round 2 pair and the report.
3. Float32 precision at planet altitude. At radius 6.37e6 m the position step is 0.5 m, so a body released 2 m above the surface does not visibly move for about 100 ticks, and any contact motion below 0.5 m is invisible to the sleep test. Status: recorded as the cause. The fix is double-precision Jolt (`JPH_DOUBLE_PRECISION`) or a planet-local physics origin, which is a next-pass item.
4. Phase 5 frame-time p99 against spoint. Open, not folded: it needs spoint's page run, which is not this probe.
5. `ENGINE_THREADS`. Recorded. It is the next lever only if the physics step stays above budget after changes 1 to 6.
6. `USE_WEBGPU` migration to emdawnwebgpu. Recorded, not unblocked.
7. Launcher-level null adapter after a browser restart. Recorded, not unblocked.
8. CI for pushed commits. Recorded; it runs on GitHub after the push.

Witnesses in Phase B are appended below this line.

## Round 2 G1 stall classification (Phase A: code and docs, not built or run)

Scope. The 135 stalls on `r1-G1` and the 150 stalls on `r2-G1` in `build/diag/paired-E`, each read from its probe row (`scripts/browser/stall-probe.mjs`, before this change) and from its page row (the phase columns of the same frame). Each stall is a defect until its cause is recorded.

Before this change, by category and active-body count at the stall (the active count is the page's `active` column in the stall's frame):

| run | stalls | cpu-bound | starved | blocked | active 10240 | active 0 | active between 0 and 10240 |
|---|---|---|---|---|---|---|---|
| r1-G1 | 135 | 48 | 28 | 59 | 62 | 65 | 8 |
| r2-G1 | 150 | 0 | 31 | 119 | 62 | 80 | 8 |

By verdict and active count: r1-G1 cpu-bound 32 at 10240, 12 at 0, 4 between; starved 6 at 10240, 22 at 0; blocked 24 at 10240, 31 at 0, 4 between. r2-G1 blocked 54 at 10240, 58 at 0, 7 between; starved 8 at 10240, 22 at 0, 1 between. The cpu-bound column of r2-G1 is not a measurement: see defect 1.

Active count over the run. The count does not rise. It steps down from 10240 to 8192, 6144, 4096, 2048 and 0 at frames 122, 124, 126, 128 and 130, and stays at 0 after frame 130. So the run has no 0-to-10240 transition; the probe's `activeMin` 0 and `activeMax` 10240 are that one descent. Eleven stalls on each run fall within two frames of one of those five steps. Most stalls are not near a step: 53 on r1-G1 and 80 on r2-G1 are at active 0, after every body has slept.

Dominant phase, from the page row of each stall. r1-G1: physics leads 38 cpu-bound, 30 blocked and 14 starved stalls; readback leads 28 blocked, 10 cpu-bound and 10 starved; backend leads 4 starved and 1 blocked. r2-G1: physics leads 65 blocked and 17 starved; readback leads 54 blocked and 11 starved; backend leads 3 starved. The stall tick median is 21.9 ms on r1-G1 and 17.95 ms on r2-G1, against 4.4 ms and 4.2 ms for the frames that are not stalls. The normal physics phase median is 1.4 ms and the normal readback median is 2.6 ms (the `r2-G1` page's `phaseMedianMs`).

Defect 1: the renderer pick (`scripts/browser/stall-probe.mjs`, `rendererMainSeries`). It chose the renderer main thread with the most cumulative jiffies in the whole thread log. In `r2-G1.threads.txt`, pid 1252943 had 810 jiffies, flat during the window (it was the renderer of the first-attempt tab), and pid 1252941, the page under test, had 778 jiffies, 775 of them inside the window. The probe therefore read the wrong thread, and every `r2-G1` stall had `cpuMs` 0. `r1-G1` picked the right renderer (pid 1173751). Change: the renderer main thread with the largest gain of jiffies inside the frame window is chosen, and ties go to the larger total. Witness: `scripts/check-stall-probe.mjs`, "rendererMainSeries keeps the main thread that gained the most CPU inside the window". The new case has a renderer at 90 jiffies that is flat inside the window, and the gate expects the renderer that ran inside it.

Defect 2: the CPU share of a stall (`scripts/browser/stall-probe.mjs`, `cpuMsBetween`). It read the cumulative jiffies at the sample at or before each stall edge. The renderer main-thread rows are 11 ms apart in `r1-G1` and 282 ms apart in `r2-G1` (medians, see the Phase A section below), so a stall that crosses a row gap received the CPU of the whole gap. That is why the cpu-bound stalls of `r1-G1` show `cpuMs` of 10, 20, 30, 40 and 50 on stalls of comparable length, and why 48 of them were labelled cpu-bound. Change: jiffies are interpolated linearly between samples, and the last sample is held after the end of the log. Witness: `scripts/check-stall-probe.mjs`, "cpuMsBetween interpolates the main-thread time between records": 25 ms over 50 to 150 against records at 0 and 100, and 5 ms over 100 to 110 against records at 0 and 200.

Limits that stay open after these changes. CPU is read in jiffies of 10 ms, and the renderer main-thread rows are 11 ms apart in `r1-G1` but 282 ms apart in `r2-G1`, where the sampler got little CPU. The CPU share of a stall is therefore an interpolated estimate, and in `r2-G1` a stall shorter than a row gap is not resolved. The physics spikes on frames at active 0 (tick 7 to 30 ms with no body awake, against a normal physics median of 1.4 ms) have no code path located yet. The readback phase has no code in `scripts/browser/engine-render-browser.js` or `src/` beyond its phase name, so the readback stalls are recorded as measured and their code is not located.

Category and cause rules for Phase B, applied to each stall after the fix. Starved: cgroup some pressure is at least 50% of the stall, which is host CPU contention from the 12 burn workers and is not a code defect. Cpu-bound: the renderer main thread ran at least 80% of the stall, and the cause is the dominant phase. Blocked: neither threshold, and the cause is the dominant phase, with the remainder recorded as waiting or below the sample resolution. Phase B writes one row per stall to `docs/stall-causes/round2-G1-r1.tsv` and `docs/stall-causes/round2-G1-r2.tsv`, with the frame, active count, total, tick, physics, readback, backend, CPU, pressure, category and cause.

Witnesses in Phase B are appended below this line.

### Phase B: witnesses after the two probe fixes

Build and gates. `npm test` (its first step rebuilds the kernel) exited 0 with 4682 PASS and 0 FAIL; log `build/diag/phase-b-npm-test.log`. `check:stall-probe` is RESULT PASS with 6 gates, including the two new witnesses. `docs/play` did not change in this pass, so the site build was not rerun.

Paired report on `build/diag/paired-E`: verdict `supported`, `starvationRatio` 158.08. Unchanged by the probe fixes, because the report counts stalls through `attributeStalls`, not `probeStalls`. Pairs: round 1, G0 71 stalls and G1 338; round 2, G0 71 and G1 312.

Stall categories, before and after the two fixes, with the active count at each stall:

| run | category | before (total, at 10240, between, at 0) | after (total, at 10240, between, at 0) |
|---|---|---|---|
| r1-G1 | cpu-bound | 48, 32, 4, 12 | 39, 33, 5, 1 |
| r1-G1 | starved | 28, 6, 0, 22 | 28, 6, 0, 22 |
| r1-G1 | blocked | 59, 24, 4, 31 | 68, 23, 3, 42 |
| r2-G1 | cpu-bound | 0, 0, 0, 0 | 0, 0, 0, 0 |
| r2-G1 | starved | 31, 8, 1, 22 | 31, 8, 1, 22 |
| r2-G1 | blocked | 119, 54, 7, 58 | 119, 54, 7, 58 |

The r2-G1 cpu-bound count stays at 0 after the fix, and that is measured, not a defect: its stalls now carry 8 to 30 ms of renderer CPU each, which is 30 to 60% of a stall, below the 80% line. The renderer was not the busy thread for most of that run. The r2-G1 counts are identical before and after for starved and blocked because the probe's pressure term does not depend on the CPU fix, and the blocked stalls stay blocked because their CPU share stays below 80%. The r1-G1 changes come from the interpolation, which moves stalls shorter than a sample interval out of cpu-bound.

Per-stall rows: `docs/stall-causes/round2-r1-G1.tsv` (135 rows) and `docs/stall-causes/round2-r2-G1.tsv` (150 rows). Columns: frame, active count, total, tick, physics, readback, backend, CPU, pressure, category, dominant phase and its time, and the cause text. The category rule is the one written above, and a stall within two frames of an active step carries that note in its cause.

Causes by category, from the rows:

- starved: 28 on r1-G1 and 31 on r2-G1, with cgroup some pressure at least 50% of the stall. Host CPU contention from the 12 burn workers of the G1 condition. Not a code defect.
- cpu-bound: 39 on r1-G1, of which 38 have a dominant physics phase and 1 a dominant readback phase. 33 of them are at 10240 active bodies, so the renderer thread's time in the frame is the physics step. No code defect is found in this pass. Whether the physics step should cost this much at 10240 bodies is open; the stall rows record its time against the 1.4 ms normal physics median.
- blocked: 68 on r1-G1 and 119 on r2-G1. The renderer CPU share is below 80% and the pressure share below 50%, so the thread was not busy for most of these stalls. Dominant phases: physics 30 and readback 37 on r1-G1, physics 65 and readback 54 on r2-G1, backend 1 on r1-G1. The stall tick median is 21.9 ms on r1-G1 and 17.95 ms on r2-G1, against 4.4 ms and 4.2 ms for frames without a stall. These stalls are waits inside the frame, not CPU on the renderer thread. Their wait is not located to a code path here, so they stay open.
- Active count and transitions. The run has no 0-to-10240 transition. The active count steps down 10240, 8192, 6144, 4096, 2048, 0 at frames 122, 124, 126, 128 and 130, and stays at 0. Eleven stalls on each run are within two frames of one of those steps. Most stalls are not near a step: 65 on r1-G1 and 80 on r2-G1 are at active 0, after every body has slept, and their physics and readback phases are the cause recorded above.

Code defects, fixed in the Phase A commit `858d271` and witnessed in Phase B: the renderer pick in `rendererMainSeries` (defect 1) and the CPU share in `cpuMsBetween` (defect 2). Both are probe defects, not engine defects. No engine change was made in this pass.

Open after this pass. The blocked stalls with dominant physics or readback phases (186 on the two runs: 67 on r1-G1 and 119 on r2-G1) are measured as waits, and the code that waits is not located. The physics spikes at active 0 have no code path located yet. Neither is recorded as a fix. The uncommitted `engine/src/world.cpp` and `engine/artifacts.json` changes (the planet sleep-threshold removal and the re-pin) were not committed in this pass, because this pass did not rebuild the engine and so did not verify those pins against a source-to-binary build. They stay out of the push. Superseded in the next pass: the engine was rebuilt from the working tree, the three pins matched, and both files were committed.

## Blocked stalls, the physics cost and the thread sampler (Phase A: code and docs, not built or run)

Correction to the Phase B text above. It says the blocked stalls "are waits inside the frame, not CPU on the renderer thread". That is withdrawn. The blocked class is what the probe reports when the renderer's CPU share is below 80% and the pressure share below 50%, and the CPU share came from a thread sampler whose renderer rows were 11 ms apart in `r1-G1` and 282 ms apart in `r2-G1`. A blocked stall therefore means the probe could not resolve it, not that it waited on a call.

Wait sites. There is no wait site in the physics or readback phases of this build. The engine is single-threaded (no `ENGINE_THREADS` in `engine/CMakeLists.txt`, `engine/build.sh` or `engine/src`), so Jolt's job barrier is `JobSystemSingleThreaded`, which runs each job inline and has an empty `WaitForJobs`. The readback phase is a host loop (`engine/src/world.cpp:431-437`, `sync` at `:474-496`) with no GPU fence. The per-site list, with file and line, measured durations and reason, is in `docs/stall-causes/wait-sites.md`. Inherent or defect: neither, because there is no wait to remove. The cause of the blocked time needs a new G1 run with the fixed sampler to settle.

Physics cost at 10240 awake bodies, from the page rows of `r1-G1` and `r2-G1` (median, ms):

| frames | tick | physics | readback | backend | upload | submit |
|---|---|---|---|---|---|---|
| active 0, 470 per run | 4.4 to 4.6 | 1.4 | 2.8 | 0.3 | 0 | 0.1 |
| active 10240, 62 per run | 39.0 to 39.3 | 36.1 to 36.4 | 2.0 to 2.1 | 0.3 | 0 to 0.1 | 0.1 |

The physics phase is the step that dominates an awake frame: 36 ms of a 39 ms tick. Its 35 ms above the sleeping case is about 3.4 µs per awake body per step (about 10240 bodies). What the engine code shows inside `Update`: the radial gravity listener (`engine/src/world.cpp:99` and `:403-423`), which takes about five body locks per awake body per step; and the planet contact (`engine/src/planet_shape.cpp:14-27`), which calls `heightAt` (`engine/src/planet_frame.cpp:193`), a page-table lookup and a bilinear blend rather than a noise evaluation. The split of the 36 ms between Jolt's broadphase, narrowphase, solver and the two engine parts is not measured.

Decision on the physics cost: not a defect. Nothing in the code is a wait or a repeated expensive step large enough to be called a defect, and the cost is Jolt's per-body work at this body count on one thread. The budget overrun of 62 frames at 10240 awake is recorded under `ENGINE_THREADS` in the ranked list, which is where the lever is. The lock count in the gravity listener and the readback loop is an optimisation candidate, recorded as open and not changed here, because it changes the sleep path.

Sampler change withdrawn. The Phase A commit `f913ac3` changed `scripts/browser/thread-cpu-sampler.mjs` on the premise that each tick took 250 to 330 ms because it read every Chromium thread. That premise is wrong: one full pass over the 200 threads of the profile takes about 3 ms (measured in Phase B). The 250 to 330 ms figure was the spacing of distinct timestamps in the thread log, and that log has a row only when a thread's jiffies change, so the spacing is not a tick period. The file is restored to its content before `f913ac3`. Measured row spacing, which is what the probe reads. The renderer main thread (the one the probe uses) in `r1-G1` (pid 1173751) has 729 rows with a median gap of 12 ms, a p90 of 47 ms and a longest gap of 1.1 s. In `r2-G1` (pid 1252941) it has 70 rows, a median gap of 282 ms and a longest gap of 133 s. In `r2-G0` (pid 1178784) it has 518 rows with a median gap of 11 ms. Over all thread types, `r1-G1` has 1109 distinct timestamps with a median gap of 11 ms and 50 gaps longer than 2 s, and `r2-G1` has 300 with a median of 567 ms and 16 gaps longer than 2 s. The cgroup sampler's log for `r2-G1` is dense (83082 rows). The thread sampler is a Node process, and the most likely cause of the sparse `r2-G1` log is that it got little CPU while the 12 burn workers ran. That is not measured directly. So the `r2-G1` CPU share per stall is sampler-limited, and its category counts cannot be read as CPU evidence. A reliable `r2` category needs a rerun in which the sampler keeps up, for example one pinned to a core the burn workers do not use. That rerun was not made in this pass.

Engine change for the waits: none.

### Phase B: engine pins, sampler measurement, npm test and the paired report

Engine rebuild from the working tree (`engine/build.sh`, job `phase-b-engine`, exit 0): fixed 64 MiB, fixed 128 MiB and leak 64 MiB. The sha256 of each built file matches its pin in `engine/artifacts.json`:

- `engine-core-64mib`: built `2e5ca6f21b57df5c694b8ab4ef0319b34ae7598ef7ea99fbc83d169d8e039fdd`, pinned the same. MATCH.
- `engine-core-128mib`: built `63d96697c6bde5922d9774fb871e114fb112e2fdb0e5ebed8ff531ab1cf107e5`, pinned the same. MATCH.
- `engine-core-64mib-leak`: built `4fe2b9693df5d3b8d9b9b40f6623315060c6ab9fb318217ffd490a9b2e7039ea`, pinned the same. MATCH.

Both files are committed in `dbc869b`, with the threshold removal in `engine/src/world.cpp`.

Sampler measurement that withdrew the change in `f913ac3`. One full pass over the 200 threads of the project browser profile (`readdirSync` of the task directories and `readFileSync` of each `stat`) takes about 0.4 ms of readdir and 2.8 to 3.2 ms of stat reads, about 14 to 16 µs per thread, with load 2.6 to 4.7. The sampler change is reverted in `378c109`.

`npm test`: EXIT 0, 4682 PASS and 0 FAIL, log `build/diag/phase-b2-npm-test.log`. The engine-artifacts gate is in the chain.

Paired report on `build/diag/paired-E`: verdict `supported`, starvationRatio 158.08, unchanged.

Stall probes, the same as the previous pass: `r1-G1` starved 28, cpu-bound 39, blocked 68 (135 stalls). `r2-G1` starved 31, cpu-bound 0, blocked 119 (150 stalls). The `r2-G1` cpu-bound count is sampler-limited as recorded above, so it is not a measured zero.

The wait sites and their durations are in `docs/stall-causes/wait-sites.md`. The physics breakdown and its decision are in the Phase A section above.
