import { gate, finish } from './lib/gate.mjs'
import * as chart from '../src/chart-pure/chartAnchor.js'
import { anchorBasis } from '../src/terrain-pure/planetFrame.js'
import { pickFace } from '../src/terrain-pure/cubeSphereCells.js'
import { createChartTransfer as createClientTransfer } from '../src/client/chartTransfer.js'

const RADIUS = 6371000
const RAD = 180 / Math.PI
const SPOINT = {
  chunkM32: 312735.7311881342,
  worst32Deg: 2.2596748516959444,
  worst16Deg: 4.4493595660156995,
  keyOf060: 63,
  anchorKey0: [0.596241399469499, -0.567669002834686, 0.567669002834686],
  anchorKey1091: [-0.6892380393003612, -0.4854161947261385, -0.5378866451948676],
  beforeDeg: 78.09531188715188,
  afterDeg: 0.19999710296498732,
  tiltDeg: 77.96343400123477,
}

const ok = (condition, what) => {
  if (!condition) throw new Error(what)
}

const near = (actual, expected, tol, what) => {
  ok(Math.abs(actual - expected) <= tol, `${what}: expected ${expected}, got ${actual}`)
}

const vecNear = (actual, expected, tol, what) => {
  ok(actual.length === expected.length, `${what}: length ${actual.length} vs ${expected.length}`)
  expected.forEach((value, i) => near(actual[i], value, tol, `${what}[${i}]`))
}

const refutes = (check, what) => {
  try {
    check()
  } catch {
    return
  }
  throw new Error(what)
}

const thrownOf = (fn) => {
  try {
    fn()
  } catch (error) {
    return error
  }
  return null
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const unit = (v) => {
  const l = Math.hypot(v[0], v[1], v[2])
  return [v[0] / l, v[1] / l, v[2] / l]
}
const angleBetweenDeg = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(unit(a), unit(b))))) * RAD

let seed = 20260
const random = () => {
  seed = (Math.imul(seed, 1103515245) + 12345) >>> 0
  return seed / 4294967296
}
const randomDir = () => unit([random() * 2 - 1, random() * 2 - 1, random() * 2 - 1])

const lattice32 = chart.createChartAnchorLattice(RADIUS)
const lattice16 = chart.createChartAnchorLattice(RADIUS, 16)

const makeFrame = (upDir, offsetY = 0.5, anchorHeight = 12) => {
  const basis = anchorBasis(upDir)
  const frame = {
    radius: RADIUS, offsetY, anchorHeight, chartEpoch: 3,
    east: basis.east, up: basis.up, north: basis.north,
    reanchorCalls: 0,
  }
  frame.reanchor = (target) => {
    frame.reanchorCalls++
    const next = anchorBasis(target)
    frame.up = next.up
    frame.east = next.east
    frame.north = next.north
    frame.chartEpoch = 4
  }
  return frame
}

const DIR_30_DEG = [Math.cos(Math.PI / 6), Math.sin(Math.PI / 6), 0]
const DIR_20_DEG = [Math.cos(Math.PI * 20 / 180), Math.sin(Math.PI * 20 / 180), 0]
const DIR_60_DEG = [Math.cos(Math.PI / 3), Math.sin(Math.PI / 3), 0]
const REANCHOR_DIR = [0.2, 0.9, 0.3]

gate('constants keep spoint values', () => {
  ok(chart.CHART_ANCHORS_PER_FACE === 32, 'CHART_ANCHORS_PER_FACE must be 32')
  ok(chart.CHART_REANCHOR_ANGLE_DEG === 28, 'CHART_REANCHOR_ANGLE_DEG must be 28')
  refutes(() => ok(chart.CHART_ANCHORS_PER_FACE === 16), 'a 16 anchor constant must not match')
  refutes(() => ok(chart.CHART_REANCHOR_ANGLE_DEG === 30), 'a 30 degree threshold must not match')
})

