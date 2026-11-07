# jayzee

Deterministic physics for multiplayer games. Numeric kernels are written in plain JavaScript over typed arrays, compiled ahead of time to WebAssembly by [jz](https://github.com/dy/jz), and driven by a small JavaScript host that owns the fixed-step clock, the body table and the wire formats.

## Install

```sh
npm install jayzee
```

Installing runs the kernel build once (about 10 to 20 seconds) and writes `dist/kernel.wasm`. At runtime nothing compiles: each `World` instantiates the cached module with its own memory.

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

Types ship in `types/index.d.ts` and are checked by `npm run check:types`.

## Develop

```sh
npm test                       # rebuilds the kernel, then runs the suites
npm run check:types        # type-checks the declarations and a usage file
npm run bench -- 2000 200    # bodies, measured ticks
```

See `docs/ARCHITECTURE.md` for the layering, the measured costs and what is not yet ported from spoint.
