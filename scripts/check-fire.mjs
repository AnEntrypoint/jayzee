import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { createFireKernel, FIRE_STATE, FIRE_EVENT, FIRE_MAX_WIND_COMPONENT, TILE_AXIS_CELLS, FACE_FREE, FACE_COUNT } from '../src/fire/index.js'
import { FIRE_DIR_COUNT, FIRE_DIR_DI, FIRE_DIR_DJ } from '../src/fire/fireLattice.js'

const N = 24
const torusLattice = (n) => ({
  cellsPerFace: n,
  faceCount: 1,
  walk(face, I, J, di, dj, out) {
    out.face = 0
    out.I = ((I + di) % n + n) % n
    out.J = ((J + dj) % n + n) % n
    return out
  },
  windInFaceAxes(face, wx, wy, wz, out) {
    out[0] = wx
    out[1] = wy
    return out
  },
})
const classes = [
  {},
  { igniteHeat: 60, burnRate: 2, heatOut: 240, fuel: 40, spotChance: 1500, spotHeat: 200, smoke: 2, damage: 3 },
  { igniteHeat: 120, burnRate: 1, heatOut: 180, fuel: 90, smoke: 1, damage: 5 },
]
const fuelClassAt = (face, I, J) => (I % 6 === 5 ? 0 : (I + 2 * J) % 3 === 0 ? 2 : 1)
const makeKernel = (overrides = {}) => createFireKernel({ lattice: torusLattice(N), fuelClassAt, classes, ...overrides })
const runFrom = (kernel, from, to) => {
  const sums = []
  for (let t = from; t < to; t++) {
    kernel.tick(t)
    sums.push(kernel.checksum())
  }
  return sums
}
const run = (kernel, ticks) => runFrom(kernel, 0, ticks)
const neighbours = (I, J) => Array.from({ length: FIRE_DIR_COUNT }, (_, d) => [I + FIRE_DIR_DI[d], J + FIRE_DIR_DJ[d]])

gate('two kernels with identical inputs and seed give identical hashes, stats and snapshots', () => {
  const build = () => {
    const k = makeKernel({ seed: 7 })
    k.ignite(0, 0, 10, 10)
    k.setWind(0, 3, 1, 0)
    return k
  }
  const a = build(), b = build()
  assert.deepEqual(run(a, 600), run(b, 600))
  assert.deepEqual(a.stats, b.stats)
  assert.ok(a.stats.ignitions > 1, 'the run must spread fire to mean anything')
  assert.deepEqual(a.snapshot(), b.snapshot())
})

gate('every value in the kernel typed arrays is an integer within its declared width', () => {
  const k = makeKernel({ seed: 13 })
  k.ignite(0, 0, 10, 10)
  k.setWind(0, 3, -2, 0)
  k.setMoisture(0, 30)
  k.setRain(200, 40)
  const sums = run(k, 900)
  const s = k.snapshot()
  const widths = {
    state: [Uint8Array, 0, 255], cls: [Uint8Array, 0, 255], fuel: [Uint16Array, 0, 65535], heat: [Uint16Array, 0, 65535], timer: [Uint16Array, 0, 65535],
    tileFace: [Uint8Array, 0, 255], tileI: [Int32Array, -(2 ** 31), 2 ** 31 - 1], tileJ: [Int32Array, -(2 ** 31), 2 ** 31 - 1],
    maskLo: [Uint32Array, 0, 2 ** 32 - 1], maskHi: [Uint32Array, 0, 2 ** 32 - 1], tileListed: [Uint8Array, 0, 1],
    interiorLo: [Uint32Array, 0, 2 ** 32 - 1], interiorHi: [Uint32Array, 0, 2 ** 32 - 1],
    activeTiles: [Int32Array, -(2 ** 31), 2 ** 31 - 1], scar: [Int32Array, -(2 ** 31), 2 ** 31 - 1],
    classFuel: [Uint16Array, 0, 65535], wind: [Int32Array, -(2 ** 31), 2 ** 31 - 1],
  }
  let checked = 0
  for (const [name, [type, min, max]] of Object.entries(widths)) {
    const arr = s[name]
    assert.ok(arr instanceof type, name + ' is not a ' + type.name)
    for (const v of arr) {
      assert.ok(Number.isInteger(v) && v >= min && v <= max, name + ' holds ' + v)
      checked++
    }
  }
  assert.ok(checked > 1000, 'the run must leave enough state to check')
  assert.ok(sums.every(v => Number.isInteger(v) && v >= 0 && v <= 0xffffffff), 'checksum is not a uint32')
  assert.ok(Object.values(k.stats).every(Number.isInteger), 'a stats counter is not an integer')
})

