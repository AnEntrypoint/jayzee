# jayzee

Deterministic physics kernels and netcode boundaries for multiplayer games, rebuilt on [jz](https://github.com/dy/jz).

Numeric physics is written as plain JavaScript over typed arrays, compiled ahead of time to WebAssembly by jz, and driven by a small JavaScript host. The host owns the fixed-step clock, the body table and the wire formats.

## Install

```sh
npm install jayzee
```

The install step compiles the kernel to ```dist/kernel.wasm``` (about 20 seconds, once). At runtime nothing compiles.

## Use

```js
import { World, encodeInputs, decodeInputs, encodeSnapshot, decodeSnapshot } from 'jayzee'

const world = new World({ tickRate: 64, gravity: -18, radius: 0.35, boxes: [[-2, 0, -2, 2, 1, 2]] })
const hero = world.spawn([0, 4, 0])
world.advance(1 / 64)
world.position(hero)

const packet = encodeInputs([{ sequence: 1, moveX: 0.5, moveZ: 0, yaw: 0, buttons: 0b1 }])
decodeInputs(packet)

const frame = encodeSnapshot(world.snapshot())
decodeSnapshot(frame)
```

## API

| Export | Purpose |
|---|---|
| ```World``` | Fixed-step simulation of sphere bodies against a ground plane and static boxes |
| ```World#spawn(position, velocity?)``` | Adds a body and returns its id |
| ```World#advance(seconds)``` | Runs whole fixed ticks, carries the remainder, returns the steps taken |
| ```World#step()``` | Runs exactly one fixed tick |
| ```World#hash()``` | Digest of positions and velocities, for replay checks |
| ```encodeInputs``` / ```decodeInputs``` | Versioned binary input packets |
| ```encodeSnapshot``` / ```decodeSnapshot``` | Versioned binary snapshots, float32 positions |
| ```loadKernel``` | The instantiated wasm kernel, for direct use |

## Test

```sh
npm test
```

The test script rebuilds the kernel, then runs the kernel, world and protocol suites.

`advance` runs at most 8 ticks per call. Longer frames drop the excess time instead of catching up.

See `docs/ARCHITECTURE.md` for the layering and what is not yet ported from spoint.
