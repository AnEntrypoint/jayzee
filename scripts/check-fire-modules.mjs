import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import {
  createFireKernel, FIRE_STATE, FIRE_EVENT, FACE_COUNT,
  cubeFaceOf, createFireLattice, createKeyframeEncoder, encodeFireKeyframe, decodeFireKeyframe, keyframeToBase64, keyframeFromBase64, validateFireSnapshot,
  createFireTimeline, encodeFireEvent, decodeFireEvent, FIRE_WIRE_TYPE, FIRE_SEQ_RANGE,
  createWindField, rayOpticalDepth, sampledOpticalDepth, createFireStageMap, burnMaskWindow,
  DEFAULT_FIRE_GAMEPLAY, resolveFireSpec, createFirebreakFuel, createFireWeather, createFireGameplay,
  checkFireCell, checkFireByte, igniteAreaRadiusCells, extinguishRadiusCells, checkExtinguishRadiusCells, checkWindVector, parseKeyframeRow, parseChecksumRow, createChecksumLedger,
} from '../src/fire/index.js'

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
const ignition = (tick, I, J, id) => ({ kind: FIRE_EVENT.IGNITE, tick, face: 0, I, J, source: 0, id })

const AXIS_OF = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
const FACES = [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1]]
function faceBasis(f) {
  const [a, s] = FACES[f]
  const u = AXIS_OF[(a + 1) % 3], v = AXIS_OF[(a + 2) % 3]
  const sign = s
  const n = AXIS_OF[a].map(c => c * s)
  return { n, u: u.map(c => c * sign), v }
}
function makePlacement(cellsPerFace, cellsPerChunk) {
  const cellAngle = (Math.PI / 2) / cellsPerFace
  const cellDir = (face, fu, fv, out) => {
    const { n, u, v } = faceBasis(face)
    const tu = Math.tan(fu * cellAngle - Math.PI / 4), tv = Math.tan(fv * cellAngle - Math.PI / 4)
    const x = n[0] + tu * u[0] + tv * v[0], y = n[1] + tu * u[1] + tv * v[1], z = n[2] + tu * u[2] + tv * v[2]
    const l = Math.hypot(x, y, z)
    out[0] = x / l; out[1] = y / l; out[2] = z / l
    return out
  }
  return { cellsPerFace, cellsPerChunk, cellAngle, cellM: 1, cellDir }
}

const refuse = (fn, type, fragment) => {
  let caught = null
  try { fn() } catch (error) { caught = error }
  assert.ok(caught, `expected a throw containing "${fragment}"`)
  assert.ok(caught instanceof type, `expected ${type.name}, got ${caught.constructor.name}: ${caught.message}`)
  assert.ok(caught.message.includes(fragment), `message "${caught.message}" lacks "${fragment}"`)
}

const lattice2 = createFireLattice(makePlacement(8, 2), 2)
const lattice1 = createFireLattice(makePlacement(8, 2), 1)

gate('cubeFaceOf maps each axis direction to its cube face and breaks ties toward x then y', () => {
  assert.equal(cubeFaceOf(1, 0, 0), 0)
  assert.equal(cubeFaceOf(-1, 0, 0), 1)
  assert.equal(cubeFaceOf(0, 1, 0), 2)
  assert.equal(cubeFaceOf(0, -1, 0), 3)
  assert.equal(cubeFaceOf(0, 0, 1), 4)
  assert.equal(cubeFaceOf(0, 0, -1), 5)
  assert.equal(cubeFaceOf(1, 1, 0), 0)
  assert.equal(cubeFaceOf(0, 1, 1), 2)
  for (const [x, y, z] of [[0.3, -0.9, 0.2], [-2, 1, 1], [0, 0, 0]]) assert.ok(Number.isInteger(cubeFaceOf(x, y, z)))
})

gate('createFireLattice refuses a fire cell that does not divide the placement chunk', () => {
  refuse(() => createFireLattice(makePlacement(8, 2), 3), RangeError, '[fireLattice] cellsPerFireCell must divide')
  refuse(() => createFireLattice(makePlacement(8, 2), 0), RangeError, '[fireLattice] cellsPerFireCell must divide')
  refuse(() => createFireLattice(makePlacement(8, 2), 1.5), RangeError, '[fireLattice] cellsPerFireCell must divide')
})

