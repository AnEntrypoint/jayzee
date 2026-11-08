import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gate, finish } from './lib/gate.mjs'
import { firstDivergence } from './lib/canon.mjs'
import { OVERLAP_CASE_LABELS, OVERLAP_CASES, SCENE, runOverlapScenario } from './lib/overlapScenario.mjs'
import { createJoltHost, loadJolt } from '../src/collision/joltHost.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/spoint/overlap.json', import.meta.url), 'utf8'))
const J = await loadJolt()

const hostAdapter = (host) => ({
  addBox: (half, position) => host.addBody(new J.BoxShape(new J.Vec3(half[0], half[1], half[2]), Math.min(0.05, Math.min(...half) * 0.1), null), position, J.EMotionType_Static, 0),
  addSphere: (radius, position) => host.addBody(new J.SphereShape(radius), position, J.EMotionType_Static, 0),
  sphere: (centre, radius, exclude) => host.overlapSphere(centre, radius, exclude),
  box: (min, max, exclude) => host.overlapBox(min, max, exclude),
  destroy: () => host.destroy(),
})

const got = runOverlapScenario(hostAdapter(await createJoltHost({ gravity: [0, -9.81, 0] })))

gate('the fixture was generated from spoint src/physics/World.js on its Jolt system with jolt-physics 1.1.0', () => {
  assert.equal(fixture.source.file, 'src/physics/World.js')
  assert.equal(fixture.source.joltPhysics, '1.1.0')
  assert.match(fixture.source.sha256, /^[0-9a-f]{64}$/)
})

gate('the fixture covers every overlap case in order', () => {
  assert.deepEqual(fixture.labels, OVERLAP_CASE_LABELS)
  assert.equal(fixture.rows.length, OVERLAP_CASE_LABELS.length)
})

gate('overlapSphere and overlapBox equal spoint Jolt answers on every case, as Jolt reports each contact', () => {
  assert.equal(firstDivergence(got.rows, fixture.rows), null)
})

gate('the fixture holds hits and misses, so a query that always answers empty would show', () => {
  const hitting = fixture.rows.filter((row) => /"value":\[n:/.test(row)).length
  const empty = fixture.rows.filter((row) => /"value":\[\]/.test(row)).length
  assert.ok(hitting >= 6 && empty >= 3, 'hitting ' + hitting + ', empty ' + empty)
})

gate('negative control: the sphere with the floor excluded differs from the same sphere without the exclusion', () => {
  const plain = fixture.rows[OVERLAP_CASE_LABELS.indexOf(OVERLAP_CASES[0].label)]
  const excluded = fixture.rows[OVERLAP_CASE_LABELS.indexOf(OVERLAP_CASES[4].label)]
  assert.notEqual(plain.slice(plain.indexOf('"value"')), excluded.slice(excluded.indexOf('"value"')))
})

gate('overlapSphere refuses a zero, negative, NaN or infinite radius with a TypeError', async () => {
  const host = await createJoltHost({ gravity: [0, -9.81, 0] })
  try {
    for (const radius of [0, -1, NaN, Infinity]) assert.throws(() => host.overlapSphere([0, 0, 0], radius), TypeError, 'radius ' + radius)
  } finally {
    host.destroy()
  }
})

gate('overlapBox refuses a box whose max is not above its min on every axis with a TypeError', async () => {
  const host = await createJoltHost({ gravity: [0, -9.81, 0] })
  try {
    assert.throws(() => host.overlapBox([1, 0, 0], [0, 1, 1]), TypeError)
    assert.throws(() => host.overlapBox([0, 0, 0], [1, 0, 1]), TypeError)
  } finally {
    host.destroy()
  }
})

gate('overlap queries refuse with static-colliders-migrating while a static is parked, and answer again after the drain', async () => {
  const host = await createJoltHost({ gravity: [0, -9.81, 0] })
  try {
    const floor = host.addBody(new J.BoxShape(new J.Vec3(40, 0.5, 40), 0.05, null), [0, -0.5, 0], J.EMotionType_Static, 0)
    host.dormantStatics.park([{ bodyId: floor, owner: { position: [0, -0.5, 0], rotation: [0, 0, 0, 1] } }])
    assert.throws(() => host.overlapSphere([0, 0, 0], 1), (error) => error.code === 'static-colliders-migrating')
    host.dormantStatics.drainAll()
    assert.deepEqual(host.overlapSphere([0, 0, 0], 1), [floor])
  } finally {
    host.destroy()
  }
})

finish()