gate('a different seed gives a different hash sequence', () => {
  const build = (seed) => {
    const k = makeKernel({ seed })
    k.ignite(0, 0, 10, 10)
    k.setWind(0, 3, 1, 0)
    return run(k, 600)
  }
  assert.notDeepEqual(build(1), build(2))
})

gate('igniting one cell spreads to a flammable neighbour within 600 ticks', () => {
  const k = makeKernel({ seed: 1 })
  k.ignite(0, 0, 10, 10)
  const flammable = neighbours(10, 10).filter(([I, J]) => fuelClassAt(0, I, J) !== 0)
  assert.ok(flammable.length > 0)
  let spread = null
  for (let t = 0; t < 600 && spread === null; t++) {
    k.tick(t)
    spread = flammable.find(([I, J]) => k.stateCodeAt(0, I, J) !== FIRE_STATE.UNBURNT) ?? null
  }
  assert.ok(spread !== null, 'no neighbour of (10, 10) caught fire')
  assert.notEqual(k.stateCodeAt(0, 10, 10), FIRE_STATE.UNBURNT)
})

gate('a high rain value burns fewer cells than the same run without rain, and the ignited cell still burns out', () => {
  const burn = (rain) => {
    const k = makeKernel({ seed: 9 })
    k.ignite(0, 0, 10, 10)
    k.setWind(0, 2, 2, 0)
    if (rain > 0) k.setRain(0, rain)
    run(k, 3000)
    return { ignitions: k.stats.ignitions, origin: k.stateCodeAt(0, 10, 10) }
  }
  const dry = burn(0), wet = burn(255)
  assert.ok(wet.ignitions < dry.ignitions, 'rain run ignited ' + wet.ignitions + ' cells, dry run ' + dry.ignitions)
  assert.equal(wet.origin, FIRE_STATE.BURNT)
})

gate('exported state, event and tile constants keep the spoint values', () => {
  assert.deepEqual({ ...FIRE_STATE }, { UNBURNT: 0, BURNING: 1, BURNT: 2 })
  assert.deepEqual({ ...FIRE_EVENT }, { IGNITE: 0, EXTINGUISH: 1, WIND: 2, MOISTURE: 3, RAIN: 4, IGNITE_AREA: 5 })
  assert.ok(Object.isFrozen(FIRE_STATE) && Object.isFrozen(FIRE_EVENT))
  assert.equal(FIRE_MAX_WIND_COMPONENT, 16)
  assert.equal(TILE_AXIS_CELLS, 8)
  assert.equal(FACE_FREE, 255)
  assert.equal(FACE_COUNT, 6)
})

gate('the lattice direction tables list the eight unit steps, orthogonal first', () => {
  assert.equal(FIRE_DIR_COUNT, 8)
  assert.ok(FIRE_DIR_DI instanceof Int8Array && FIRE_DIR_DJ instanceof Int8Array)
  const pairs = Array.from({ length: FIRE_DIR_COUNT }, (_, d) => [FIRE_DIR_DI[d], FIRE_DIR_DJ[d]])
  assert.deepEqual(pairs, [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]])
})

gate('createFireKernel rejects malformed arguments with the spoint error types', () => {
  const lattice = torusLattice(N)
  assert.throws(() => createFireKernel({ fuelClassAt, classes }), TypeError)
  assert.throws(() => createFireKernel({ lattice, classes }), TypeError)
  assert.throws(() => createFireKernel({ lattice, fuelClassAt, classes: [{}] }), TypeError)
  assert.throws(() => makeKernel({ stepTicks: 1 }), RangeError)
  assert.throws(() => makeKernel({ softActiveCells: 100, maxActiveCells: 10 }), RangeError)
  assert.throws(() => createFireKernel({ lattice: torusLattice(0), fuelClassAt, classes }), RangeError)
})