gate('createFireLattice keys round trip and reports the coarsened extent', () => {
  assert.equal(lattice2.cellsPerFace, 4)
  assert.equal(lattice2.faceCount, FACE_COUNT)
  assert.equal(lattice2.cellM, 2)
  for (let f = 0; f < FACE_COUNT; f++) for (let I = 0; I < 4; I++) for (let J = 0; J < 4; J++) {
    const key = lattice2.cellKey(f, I, J)
    assert.ok(Number.isInteger(key) && key >= 0 && key < FACE_COUNT * 16)
    assert.deepEqual({ ...lattice2.cellOfKey(key, {}) }, { face: f, I, J })
  }
})

gate('createFireLattice cellOfDir returns the cell whose centre direction it was given', () => {
  const centre = [0, 0, 0]
  for (let f = 0; f < FACE_COUNT; f++) for (let I = 0; I < 8; I++) for (let J = 0; J < 8; J++) {
    lattice1.cellCentreDir(f, I, J, centre)
    const c = lattice1.cellOfDir(centre[0], centre[1], centre[2], {})
    assert.deepEqual({ ...c }, { face: f, I, J }, `centre of ${f},${I},${J}`)
  }
})

gate('createFireLattice walk across a cube edge is symmetric: every step has a step back to its origin', () => {
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]]
  let crossings = 0
  for (let f = 0; f < FACE_COUNT; f++) for (let I = 0; I < 8; I++) for (let J = 0; J < 8; J++) {
    for (const [di, dj] of dirs) {
      const w = lattice1.walk(f, I, J, di, dj, {})
      const q = { ...w }
      if (q.face !== f) crossings++
      const back = dirs.some(([ei, ej]) => {
        const r = lattice1.walk(q.face, q.I, q.J, ei, ej, {})
        return r.face === f && r.I === I && r.J === J
      })
      assert.ok(back, `walk ${f},${I},${J} by ${di},${dj} to ${q.face},${q.I},${q.J} has no step back`)
    }
  }
  assert.ok(crossings > 0)
})

gate('createFireLattice cellOfPlacementId maps placement cells onto coarse fire cells by integer division', () => {
  const c = lattice2.cellOfPlacementId(1 * 64 + 5 * 8 + 6, {})
  assert.deepEqual({ ...c }, { face: 1, I: 2, J: 3 })
  const d = lattice2.cellOfPlacementId(0, {})
  assert.deepEqual({ ...d }, { face: 0, I: 0, J: 0 })
})

gate('createWindField is deterministic per seed, stays within the amplitude and holds across a period', () => {
  const field = createWindField({ seed: 7, amplitude: 4, periodSteps: 1 })
  const out = [0, 0, 0]
  for (let step = 0; step < 200; step++) {
    const v = field(step, out)
    assert.equal(v, out)
    for (const c of v) assert.ok(Number.isInteger(c) && c >= -4 && c <= 4, `component ${c}`)
  }
  const a = [...createWindField({ seed: 9 })(3, [0, 0, 0])]
  const b = [...createWindField({ seed: 9 })(3, [0, 0, 0])]
  assert.deepEqual(a, b)
  const banded = createWindField({ seed: 7, amplitude: 4, periodSteps: 5 })
  assert.deepEqual([...banded(0, [0, 0, 0])], [...banded(4, [0, 0, 0])])
  assert.deepEqual([...banded(5, [0, 0, 0])], [...banded(9, [0, 0, 0])])
})

gate('fireWire encodes and decodes every event kind to the same fields', () => {
  const cases = [
    { kind: FIRE_EVENT.IGNITE, tick: 100, seq: 3, face: 2, I: 1, J: 3, source: 200 },
    { kind: FIRE_EVENT.EXTINGUISH, tick: 7, seq: 0, face: 5, I: 0, J: 2, radius: 16 },
    { kind: FIRE_EVENT.IGNITE_AREA, tick: 8, seq: 4095, face: 0, I: 3, J: 3, radius: 8 },
    { kind: FIRE_EVENT.WIND, tick: 9, seq: 1, wx: -16, wy: 0, wz: 16 },
    { kind: FIRE_EVENT.MOISTURE, tick: 10, seq: 2, value: 255 },
    { kind: FIRE_EVENT.RAIN, tick: 11, seq: 5, value: 0 },
  ]
  for (const ev of cases) {
    const row = encodeFireEvent(lattice2, { ...ev, id: ev.tick * FIRE_SEQ_RANGE + ev.seq })
    const back = decodeFireEvent(lattice2, JSON.parse(JSON.stringify(row)))
    assert.equal(back.kind, ev.kind)
    assert.equal(back.tick, ev.tick)
    assert.equal(back.seq, ev.seq)
    assert.equal(back.id, ev.tick * FIRE_SEQ_RANGE + ev.seq)
    for (const f of ['face', 'I', 'J', 'source', 'radius', 'wx', 'wy', 'wz', 'value']) if (ev[f] !== undefined) assert.equal(back[f], ev[f], f)
  }
})

