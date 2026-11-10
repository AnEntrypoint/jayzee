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
| Threads | Two builds with one API: multithreaded (pthreads and the Jolt job system) and single-threaded | Threads need `crossOriginIsolated`. GitHub Pages cannot set COOP and COEP headers, so Pages serves a service-worker isolation shim that sets them on the page's own responses (owner decision, 2026-11-08). Where the shim cannot take hold, the same game runs the single-threaded build behind the same API. |
| Rendering | Renderer in the same wasm module, C++ calling WebGPU through Dawn's `emdawnwebgpu` port (`webgpu_cpp.h`), with a WebGL2 path in the same module for browsers without WebGPU. three.js is retired once parity is witnessed. Owner confirmed 2026-11-08. | Removes the JS scene graph and the per-object crossings. The research found no maintained option that targets Emscripten besides emdawnwebgpu. WebGPU is absent on many Linux and older-hardware browsers, so WebGL2 is required, not optional. |
| Rendering library | Own thin renderer over `webgpu_cpp.h` and WebGL2, not a third-party engine | bgfx, Diligent and sokol_gfx all build both backends from Emscripten. sokol_gfx has no indirect draw and Diligent needs heavier isolation. bgfx and Diligent add indirection and per-frame state tracking that the crosstalk budget removes. Revisit if the own renderer's WebGPU path proves too costly to maintain (see Open items). |
| Shared terrain data | One terrain page cache, written by the core, read by physics and by the renderer through `writeTexture` from the same slot | The same planet height is never computed twice. Physics and rendering read one fixed source, so there is no second terrain pass. |
| GPU float use | GPU compute never feeds collision, prediction or the state hash | WGSL float results are not guaranteed bit-identical across vendors, so GPU results can differ. The GPU may compute display-only effects. |

## Accepted deviations

Owner decision (2026-11-08): a deviation from this contract is accepted and worked around when it follows from C++'s own limits, rather than copying the JS design. Jayzee lists each deviation under "Deviations for the dispatcher" in `docs/PENDING_VALIDATION.md`, with the row it changes. The dispatcher records each one here once reviewed.

## Memory

- One `WebAssembly.Memory` sized at start from the device budget. Link with `ALLOW_MEMORY_GROWTH=0` and `INITIAL_MEMORY` equal to the budget. Because memory never grows, JS typed-array views over it never detach, so they are created once and kept.
- The budget comes from `navigator.deviceMemory`, `navigator.hardwareConcurrency`, the GPU adapter limits and a per-platform table, all read once at boot. On the server it comes from configuration.
- Player capacity tiers (owner decision, 2026-11-08): the default tier is 64 players and the top tier is 1024. `engine_init` takes the tier, and every region is sized from that tier's capacity table. A device that cannot hold the requested tier runs the highest tier its budget allows, reports the tier it runs, and never allocates above the budget.
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

## Client resources and rendering

The same invariant applies to rendering. The renderer lives in the same wasm module as the core.

- **Device and thread.** The WebGPU device is created once at boot. Rendering runs on one pthread that owns a canvas transferred with `OFFSCREENCANVAS_SUPPORT`. The device is not shared across threads, because no browser ships shared devices (UNVERIFIED). WebGL2 uses the same thread model through `OFFSCREENCANVASES_TO_PTHREAD`.
- **Uploads.** Buffer and texture writes use `wgpuQueueWriteBuffer` and `wgpuQueueWriteTexture` from views over wasm memory, with no JS copy in the glue. Mapped ranges (`wgpuBufferGetMappedRange`) are not used for uploads, because they copy through a shadow block.
- **One buffer for indirect args.** All indirect draw arguments live in one buffer, so the per-frame validation cost does not scale with the number of buffers (UNVERIFIED: measure in phase 10). The arguments are written from the CPU with `wgpuQueueWriteBuffer`, the same as the other per-frame data.
- **CPU culling on both backends.** `planFrame` culls each body against the frustum on the CPU and keeps the visible records per class. Both backends upload only those records and draw them with the count from the same pass. WebGPU does not cull on the GPU: a GPU cull re-read every body record each frame and repeated the CPU cull. The WebGL2 path draws the same records with `glBufferSubData` and instancing.
- **Presentation.** Present from `requestAnimationFrame`. Surface presentation in the Emscripten port is UNVERIFIED and is witnessed in phase 10.
- **Blocking waits.** `WaitAny` with a timeout needs JSPI or Asyncify. Otherwise use callbacks. JSPI support per browser is UNVERIFIED for Safari and must be checked in phase 10.
- **Fallback.** Chrome, Edge, Firefox and Safari run WebGPU on the paths that MDN lists. Everything else runs the WebGL2 renderer. Both paths read the same slots.

The slot rules still apply:
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
10. **Renderer in the module (WebGPU).** The renderer runs on the render pthread and draws the terrain pages and props from the slots. Witness: the scene renders on a WebGPU device in a self-launched Chromium, with `allocations_since_warmup() == 0` during play and a per-frame API call count recorded, and a control run that shows the same scene from the current three.js renderer.
11. **Renderer fallback (WebGL2).** The same slots render on WebGL2. Witness: the same scene renders with the WebGL2 path in a browser with WebGPU disabled.
12. **Retire three.js** once phases 10 and 11 match the three.js reference images within an agreed tolerance.

## Open items to verify

- Whether Jolt's job system stays deterministic across thread counts in the multithreaded wasm build. A cross-machine hash witness settles it.
- The exact Jolt collision-dispatch entries needed for `CharacterVirtual` against the custom planet shape.
- The service-worker isolation shim on GitHub Pages is decided (see the Threads row). Phase B witnesses it on the public site.
- Whether the own renderer's WebGPU path is too costly to maintain. If it is, reconsider bgfx, which has a maintained WebGPU backend and a WebGL backend.
- Measured cost of the wasm-to-JS glue per WebGPU call. The research found no published number, so benchmark 10 000 `wgpuRenderPassEncoderDraw` calls against the same loop in JavaScript.
- Whether the emdawnwebgpu port in use presents correctly from a pthread with an OffscreenCanvas.
- Whether Safari has JSPI.

