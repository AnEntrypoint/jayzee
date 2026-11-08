import { readFileSync } from 'node:fs'
import { gate, finish } from './lib/gate.mjs'
import { LagCompensator, HISTORY_CAPACITY } from '../src/netcode/lagCompensation.js'
import { applyChartTransfer } from '../src/netcode/lagChartTransfer.js'
import { createChartTransfer } from '../src/client/chartTransfer.js'

const FROM = { radius: 1000, anchorHeight: 2, offsetY: 0.5, east: [-0.9950371902099893, 0.09950371902099893, 0], up: [0.09938079899999067, 0.9938079899999066, 0.04969039949999533], north: [0.004944379549888721, 0.049443795498887215, -0.9987646690775217] }
const TO = { radius: 1000, anchorHeight: 2, offsetY: 1.5, east: [-0.9486832980505138, 0.31622776601683794, 0], up: [0.30942637387763805, 0.9282791216329142, -0.2062842492517587], north: [-0.06523280730534423, -0.19569842191603268, -0.9784921095801634] }

const SPOINT = {
  count: 5,
  a: [
    { tick: 1, position: [221.72323323781205, -54.636467313148614, -251.38662529204004], velocity: [0.5075304085316072, -0.06414996910614869, -0.19569789441744162], rotation: [0, 0.1536190469857083, 0, 0.9881301475024445] },
    { tick: 2, position: [223.12770694192227, -53.21938401924626, -252.80765609839366], velocity: [0.9930619394262996, -0.2226031283663612, -0.36643666806746567], rotation: [0, 0.2939711576186175, 0, 0.9558142907952203] },
    { tick: 3, position: [224.53218064603246, -51.802300725344026, -254.22868690474732], velocity: [1.478593470320992, -0.38105628762657373, -0.5371754417174898], rotation: [0, 0.4260834259616437, 0, 0.9046838752408426] },
    { tick: 4, position: [225.93665435014265, -50.385217431441674, -255.64971771110092], velocity: [1.9641250012156846, -0.5395094468867863, -0.7079142153675139], rotation: [0, 0.5499055326853112, 0, 0.8352268584774344] },
  ],
  b: [
    { tick: 2, position: [230.12789380785793, -56.9415009323767, -244.67480730310857], velocity: [1.4482531068934166, 2.430911231626044, 2.448108151681196], rotation: [0, 0.21308098869480774, 0, 0.9770345399507856] },
  ],
}

const ok = (condition, what) => {
  if (!condition) throw new Error(what)
}

const vecNear = (actual, expected, tol, what) => {
  ok(actual.length === expected.length, `${what}: length ${actual.length} vs ${expected.length}`)
  expected.forEach((value, i) => ok(Math.abs(actual[i] - value) <= tol, `${what}[${i}]: expected ${value}, got ${actual[i]}`))
}

const thrownOf = (fn) => {
  try {
    fn()
  } catch (error) {
    return error
  }
  return null
}

const yawQuat = (yaw) => [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)]

const seeded = (windowMs = 1000) => {
  let now = 0
  const lag = new LagCompensator(windowMs, 60, () => now++)
  for (let k = 1; k <= 4; k++) lag.recordPlayerPosition('a', [k, 2 * k, -k], yawQuat(0.3 * k), [0.5 * k, 0.1, -0.2 * k], k)
  lag.recordPlayerPosition('b', [10, 0, 5], [0.1, 0.2, 0.3, 0.927], [1, 2, 3], 2)
  return lag
}

const samplesOf = (lag, id) => {
  const ring = lag.playerHistory.get(id)
  return Array.from({ length: ring.len }, (_, i) => ring.buf[(ring.head + i) % HISTORY_CAPACITY])
}

const snapshot = (lag) => JSON.stringify([...lag.playerHistory].map(([id, ring]) => [id, ring.head, ring.len, ring.committed, ring.buf]))

const transfer = createChartTransfer(FROM, TO)

gate('applyChartTransfer returns 5 samples over two players, as spoint LagCompensator#applyChartTransfer does on the same history', () => {
  const lag = seeded()
  const count = applyChartTransfer(lag, transfer)
  ok(count === SPOINT.count, `count ${count}`)
})

gate('positions, velocities and rotations match spoint at d5e3860 within 1e-9 for every sample', () => {
  const lag = seeded()
  applyChartTransfer(lag, transfer)
  for (const id of ['a', 'b']) {
    const got = samplesOf(lag, id)
    ok(got.length === SPOINT[id].length, `${id} length ${got.length}`)
    SPOINT[id].forEach((want, i) => {
      ok(got[i].tick === want.tick, `${id}[${i}] tick ${got[i].tick}`)
      vecNear(got[i].position, want.position, 1e-9, `${id}[${i}].position`)
      vecNear(got[i].velocity, want.velocity, 1e-9, `${id}[${i}].velocity`)
      vecNear(got[i].rotation, want.rotation, 1e-9, `${id}[${i}].rotation`)
    })
  }
})