gate('fireWire refuses malformed rows with the malformed fire event message', () => {
  const bad = [
    [9, 1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, -1, 0, 0, 0],
    [0, 1, FIRE_SEQ_RANGE, 0, 0],
    [0, 1, 0, 0, 256],
    [1, 1, 0, 0, 17],
    [5, 1, 0, 0, 9],
    [2, 1, 0, 17, 0, 0],
    [2, 1, 0, 1.5, 0, 0],
    [0, 1, 0, 6 * 4 * 4, 0],
    [3, 1, 0, 256],
    'not-a-row',
  ]
  for (const row of bad) refuse(() => decodeFireEvent(lattice2, row), TypeError, '[fire] malformed fire event')
  refuse(() => encodeFireEvent(lattice2, { kind: 99, tick: 1, seq: 0, id: 1 }), TypeError, '[fire] cannot encode event kind 99')
})

const kernelAfterIgnition = () => {
  const k = makeKernel()
  k.queueEvent(ignition(0, 12, 12, 1))
  for (let t = 0; t < 40; t++) k.tick(t)
  return k
}

gate('fireKeyframe round trips a live kernel snapshot and restores to the same checksum', () => {
  const k = kernelAfterIgnition()
  const snap = k.snapshot()
  const bytes = encodeFireKeyframe({ tick: 40, snapshot: snap, log: [] })
  const decoded = decodeFireKeyframe(bytes)
  assert.equal(decoded.tick, 40)
  assert.equal(decoded.snapshot.tileCount, snap.tileCount)
  assert.equal(decoded.snapshot.activeCount, snap.activeCount)
  assert.equal(decoded.snapshot.scarCount, snap.scarCount)
  const fresh = makeKernel()
  fresh.restore(decoded.snapshot)
  assert.equal(fresh.checksum(), k.checksum())
})

gate('fireKeyframe budgeted encoding yields the same bytes as the one-shot encoding', () => {
  const snap = kernelAfterIgnition().snapshot()
  const once = encodeFireKeyframe({ tick: 40, snapshot: snap, log: [] })
  const encoder = createKeyframeEncoder({ tick: 40, snapshot: snap, logOf: () => [] })
  let slices = 0
  while (!encoder.advance(0.05)) { slices++; assert.ok(slices < 1e6, 'encoder never finished') }
  assert.deepEqual(Buffer.from(encoder.bytes), Buffer.from(once))
  assert.equal(encoder.base64, keyframeToBase64(once))
  assert.deepEqual(Buffer.from(keyframeFromBase64(encoder.base64)), Buffer.from(once))
})

gate('fireKeyframe refuses a tampered payload with a [fireKeyframe] checksum error', () => {
  const bytes = encodeFireKeyframe({ tick: 40, snapshot: kernelAfterIgnition().snapshot(), log: [] })
  const flipped = Uint8Array.from(bytes)
  flipped[flipped.length - 1] ^= 0x5a
  refuse(() => decodeFireKeyframe(flipped), TypeError, '[fireKeyframe] keyframe checksum mismatch')
  const magic = Uint8Array.from(bytes)
  magic[0] ^= 0xff
  refuse(() => decodeFireKeyframe(magic), TypeError, '[fireKeyframe] keyframe magic mismatch')
  const longer = new Uint8Array(bytes.length + 1)
  longer.set(bytes)
  refuse(() => decodeFireKeyframe(longer), TypeError, '[fireKeyframe] keyframe declares')
  refuse(() => decodeFireKeyframe(bytes.subarray(0, 10)), TypeError, '[fireKeyframe] keyframe is 10 B, too short')
  refuse(() => decodeFireKeyframe([1, 2, 3]), TypeError, '[fireKeyframe] keyframe must be a Uint8Array')
  refuse(() => createKeyframeEncoder({ tick: 1, snapshot: null }), TypeError, '[fireKeyframe] a keyframe needs a snapshot')
  refuse(() => keyframeFromBase64(''), TypeError, '[fireKeyframe] keyframe payload must be a base64 string')
})