gate('default lattice is 32 chunks per face at the spoint chunk size', () => {
  ok(lattice32.chunksPerFace === 32, `chunksPerFace ${lattice32.chunksPerFace}`)
  near(lattice32.chunkM, SPOINT.chunkM32, 1e-6, 'chunkM')
  refutes(() => ok(chart.createChartAnchorLattice(RADIUS, 16).chunksPerFace === 32), 'a 16 anchor lattice must not have 32 chunks')
})

gate('chunk size keeps the safety margin above the plain quarter-turn division', () => {
  const plain = (Math.PI / 2) * RADIUS / 32
  ok(lattice32.chunkM > plain, 'chunkM must exceed the plain division')
  refutes(() => ok(lattice32.chunkM < plain), 'chunkM must not sit below the plain division')
})

gate('invalid radius and anchor counts throw with the spoint reasons', () => {
  const reasonOf = (radius, anchors) => thrownOf(() => chart.createChartAnchorLattice(radius, anchors))?.reason
  ok(reasonOf(0) === 'radius-not-positive-finite', 'radius 0')
  ok(reasonOf(-1) === 'radius-not-positive-finite', 'negative radius')
  ok(reasonOf(NaN) === 'radius-not-positive-finite', 'NaN radius')
  ok(reasonOf(Infinity) === 'radius-not-positive-finite', 'infinite radius')
  ok(reasonOf(RADIUS, 0) === 'anchors-per-face-below-one', 'zero anchors')
  ok(reasonOf(RADIUS, NaN) === 'anchors-per-face-below-one', 'NaN anchors')
  ok(reasonOf(0, 0) === 'radius-not-positive-finite+anchors-per-face-below-one', 'both invalid')
  const error = thrownOf(() => chart.createChartAnchorLattice(0, 0))
  ok(error instanceof chart.ChartAnchorLatticeError, 'error class')
  ok(error instanceof Error && error.name === 'ChartAnchorLatticeError', 'error name')
  ok(error.reasons.length === 2, 'two reasons kept in order')
  refutes(() => ok(thrownOf(() => chart.createChartAnchorLattice(0)) === null), 'radius 0 must not pass as valid')
})

gate('valid input does not throw', () => {
  ok(thrownOf(() => chart.createChartAnchorLattice(RADIUS)) === null, 'default lattice must not throw')
  ok(thrownOf(() => chart.createChartAnchorLattice(RADIUS, 1)) === null, 'one anchor per face must not throw')
  refutes(() => ok(thrownOf(() => chart.createChartAnchorLattice(RADIUS, 1)) !== null), 'one anchor per face must not be refused')
})

gate('key of a direction matches spoint and the centre of its chunk is a unit vector', () => {
  ok(chart.chartAnchorKeyOfDir(lattice32, [0.6, 0.6, 0.5]) === SPOINT.keyOf060, 'key of [0.6,0.6,0.5]')
  refutes(() => ok(chart.chartAnchorKeyOfDir(lattice32, [-1, 0, 0]) === SPOINT.keyOf060), 'a -x direction must not share the key')
  for (let i = 0; i < 500; i++) {
    const dir = randomDir()
    const key = chart.chartAnchorKeyOfDir(lattice32, dir)
    const anchor = chart.chartAnchorDirOfKey(lattice32, key)
    near(Math.hypot(anchor[0], anchor[1], anchor[2]), 1, 1e-9, 'anchor length')
    vecNear(chart.chartAnchorForDir(lattice32, dir), anchor, 0, 'anchorForDir equals its key centre')
  }
  refutes(() => vecNear(chart.chartAnchorForDir(lattice32, [0.3, 0.4, 0.5]), [0.3, 0.4, 0.5], 1e-9, 'anchor'), 'an anchor must not be the query direction')
})

gate('anchors of keys 0 and 1091 match spoint', () => {
  vecNear(chart.chartAnchorDirOfKey(lattice32, 0), SPOINT.anchorKey0, 1e-12, 'key 0')
  vecNear(chart.chartAnchorDirOfKey(lattice32, 1091), SPOINT.anchorKey1091, 1e-12, 'key 1091')
  refutes(() => vecNear(chart.chartAnchorDirOfKey(lattice32, 0), SPOINT.anchorKey1091, 1e-12, 'key 0 as key 1091'), 'key 0 must not equal key 1091')
})

