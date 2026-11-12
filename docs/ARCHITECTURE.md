# Architecture

jayzee keeps each layer in the language it runs well in.

| Layer | Path | Language | Owns |
|---|---|---|---|
| Kernel | `src/kernel` | Numeric JavaScript, compiled by jz to wasm | Integration, contact response, pair search, the tick |
| World | `src/world` | Plain JavaScript | Fixed-step clock, body table, wasm memory handles, the hash |
| Protocol | `src/protocol` | Plain JavaScript | Versioned binary input and snapshot codecs |

Dependencies point one way. The world calls the kernel. The codecs depend on nothing. The kernel imports no host code and allocates nothing after `reserve`.

## Why this split

jz compiles numeric code over typed arrays with no runtime. Its own documentation lists network I/O, UI, dynamic object models and long-lived object graphs as outside its scope. Physics is numeric and hot, so it moves to wasm. Everything else stays JavaScript, where it is clear and cheap to change.

## Build and runtime

- `scripts/build-kernel.mjs` compiles `src/kernel/kernel.js` and its modules into `dist/kernel.wasm` through `jz`. It runs on install, pack and test.
- `src/kernel/load.js` compiles the bytes to a `WebAssembly.Module` once per process and instantiates it for each world with the plain WebAssembly API. The module has no imports, so neither the compiler nor its interop runtime is loaded at runtime.
- Each `World` owns its instance and therefore its linear memory. The kernel owns the buffers: `reserve` allocates positions, velocities, boxes and the pair grid once, as module bindings whose types jz knows statically, and the world holds views of the first three. A tick copies nothing across the JavaScript boundary, and nothing is allocated after `reserve`.
- One call to `step` runs a full tick: integrate, then `solverIterations` passes of ground, boxes and pairs.

## Determinism

- The world advances in fixed ticks (default 64 Hz). `advance` carries the remainder and caps catch-up at 8 ticks, so a stall drops time rather than spiralling.
- The same spawn and step schedule gives identical positions, velocities and hashes. The world suite checks this across two worlds.
- `hash()` folds the exact IEEE-754 bits of every position and velocity through FNV-1a. A change of one ulp changes it.

## Contacts

- Bodies are spheres of one radius. Static geometry is the ground plane at y = 0 and axis-aligned boxes.
- Restitution applies only to impacts faster than 1 m/s. Slower contacts remove the normal velocity, so a resting body settles instead of micro-bouncing.
- Body pairs use a spatial hash grid. Cells are as wide as the contact diameter. Each body records its cell at the start of the pass. A candidate is accepted only when its recorded cell is the one being searched, so a bucket collision never duplicates or drops a pair. The bucket table is the power of two at or above two buckets per body, with a minimum of 64. The hash is an integer mix masked to the table, and a bitset of eight bits per bucket answers a probe of an empty cell without reading the table. Neither changes which pairs are resolved: a chain is in descending body index whatever the hash.
- The solver runs `solverIterations` passes per tick (default 8). In the stack gate, a chain of five overlapping bodies has a 0.19 m overlap after one pass, about 0.014 m after eight, and 0.0005 m after sixteen. Sixteen or more passes are needed when exact stacking matters.

## Measured cost

Measured with `npm run bench` on Node 22, 8 solver iterations, 200 measured ticks after 30 warm-up ticks, bodies falling in a 60 m square above a box floor. Numbers are from one 4-CPU container; rerun them on the target before relying on them.

| Bodies | Mean tick | Ticks per second | Before the typed kernel |
|---|---|---|---|
| 500 | 0.42 ms | 2400 | 7.8 ms |
| 2000 | 3.1 ms | 320 | 27 ms |
| 5000 | 10 ms | 97 | 71 ms |

The budget at 64 Hz is 15.6 ms per tick, so this kernel fits it to about 5000 bodies with eight iterations. The state hash after every tick is the same as before the change, bit for bit.

What the earlier figures were: every buffer was a parameter, and jz compiles an array parameter of a function that another kernel function calls on its dynamic path, a hash lookup per access. The kernel now holds its buffers as module bindings, which jz types statically. The pair search took most of what was left: its bucket hash was a float multiply, divide and floor for each of the 27 neighbour cells of each body on every solver pass, and most probes walked a chain of bodies from other cells. The integer hash and the occupancy bitset removed both. A world of 500 bodies holds 65 KiB of wasm memory against 1090 KiB, and `kernel.wasm` is 16,460 bytes against 131,666.