gate('validateFireSnapshot accepts a live snapshot and names the first field it cannot restore', () => {
  const snap = kernelAfterIgnition().snapshot()
  assert.deepEqual(validateFireSnapshot(snap, { cellsPerFace: N, cellCapacity: Infinity }), { ok: true })
  assert.equal(validateFireSnapshot(snap, { cellsPerFace: N + 1 }).reason, 'lattice-mismatch')
  assert.equal(validateFireSnapshot({ ...snap, classFuel: undefined }).reason, 'no-classFuel')
  assert.equal(validateFireSnapshot({ ...snap, wind: null }).reason, 'no-wind')
  assert.equal(validateFireSnapshot({ ...snap, pending: null }).reason, 'no-pending')
  assert.equal(validateFireSnapshot({ ...snap, cls: new Uint16Array(snap.cls) }).reason, 'narrow-cls')
  assert.equal(validateFireSnapshot(null).reason, 'not-a-snapshot')
})

gate('fireTimeline refuses a missing kernel and a window below one step', () => {
  refuse(() => createFireTimeline({}), TypeError, '[fireTimeline] kernel is required')
  refuse(() => createFireTimeline({ kernel: makeKernel(), windowSteps: 0 }), RangeError, '[fireTimeline] windowSteps must be a positive integer')
  refuse(() => createFireTimeline({ kernel: makeKernel(), windowSteps: 2.5 }), RangeError, '[fireTimeline] windowSteps must be a positive integer')
})

gate('fireTimeline keeps the log ordered by tick then id and drops a repeated id', () => {
  const tl = createFireTimeline({ kernel: makeKernel() })
  tl.startAt(0)
  tl.submit(ignition(9, 1, 1, 3))
  tl.submit(ignition(5, 2, 2, 2))
  tl.submit(ignition(5, 3, 3, 1))
  assert.deepEqual(tl.log.map(e => e.id), [1, 2, 3])
  assert.deepEqual(tl.log.map(e => e.tick), [5, 5, 9])
  assert.deepEqual(tl.submit(ignition(9, 1, 1, 3)), { ok: true, duplicate: true, rewound: false })
})

gate('fireTimeline refuses startAt once the timeline has advanced', () => {
  const tl = createFireTimeline({ kernel: makeKernel() })
  tl.startAt(0)
  tl.advanceTo(1)
  refuse(() => tl.startAt(0), Error, '[fireTimeline] startAt only applies to an empty timeline')
})

gate('fireTimeline rewinds to a late event and replays to the straight-through checksum', () => {
  const ev = ignition(45, 10, 10, 7)
  const straight = makeKernel()
  straight.queueEvent({ ...ev })
  for (let t = 1; t <= 100; t++) straight.tick(t)
  const tl = createFireTimeline({ kernel: makeKernel(), windowSteps: 4 })
  tl.startAt(0)
  tl.advanceTo(100)
  const r = tl.submit(ev)
  assert.equal(r.ok, true)
  assert.equal(r.rewound, true)
  assert.equal(tl.stats.rewinds, 1)
  assert.equal(tl.tick, 100)
  assert.equal(tl.checksum(), straight.checksum())
})

gate('fireTimeline refuses a late event when rewind is disabled or the event falls outside the window', () => {
  const off = createFireTimeline({ kernel: makeKernel(), keepSnapshots: false })
  off.startAt(0)
  off.advanceTo(40)
  assert.deepEqual(off.submit(ignition(10, 1, 1, 1)), { ok: false, reason: 'rewind-disabled', restored: false, id: 1 })
  const narrow = createFireTimeline({ kernel: makeKernel(), windowSteps: 1 })
  narrow.startAt(0)
  narrow.advanceTo(200)
  const late = narrow.submit(ignition(5, 1, 1, 2))
  assert.equal(late.ok, false)
  assert.equal(late.reason, 'beyond-window')
})

gate('fireStageMap refuses a lattice smaller than one tile', () => {
  refuse(() => createFireStageMap({ kernel: makeKernel(), lattice: { cellsPerFace: 4 } }), RangeError, '[fireStageMap] lattice too small')
})

