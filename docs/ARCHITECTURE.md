# Architecture

jayzee keeps each layer in the language it runs well in.

| Layer | Path | Language | Owns |
|---|---|---|---|
| Kernel | `src/kernel` | Numeric JavaScript, compiled by jz to wasm | Integration, contact response, pair search, the tick |
| World | `src/world` | Plain JavaScript | Fixed-step clock, body table, wasm memory handles, the hash |
| Protocol | `src/protocol` | Plain JavaScript | Versioned binary input and snapshot codecs |

Dependencies point one way. The world calls the kernel. The codecs depend on nothing. The kernel imports no host code and allocates nothing in steady state.

## Why this split

jz compiles numeric code over typed arrays with no runtime. Its own documentation lists network I/O, UI, dynamic object models and long-lived object graphs as outside its scope. Physics is numeric and hot, so it moves to wasm. Everything else stays JavaScript, where it is clear and cheap to change.

## Build and runtime

- `scripts/build-kernel.mjs` compiles `src/kernel/kernel.js` and its modules into `dist/kernel.wasm` through `jz`. It runs on install, pack and test.
- `src/kernel/load.js` compiles the bytes to a `WebAssembly.Module` once per process and instantiates it through `jz/interop` for each world. The compiler never runs at runtime.
- Each `World` owns its instance and therefore its linear memory. Its arrays are created with `memory.Float64Array(n)` and `memory.Int32Array(n)`, which return pinned handles. The kernel reads and writes them in place, so a tick copies nothing across the JavaScript boundary.
- One call to `step` runs a full tick: integrate, then `solverIterations` passes of ground, boxes and pairs.

## Determinism

- The world advances in fixed ticks (default 64 Hz). `advance` carries the remainder and caps catch-up at 8 ticks, so a stall drops time rather than spiralling.
- The same spawn and step schedule gives identical positions, velocities and hashes. The world suite checks this across two worlds.
- `hash()` folds the exact IEEE-754 bits of every position and velocity through FNV-1a. A change of one ulp changes it.

## Contacts

- Bodies are spheres of one radius. Static geometry is the ground plane at y = 0 and axis-aligned boxes.
- Restitution applies only to impacts faster than 1 m/s. Slower contacts remove the normal velocity, so a resting body settles instead of micro-bouncing.
- Body pairs use a spatial hash grid. Cells are as wide as the contact diameter. Each body records its cell at the start of the pass. A candidate is accepted only when its recorded cell is the one being searched, so a bucket collision never duplicates or drops a pair. The bucket table holds two buckets per body, with a minimum of 64.
- The solver runs `solverIterations` passes per tick (default 8). In the stack test, a chain of five overlapping bodies has a 0.19 m overlap after one pass, about 0.014 m after eight, and 0.0005 m after sixteen. Sixteen or more passes are needed when exact stacking matters.

## Measured cost

Measured with `npm run bench` on Node 24, 8 solver iterations, 200 measured ticks after 30 warm-up ticks, bodies falling in a 60 m square above a box floor. Numbers are from one development machine; rerun them on the target before relying on them.

| Bodies | Mean tick | Ticks per second |
|---|---|---|
| 500 | 5.8 ms | 173 |
| 2000 | 27 ms | 37 |
| 5000 | 71 ms | 14 |

The budget at 64 Hz is 15.6 ms per tick, so this kernel fits it up to roughly 1000 bodies with eight iterations. Four iterations roughly halves the pair cost. The cost is per typed-array access in the compiled wasm, not warm-up: `--no-liftoff` changes nothing.

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

Each lands as a host module over the existing kernel, without changing kernel signatures unless a test shows a kernel defect.