gate('chartAnchorDirOfKey writes into out and a default call returns a fresh array', () => {
  const out = [9, 9, 9]
  ok(chart.chartAnchorDirOfKey(lattice32, 0, out) === out, 'out must be returned')
  vecNear(out, SPOINT.anchorKey0, 1e-12, 'out contents')
  const first = chart.chartAnchorDirOfKey(lattice32, 0)
  const second = chart.chartAnchorDirOfKey(lattice32, 0)
  ok(first !== second, 'default out must be a fresh array per call')
  refutes(() => ok(first === second), 'two default calls must not share an array')
})

gate('cell worst angle matches spoint and falls as the anchor count rises', () => {
  near(chart.chartAnchorCellWorstAngleDeg(lattice32), SPOINT.worst32Deg, 1e-9, 'worst angle at 32')
  near(chart.chartAnchorCellWorstAngleDeg(lattice16), SPOINT.worst16Deg, 1e-9, 'worst angle at 16')
  ok(chart.chartAnchorCellWorstAngleDeg(lattice32) < chart.chartAnchorCellWorstAngleDeg(lattice16), 'more anchors must lower the worst angle')
  refutes(() => ok(chart.chartAnchorCellWorstAngleDeg(lattice32) >= chart.chartAnchorCellWorstAngleDeg(lattice16)), 'the ordering must not reverse')
})

gate('every sampled direction lies within the worst cell angle of its anchor', () => {
  const worst = chart.chartAnchorCellWorstAngleDeg(lattice32)
  let maxAngle = 0
  for (let i = 0; i < 1500; i++) {
    const dir = randomDir()
    const anchor = chart.chartAnchorForDir(lattice32, dir)
    maxAngle = Math.max(maxAngle, angleBetweenDeg(dir, anchor))
  }
  ok(maxAngle <= worst + 1e-9, `sampled angle ${maxAngle} exceeds worst ${worst}`)
  refutes(() => ok(maxAngle <= worst / 2), 'half the worst angle must not bound every sample')
})

gate('chartAnchorAngleDeg normalises the direction and stays finite', () => {
  const frame = { up: [0, 1, 0] }
  near(chart.chartAnchorAngleDeg(frame, [0, 1, 0]), 0, 1e-12, 'same direction')
  near(chart.chartAnchorAngleDeg(frame, [1, 0, 0]), 90, 1e-12, 'perpendicular')
  near(chart.chartAnchorAngleDeg(frame, [0, -1, 0]), 180, 1e-12, 'opposite')
  near(chart.chartAnchorAngleDeg(frame, [0, 5, 0]), 0, 1e-12, 'unnormalised same direction')
  near(chart.chartAnchorAngleDeg(frame, [0, 0, 0]), 90, 1e-12, 'zero direction falls back to length 1')
  const rounded = chart.chartAnchorAngleDeg({ up: [1, 0, 0] }, [1 + 2.2e-16, 0, 0])
  ok(Number.isFinite(rounded) && rounded === 0, `rounding above 1 must clamp to 0, got ${rounded}`)
  refutes(() => near(chart.chartAnchorAngleDeg(frame, [1, 0, 0]), 0, 1e-12, 'perpendicular'), 'a perpendicular direction must not read as 0')
})

gate('chartNeedsReanchor uses the 28 degree default and a strict comparison', () => {
  const frame = { up: [1, 0, 0] }
  ok(chart.chartNeedsReanchor(frame, [0, 1, 0]) === true, 'a 90 degree offset needs a re-anchor')
  ok(chart.chartNeedsReanchor(frame, DIR_20_DEG) === false, 'a 20 degree offset does not')
  ok(chart.chartNeedsReanchor(frame, DIR_30_DEG) === true, 'a 30 degree offset needs a re-anchor')
  const exact = chart.chartAnchorAngleDeg(frame, DIR_30_DEG)
  ok(chart.chartNeedsReanchor(frame, DIR_30_DEG, exact) === false, 'an offset equal to the threshold does not need one')
  ok(chart.chartNeedsReanchor(frame, DIR_20_DEG, 5) === true, 'an explicit threshold of 5 degrees is honoured')
  refutes(() => ok(chart.chartNeedsReanchor(frame, DIR_30_DEG) === false), 'a 30 degree offset must not pass the 28 degree threshold')
})