gate('fireStageMap assigns tile slots, reference counts texels and refuses a full slot table', () => {
  const kernel = makeKernel()
  const lattice = torusLattice(N)
  const sm = createFireStageMap({ kernel, lattice })
  const slot = sm.acquire(0, 1, 1)
  assert.equal(sm.acquire(0, 1, 1), slot)
  assert.equal(sm.watchedTiles, 1)
  const value = sm.slotValueOfCell(0, 9, 10)
  const { x, y } = sm.texelOf(value, {})
  const origin = sm.blockOrigin(slot)
  assert.deepEqual({ x, y }, { x: origin.x + (9 & 7), y: origin.y + (10 & 7) })
  assert.equal(sm.slotValueOfCell(0, 0, 0), -1)
  assert.equal(sm.release(0, 1, 1), true)
  assert.notEqual(sm.slotValueOfCell(0, 9, 10), -1)
  assert.equal(sm.release(0, 1, 1), true)
  assert.equal(sm.slotValueOfCell(0, 9, 10), -1)
  assert.equal(sm.release(0, 1, 1), false)
  const tiny = createFireStageMap({ kernel, lattice, slotsAcross: 1, slotsDown: 1 })
  tiny.acquire(0, 0, 0)
  refuse(() => tiny.acquire(0, 1, 0), RangeError, '[fireStageMap] all 1 tile slots are in use')
})

gate('fireStageMap copies a synced tile byte for byte from the kernel stage read', () => {
  const kernel = kernelAfterIgnition()
  const lattice = torusLattice(N)
  const sm = createFireStageMap({ kernel, lattice })
  const slot = sm.acquire(0, 1, 1)
  const changed = sm.sync()
  assert.equal(changed, 1)
  assert.equal(sm.sync(), 0)
  const t = kernel.tileIndexOf(0, 1, 1)
  assert.ok(t >= 0)
  const stage = new Uint8Array(64 * 4)
  kernel.readTileStage(t, stage, 0)
  const { x: bx, y: by } = sm.blockOrigin(slot)
  for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) for (let c = 0; c < 4; c++) {
    assert.equal(sm.data[((by + row) * sm.width + bx + col) * 4 + c], stage[(row * 8 + col) * 4 + c], `texel ${row},${col} channel ${c}`)
  }
  assert.equal(sm.stats.syncs, 2)
})

gate('burnMaskWindow writes 255, 128 or 0 per cell and counts every lit cell', () => {
  const kernel = kernelAfterIgnition()
  const out = new Uint8Array(16 * 16)
  const lit = burnMaskWindow(kernel, 0, 8, 8, 16, 16, out)
  let expectLit = 0
  for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) {
    const state = kernel.stateCodeAt(0, 8 + i, 8 + j)
    const want = state === 2 ? 255 : state === 1 ? 128 : 0
    assert.equal(out[j * 16 + i], want)
    if (state !== 0) expectLit++
  }
  assert.equal(lit, expectLit)
  assert.ok(lit > 0)
})

gate('rayOpticalDepth is zero when the ray starts above the plume and integrates density over a burning cell', () => {
  const kernel = makeKernel()
  assert.equal(rayOpticalDepth(kernel, 0, 10, 10, 10, 10, 10, 50, 0, 30, 1), 0)
  assert.equal(rayOpticalDepth(kernel, 0, 10, 10, 10, 10, 0, 0, 0, 30, 1), 0)
  for (let t = 0; t < 20 && kernel.stateCodeAt(0, 12, 12) !== FIRE_STATE.BURNING; t++) {
    if (t === 0) kernel.queueEvent(ignition(0, 12, 12, 1))
    kernel.tick(t)
  }
  const density = kernel.smokeAt(0, 12, 12)
  assert.ok(density > 0, 'the probed cell must be burning')
  const depth = rayOpticalDepth(kernel, 0, 12, 12, 12, 12, 10, 0, 0, 30, 1)
  assert.ok(Math.abs(depth - 20 * density * 0.5 / 255) < 1e-12, `depth ${depth}`)
})