## Web bottlenecks and the decisions taken (2026-11-10)

Phase A wrote this design and its code. Nothing here has been built or run. Phase B measures it, and the numbers go in docs/PENDING_VALIDATION.md.

| Area | Decision | Reason |
|---|---|---|
| Sizing | `engine::device::plan` runs once at startup from the adapter limits (`maxTextureDimension2D`, `maxTextureArrayLayers`, `maxBufferSize`), the texel size, and `deviceMemoryBytes / 4` when the host reports it. It picks the highest tier that fits. Nothing grows after that. | A growth step after load is a hitch, and it moves RAM and VRAM past the ceiling the device was sized for. |
| Texture slots | One fixed texture array per tier (side and layer count from the tier). Content takes a slot through the existing generation table (`handles::Table`). | A fixed layer index means no reallocation and no bind-group rebuild when content changes. |
| Model geometry | One vertex pool and one index pool. `models::acquire` takes a slot sized `verticesPerModel` and `indicesPerModel`. `models::upload` copies into that slot and nothing else. | New content reuses a pool that already exists. Nothing is created on arrival. |
| Vertex format | 32-byte vertex stride and 4-byte indices for every model. | One layout is what lets every model share one shader setup. |
| Art pipeline | Textures must be KTX2 (Basis). Geometry must be GLB with meshopt-encoded bufferViews. `tools/asset-pipeline/validate.mjs` refuses everything else. | Basis transcodes to the device's compressed format, and meshopt decodes without a per-model layout. |
| Pipelines | Every pipeline and bind layout is built in `buildPipelines()` at init, before `engine_render_seal`. `engine_render_creates_after_seal` must stay 0. | Nothing compiles when a model first appears. |
| Threads | Decode (KTX2 transcode, meshopt decode) belongs on a worker. The render thread only copies into slots that already exist. | Decode cost stays out of frame time. Status: not yet implemented, see the status note. |
| GC pressure | No allocation per frame in JS. Slot handles are plain doubles. In C++, slots are carved from the arena at bind. | A GC pause is a hitch, and the arena is the only allocation path. |
| Upload budget | Each tier has a byte budget per frame (table below). An upload that does not fit waits for the next frame. | A large model is spread over frames instead of landing in one. |
| Context loss | Not implemented in Phase A. The design keeps the CPU copies in the arena, so a device-lost event rebuilds the pipelines and re-uploads the slots from those copies. | Recovery needs no content reload from the network. |
| VRAM | WebGPU and WebGL2 do not report VRAM. The measured quantity is the accounted pool size from `device::vramBytesOf`. | Accounted bytes are the only figure that can be checked against the budget. |

### Tiers

From `engine/src/device_tier.cpp`. The VRAM columns are for the texel size noted. They are computed by hand from the formula below, and Phase B confirms them against the planner's output.

| Tier | Texture side | Layers | Model slots | Vertices per model | Indices per model | Upload per frame | VRAM budget | Accounted, 1 byte per texel | Accounted, 4 bytes per texel |
|---|---|---|---|---|---|---|---|---|---|
| 0 | 512 | 64 | 128 | 4096 | 12288 | 512 KiB | 256 MiB | 43.3 MiB | 107.3 MiB |
| 1 | 1024 | 128 | 256 | 16384 | 49152 | 1 MiB | 512 MiB | 346.7 MiB | over budget |
| 2 | 2048 | 96 | 256 | 32768 | 98304 | 2 MiB | 1024 MiB | 864.0 MiB | over budget |

With 4 bytes per texel (the RGBA8 fallback for a device with no compressed format), only tier 0 fits. Tier 2 has fewer layers than tier 1. At 128 layers, the texture pool alone with the vertex and index pools would pass the 1024 MiB budget.

### Pool accounting

`vramBytes = textureBytes + vertexBytes + indexBytes`, where:

- `textureBytes = base + floor(base / 3)`, `base = layers × side² × texelBytes` (the one-third is the mip chain).
- `vertexBytes = slots × verticesPerModel × 32`.
- `indexBytes = slots × indicesPerModel × 4`.

The plan fits a tier when every item below holds, and it picks the highest tier that fits:

- `side ≤ maxTextureDimension2D`, `layers ≤ maxTextureArrayLayers`.
- The vertex pool and the index pool are each `≤ maxBufferSize`.
- `vramBytes ≤ vramBudgetBytes`, where the budget is the tier budget, or `min(tier budget, deviceMemoryBytes / 4)` when the host reports device memory.

The texel size must be 1 (a block-compressed format) or 4 (RGBA8). Any other value is refused.

### Asset rules

Enforced by `tools/asset-pipeline/validate.mjs`, which exits 1 on any REJECT.

- A texture is a KTX2 file. The identifier and the 80-byte header are checked.
- A model is a GLB file. Its JSON chunk and BIN chunk are parsed, and its length fields must match the file size.
- Every bufferView a mesh accessor uses carries `EXT_meshopt_compression`, with a buffer index in range, a positive `byteLength`, `byteStride` and `count`, and a mode of ATTRIBUTES, TRIANGLES or INDICES. `extensionsUsed` lists the extension.
- No buffer and no image may use an external `uri`.
- Every image is a KTX2 bufferView in the BIN chunk, with `mimeType` `image/ktx2`.
- A file whose name ends `.ktx2` must hold KTX2 bytes, and a file whose name ends `.glb` must hold GLB bytes.
- JSON glTF, PNG, JPEG, and any geometry without meshopt (including Draco) are refused.

### Measurements for Phase B

- **(a) RAM flat.** Across N load and unload cycles of models, after warm-up: the wasm `memory.buffer.byteLength` is the same at the end as at the start, `allocations_since_warmup()` stays 0, and `models::liveCount()` returns to 0 after the last release. The JS heap is sampled at the same points. Report the start, end and peak values.
- **(b) No first-appearance hitch.** Time the first frame after the first `acquire` and `upload` of a new drawn item, and compare it with the median steady frame time from the same run. The pass is an `engine_render_creates_after_seal` delta of 0 across that first frame. Report both times and the ratio.
- **(c) VRAM within budget.** `vramBytesOf` of the chosen plan is at most `vramBudgetBytes`. Report it for the tier the browser device selects, and the planner's result for each texel size.