gate('chartNeedsReanchorForCell compares the offset to the target with a 1e-18 squared bound', () => {
  const target = chart.chartAnchorForDir(lattice32, REANCHOR_DIR)
  const at = (dx) => ({ up: [target[0] + dx, target[1], target[2]] })
  ok(chart.chartNeedsReanchorForCell(null, at(0), REANCHOR_DIR) === false, 'no lattice reports no re-anchor')
  ok(chart.chartNeedsReanchorForCell(lattice32, at(0), REANCHOR_DIR) === false, 'an aligned frame does not need one')
  ok(chart.chartNeedsReanchorForCell(lattice32, at(1e-10), REANCHOR_DIR) === false, 'a 1e-10 offset is inside the bound')
  ok(chart.chartNeedsReanchorForCell(lattice32, at(1e-8), REANCHOR_DIR) === true, 'a 1e-8 offset is outside the bound')
  refutes(() => ok(chart.chartNeedsReanchorForCell(lattice32, at(1e-8), REANCHOR_DIR) === false), 'a 1e-8 offset must not pass as aligned')
})

gate('snapshotChart copies its vectors and keeps the scalar fields', () => {
  const frame = makeFrame([0.2, 0.9, 0.3])
  const snap = chart.snapshotChart(frame)
  ok(JSON.stringify(Object.keys(snap)) === JSON.stringify(['radius', 'offsetY', 'anchorHeight', 'chartEpoch', 'east', 'up', 'north']), 'snapshot keys')
  ok(snap.radius === RADIUS && snap.offsetY === 0.5 && snap.anchorHeight === 12 && snap.chartEpoch === 3, 'scalar fields')
  ok(snap.up !== frame.up && snap.east !== frame.east && snap.north !== frame.north, 'vectors must be copies')
  const before = frame.up[0]
  snap.up[0] = 99
  ok(frame.up[0] === before, 'editing the snapshot must not move the frame')
  refutes(() => {
    const alias = { ...snap, up: frame.up }
    alias.up[0] = 99
    ok(frame.up[0] === before, 'an aliased snapshot must not leave the frame unchanged')
  }, 'an aliased snapshot must be detected as moving the frame')
})

gate('reanchorChartFor refuses a frame or lattice it cannot use, even when aligned', () => {
  const bare = { up: [1, 0, 0], east: [0, 0, 1], north: [0, 1, 0] }
  const typeErrorOf = (fn) => {
    const error = thrownOf(fn)
    ok(error instanceof TypeError, 'expected a TypeError')
    return error.message
  }
  ok(typeErrorOf(() => chart.reanchorChartFor({ frame: bare, lattice: lattice32, dir: REANCHOR_DIR })).includes('reanchor(target)'), 'a frame without reanchor')
  const aligned = makeFrame([1, 0, 0])
  ok(typeErrorOf(() => chart.reanchorChartFor({ frame: aligned, lattice: null, dir: [1, 0, 0] })).includes('anchor lattice'), 'a missing lattice must throw')
  ok(chart.reanchorChartFor({ frame: aligned, lattice: lattice32, dir: [1, 0, 0] }) === null, 'an aligned frame with a lattice reports nothing')
  refutes(() => ok(thrownOf(() => chart.reanchorChartFor({ frame: aligned, lattice: null, dir: [1, 0, 0] })) === null), 'a missing lattice must not report no re-anchor')
})

gate('reanchorChartFor does nothing inside the threshold and re-anchors outside it', () => {
  const frame = makeFrame([1, 0, 0])
  ok(chart.reanchorChartFor({ frame, lattice: lattice32, dir: DIR_20_DEG }) === null, 'a 20 degree offset returns null')
  ok(frame.reanchorCalls === 0, 'no reanchor call inside the threshold')
  const out = chart.reanchorChartFor({ frame, lattice: lattice32, dir: DIR_60_DEG })
  ok(out !== null && frame.reanchorCalls === 1, 'a 60 degree offset re-anchors once')
  refutes(() => ok(chart.reanchorChartFor({ frame: makeFrame([1, 0, 0]), lattice: lattice32, dir: DIR_60_DEG }) === null), 'a 60 degree offset must not return null')
})