gate('sampledOpticalDepth agrees with rayOpticalDepth over one cell and returns zero above the plume', () => {
  const kernel = makeKernel()
  kernel.queueEvent(ignition(0, 12, 12, 1))
  for (let t = 0; t < 20 && kernel.stateCodeAt(0, 12, 12) !== FIRE_STATE.BURNING; t++) kernel.tick(t)
  const frame = { localToDir: (x, y, z) => [x, y, z] }
  const lattice = { cellM: 1, cellOfDir(dx, dy, dz, out) { out.face = 0; out.I = 12; out.J = 12; return out } }
  const sampled = sampledOpticalDepth(kernel, lattice, frame, [0, 0, 0], [0, 1, 0], 10, 0, 30, { face: 0, I: 0, J: 0 })
  const ray = rayOpticalDepth(kernel, 0, 12, 12, 12, 12, 10, 0, 0, 30, 1)
  assert.ok(Math.abs(sampled - ray) < 1e-12, `${sampled} vs ${ray}`)
  assert.equal(sampledOpticalDepth(kernel, lattice, frame, [0, 0, 0], [0, 1, 0], 10, 50, 30, { face: 0, I: 0, J: 0 }), 0)
})

gate('resolveFireSpec resolves the defaults into one class table with the first class as the default', () => {
  const r = resolveFireSpec({})
  assert.equal(r.config.stepTicks, 30)
  assert.equal(r.config.windowSteps, 4)
  assert.deepEqual(r.names, ['grass', 'shrub', 'forest'])
  assert.equal(r.classes.length, 4)
  assert.equal(r.fuelClassAt(0, 0, 0), 1)
  assert.equal(r.role, 'authority')
  assert.equal(r.rewind, false)
  assert.deepEqual(r.wind, [0, 0, 0])
  assert.equal(resolveFireSpec({ role: 'mirror' }).rewind, true)
})

gate('resolveFireSpec refuses malformed specs with the [fire] message naming the field', () => {
  refuse(() => resolveFireSpec(null), TypeError, '[fire] spec must be an object')
  refuse(() => resolveFireSpec({ bogus: 1 }), TypeError, 'spec declares unknown key "bogus"')
  refuse(() => resolveFireSpec({ stepTicks: 1 }), TypeError, '[fire] spec.stepTicks must be an integer of at least 2, got 1')
  refuse(() => resolveFireSpec({ softActiveCells: 10, maxActiveCells: 5 }), TypeError, 'must not exceed spec.maxActiveCells')
  refuse(() => resolveFireSpec({ classes: { a: { fuel: 100, burnRate: 1, igniteHeat: 1, heatOut: 1 } }, regrowSteps: 50 }), TypeError, 'must exceed the 100 steps spec.classes.a burns for')
  refuse(() => resolveFireSpec({ windField: { amplitude: 0 } }), TypeError, 'spec.windField.amplitude must be an integer from 1 to 16, got 0')
  refuse(() => resolveFireSpec({ fuel: { default: 'nope' } }), TypeError, 'spec.fuel.default must name a class')
  refuse(() => resolveFireSpec({ role: 'bogus' }), TypeError, "spec.role must be 'authority' or 'mirror'")
  refuse(() => resolveFireSpec({ classes: { a: { fuel: 100, burnRate: 1, igniteHeat: 1, heatOut: 1, bogus: 2 } } }), TypeError, 'declares unknown key "bogus"')
})

gate('the fire helpers refuse out-of-range cells, bytes, radii and wind with the fire message', () => {
  refuse(() => checkFireCell(lattice2, 6, 0, 0, 'igniteCell'), RangeError, '[fire] igniteCell(6, 0, 0) is outside the lattice')
  refuse(() => checkFireByte(256, 'moisture'), RangeError, '[fire] moisture must be an integer from 0 to 255, got 256')
  refuse(() => igniteAreaRadiusCells(-1, 1), RangeError, '[fire] igniteArea radius must be a non-negative number of metres')
  refuse(() => extinguishRadiusCells(Infinity, 1), RangeError, '[fire] extinguish radius must be a non-negative number of metres')
  refuse(() => checkExtinguishRadiusCells(17), RangeError, '[fire] extinguish radius must be 0..16 cells, got 17')
  refuse(() => checkWindVector([1, 2, 17]), TypeError, '[fire] wind must be [x, y, z] integers within +-16')
  assert.equal(igniteAreaRadiusCells(3.5, 1), 4)
  assert.equal(igniteAreaRadiusCells(1000, 1), 8)
  assert.equal(extinguishRadiusCells(8, 2), 4)
  assert.deepEqual(checkWindVector([1, 2, 3]), [1, 2, 3])
  assert.equal(checkFireByte(255, 'rain'), 255)
})