### Decisions for ranks 3 to 6

Taken in the Phase A pass that followed the measurements. They supersede the Sizing, Threads and Context loss rows of the table above. Each number is a byte count from the layout in `engine/src/device_tier.cpp` and `engine/src/model_pool.cpp`, or from the build in `engine/CMakeLists.txt`.

**Arena size and pool sizing (rank 3).** The wasm memory cannot grow (`ALLOW_MEMORY_GROWTH=0`), so the arena is fixed at build. It is sized from the largest tier pool plus the engine budget, then the planned tier's pool is carved at startup.

| quantity | bytes | MiB |
|---|---|---|
| tier 0 pool: 128 slots × (4096 × 32 + 12288 × 4) | 23,068,672 | 22 |
| tier 1 pool: 256 slots × (16384 × 32 + 49152 × 4) | 184,549,376 | 176 |
| tier 2 pool: 256 slots × (32768 × 32 + 98304 × 4) | 369,098,752 | 352 |
| engine budget (`budgetBytes`, the most the non-model arena may use) | 67,108,864 | 64 |
| 512 MiB build arena: 512 MiB − 4 MiB | 532,676,608 | 508 |
| tier 2 pool + engine budget | 436,207,616 | 416 |
| headroom in the 512 MiB build for tier 2 | 96,468,992 | 92 |

The 64 MiB build's arena is 60 MiB, which holds the tier 0 pool and the budget together, as it did when the pool was carved inside `engine_init`. A 128 MiB build would not hold tier 2, so it is not used for the device path.

- `engine_init` no longer carves the model pool. `engine_models_bind_plan(maxDim, maxLayers, maxBuffer, texel, deviceMemory)` runs `device::plan` on the adapter's limits, then carves `bytesFor` of the planned tier's layout. When the arena cannot hold that pool, it steps down to the next smaller tier and carves again, so the bound tier is the highest one that both the device and the arena hold. It returns the bound tier (0 to 2), or −1 when no tier fits the limits, −2 when no tier's pool fits the arena, −3 when the pool refuses its layout, or −4 when the pool is already bound. On the 64 MiB build, a device that plans tier 2 binds tier 0 (23,071,104 B, measured before the cluster table; 23,169,408 B after it, see the Nanite section).
- Slots are fixed at bind. Nothing grows: a slot count, a vertex count and an index count are set once, and the render path only reads them.
- The upload budget per frame comes from the planned tier (`uploadBytesPerFrame`: 512 KiB, 1 MiB, 2 MiB), not from a constant. Each tier's budget is unchanged.
- The browser default glue is the 512 MiB build (`engine-core-512mib.mjs`). The device tier is chosen by the planner after the module exists, so the glue cannot depend on the tier. The 64 MiB build remains for the gates and the tier 0 measurements.
- The device limits come from the WebGPU device the loader requests: `maxTextureDimension2D`, `maxTextureArrayLayers`, `maxBufferSize`, texel 1 when `texture-compression-bc` is present and 4 otherwise, and `navigator.deviceMemory` in bytes when reported. The loader requests `texture-compression-bc` when the adapter has it. Before this request, the measured device reported `textureCompressionBc: false`, so the planner used texel 4 and picked tier 0. The loader also requests the adapter's `maxBufferSize`, because the default 256 MiB limit equals tier 2's 268,435,456 B vertex pool exactly, which leaves no margin. WebGL2 uses 2048, 256, 256 MiB, texel 4 and no device memory, which the planner maps to tier 0.

**Context loss (rank 4).** The design planned to rebuild from the arena copies. That is not done. The device reaches the module only through the factory options (`preinitializedWebGPUDevice`), and this build has no path that rebinds a new device on a live instance, so the arena copies cannot be reused on a new device without that path, which is not verified here.

- Decision: when `device.lost` fires, the loader's `deviceLost` promise resolves with `{ reason, message }`, and the caller re-runs `loadRenderer` to get a new module and device. The host re-stages its content. The arena copies do not survive.
- Cost: a second 512 MiB instance exists until the first is collected. `scripts/browser/device-loss-run.mjs` measures whether the reload succeeds while the first instance is still referenced.
- Witness: `device.destroy()` in the page resolves `deviceLost` with reason `destroyed`, the reloaded renderer draws with status 0, and `createsAfterSeal` stays 0.

**Decode (rank 5).** Decoding runs on a worker. The render thread copies into slots that already exist.

- meshopt: `meshoptimizer` 1.2.0 (pinned, MIT), its `./decoder` export, `MeshoptDecoder.decodeVertexBuffer` and `decodeIndexBuffer`, run in `src/engine/decodeWorker.js`. The same package's `./encoder` drives the round-trip witness.
- KTX2: the Basis Universal transcoder shipped in `three` 0.185.1 (pinned, MIT), `node_modules/three/examples/jsm/libs/basis/basis_transcoder.js` and `.wasm` (515 KiB). Its source is loaded as a function with `module` and `exports` as parameters, so the worker and Node run the same file without `importScripts`. The worker transcodes level 0 of layer 0 to RGBA32 (transcoder format 13), which is the RGBA8 albedo layer the renderer already takes. BC7 output (the tier texel 1 format) waits for the tiered texture array, which the renderer does not allocate yet.
- No KTX2 encoder is on the host (`toktx` and `basisu` are absent), so a real KTX2 transcode is not witnessed here. The witness checks the transcoder's initialisation and its refusal of non-KTX2 bytes.
- Upload: the decode client writes decoded bytes straight into the slot's pool memory, through `engine_models_vertex_ptr` and `engine_models_index_ptr`, after the byte counts match `engine_models_vertex_count` and `engine_models_index_count`. It then calls `engine_models_mark_dirty`. No staging buffer, so no per-model allocation in wasm.

**Like-for-like with spoint (rank 6).** The operation is the same on both sides: sample a 33 by 33 height grid over 256 m, once per build, timed per build, on the same host. spoint samples with its JavaScript height function inside `timeFieldSteps`. jayzee samples with `engine_planet_height` in the 64 MiB build, under Node. The call boundary differs, and the row says so. `scripts/spoint-streamer-compare.mjs` writes both rows, and the ratio of the two p99 values is the like-for-like figure. The one-frame phase 5 comparison stays as a separate, labelled row.

