# Engine core: C++ with Jolt in one preallocated wasm

This is the implementation contract for jayzee's engine core. Every change to the core is checked against it. Where this file and older docs disagree, this file wins.

## The invariant

A game allocates, at start, every resource the device will make available over the game's lifetime. After warm-up it never allocates again. It reuses what it already holds: memory, bodies, shapes, buffers, textures, lights, instance slots, content entries and network buffers. Streaming more content in is a write into slots the engine already owns, never a creation.

The device decides the budget. Content fits the budget. Content never grows the budget.

Consequences that follow from it:
- Adding a light, a texture, a trimesh, a prop or a terrain page costs a slot write, never an allocation, shader compile or acceleration-structure rebuild.
- Moving across the planet streams data into fixed pages. It must not create or destroy a physics body, and it must not grow wasm memory or the JS heap.
- When content exceeds the budget, the engine degrades by policy (lower LOD, fewer active slots, coarser pages). It never allocates more.

## Decisions

| Question | Decision | Why |
|---|---|---|
| Core language | C++20 | Jolt is C++. Calling it directly needs no binding layer, so Jolt's internals (custom shapes, collision dispatch, broadphase layers, allocator hooks, job system) are usable without a shim to maintain. One language for physics, terrain, codecs and the tick is the least maintenance. Zig would need an `extern "C"` wrapper around every Jolt type it uses. |
| Toolchain | Emscripten, pinned, built in GitHub Actions with pinned action SHAs and a checked output hash | Mature wasm pthreads, SIMD, fixed-memory linking and worker support. Local builds are for iteration only. |
| Physics | Jolt compiled from source into the same module | Battle-tested, and inside the module there is no boundary between physics, terrain and codecs. |
| Determinism | Jolt `CROSS_PLATFORM_DETERMINISTIC=ON`, `-ffp-contract=off`, no fast-math, fixed timestep | Client prediction and server authority must produce identical hashes. |
| The jz kernel | Superseded | It stays only as the reference until the C++ core passes the same behavioural witnesses, then it is removed. |
| Threads | Two builds with one API: multithreaded (pthreads and the Jolt job system) and single-threaded | Threads need `crossOriginIsolated`. GitHub Pages cannot set COOP and COEP headers, so the site needs a service-worker isolation shim or falls back to the single-threaded build. |

## Memory

- One `WebAssembly.Memory` sized at start from the device budget. Link with `ALLOW_MEMORY_GROWTH=0` and `INITIAL_MEMORY` equal to the budget. Because memory never grows, JS typed-array views over it never detach, so they are created once and kept.
- The budget comes from `navigator.deviceMemory`, `navigator.hardwareConcurrency`, the GPU adapter limits and a per-platform table, all read once at boot. On the server it comes from configuration.
- Inside the memory, everything is carved into fixed regions at boot:
  - **Jolt arenas.** Jolt's allocator hooks (`JPH::Allocate`, `Free`, `AlignedAllocate`, `AlignedFree`) are pointed at engine pools before `RegisterTypes`. `TempAllocatorImpl` gets a fixed size. `PhysicsSystem::Init` gets fixed maxima for bodies, body pairs and contact constraints from the budget.
  - **Body pools.** Bodies for each prop class are created at boot with their shapes. Spawning takes a parked body from the pool and adds it with `BodyInterface::AddBodiesPrepare` and `AddBodiesFinalize` in one batch per tick. Despawning removes it in a batch and returns it to the pool. Pool ids carry a generation, so stale handles are rejected.
  - **Shape library.** Every collision shape is cooked ahead of time and stored in Jolt's binary form. Loading restores into preallocated storage. No mesh is cooked at runtime.
  - **Terrain page cache.** Fixed pages of height and material samples (see Terrain).
  - **Vegetation field.** A fixed table of instances per cell (see Vegetation).
  - **Rings.** Input ring, outbound snapshot ring, render transform buffer, event ring. All fixed capacity, double-buffered or epoch-stamped.
- The engine exports allocation counters. After warm-up `allocations_since_warmup()` must stay 0, and `memory.buffer.byteLength` must not change. These are witnessed, not assumed.

## The bridge

The wasm boundary is the bottleneck, so it is crossed as rarely as possible and never per object.

1. **Boot.** JS calls `engine_init(budget)` once and receives the byte offsets of every region. It builds its typed-array views once.
2. **Per tick.** JS writes the tick's inputs into the input ring, then makes one call, `engine_tick(steps)`. Physics, terrain streaming commits, game rules, snapshot encoding and the state hash all run inside that call.
3. **Outputs.** JS reads region headers to find how many bytes or instances were written: the outbound snapshot bytes, the transform buffer and the event ring. The transport sends a `subarray` of the snapshot region. The renderer uploads from the transform region with `queue.writeBuffer`, which is the only copy and it goes to the GPU.
4. **Threads.** Workers share the same memory. A region is published by bumping one epoch counter per tick, not by stamping each slot. Readers take a whole buffer for an epoch or skip it.
5. **Never** call per body, return arrays, use `Array.from`, or build objects for each entity on the JS side in the hot path.