gate('a re-anchor moves the frame onto the anchor and reports the spoint numbers', () => {
  const frame = makeFrame([1, 0, 0])
  const result = chart.reanchorChartFor({ frame, lattice: lattice32, dir: REANCHOR_DIR })
  ok(result !== null && frame.reanchorCalls === 1, 'one re-anchor')
  ok(JSON.stringify(Object.keys(result)) === JSON.stringify(['from', 'to', 'anchorDir', 'angleBeforeDeg', 'angleAfterDeg', 'transfer']), 'result keys')
  vecNear(result.to.up, chart.chartAnchorForDir(lattice32, REANCHOR_DIR), 1e-12, 'to.up is the anchor')
  vecNear(result.anchorDir, result.to.up, 0, 'anchorDir is to.up')
  near(result.angleBeforeDeg, SPOINT.beforeDeg, 1e-9, 'angleBeforeDeg')
  near(result.angleAfterDeg, SPOINT.afterDeg, 1e-9, 'angleAfterDeg')
  ok(result.angleAfterDeg < result.angleBeforeDeg, 'the re-anchor must bring the frame closer')
  refutes(() => near(result.angleBeforeDeg, result.angleAfterDeg, 1e-9, 'before and after'), 'before and after must differ')
})

gate('from and to are fixed snapshots even when reanchor mutates the frame in place', () => {
  const frame = makeFrame([1, 0, 0])
  frame.reanchor = (target) => {
    frame.reanchorCalls++
    const next = anchorBasis(target)
    frame.up.splice(0, 3, ...next.up)
    frame.east.splice(0, 3, ...next.east)
    frame.north.splice(0, 3, ...next.north)
  }
  const result = chart.reanchorChartFor({ frame, lattice: lattice32, dir: REANCHOR_DIR })
  vecNear(result.from.up, [1, 0, 0], 0, 'from.up keeps the pre-reanchor up')
  vecNear(result.to.up, frame.up, 0, 'to.up matches the live up after reanchor')
  refutes(() => ok(result.from.up[1] === frame.up[1], 'from.up must not follow the live frame'), 'the live frame must have moved away from the snapshot')
  result.anchorDir[0] = 7
  ok(result.to.up[0] !== 7, 'anchorDir must be a copy')
})

gate('cellTrigger re-anchors on the cell offset and ignores the angle', () => {
  const target = chart.chartAnchorForDir(lattice32, REANCHOR_DIR)
  const aligned = { radius: RADIUS, offsetY: 0, anchorHeight: 0, chartEpoch: 0, east: [0, 0, 1], up: [...target], north: [0, 1, 0] }
  aligned.reanchor = () => ok(false, 'an aligned frame must not reanchor')
  ok(chart.reanchorChartFor({ frame: aligned, lattice: lattice32, dir: REANCHOR_DIR, cellTrigger: true }) === null, 'aligned frame with cell trigger')
  const off = makeFrame([1, 0, 0])
  off.up = [target[0] + 1e-8, target[1], target[2]]
  ok(chart.reanchorChartFor({ frame: off, lattice: lattice32, dir: REANCHOR_DIR }) === null, 'the angle test alone ignores a 1e-8 offset')
  ok(chart.reanchorChartFor({ frame: off, lattice: lattice32, dir: REANCHOR_DIR, cellTrigger: true }) !== null, 'the cell trigger fires on a 1e-8 offset')
  const fresh = makeFrame([1, 0, 0])
  fresh.up = [target[0] + 1e-8, target[1], target[2]]
  refutes(() => ok(chart.reanchorChartFor({ frame: fresh, lattice: lattice32, dir: REANCHOR_DIR }) !== null), 'the angle test must not fire on a 1e-8 offset')
})