### Decisions from the Nanite macro view (article, 2021, updated 2024)

The article is a RenderDoc capture of Unreal's Nanite preview. It gives the pass order, the captured counts and the visibility buffer layout. It gives no LOD error formula, no cluster-tree construction, no streaming design and no measured gains, so every adaptation below is jayzee's, not a copy of a formula. Each row says what was taken, what was left out, and why.

| technique in the article | decision | reason |
|---|---|---|
| Clusters of 128 triangles with a bounding sphere | Implemented: each model slot's index run is cut into clusters of 384 indices (128 triangles), each with a sphere in the model's local space | Gives cluster culling without a clusterizer in wasm. Clusters share the slot's vertices, so no vertex is duplicated (the article's 384-vertex cluster duplicates them) |
| Cluster culling against the frame's view frustum | Implemented on the CPU for both APIs, against the six planes `planFrame` already extracts for props | The frame's planes already exist. A GPU pass needs compute, which WebGL2 does not have, so a CPU path is needed anyway |
| Contiguous visible clusters drawn as one range | Implemented: `visibleRuns` merges adjacent visible clusters into one `DrawIndexed` | A slot's clusters are contiguous in its index run, so a run covers any visible stretch with one call |
| Indirect execute for the cluster draws | Implemented for the WebGPU visibility draws: `finalize` writes the vertex count from the GPU's atomic counts into a `DrawIndirect` buffer. The forward path keeps its CPU-counted direct draws | The GPU count is not on the CPU until a readback, so the arguments must be written on the GPU. The forward path already has its counts on the CPU, so it needs no indirect buffer |
| GPU instance culling with compute, and a WebGL2 fallback | Implemented on WebGPU as two compute culls (`cullA` before the visibility draw, `cullB` on the candidates after it) and a `finalize` pass that writes the draw arguments. WebGL2 keeps the CPU `visibleRuns` | Compute is what WebGPU offers and WebGL2 lacks. The cull reads the cluster table that `markDirty` already writes, and the counts stay on the GPU, so no readback stalls the frame |
| Visibility buffer (R32G32_UINT, ClusterID and TriangleID) and the deferred material pass | Implemented on WebGPU as one R32Uint id per pixel, `(cluster << 7 | triangle) + 1`, with 0 for no model. A vertex-pulling pass writes it, and a fullscreen resolve pass reconstructs the triangle and shades it with perspective-correct barycentrics. Only the model's one shade is resolved, since models have one material | One 32-bit id fits both fields for cluster indices below 2^25 (the id is then at most 2^32 − 1), so the second channel is not needed. Vertex pulling reads the pool's storage buffers, which the WebGPU limit request makes possible. WebGL2 has no storage buffers, so it keeps the forward draw |
| Early depth emission (EmitDepthTargets) | Dropped | It doubles the model vertex work. No overdraw is measured, and the forward depth test already rejects hidden fragments |
| HZB occlusion from the previous frame's depth, rebuilt after the post pass | Implemented on WebGPU as two passes. Pass A culls with the previous frame's HZB and draws the survivors. The HZB is rebuilt from this frame's model depth, and pass B retests only the rejected clusters against it. WebGL2 has no occlusion | The article gives no occlusion figure, so the value is unmeasured. The two-pass form is conservative whatever the HZB's age: a stale pyramid only costs culling, never a visible cluster. The witness checks that the occlusion and no-occlusion pictures are equal |
| Persistent threads with a fixed thread count | Dropped | It assigns work against a GPU queue. WebGPU gives no persistent-thread guarantee, and culling here runs on the CPU |
| Compute software rasterization with 64-bit atomics | Dropped | WebGPU has no 64-bit atomics, and WebGL2 has no compute |
| Hardware and software rasterizer split by triangle size (3,333 hardware instances and 34,821 software groups captured) | Dropped | The software path is compute. Only the hardware path exists here |
| Cluster LOD with seam stitching | Dropped | The article gives no mechanism, so it cannot be implemented from its source. Each model has one level of detail |
| 14-bit material IDs, early stencil marking, the NaN x-coordinate discard | Dropped | They belong to the deferred material pass, which is not built |
| Streaming design | Dropped | The article gives no design |
| HZB readback on WebGL2 | Dropped | The article names it as a stall. It is not built |

Sizes, in the layout in `engine/src/model_pool.cpp`. A cluster record is 24 bytes: a centre (three floats), a radius, a first index and an index count. A slot holds ceil(indicesPerSlot / 384) clusters, at most 256, so the table is slots × clusters × 24 bytes. These rows replace the pool rows of the ranks 3 to 6 table above:

| tier | cluster table | formula pool (vertices, indices, clusters) | carved pool (`engine_models_pool_bytes`) | carved pool plus 64 MiB budget |
|---|---|---|---|---|
| 0 | 98,304 B (128 slots × 32 clusters) | 23,166,976 B | 23,169,408 B | — |
| 1 | 786,432 B (256 slots × 128 clusters) | 185,335,808 B | 185,340,672 B | — |
| 2 | 1,572,864 B (256 slots × 256 clusters) | 370,671,616 B | 370,676,480 B | 437,785,344 B, headroom 94,891,264 B in the 512 MiB build |

The carved figure is the formula plus the meta array and the handle table, which the formula leaves out: 2,432 B at 128 slots and 4,864 B at 256 slots. The earlier measured tier 0 carve of 23,071,104 B is the same value before the cluster table, so the 2,432 B gap is the meta and handle table and no alignment term. The carved values come from `engine_models_pool_bytes` on the 512 MiB build, measured by a one-off run in Phase B. The table is in wasm memory, not VRAM, so `vramBytesOf` is unchanged.