gate('the wire row parsers accept well-formed rows and refuse the rest', () => {
  assert.deepEqual(parseKeyframeRow([5, 1.5, 'AAAA']), { tick: 5, hash: 1.5, b64: 'AAAA' })
  assert.deepEqual(parseChecksumRow([1, 2]), { tick: 1, hash: 2 })
  refuse(() => parseKeyframeRow([5, 1.5]), TypeError, '[fire] malformed keyframe row')
  refuse(() => parseChecksumRow([1, 2.5]), TypeError, '[fire] malformed checksum row')
  assert.equal(FIRE_WIRE_TYPE, 'fire')
})

gate('the checksum ledger counts matches, mismatches and missed ticks and bounds its history', () => {
  const ledger = createChecksumLedger({ limit: 3 })
  ledger.rememberLocal(10, 111)
  ledger.rememberLocal(20, 222)
  ledger.rememberLocal(30, 333)
  ledger.rememberLocal(40, 444)
  assert.deepEqual(ledger.history, [[20, 222], [30, 333], [40, 444]])
  ledger.receiveRemote(20, 222)
  ledger.receiveRemote(30, 999)
  ledger.receiveRemote(50, 1)
  ledger.compare(40)
  assert.equal(ledger.stats.compared, 2)
  assert.equal(ledger.stats.mismatches, 1)
  assert.deepEqual(ledger.stats.firstMismatch, { tick: 30, local: 333, remote: 999 })
  ledger.compare(50)
  assert.equal(ledger.stats.missed, 1)
  assert.equal(ledger.stats.rows, 3)
})

const FRAME = { radius: 1000, anchorHeight: 0, up: [1, 0, 0], east: [0, 1, 0], north: [0, 0, 1] }
const NO_BREAKS = { water: false, kinds: new Set(), cleared: [], rock: null, heightAt: null, seaLevelAt: null, kindAt: null }

gate('createFirebreakFuel refuses water and kind breaks without their samplers and a missing planet radius', () => {
  const terrain = { heightAt: null, seaLevelAt: null, kindAt: null }
  const base = () => 2
  refuse(() => createFirebreakFuel({ baseClassAt: base, breaks: { ...NO_BREAKS, water: true }, frame: FRAME, lattice: lattice1, terrain }), TypeError, '[fire] firebreaks.water needs both a height and a sea-level sampler')
  refuse(() => createFirebreakFuel({ baseClassAt: base, breaks: { ...NO_BREAKS, kinds: new Set(['road']) }, frame: FRAME, lattice: lattice1, terrain }), TypeError, '[fire] firebreaks.kinds needs a terrain kind sampler')
  refuse(() => createFirebreakFuel({ baseClassAt: base, breaks: NO_BREAKS, frame: { ...FRAME, radius: 0 }, lattice: lattice1, terrain }), TypeError, '[fire] firebreaks need a planet radius')
})

gate('createFirebreakFuel clears fuel inside a cleared disc and leaves the base class elsewhere', () => {
  const base = () => 2
  const open = createFirebreakFuel({ baseClassAt: base, breaks: NO_BREAKS, frame: FRAME, lattice: lattice1, terrain: {} })
  assert.equal(open(0, 4, 4), 2)
  const cleared = createFirebreakFuel({ baseClassAt: base, breaks: { ...NO_BREAKS, cleared: [{ center: [0, 0], radiusM: 1e9 }] }, frame: FRAME, lattice: lattice1, terrain: {} })
  assert.equal(cleared(0, 4, 4), 0)
  const none = createFirebreakFuel({ baseClassAt: () => 0, breaks: { ...NO_BREAKS, cleared: [{ center: [0, 0], radiusM: 1e9 }] }, frame: FRAME, lattice: lattice1, terrain: {} })
  assert.equal(none(0, 4, 4), 0)
})

gate('createFireWeather gates emissions to the step period and maps rain, snow and dry readings to moisture', () => {
  const config = { rainPerIntensity: 255, snowRainFraction: 0.25, wetPerStep: 8, dryPerStep: 1, maxMoisture: 200, hysteresis: 8 }
  let reading = { type: 'rain', intensity: 1, wind: [1.6, -20, 3] }
  const weather = createFireWeather({ config, readWeather: () => reading, stepTicks: 30 })
  assert.equal(weather.step(1, {}), null)
  const out = weather.step(0, { rain: -1, moisture: -1, wind: null })
  assert.equal(out.rain, 255)
  assert.equal(out.moisture, 8)
  assert.deepEqual(out.wind, [2, -16, 3])
  for (let k = 1; k <= 30; k++) weather.step(k * 30, {})
  assert.equal(weather.moisture, 200)
  reading = { type: 'snow', intensity: 1 }
  weather.step(31 * 30, {})
  assert.equal(weather.rain, 64)
  reading = { type: 'none', intensity: 0 }
  const before = weather.moisture
  weather.step(32 * 30, {})
  assert.equal(weather.moisture, before - 1)
  reading = { type: 'rain', intensity: NaN }
  weather.step(33 * 30, {})
  assert.equal(weather.reading.kind, 'unreadable-weather')
})