gate('composed wind is clamped to the maximum component while the snapshot keeps the raw wind', () => {
  const k = makeKernel()
  k.setWind(0, 40, -40, 3)
  k.tick(0)
  assert.deepEqual(k.wind, [16, -16, 3])
  assert.deepEqual(Array.from(k.snapshot().wind), [40, -40, 3])
})

gate('windAt adds its per-step gust to the wind before the clamp', () => {
  const k = makeKernel({ windAt: (step, gust) => { gust[0] = 20; gust[1] = 0; gust[2] = 0 } })
  k.ignite(0, 0, 10, 10)
  k.tick(0)
  assert.deepEqual(k.wind, [16, 0, 0])
})

gate('queued events apply in tick order, and in id order within one tick', () => {
  const k = makeKernel()
  k.setWind(20, 1, 0, 0)
  k.setWind(10, 5, 0, 0)
  run(k, 31)
  assert.deepEqual(k.wind, [1, 0, 0])
  const j = makeKernel()
  j.setWind(0, 5, 0, 0, 1)
  j.setWind(0, 2, 0, 0, 0)
  j.tick(0)
  assert.deepEqual(j.wind, [5, 0, 0])
})

gate('a queued extinguish puts out a burning cell at the next step boundary', () => {
  const after60 = (extinguish) => {
    const k = makeKernel()
    k.ignite(0, 0, 10, 10)
    if (extinguish) k.extinguish(30, 0, 10, 10, 1)
    run(k, 60)
    return k.stateCodeAt(0, 10, 10)
  }
  assert.equal(after60(false), FIRE_STATE.BURNING)
  assert.equal(after60(true), FIRE_STATE.BURNT)
})

gate('a queued moisture value raises the ignition threshold and so lowers the ignitions', () => {
  const ignitions = (moisture) => {
    const k = makeKernel({ seed: 3 })
    k.setMoisture(0, moisture)
    k.ignite(0, 0, 10, 10)
    run(k, 600)
    return k.stats.ignitions
  }
  const dry = ignitions(0), damp = ignitions(127)
  assert.ok(damp < dry, 'damp run ignited ' + damp + ', dry run ' + dry)
})

gate('cellState and stateCodeAt report an untouched cell without creating a tile', () => {
  const k = makeKernel()
  assert.deepEqual(k.cellState(0, 4, 4), { state: FIRE_STATE.UNBURNT, heat: 0, fuel: classes[fuelClassAt(0, 4, 4)].fuel })
  assert.equal(k.stateCodeAt(0, 4, 4), FIRE_STATE.UNBURNT)
  assert.equal(k.tileCount, 0)
  assert.equal(k.tileIndexOf(0, 0, 0), -1)
})

gate('readTileStage writes state, timer byte, class and a full alpha byte for each cell', () => {
  const k = makeKernel()
  k.ignite(0, 0, 6, 6)
  k.tick(0)
  const t = k.tileIndexOf(0, 0, 0)
  assert.ok(t >= 0)
  const out = new Uint8Array(TILE_AXIS_CELLS * TILE_AXIS_CELLS * 4)
  k.readTileStage(t, out, 0)
  const burning = (6 * TILE_AXIS_CELLS + 6) * 4
  assert.equal(out[burning], FIRE_STATE.BURNING)
  assert.equal(out[burning + 2], fuelClassAt(0, 6, 6))
  assert.equal(out[burning + 3], 255)
  assert.equal(out[0], FIRE_STATE.UNBURNT)
  assert.equal(out[0 + 1], 0)
  assert.equal(out[0 + 2], fuelClassAt(0, 0, 0))
})

gate('smokeAt and damageAt report the class value only for a burning cell', () => {
  const k = makeKernel()
  k.ignite(0, 0, 6, 6)
  k.tick(0)
  const c = fuelClassAt(0, 6, 6)
  assert.equal(k.smokeAt(0, 6, 6), classes[c].smoke)
  assert.equal(k.damageAt(0, 6, 6), classes[c].damage)
  assert.equal(k.smokeAt(0, 0, 0), 0)
  assert.equal(k.damageAt(0, 0, 0), 0)
})