- Bounds are built in `upload` and in `markDirty`, after the slot's data is final, so a decoded slot is culled from its real geometry. Nothing is built per frame.
- A cluster is unbounded (never culled) when an index is past the slot's vertex count, or when a position is not finite. The unbounded case is the safe one: a bad index draws, and it does not vanish.
- `validLayout` now refuses a vertex stride under 12 bytes (a position is three floats, so the bounds read it) and an index count above 256 clusters of 384.
- The model shader places slot `s` at `(4s − 8, 0, −20)` with scale 2. The culling uses the same placement (`modelOffset`, `kModelScale`), copied into C++. A change to the shader must change both; the witness checks the C++ numbers.
- WebGL2 draws models forward with the same `visibleRuns`: one `glDrawElements` per run, a `uOffset` uniform per slot and the slot's vertex base in the attribute pointer. It has no visibility buffer and no occlusion, and `engine_render_model_path_effective` reports `forward` whatever path is requested.
- The run buffer is a file-scope array of `kMaxClustersPerSlot` ranges in the WebGPU renderer, so a frame allocates nothing.
- Witness: `engine/test/witness_models.cpp`, the cluster block. It checks each cluster's sphere against its vertices, the adjacent merge into one run, a plane that cuts a cluster, a conservative cut (every culled vertex lies outside the plane), a plane that rejects every cluster, an unbounded slot, and the layout limits.

### Phase C: visibility buffer, GPU culling and HZB

Where each part runs. The WebGPU column is the visibility path, the default for models. The forward path is still built on WebGPU, as the comparison baseline.

