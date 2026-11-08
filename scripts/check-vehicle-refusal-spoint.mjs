import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gate, finish } from './lib/gate.mjs'
import { firstDivergence } from './lib/canon.mjs'
import { REFUSAL_CASE_LABELS, WHEEL, WHEELED_OPTS, captureErrors, runRefusalScenario } from './lib/vehicleRefusalScenario.mjs'
import { createJoltHost, loadJolt } from '../src/collision/joltHost.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/spoint/vehicle-refusal.json', import.meta.url), 'utf8'))
const J = await loadJolt()
const parsed = fixture.rows.map((row) => JSON.parse(row.replace(/s:/g, '').replace(/n:/g, '')))

const adapterFor = (host) => ({
  addBox: (h, position, dynamic) => host.addBody(new J.BoxShape(new J.Vec3(h[0], h[1], h[2]), dynamic ? Math.min(0.05, Math.min(...h) * 0.1) : 0.05, null), position, dynamic ? J.EMotionType_Dynamic : J.EMotionType_Static, dynamic ? 1 : 0),
  createWheeled: (chassis, wheels, opts) => host.vehicles.createWheeledVehicle(chassis, wheels, opts),
  createTracked: (chassis, wheels, opts) => host.vehicles.createTrackedVehicle(chassis, wheels, opts),
  destroy: () => host.destroy(),
})

const capture = captureErrors()
let got
try {
  got = runRefusalScenario(adapterFor(await createJoltHost({ gravity: [0, -9.81, 0] })), capture).rows
} finally {
  capture.restore()
}

gate('the fixture was generated from spoint src/physics/VehiclePhysics.js with jolt-physics 1.1.0', () => {
  assert.deepEqual(Object.keys(fixture.source.sha256).sort(), ['src/physics/VehiclePhysics.js', 'src/physics/World.js'])
  assert.equal(fixture.source.joltPhysics, '1.1.0')
})

gate('the fixture covers every refusal case in order', () => {
  assert.equal(fixture.rows.length, REFUSAL_CASE_LABELS.length)
  REFUSAL_CASE_LABELS.forEach((label, i) => assert.ok(fixture.rows[i].includes('s:' + JSON.stringify(label)), label))
})

gate('every refused build logs the same console.error lines as spoint, in the same order', () => {
  assert.equal(firstDivergence(got, fixture.rows), null)
})

gate('the fixture holds three refusals that log and four that return null silently, so a dropped log would show', () => {
  const logging = parsed.filter((row) => row.logged.length > 0).length
  assert.equal(logging, 3)
  assert.ok(parsed.every((row) => row.value === null))
})

gate('a refused wheeled build keeps its message in lastError and logs that message', async () => {
  const host = await createJoltHost({ gravity: [0, -9.81, 0] })
  const capture2 = captureErrors()
  try {
    const chassis = adapterFor(host).addBox([1, 0.3, 2], [0, 1.2, 0], true)
    const vid = host.vehicles.createWheeledVehicle(chassis, [{ ...WHEEL, suspensionSpring: { frequency: 0, damping: 0.5 } }], WHEELED_OPTS)
    assert.equal(vid, null)
    const [prefix, message] = parsed[3].logged[0]
    assert.equal(host.vehicles.lastError, message)
    assert.deepEqual(capture2.take(), [[prefix, message]])
  } finally {
    capture2.restore()
    host.destroy()
  }
})

finish()