gate('a snapshot restored into a fresh kernel continues with the same hashes', () => {
  const a = makeKernel({ seed: 6 })
  a.ignite(0, 0, 10, 10)
  a.setWind(0, 2, 0, 0)
  const at200 = run(a, 200).at(-1)
  const snap = a.snapshot()
  const original = runFrom(a, 200, 400)
  const b = makeKernel({ seed: 6 })
  b.restore(snap)
  assert.equal(b.checksum(), at200)
  assert.deepEqual(runFrom(b, 200, 400), original)
})

gate('takeDelta then undoDelta returns the kernel to the checksum it had before the step', () => {
  const k = makeKernel({ seed: 4 })
  k.ignite(0, 0, 10, 10)
  run(k, 30)
  k.releaseDelta(k.takeDelta())
  const before = k.checksum()
  runFrom(k, 30, 60)
  const after = k.checksum()
  const d = k.takeDelta()
  assert.notEqual(after, before)
  k.undoDelta(d)
  k.releaseDelta(d)
  assert.equal(k.checksum(), before)
})

gate('takeDelta refuses a kernel created with undo disabled', () => {
  assert.throws(() => makeKernel({ undo: false }).takeDelta(), TypeError)
})

gate('undoOpenStep reverts the step that was last started, and reports false once none is open', () => {
  const k = makeKernel({ seed: 4 })
  k.ignite(0, 0, 10, 10)
  run(k, 30)
  k.releaseDelta(k.takeDelta())
  const before = k.checksum()
  runFrom(k, 30, 60)
  assert.notEqual(k.checksum(), before)
  assert.equal(k.undoOpenStep(), true)
  assert.equal(k.checksum(), before)
  assert.equal(k.undoOpenStep(), false)
})

gate('markRestored closes the open step and replaces the pending events', () => {
  const k = makeKernel()
  k.ignite(0, 0, 10, 10)
  k.tick(0)
  k.queueEvent({ kind: FIRE_EVENT.RAIN, tick: 500, value: 3, id: 99 })
  k.markRestored([])
  assert.equal(k.undoOpenStep(), false)
  assert.equal(k.snapshot().pending.length, 0)
})

gate('runStepUnsliced gives the same checksum as the sliced tick path at each step end', () => {
  const build = () => {
    const k = makeKernel({ seed: 2 })
    k.ignite(0, 0, 8, 8)
    k.setWind(0, 1, 0, 0)
    return k
  }
  const sliced = build(), whole = build()
  for (let s = 0; s < 12; s++) {
    const t0 = s * 30
    for (let t = t0; t < t0 + 30; t++) sliced.tick(t)
    whole.runStepUnsliced(t0)
    assert.equal(whole.checksum(), sliced.checksum(), 'step ' + s)
  }
})

gate('atBoundary is true only on a step boundary while the kernel is between steps', () => {
  const k = makeKernel()
  assert.equal(k.atBoundary(0), true)
  assert.equal(k.atBoundary(15), false)
  k.ignite(0, 0, 10, 10)
  k.tick(0)
  assert.equal(k.atBoundary(30), false)
})

gate('stepIndex and stats.steps count each step started while the fire is active', () => {
  const k = makeKernel()
  k.ignite(0, 0, 10, 10)
  run(k, 90)
  assert.equal(k.stepIndex, 3)
  assert.equal(k.stats.steps, 3)
})

gate('after the whole lattice is extinguished and regrows, every tile is reclaimed', () => {
  const k = makeKernel({ seed: 5, regrowSteps: 2 })
  k.ignite(0, 0, 10, 10)
  run(k, 1200)
  k.extinguish(1200, 0, 10, 10, 12)
  runFrom(k, 1200, 6000)
  assert.ok(k.reclaimCounters.released > 0, 'no tile was reclaimed')
  assert.equal(k.liveTileCount, 0)
  assert.equal(k.tileCount, 0)
})

gate('memoryBytes sums the typed-array byte lengths at the default capacities', () => {
  assert.equal(makeKernel().memoryBytes, 4407808)
})

gate('ignition advances the change serial and the serial of the touched tile', () => {
  const k = makeKernel()
  k.ignite(0, 0, 10, 10)
  const before = k.changeSerial
  k.tick(0)
  const t = k.tileIndexOf(0, 1, 1)
  assert.ok(t >= 0)
  assert.ok(k.changeSerial > before)
  assert.ok(k.tileSerialOf(t) > before)
})

finish()