| part | WebGPU | WebGL2 | reason for the split |
|---|---|---|---|
| cluster cull A (frustum, previous frame's HZB) | compute `cullA` | CPU `visibleRuns` | WebGL2 has no compute |
| cluster cull B (rejected clusters, this frame's HZB) | compute `cullB` | not used | the candidate list exists only with pass A |
| draw arguments | `finalize` writes `DrawIndirect` arguments from the atomic counts | CPU run list | the counts stay on the GPU, so no readback |
| visibility draw | R32Uint id target and Depth32Float, vertex pulling from the pool's storage buffers | not built | no storage buffers on WebGL2 |
| HZB | R32Float mip chain, depth copy and max reduce in compute | not built | no compute |
| resolve | fullscreen pass that shades each id's triangle | not built | follows the id target |
| forward model draw | direct draws per run, the comparison baseline | the only model path | WebGL2 has no other path |

Decisions taken in this pass:

- The HZB is padded to a power of two, with padding texels at depth 1, which is far and never occludes. WebGPU sizes a mip as the floor of the base, so a non-power-of-two base drops the last odd row or column at every level. Tail levels clamp to one texel, which is WebGPU's rule (`max(1, size >> level)`). The occlusion test and the dispatch sizes use the same clamp.
- The HZB is built from the model depth only. Props and terrain are drawn after the resolve, so they add no occlusion. This loses culling and never a visible cluster: the stored depth is the farthest of the covering texels, so it is at least the true nearest depth.
- Pass B exists because pass A's HZB can be stale. A stale pyramid only changes which clusters pass A rejects. Every rejected cluster is retested against the pyramid of this frame's survivors before it is dropped, so a stale HZB costs culling and never a visible cluster.
- Occlusion stays off on the first visibility frame, because no pyramid exists yet (`hzbValid`). A switch to the forward path leaves the pyramid in place, and the next visibility frame uses it under the rule above.
- Depth is Depth32Float on the props, terrain and model pipelines. The HZB reads depth as float, and the id pass and the forward pass must share one format. The engine had Depth24Plus; it is replaced in all three.
- The model shader used the GL projection on WebGPU, which has NDC depth in [0, 1]. The near half of the depth range was clipped. The props and terrain shaders already remapped depth with `clipOf`, and the model shader did not. Both model paths now use `clipOf`. The Phase B browser runs did not catch it, because they checked the counts and no pixels.
- The vertex pool at tier 2 is 256 MiB, over the 128 MiB default `maxStorageBufferBindingSize`. `renderer.js` requests the adapter's storage limit and plans the pool against the smaller of the buffer and storage limits. A device with a 128 MiB storage limit is planned at a lower tier, not refused.
- Clusters: `visibilityId` is `(cluster << 7 | triangle) + 1`, so 0 is no model. The largest cluster index at tier 2 is 65,535, which gives an id of 2^23. The witness checks the id round trip up to cluster 131,071 (512 slots), where the id is 2^24.
- The C++ side allocates nothing per frame. Every GPU object is created in `init` or `buildVisibility`, and `frame()` writes buffers and records passes. The per-frame wgpu encoder and pass objects are the same as before this pass.
- The visibility path runs only when at least one model is live (`models::liveCount() > 0`). With no live models the culls, HZB and resolve would run on nothing. The 1024 WebGPU witness measured 118 API calls per frame that way, and 36 after the rule.
- The forward path records no compute dispatch. The visibility path does (cull, finalize, HZB, id and resolve), and `check:engine-render` asserts only the forward path, which is a narrower claim than the Phase A text made.

Memory, in VRAM. Wasm memory is unchanged: the cluster table is already part of the carved pool (the Phase B table).

| buffer | tier 2 size (256 slots × 256 clusters) | notes |
|---|---|---|
| cluster table | 1,572,864 B | copied per dirty slot, so an unchanged slot costs nothing |
| candidate and visible lists | 3 × 65,536 × 4 = 786,432 B | `listA`, `listCand`, `listB` |
| counters, draw arguments, parameters | 16 + 32 + 48 B | |
| slot ready words | 1,024 B | 256 words |
| id target | surface width × height × 4 B | 2,073,600 B at 960 × 540 |
| HZB | padded surface, R32Float, full mip chain (about 4/3 of the base) | about 11 MB at 1920 × 1080 |
| depth | surface width × height × 4 B | replaces the Depth24Plus target, same size |

Witnesses for this pass are listed in docs/PENDING_VALIDATION.md under the Phase C section.

### Phase C: occlusion efficiency, measured

The occluded scene (`visibility.html?scene=occluded`) puts four large quads behind four small quads, 8 model slots of 256 clusters each, 24 live clusters in total and 2,304 triangles. The WebGPU run reports three configurations from the same camera:

| configuration | path | clusters drawn | frustum culled | HZB culled | image |
|---|---|---|---|---|---|
| forward | forward | all | n/a | n/a | baseline |
| visibility, HZB off | visibility | 24 of 24 | 0 | 0 | identical to forward on the walls scene, identical to the HZB run on the occluded scene |
| visibility, HZB on | visibility | 12 of 24 | 0 | 12 | identical to the HZB-off run (0 of 518,400 pixels differ) |

Derived from the cluster totals: the HZB run keeps about 1,152 of 2,304 triangles, so the culled share is 50 percent of the triangles in this scene. The triangle count per cluster is not uniform, so this is the share of the cluster-weighted triangle total and not an exact per-triangle count.

The walls scene (larger quads, nothing hidden) draws 24 of 24 clusters with and without HZB, which is the control: the HZB never culls a visible cluster.

WebGL2 has no compute and no HZB, so its requested visibility path runs as forward (`effectivePath` forward, `drawn` 24 of 24 on both scenes). This is the deferred item listed under "Deferred on WebGL2" below.

The readback that produces these numbers is a staging buffer copied in the frame and mapped asynchronously. The count is the frame the copy was submitted in, so it is one frame behind the pixels that were drawn in the same call. The readback is off unless a witness turns it on (`engine_render_set_count_readback`).

Deferred on WebGL2, recorded here and not hidden: GPU cluster culling, the HZB, the id target and the resolve are not built on WebGL2. The WebGL2 visibility request is accepted and reported as forward. The per-cluster frustum cull on the CPU runs on WebGL2 and is witnessed by the same counts (24 of 24 drawn in both scenes).

### Baseline feature set, bottom line

The checklist below is the Phase 1 baseline the owner asked for: what jayzee must support, read from the documentation of the two sibling engines (spoint and the flat-landscape engine spawn, plus the upstream notes in this repo) and from this repo's sources. Status is supported, partial or missing. The statuses are a first audit by reading, and they have not been measured. A row is "supported" only where a witness in docs/PENDING_VALIDATION.md names it, and every other row is a claim to verify. The spawn engine is flat; jayzee's landscapes are spherical, so every terrain row is judged for the sphere.

Physics

- [ ] Rigid bodies, pooled, batch add and remove, generation-checked handles: partial (world.cpp; pool witness recorded in phase 4)
- [ ] Radial planet gravity toward the centre, world gravity zero: partial
- [ ] Character capsule with ground, 60-degree slope, step-up and wall planes: partial (JS characterManager only; no C++ CharacterVirtual)
- [ ] Character against the planet shape: missing
- [ ] CCD swept stop for fast bodies: partial (box-only pure logic)
- [ ] Sleeping islands and warm-started contacts: partial
- [ ] Vehicles (wheels, suspension, slip, chassis pinning): partial (JS only)
- [ ] Joints and friction and restitution combine modes: partial
- [ ] Triggers and sensors (enter and exit without response): partial (pure logic)
- [ ] Ray and overlap queries with layer filters and hit normals: partial
- [ ] Planet-surface ray and shape cast: missing (surface_shape.h CastRay returns false)
- [ ] Moving platforms that carry riders: partial (velocity only; rider carry not witnessed)
- [ ] Deterministic physics with equal hashes across client and server: partial (cross-thread hash witness open)

Terrain and landscape

- [ ] Cube-sphere frame: faces, cells, face pick, local-to-planet mapping: partial
- [ ] Height at any planet point: coarse procedural far field, resident pages near: partial
- [ ] Ground height and normal query for physics and gameplay: partial
- [ ] One height source read by physics and renderer: partial (see "Landscape dataset decision")
- [ ] Collision and visual sharing from the same samples: partial
- [ ] Terrain LOD by altitude with geomorph seams: missing
- [ ] Page streaming: workers decode into free slots and commit by epoch at the tick: partial
- [ ] Bounded request queues with low-priority drop: partial
- [ ] Chart re-anchor at face boundaries with hysteresis: partial
- [ ] Fail-loud heightfield bake, no silent fallback: supported (heightfieldPhysics.js, check gate)
- [ ] Terrain paint and sculpt at runtime: partial (pure logic)
- [ ] Caves, carving and erosion in the query path: partial (pure logic)
- [ ] Sky and atmosphere LUTs: partial (JS only)
- [ ] Floating origin on the large planet: partial (pure logic)

Vegetation

- [ ] Instance table per cube-sphere cell: partial (vegetation.cpp; phase 6 witness)
- [ ] One body for all vegetation through a custom shape: partial
- [ ] Placement streaming with no allocation as the player moves: partial
- [ ] Collision classes: trunk capsule, rock hull, pass-through: partial
- [ ] Promotion of touched instances to pooled dynamic bodies: missing
- [ ] Placement rules (slope caps, snow, footprint exclusion): partial
- [ ] Vegetation LOD bands with hysteresis: missing
- [ ] Grass density and wind from one law on CPU and shader: partial (no wind in C++)

Rendering

- [ ] WebGPU renderer with slots on a device created at boot: partial (phase 10 witness recorded)
- [ ] WebGL2 fallback drawing the same slots: partial (phase 11 recorded; no GPU culling or HZB)
- [ ] Light slot buffer, adding a light writes a slot: supported
- [ ] Every pipeline built before the seal, creates-after-seal stays 0: supported
- [ ] CPU frustum culling on both backends: supported
- [ ] Occlusion culling with an HZB: supported on WebGPU (see "Phase C: occlusion efficiency, measured"); missing on WebGL2
- [ ] Shadows: missing in C++ (JS only)
- [ ] Materials as slots: partial
- [ ] Device-loss recovery: partial (witnessed for destroy and reload)
- [ ] Model pool and per-frame upload budget: supported
- [ ] Screen-size LOD with hysteresis: missing

Assets

- [ ] GLB only, lengths checked, no external URIs: supported (validate.mjs)
- [ ] Meshopt geometry, Draco refused: supported (validate.mjs, decodeCore.js)
- [ ] KTX2 with Basis transcode on a worker: partial (no real transcode witnessed)
- [ ] Validation gate blocks the build on rejected assets: supported
- [ ] Progressive LOD and meshlets: partial
- [ ] Named asset resolution through one 302 with content checks: supported
- [ ] Spawn terrain store import, re-keyed to cube-sphere cells: missing

Netcode and simulation

- [ ] Fixed tick with catch-up limits and shed fraction: partial
- [ ] One tick call per frame from JS: supported (engine_tick once)
- [ ] Authoritative profile with starvation hold: partial
- [ ] Rollback profile (input delay 1, 12 ticks of rollback): partial (WebRTC wiring not ported)
- [ ] Lockstep profile (input delay 3, checksum every 30 ticks): partial
- [ ] Binary snapshots, 29-byte entity and 22-byte player records: partial
- [ ] Snapshot delta against an acknowledged baseline: partial
- [ ] Snapshot LOD (full near, 5 Hz beyond 120 m): partial
- [ ] Interest management with cell keys that throw rather than wrap: partial
- [ ] Per-tick bandwidth budget with priority decay: partial
- [ ] Prediction and interpolation with bounded extrapolation: partial
- [ ] Lag compensation with a rewind ring and capsule hit test: partial
- [ ] Replay record and play back with magic and version: partial
- [ ] Desync checks, consensus vote and input rate limit: partial
- [ ] Transports (WebSocket, WebTransport, WebRTC, worker): partial

Game systems

- [ ] Projectiles with gravity and hit resolution: partial
- [ ] Pickups with trigger and respawn: partial
- [ ] Crowds and steering under a per-tick budget: partial
- [ ] Bots and decision pipeline: partial
- [ ] Finite state machine interpreter: partial
- [ ] Pathfinding corridor search with budget and partial results: partial
- [ ] Navmesh query on the sphere by chart: partial
- [ ] Quests and event chains: partial
- [ ] Stats, progression and abilities: partial
- [ ] Health and timed buffs with death events: partial
- [ ] Character animation with blend trees, IK and ragdoll: partial (JS only)
- [ ] Fire and fluid kernels: partial
- [ ] Script limits (memory, op count, time): supported

Memory and budgets

- [ ] Every region carved at boot, allocations since warm-up stay 0: partial (phase 4 and tier witnesses)
- [ ] One wasm memory sized from the device budget, no growth in tier builds: supported (artifacts gate)
- [ ] Device tier planner from adapter limits and RAM: supported
- [ ] VRAM accounting against the tier budget: partial (WebGPU reports no VRAM; planned bytes only)
- [ ] Per-frame upload budget per tier: supported
- [ ] Body and vegetation pools with generation ids: partial
- [ ] Fixed rings for input, snapshot, transform and events: partial
- [ ] Budget degradation (lower LOD, fewer slots) instead of allocation: partial
- [ ] Jolt heap and caps that fail rather than grow: partial

Landscape dataset decision

Decision: one CPU height store, the page cache in `engine/src/page_cache.cpp`, read by both the collider and the renderer. The GPU height texture is a per-layer upload of the same samples and is a separate GPU resource in every design.

The code paths that read it, verified by grep:

- collision: `planet_frame.cpp` bilinearly samples `terrain.pages.pageSamples(slot)` for every height query, and `PlanetShape` reads through the same `Planet`.
- render: `render_webgpu.cpp` and `render_webgl2.cpp` write `scene.pages->pageSamples(slot)` into the height texture on upload.

Measured with `scripts/bench-landscape-store.mjs` (Node, the built wasm, the page layout from `src/engine/pageLayout.js`, radius 6,371,000 m, cell 25.46 m, 5 repeats, median copy):

| quantity | one shared store (as built) | two copies (a second CPU store) |
|---|---|---|
| pages in the store | 64 (`kPageSlots` is 64 at every tier) | 64 |
| sample bytes | 65,536 (64 pages × 256 floats × 4 B) | 131,072 |
| build time, stage, fill and commit 64 pages | 3.79 ms (3.62 ms on the 512 MiB glue) | 3.82 ms (extra copy 0.025 ms, 0.011 ms on 512 MiB) |

The extra copy costs 64 KiB and about 0.01 to 0.03 ms for the whole store. No measured reason forbids sharing any part, so no part is split. The reason to keep one store is correctness: the collider and the drawn surface then read the same numbers, so they cannot drift apart at a page edge.

Page store sizing rule (replaces the fixed 64-page store)

The store holds `pageSlots` pages, chosen once when the arena is planned, from the arena budget:

- `pageSlots = clamp(floor(budget / 8 / 1033 B), 64, 256)`, where 1033 B is one page's arena cost (256 float samples, an int64 key and a state byte, `planet::kPageArenaBytes`) and 1/8 is the share of the budget the pages may take.
- The lower bound 64 is the old fixed count, so a small budget never has fewer pages than before. The upper bound 256 is `planet::kMaxRenderedPages`, the render array maximum: WebGPU's default `maxTextureArrayLayers` and the WebGL2 minimum for layers, so one height texture array fits every backend.
- The renderer reads the count from the store (`pageLayers()` = min(256, `pages.pageSlotCount()`)). Its GPU height texture is created with that many layers at init. The layer arrays in `FramePlan` and the record buffer are sized to 256 at compile time and are never resized.
- Every buffer is allocated once in `engine_init` or `engine_render_init`. Nothing is added after the seal, and `createsAfterSeal` stays 0.

Measured: a 48 MiB budget gives 256 pages, a 262,144 B store, and a 4.53 ms build for 256 pages (`scripts/bench-landscape-store.mjs`). The 64-tier render witness on both backends still checksums -5415737363265412373 with 16 scene pages, so the change does not alter the rendered scene. A 16 MiB arena is refused by `engine_init` before the store is touched; that is the existing planner, not the page count.

Commits are pending until the tick applies them, so a freshly committed page is not resident until the next `applyPending` (the bench reports `residentAfterBuild` 0 for this reason).

1024 frame budget decision

Decision: the 1024 tier's frame budget is 16.7 ms (one tick at 60 Hz). The 1024 witness scene is the planet scene of 10,240 bodies, and it runs on the threaded and SIMD build (`engine-core-128mib-timed-threads-simd`, 4 workers) with the scalar build as the fallback. The determinism runs recorded the simulation hashes b6675ee2 and 21494c4d, and the record says they are unchanged across the scalar, SIMD and threaded configurations (1 and 4 threads, with repeats).

Measured: three interleaved rounds give a WebGPU median of 16.9 ms and a WebGL2 median of 17.5 ms, with round-to-round spread from 13.7 to 17.6 ms. The budget is reached in some rounds and missed in others, and the tick is most of the frame on both backends. So the 1024 tier is at the budget, not inside it. The 8-worker case is impossible with the current pthread pool size of 3, so 4 workers is the ceiling.

The 1024 solver configuration (owner decision, dispatcher-recorded, 2026-11-10)

The 64, 128 and 512 tiers keep their determinism hash and their 8 solver iterations. For the 1024 tier only, the solver runs 4 iterations for both velocity and position steps (`SOLVER_ITERATIONS_BY_PLAYERS` in `src/engine/solverIterations.js`). This is the least change that halves the contact-solver work and keeps the existing sleeping and broadphase settings. The host applies it only when the caller leaves `solverIterations` unset (`src/engine/EngineWorld.js`), and the render page reads the same table, so the witness runs what the host runs.

The simulation hash is the physics state, not the render scene. `scripts/check-engine-state-hash-1024.mjs` runs 10,240 bodies for 120 ticks on the fixed build (1 worker) and on the threaded build (4 workers), requires the two to agree bit for bit, and compares the FNV-1a hash of the float32 positions with `engine/state-hashes.json` (key `tier1024-solver4`). The pin is written by `npm run gen:engine-state-hash-1024`, which refuses to write when the two builds disagree. The earlier values b6675ee2 and 21494c4d are not traceable to any gate or record in this repo: the render page's `hash` covers the camera and the page samples, so those values are not simulation hashes and are not used.

The 1024 witness reports the host load beside each run (`load.load1Before`, `load.load1After`, `load.cpus` in each stream record), so a frame figure can be read with the load that produced it.

Open for this decision: the 1024 tier is measured again in the stream witness after this change. If the median is still above 16.7 ms on either backend, the next lever is the position-step count alone, and that is a new decision.

Minimum arena for the 1024 plan (decision)

Decision: `engine_init` keeps refusing a budget that cannot hold the planned tier. It returns -2 (range) and binds nothing. The device decides the budget, so the engine does not quietly boot a smaller plan that would break the tier contract. The host chooses a budget at or above the floor, and the floor is what the gate measures: `scripts/check-engine-budget-floor.mjs` asserts 16 MiB is refused, 48 MiB boots, and bisects the smallest booting arena between them, printing it as an INFO line. In this build the floor is 35 MiB (Phase B run, docs/PENDING_VALIDATION.md).

Real vegetation and streaming (Phase A)

- Asset prep. `tools/asset-pipeline/prep.mjs` runs meshopt at level `medium` through the pinned `@gltf-transform/*` 4.5.1 and `meshoptimizer` 1.2.0, and encodes each embedded texture to KTX2 with the pinned `basisu` 1.16.3 binary (ETC1S, mipmaps). The output is validated by `tools/asset-pipeline/validate.mjs`. The source vegetation (`/workspace/hy3d/output/relay-prepped`: tree, tall_tree, grass_large, flowers) is PNG and not meshopt-compressed, so prep is required before any engine path can use it. `scripts/check-vegetation-assets.mjs` runs prep and checks each output for validity, at least one KTX2 texture, the medium level and a size no more than twice the source.
- What is not done. The engine has no instanced GLB draw path. Props are 36-vertex cubes by class, and models draw one slot per asset at a fixed offset. Dense real-asset vegetation therefore needs an instanced draw path in the renderer, and no such path exists yet. Until it does, the vegetation gate proves the assets are valid, not that they draw.
- KTX2 transcode is not witnessed. Prep writes KTX2 bytes, and the decode worker's transcode witness covers only a KTX2 header with no content.
- Streaming. The planet render page streams pages in a bounded queue: a window of 8 pages around the camera cell and at most 8 staged or released pages per frame (`streamPerFrame`). It replaces the earlier restage that placed every new page in one frame, which was a hitch. `scripts/browser/stream-witness-run.mjs` runs the planet walk and the 250 m flyover on the four tiers and both backends, and writes a per-run record and a summary. Its verdict needs more than 64 placed pages, frame p99 and worst frame at or below 16.7 ms, and per-frame page streaming at or below 2 ms, with no allocation after warm-up and no creation after the seal.
- Encode phase. The render phase timers gain `kEncode`, covering command encoding (`encodeVisibility` or `encodeForward`) and `Finish`, so the backend cost can be read apart from the submit. The page reports it as `encode`.
- Physics sync. `World::sync` reads body positions through `GetBodyInterfaceNoLock()`. It is called on the step thread between steps, and nothing else touches bodies then, so the lock is not needed. This is unmeasured and must be confirmed by the threaded determinism hashes in Phase B.

Scenario witnesses (open)

Not done in this pass. The owner asked for repeatable physics scenarios from spoint's example games (character controller, deathrun, combat bots, lockstep RTS, boss fights) with tick and frame budgets on every tier and both backends. None exists yet. Recorded as open.

### Status

- The renderer draws model slots. Uploads reach the GPU on the planned tier's per-frame budget, and only slots whose upload is complete are drawn. The model pipeline is built before the seal (createsAfterSeal stays 0).
- The model pool is planned and carved at startup by `engine_models_bind_plan` from the device limits. The tier is `renderer.modelTier`.
- Decode runs on a worker. In a browser worker, a meshopt vertex stream decodes byte for byte, and the Basis transcoder loads in the worker and refuses a KTX2 header with no content (scripts/browser/decode-worker-run.mjs). A real KTX2 transcode is not witnessed (no encoder on the host).
- Device loss is detected and reported through `renderer.deviceLost`. Recovery re-creates the renderer. The arena copies do not survive a device loss. The browser witness destroys the device, reloads, and draws with status 0 (scripts/browser/device-loss-run.mjs).
- Phase B measurements are in docs/PENDING_VALIDATION.md under the Phase B result for this pass.
