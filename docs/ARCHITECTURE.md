# Architecture

jayzee keeps each layer in the language it runs well in.

| Layer | Path | Language | Owns |
|---|---|---|---|
| Kernel | ```src/kernel``` | Numeric JavaScript, compiled by jz to wasm | Integration, contact response, pair broadphase, state hash |
| World | ```src/world``` | Plain JavaScript | Fixed-step clock, body table, the order of kernel calls |
| Protocol | ```src/protocol``` | Plain JavaScript | Versioned binary input and snapshot codecs |

Dependencies point one way. The world calls the kernel. The protocol codecs depend on nothing else. The kernel imports no host code and has no objects, closures or allocation policy of its own.

## Why this split

jz compiles numeric code over typed arrays with no runtime. Its own documentation lists network I/O, UI, dynamic object models and long-lived object graphs as outside its scope. spoint's physics core is numeric and hot, so it moves to wasm. Everything else stays JavaScript, where it is clear and cheap to change.

## Build and runtime

- ```scripts/build-kernel.mjs``` compiles ```src/kernel/kernel.js``` and its modules into ```dist/kernel.wasm```. The build takes about 20 seconds.
- ```src/kernel/load.js``` instantiates those bytes through ```jz/interop```. The compiler never runs at runtime.
- ```prepare```, ```prepack``` and ```test``` run the build, so a fresh clone is runnable after ```npm install```.

## Determinism

- The world advances in fixed ticks (default 64 Hz). ```advance``` carries the remainder and caps catch-up at 8 ticks, so a stall drops time rather than spiralling.
- The same spawn and step schedule gives identical positions and hashes. The world suite checks this across two worlds.
- ```hashState``` quantizes each component to 1/4096 m/s or m. It is a digest for replay checks, not a bit-exact comparison.

## Contacts

- Bodies are spheres of one radius. Static geometry is the ground plane at y = 0 and axis-aligned boxes.
- Restitution applies only to impacts faster than 1 m/s. Slower contacts remove the normal velocity, so a resting body settles instead of micro-bouncing.
- Body pairs use a uniform grid with cell size equal to the contact diameter and 16 cells per axis. Positions outside the grid clamp to edge cells, which keeps every overlapping pair in neighbouring cells. Contacts resolve against the grid built at the start of the pass.

## Wire formats

- Input packet: version (u8), record count (u8), then 12-byte records: sequence (u32), moveX (i8, 127 = 1.0), moveZ (i8), yaw (u16, 65536 steps per turn), buttons (u32 bitmask). Out-of-range fields throw, they are not clamped.
- Snapshot: version (u8), tick (u32), body count (u16), then float32 x, y, z per body.

## Mapping from spoint

| spoint | jayzee | State |
|---|---|---|
| ```src/physics``` (Jolt wrapper) | ```src/kernel``` | Replaced by jz kernels. Jolt is not ported. |
| ```src/sdk/TickHandler.js``` pipeline | ```World#step``` | Ported: integrate, ground, boxes, pairs |
| ```src/protocol``` (MessagePack, InputCodec) | ```src/protocol``` | Ported as fixed binary layouts. MessagePack is dropped. |
| ```src/netcode``` (prediction, AOI, bandwidth budget) | none yet | Not ported. Lands as host modules over the same kernel. |
| ```src/apps``` (AppRuntime, app lifecycle) | none yet | Not ported. Lands as a host plugin layer. |
| ```src/terrain```, ```src/static```, ```src/fluid``` | none | Out of scope for this core. |
| ```src/transport```, ```src/sharding```, ```src/storage``` | none | Out of scope for this core. |
| ```client/``` (Three.js, VRM, rendering) | none | Out of scope for this core. |

## Not yet built

- Body-to-body and body-to-box contacts for non-sphere shapes.
- Character controller semantics (slopes, steps, capsules).
- Netcode: input buffering, prediction and reconciliation, interest management, bandwidth budgets.
- App lifecycle and hot reload.

Each lands as a host module over the existing kernel, without changing kernel signatures unless a test shows a kernel defect.