The server, the client's prediction copy, single-player and listen servers all run this same module and the same tick. Only the transport and the renderer differ.

## Terrain on the planet

Spoint streams terrain by creating a Jolt heightfield body per field and removing old ones (`src/terrain/HeightfieldStreamer.js` lines 266, 288 and 300). Each creation allocates, copies samples into the Jolt heap and inserts into the broadphase while the player moves. That is the hitch. The core replaces it.

- **One planet body.** The planet is one static body whose shape is a custom Jolt shape, `PlanetShape` (a user shape subtype). Collision against it is registered with `CollisionDispatch::sRegisterCollideShape` and `sRegisterCastShape` for the shape pairs the game uses (sphere, capsule, box, convex hull, and the `CharacterVirtual` queries).
- **Analytic geometry first.** The planet surface is defined everywhere by the cube-sphere frame (`planetFrame` and `cubeSphereCells`, ported to C++) plus a height function. A query anywhere on the planet has an answer, even where no page is resident. That makes planet-wide collision possible: the far field answers from the coarse procedural height, and the near field answers from resident pages.
- **Paged height cache.** Near-field detail lives in a fixed number of pages keyed by cube-sphere cell. Streaming decodes a page on a worker thread directly into a free page slot, then commits it by flipping the page table entry at the next tick boundary. No body is created, no broadphase node changes, no allocation happens.
- **Queries work in the planet's own space.** A narrow-phase query converts the other shape's support points into cell coordinates and samples height there, instead of building triangles. Triangles are produced only for the small patch under a contact, from a fixed scratch buffer.
- **Gravity** is radial. The world gravity is zero, and a `PhysicsStepListener` applies the planet's gravity to active bodies inside the step.
- **Caves and carved terrain.** The cave SDF and stamps are evaluated in the same query path, with a fixed patch budget.

## Vegetation and scattered rocks

Vegetation must not be one Jolt body per tree.

- Instances live in a fixed table per cube-sphere cell: position, rotation, scale and a collision class (trunk capsule, rock hull or pass-through).
- One static body carries a custom `VegetationShape`. Its query finds the cells overlapped by the other shape's bounds, walks only those cells' instances, and tests against the class's prebuilt shape transformed in place.
- Placement streams into cell slots the same way terrain pages do, so moving costs a slot write.
- Destructible or interactive instances are promoted to a pooled dynamic body only when touched, and returned to the field when they settle.

## Client resources

The same invariant applies to rendering:
- One large vertex buffer and one large index buffer, sub-allocated from fixed ranges per mesh class.
- Texture arrays and atlases allocated at boot. Loading a texture writes into a free layer.
- A fixed-size clustered light buffer. Adding a light writes a slot. The shader never changes when lights are added.
- Instance buffers at maximum capacity per class, filled from the transform region.
- Every pipeline and shader variant compiled and warmed during the loading screen.
- Materials are slots in a material table, not new objects.

## Streaming and async

- Asset and page decoding runs on worker threads inside the module and writes into free slots. The main thread never waits on it.
- Each stream has a fixed queue of requests. When the queue is full, low-priority requests are dropped by policy, not queued without limit.
- Commits happen at tick boundaries by epoch flip, so a frame never sees a half-written slot.

## Phases and witnesses

Each phase ends with a red witness on the old code and a green witness on the new code, and a pushed commit.

1. **Toolchain.** Pinned Emscripten in GitHub Actions builds an empty module with fixed memory. Witness: the artifact hash, and `memory.buffer.byteLength` unchanged after 10 000 ticks.
2. **Jolt in the module.** `World` parity with the current API: spawn, step, hash, state import and export. Witness: the existing world, netcode and determinism suites pass against the C++ core, and two runs give identical hashes.
3. **Bridge.** Input ring, single tick call, snapshot and transform regions. Witness: JS-to-wasm calls per tick equal 1, and no JS allocation per tick under a heap-snapshot diff.
4. **Pools and removal.** Body pools with generation ids. Witness: spawning and despawning 10 000 bodies after warm-up gives `allocations_since_warmup() == 0`.
5. **PlanetShape and the page cache.** Witness: a scripted flight around the planet with zero allocations, zero body creations and no change in broadphase body count. Frame-time p99 is recorded against spoint's streamer on the same path.
6. **Vegetation field.** Witness: collisions against trees in a dense forest with one vegetation body, and a cost measurement against one body per tree.
7. **Netcode codecs in C++.** Witness: the existing wire formats are bit-for-bit compatible.
8. **Client resource pools.** Witness: adding lights, textures and meshes during play leaves frame-time p99 unchanged and compiles no pipeline after loading.
9. **Retire the jz kernel** once phases 2 to 7 are green.

## Open items to verify

- Whether Jolt's job system stays deterministic across thread counts in the multithreaded wasm build. A cross-machine hash witness settles it.
- The exact Jolt collision-dispatch entries needed for `CharacterVirtual` against the custom planet shape.
- The isolation shim for GitHub Pages, or confirmation that the single-threaded build is the Pages default.