gate('transfer reports the tilt between the two ups and maps local vectors as spoint does', () => {
  const frame = makeFrame([1, 0, 0])
  const result = chart.reanchorChartFor({ frame, lattice: lattice32, dir: REANCHOR_DIR })
  near(result.transfer.tiltRad * RAD, SPOINT.tiltDeg, 1e-9, 'tilt in degrees')
  near(result.transfer.tiltRad, Math.acos(Math.max(-1, Math.min(1, dot(result.from.up, result.to.up)))), 1e-12, 'tilt is the angle between the ups')
  const from = result.from
  const to = result.to
  const expected = [dot(to.east, from.up), dot(to.up, from.up), dot(to.north, from.up)]
  vecNear(result.transfer.vec([0, 1, 0]), expected, 1e-12, 'vec of the from up axis')
  refutes(() => near(result.transfer.tiltRad * RAD, result.angleBeforeDeg, 1e-9, 'tilt against angleBefore'), 'the tilt must not equal the angle from the old up to the direction')
})

gate('transfer quaternion output is unit length and turns the identity', () => {
  const frame = makeFrame([1, 0, 0])
  const result = chart.reanchorChartFor({ frame, lattice: lattice32, dir: REANCHOR_DIR })
  const q = result.transfer.quat([0, 0, 0, 1])
  near(Math.hypot(q[0], q[1], q[2], q[3]), 1, 1e-12, 'quaternion length')
  refutes(() => vecNear(q, [0, 0, 0, 1], 1e-9, 'quaternion'), 'a real re-anchor must not leave the identity quaternion')
})

gate('createChartTransfer is the jayzee client transfer', () => {
  ok(chart.createChartTransfer === createClientTransfer, 're-export must be the client transfer')
  refutes(() => ok(chart.createChartTransfer === chart.snapshotChart), 'a different function must not match')
})

gate('chartBasisForDir matches the planet frame basis and is orthonormal', () => {
  for (let i = 0; i < 300; i++) {
    const dir = randomDir()
    const basis = chart.chartBasisForDir(dir)
    const reference = anchorBasis(dir)
    vecNear(basis.up, reference.up, 0, 'up matches anchorBasis')
    vecNear(basis.east, reference.east, 0, 'east matches anchorBasis')
    vecNear(basis.north, reference.north, 0, 'north matches anchorBasis')
    near(dot(basis.east, basis.up), 0, 1e-12, 'east perpendicular to up')
    near(dot(basis.north, basis.up), 0, 1e-12, 'north perpendicular to up')
    near(Math.hypot(...basis.north), 1, 1e-12, 'north unit length')
    vecNear(basis.north, cross(basis.east, basis.up), 1e-12, 'north is east cross up')
  }
  refutes(() => {
    const basis = chart.chartBasisForDir(randomDir())
    vecNear(basis.north, cross(basis.up, basis.east), 1e-12, 'north against up cross east')
  }, 'north must not equal up cross east')
})

gate('the pole basis takes its reference from the x axis', () => {
  const basis = chart.chartBasisForDir([0, 1, 0])
  vecNear(basis.east, [0, 0, 1], 1e-12, 'east at the pole')
  vecNear(basis.north, [-1, 0, 0], 1e-12, 'north at the pole')
  refutes(() => vecNear(basis.east, [1, 0, 0], 1e-12, 'east at the pole'), 'east at the pole must not be the x axis')
})

gate('the face of an anchor agrees with CubeSphereCells pickFace', () => {
  let agree = 0
  let shiftedAgree = 0
  const samples = 2000
  for (let i = 0; i < samples; i++) {
    const dir = randomDir()
    const key = chart.chartAnchorKeyOfDir(lattice32, dir)
    const face = lattice32.decodeChunk(key, [0, 0, 0])[0]
    if (face === pickFace(dir[0], dir[1], dir[2])) agree++
    if ((face + 1) % 6 === pickFace(dir[0], dir[1], dir[2])) shiftedAgree++
  }
  ok(agree === samples, `${samples - agree} of ${samples} faces disagree`)
  refutes(() => ok(shiftedAgree === samples), 'a shifted face index must not agree on every sample')
})

finish()
