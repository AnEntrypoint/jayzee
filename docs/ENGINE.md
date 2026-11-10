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
| Indirect execute for the cluster draws | Dropped | The run counts are known on the CPU in the same frame, so the indirect buffer would carry values the CPU already has |
| GPU instance culling with compute, and a WebGL2 fallback | Deferred | The CPU pass costs at most slots × clusters sphere tests (65,536 at tier 2) per frame. No measurement shows that cost needs moving to the GPU |
| Visibility buffer (R32G32_UINT, ClusterID and TriangleID) and the deferred material pass | Deferred, not implemented | It is the largest item in the article. It needs a second geometry pass that fetches vertices from storage buffers (WebGPU) or textures (WebGL2), a material classification pass, and integer colour targets on both backends. No overdraw or shading cost in the engine supports that rewrite yet |
| Early depth emission (EmitDepthTargets) | Dropped | It doubles the model vertex work. No overdraw is measured, and the forward depth test already rejects hidden fragments |
| HZB occlusion from the previous frame's depth, rebuilt after the post pass | Deferred | It needs a depth mip chain each frame: a compute pass on WebGPU and a fragment pass per level on WebGL2. The article gives no occlusion figure, and no occlusion problem is measured here |
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
- WebGL2 has no model draw path (it draws props and terrain only), so this culling reaches WebGPU only. A WebGL2 model path is a follow-up, and it would use the same `visibleRuns`.
- The run buffer is a file-scope array of `kMaxClustersPerSlot` ranges in the WebGPU renderer, so a frame allocates nothing.
- Witness: `engine/test/witness_models.cpp`, the cluster block. It checks each cluster's sphere against its vertices, the adjacent merge into one run, a plane that cuts a cluster, a conservative cut (every culled vertex lies outside the plane), a plane that rejects every cluster, an unbounded slot, and the layout limits.

### Status

- The renderer draws model slots. Uploads reach the GPU on the planned tier's per-frame budget, and only slots whose upload is complete are drawn. The model pipeline is built before the seal (createsAfterSeal stays 0).
- The model pool is planned and carved at startup by `engine_models_bind_plan` from the device limits. The tier is `renderer.modelTier`.
- Decode runs on a worker. In a browser worker, a meshopt vertex stream decodes byte for byte, and the Basis transcoder loads in the worker and refuses a KTX2 header with no content (scripts/browser/decode-worker-run.mjs). A real KTX2 transcode is not witnessed (no encoder on the host).
- Device loss is detected and reported through `renderer.deviceLost`. Recovery re-creates the renderer. The arena copies do not survive a device loss. The browser witness destroys the device, reloads, and draws with status 0 (scripts/browser/device-loss-run.mjs).
- Phase B measurements are in docs/PENDING_VALIDATION.md under the Phase B result for this pass.