gate('a position goes through transfer.point and a velocity through transfer.vec, each in place', () => {
  const lag = seeded()
  const before = samplesOf(lag, 'a').map((s) => ({ p: [...s.position], v: [...s.velocity], refP: s.position, refV: s.velocity }))
  applyChartTransfer(lag, transfer)
  samplesOf(lag, 'a').forEach((s, i) => {
    ok(s.position === before[i].refP && s.velocity === before[i].refV, `sample ${i} arrays were replaced`)
    vecNear(s.position, transfer.point(before[i].p), 1e-12, `point ${i}`)
    vecNear(s.velocity, transfer.vec(before[i].v), 1e-12, `vec ${i}`)
  })
})

gate('spoint quirk kept: a rotation with pitch or roll is replaced by a pure yaw quaternion, so x and z become 0', () => {
  const lag = seeded()
  applyChartTransfer(lag, transfer)
  const rotation = samplesOf(lag, 'b')[0].rotation
  ok(rotation[0] === 0 && rotation[2] === 0, `rotation ${rotation}`)
  const yawIn = 2 * Math.atan2(0.2, 0.927)
  vecNear(rotation, yawQuat(transfer.look(yawIn, 0).yaw), 1e-12, 'yaw-only rotation')
})

gate('tick, timestamp, ring head, len and committed count are left alone', () => {
  const lag = seeded()
  lag.beginTick(5)
  const shape = [...lag.playerHistory].map(([id, ring]) => [id, ring.head, ring.len, ring.committed, samplesOf(lag, id).map((s) => [s.tick, s.timestamp])])
  applyChartTransfer(lag, transfer)
  const after = [...lag.playerHistory].map(([id, ring]) => [id, ring.head, ring.len, ring.committed, samplesOf(lag, id).map((s) => [s.tick, s.timestamp])])
  ok(JSON.stringify(shape) === JSON.stringify(after), 'ring shape changed')
})

gate('a rewind after the transfer interpolates in the new chart: tick 2.5 is the midpoint of the transferred samples', () => {
  const lag = seeded()
  applyChartTransfer(lag, transfer)
  const mid = lag.rewindAtTick('a', 2.5)
  const [s2, s3] = [SPOINT.a[1], SPOINT.a[2]]
  vecNear(mid.position, s2.position.map((c, i) => (c + s3.position[i]) / 2), 1e-9, 'midpoint')
})

gate('slots outside the live window are not touched: a trimmed ring transfers only its len samples', () => {
  let now = 0
  const lag = new LagCompensator(50, 60, () => now++)
  for (let k = 1; k <= 10; k++) lag.recordPlayerPosition('c', [k, 0, 0], yawQuat(0), [0, 0, 0], k)
  const ring = lag.playerHistory.get('c')
  ok(ring.head > 0, `ring head ${ring.head}`)
  const stale = ring.buf.slice(0, ring.head).map((s) => [...s.position])
  const count = applyChartTransfer(lag, transfer)
  ok(count === ring.len, `count ${count} len ${ring.len}`)
  ring.buf.slice(0, ring.head).forEach((s, i) => vecNear(s.position, stale[i], 0, `stale slot ${i}`))
})

gate('an empty compensator transfers 0 samples', () => {
  ok(applyChartTransfer(new LagCompensator(1000, 60, () => 0), transfer) === 0, 'non-zero count')
})

gate('the same chart on both sides leaves every sample where it was, within 1e-9', () => {
  const lag = seeded()
  const before = samplesOf(lag, 'a').map((s) => [...s.position, ...s.velocity, ...s.rotation])
  applyChartTransfer(lag, createChartTransfer(FROM, FROM))
  samplesOf(lag, 'a').forEach((s, i) => vecNear([...s.position, ...s.velocity, ...s.rotation], before[i], 1e-9, `sample ${i}`))
})

gate('negative control: a perturbed destination chart changes the transferred positions', () => {
  const lag = seeded()
  applyChartTransfer(lag, createChartTransfer(FROM, { ...TO, offsetY: TO.offsetY + 0.25 }))
  const got = samplesOf(lag, 'a')[0].position
  ok(Math.abs(got[1] - SPOINT.a[0].position[1]) > 0.2, `position ${got}`)
})

gate('improvement over spoint: a transfer missing point, vec or look is refused before any sample moves', () => {
  for (const broken of [null, {}, { point: transfer.point, vec: transfer.vec }, { ...transfer, point: 1 }]) {
    const lag = seeded()
    const before = snapshot(lag)
    const error = thrownOf(() => applyChartTransfer(lag, broken))
    ok(error instanceof TypeError, `no TypeError for ${JSON.stringify(broken)}`)
    ok(snapshot(lag) === before, 'history changed before the refusal')
  }
})

gate('a missing compensator or one without a playerHistory map is refused', () => {
  for (const bad of [null, undefined, {}, { playerHistory: [] }]) {
    ok(thrownOf(() => applyChartTransfer(bad, transfer)) instanceof TypeError, `accepted ${String(bad)}`)
  }
})

gate('the module source has no comments and reads no host globals', () => {
  const source = readFileSync(new URL('../src/netcode/lagChartTransfer.js', import.meta.url), 'utf8')
  ok(!/\/\/|\/\*/.test(source), 'comment marker found')
  for (const name of ['Date', 'performance', 'console', 'window', 'process', 'setTimeout', 'globalThis', 'Math.random']) ok(!source.includes(name), `${name} found`)
})

finish()