gate('createFireWeather reports moisture only past the hysteresis band and wind only on change', () => {
  const config = { rainPerIntensity: 255, snowRainFraction: 0.25, wetPerStep: 8, dryPerStep: 1, maxMoisture: 200, hysteresis: 8 }
  const weather = createFireWeather({ config, readWeather: () => ({ type: 'rain', intensity: 1, wind: [2, -16, 3] }), stepTicks: 30 })
  weather.step(0, {})
  weather.markEmitted(255, 8, [2, -16, 3])
  assert.equal(weather.emittedRain, 255)
  assert.deepEqual(weather.emittedWind, [2, -16, 3])
  const quiet = weather.step(30, { rain: -1, moisture: -1, wind: null })
  assert.equal(quiet.rain, -1)
  assert.equal(quiet.moisture, 16 >= 0 ? 16 : -1)
  assert.equal(quiet.wind, null)
})

gate('createFireGameplay burns targets by rate, ends the status after its window and reports death', () => {
  const sent = []
  const io = {
    sendPlayer: (id, msg) => sent.push([id, msg.type]),
    sendEntity: () => {},
    applyImpulse: () => {},
  }
  let rate = 10
  const world = { kernel: { activeCount: 1, damageAt: () => rate }, lattice: { cellM: 1 } }
  const target = { id: 1, position: [0, 0, 0], holder: { health: 100 }, entity: false }
  const gp = createFireGameplay({
    gameplay: DEFAULT_FIRE_GAMEPLAY, getWorld: () => world, cellOfPosition: () => ({ face: 0, I: 0, J: 0 }),
    frameOf: () => null, targets: () => [target], io,
  })
  refuse(() => gp.tickDamage(15, 0), RangeError, '[fire] tickDamage needs the authority tick period')
  gp.tickDamage(15, 0.5)
  assert.equal(target.holder.health, 95)
  assert.equal(gp.isBurning(1), true)
  assert.deepEqual(sent, [[1, 'fire_burn']])
  rate = 0
  gp.tickDamage(30, 0.5)
  assert.equal(target.holder.health, 92.5)
  assert.equal(gp.isBurning(1), false)
  assert.deepEqual(sent.at(-1), [1, 'fire_burn_end'])
  gp.tickDamage(45, 0.5)
  assert.equal(target.holder.health, 92.5)
  target.holder.health = 1
  rate = 10
  gp.tickDamage(60, 0.5)
  assert.equal(target.holder.health, 0)
  assert.ok(sent.some(([id, type]) => id === 1 && type === 'fire_death'))
})

gate('createFireGameplay blast applies falloff to health and to a velocity holder without an io call', () => {
  const holder = { health: 100, velocity: [0, 0, 0] }
  const target = { id: 2, position: [1, 0, 0], holder, entity: false }
  const gp = createFireGameplay({
    gameplay: DEFAULT_FIRE_GAMEPLAY, getWorld: () => null, cellOfPosition: () => ({ face: 0, I: 0, J: 0 }),
    frameOf: () => null, targets: () => [target], io: { sendPlayer() {}, sendEntity() {}, applyImpulse() {} },
  })
  gp.blast([0, 0, 0], 2, 10)
  assert.equal(holder.health, 95)
  assert.deepEqual(holder.velocity, [6, 6, 0])
  assert.equal(gp.rayBlocked([0, 0, 0], [1, 0, 0], 5), false)
  assert.equal(gp.smokeDepth([0, 0, 0], [1, 0, 0], 5), 0)
})

gate('the ported barrel exposes the wire type as the fire message type', () => {
  assert.equal(FIRE_WIRE_TYPE, 'fire')
  assert.equal(typeof createFireTimeline, 'function')
  assert.equal(typeof createFireGameplay, 'function')
})

finish()