## Netcode

- The client sends each tick's input in a packet that also carries the previous 15 inputs. Any single packet can be lost without a gap.
- The server keeps an `InputBuffer` per player. It accepts out-of-order packets, ignores duplicates and stale inputs, and takes exactly one input per tick. A missing input holds the last movement for up to four ticks, then goes neutral.
- Playout delay: the server processes tick t at its step t + 12. Input t can arrive in any packet sent between steps t and t + 12, so the 16-input redundancy survives long loss bursts. With a delay of 4 the same redundancy leaves gaps under 30% loss (22 of 900 inputs in the witness).
- Canonical inputs: both sides apply the decoded wire value, not the raw intent, so both run identical numbers. `canonicalInput` is the single place that quantizes.
- Prediction: the client predicts one tick per step. On each state from the server it imports the exact float64 state, drops the acknowledged inputs and replays the rest. A state from a tick it has not reached throws.
- Authority: one tick per `Authority#step` takes one input per player, applies its movement and steps the world once.
- The state codec carries float64 positions and velocities, because reconciliation must be exact. The float32 snapshot remains for display and broadcast.
- Snapshot acknowledgement: the client acknowledges the newest state it received in a 5-byte `ack` message. The server keeps its last 64 states, and the next state is a delta against the newest acknowledged one that it still holds. Without an acknowledgement, or when the base has been pruned, the state is sent in full.
- Delta codec: each changed body is sent in full as float64 values, so a delta reconstructs the state bit for bit. Bodies whose six values match the base are omitted. In the witness the delta stream is 17.6% of the full-state bytes over 400 ticks with 40 falling bodies, and a delta against a settled base is 14 bytes against 114 for the full state.
- Witness: `npm run check:netcode` runs 900 ticks with 30% input loss, input delay of 0 to 3 ticks, 10% state loss and state delay of 0 to 2 ticks. Every client tick matches an offline trajectory bit for bit, and the client converges to the server state. A control run with a 4-tick playout delay shows the gaps that the 12-tick delay removes.

Not yet covered: more than one predicted player in the witness, jump and other buttons (only movement is simulated), bandwidth budgets beyond delta encoding, interest management and client-side smoothing of corrections.
## Wire formats

- Input packet: version (u8), record count (u8), then 12-byte records: sequence (u32), moveX (i8, 127 = 1.0), moveZ (i8), yaw (u16, 65536 steps per turn), buttons (u32 bitmask). Out-of-range fields throw, they are not clamped.
- Snapshot: version (u8), tick (u32), body count (u16), then float32 x, y, z per body.
- Delta: version (u8), flags (u8, bit 0 = has base), tick (u32), base tick (u32), body count (u16), changed count (u16), then per changed body: index (u16) and six float64 values.
- Ack: version (u8), tick (u32).

## Mapping from spoint

| spoint | jayzee | State |
|---|---|---|
| `src/physics` (Jolt wrapper) | `src/kernel` | Replaced by jz kernels. Jolt is not ported. |
| `src/sdk/TickHandler.js` pipeline | `World#step` | Ported: integrate, ground, boxes, pairs |
| `src/protocol` (MessagePack, InputCodec) | `src/protocol` | Ported as fixed binary layouts. MessagePack is dropped. |
| `src/netcode` (prediction, AOI, bandwidth budget) | `src/netcode` | Input buffer, prediction, reconciliation and authority are ported. AOI and bandwidth budgets are not. |
| `src/apps` (AppRuntime, app lifecycle) | none yet | Not ported. Lands as a host plugin layer. |
| `src/terrain`, `src/static`, `src/fluid` | none | Out of scope for this core. |
| `src/transport`, `src/sharding`, `src/storage` | none | Out of scope for this core. |
| `client/` (Three.js, VRM, rendering) | none | Out of scope for this core. |

## Not yet built

- Body-to-body and body-to-box contacts for non-sphere shapes.
- Character controller semantics (slopes, steps, capsules).
- Netcode: interest management, bandwidth budgets beyond deltas, jump and other buttons, client-side smoothing.
- App lifecycle and hot reload.

Each lands as a host module over the existing kernel, without changing kernel signatures unless a gate shows a kernel defect.
