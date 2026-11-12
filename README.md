# jayzee

Deterministic physics for multiplayer games. Numeric kernels are written in plain JavaScript over typed arrays, compiled ahead of time to WebAssembly by [jz](https://github.com/dy/jz), and driven by a small JavaScript host that owns the fixed-step clock, the body table and the wire formats.

## Install

```sh
npm install jayzee
```

The package ships `dist/kernel.wasm` prebuilt (16 KB). jz is a build-time dependency only: at runtime nothing compiles and nothing is imported, and each `World` instantiates the cached module with its own memory through the plain WebAssembly API. A checkout builds the kernel on `npm install` (about 5 seconds).

## Use

```ts
import { World, encodeInputs, decodeInputs, encodeSnapshot, decodeSnapshot } from "jayzee"

const world = new World({ tickRate: 64, gravity: -18, radius: 0.35, boxes: [[-2, 0, -2, 2, 1, 2]] })
const hero = world.spawn([0, 4, 0])
world.advance(1 / 64)
world.position(hero)

const packet = encodeInputs([{ sequence: 1, moveX: 0.5, moveZ: 0, yaw: 0, buttons: 0b1 }])
decodeInputs(packet)

const frame = encodeSnapshot(world.snapshot())
decodeSnapshot(frame)
```

`advance` runs at most 8 ticks per call. Longer frames drop the excess time instead of catching up.

## API

| Export | Purpose |
|---|---|
| `World` | Fixed-step simulation of sphere bodies against a ground plane and static boxes |
| `new World({ ... })` | Options: `capacity, tickRate, gravity, drag, radius, restitution, solverIterations, boxes` |
| `World#spawn(position, velocity?)` | Adds a body and returns its id |
| `World#advance(seconds)` | Runs whole fixed ticks, carries the remainder, returns the steps taken |
| `World#step()` | Runs exactly one fixed tick |
| `World#hash()` | FNV-1a digest of the exact float64 bits of positions and velocities |
| `World#snapshot()` | Tick, count and a copy of the positions |
| `encodeInputs` / `decodeInputs` | Versioned binary input packets |
| `encodeSnapshot` / `decodeSnapshot` | Versioned binary snapshots, float32 positions |
| `encodeState` / `decodeState` | Versioned lossless state, float64 positions and velocities |
| `encodeDelta` / `decodeDelta` | Versioned lossless state deltas against an acknowledged base |
| `encodeAck` / `decodeAck` | Versioned acknowledgement of the newest received tick |
| `StateSender` / `StateReceiver` | Snapshot stream: acknowledged delta bases with full-state fallback |
| `InputBuffer` | Per-player input queue: reordering, duplicates, holds on gaps |
| `Predictor` | Client prediction and reconciliation against authoritative states |
| `Authority` | Server side: one input per player per tick, then a world step |
| `World#exportState` / `importState` | Lossless state round trip for a world |

Types ship in `types/index.d.ts` and are checked by `npm run check:types`.

## Develop

```sh
npm test                     # rebuilds the kernel, then runs every gate below
npm run check:kernel         # kernel behaviour against the real build
npm run check:world          # world stepping, contacts and state round trips
npm run check:protocol       # codec round trips and rejected input
npm run check:netcode        # prediction witness under loss and latency
npm run check:snapshots      # delta and acknowledgement witness under loss
npm run check:types          # type-checks the declarations and a usage file
npm run bench -- 2000 200    # bodies, measured ticks
```

Verification is by gate scripts under `scripts/`, not unit tests. Each gate prints PASS or FAIL lines and exits non-zero on failure.

See `docs/ARCHITECTURE.md` for the layering, the measured costs and what is not yet ported from spoint.
