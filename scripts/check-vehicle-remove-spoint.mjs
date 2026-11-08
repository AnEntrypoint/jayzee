import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gate, finish } from './lib/gate.mjs'
import { firstDivergence } from './lib/canon.mjs'
import { captureErrors, WHEEL, WHEELED_OPTS } from './lib/vehicleRefusalScenario.mjs'
import { REMOVE_CASE_LABELS, REMOVE_FAULT, runVehicleRemoveScenario } from './lib/vehicleRemoveScenario.mjs'
import { createJoltHost, loadJolt } from '../src/collision/joltHost.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/spoint/vehicle-remove.json', import.meta.url), 'utf8'))
const J = await loadJolt()
const LOG_PREFIX = '[physics] removeVehicle cleanup error:'
const parse = (row) => JSON.parse(row.replace(/([:\[,])[snb]:/g, '$1'))

const boxOf = (host, h, position, dynamic) => {
  const hv = new J.Vec3(h[0], h[1], h[2])
  const shape = new J.BoxShape(hv, dynamic ? Math.min(0.05, Math.min(...h) * 0.1) : 0.05, null)
  J.destroy(hv)
  return dynamic ? host.addBody(shape, position, J.EMotionType_Dynamic, 1) : host.addBody(shape, position, J.EMotionType_Static, 0)
}
const WHEELS = [
  WHEEL,
  { ...WHEEL, position: [0.8, -0.35, 1.2], steer: false },
  { ...WHEEL, position: [-0.8, -0.35, -1.2], steer: false },
  { ...WHEEL, position: [0.8, -0.35, -1.2], steer: false },
]

const host = await createJoltHost({ gravity: [0, -9.81, 0] })
const capture = captureErrors()
let got
try {
  got = runVehicleRemoveScenario({
    addBox: (h, position, dynamic) => boxOf(host, h, position, dynamic),
    createWheeled: (chassis, wheels, opts) => host.vehicles.createWheeledVehicle(chassis, wheels, opts),
    removeVehicle: (vid) => host.vehicles.removeVehicle(vid),
    wheelGrounded: (vid, i) => host.vehicles.isVehicleWheelGrounded(vid, i),
    injectRemoveFault: (message) => { host.physicsSystem.RemoveConstraint = () => { throw new Error(message) } },
    clearRemoveFault: () => { delete host.physicsSystem.RemoveConstraint },
    destroy: () => host.destroy(),
  }, capture).rows
} finally {
  capture.restore()
}

gate('the fixture was generated from spoint src/physics/World.js and VehiclePhysics.js with jolt-physics 1.1.0', () => {
  assert.deepEqual(Object.keys(fixture.source.sha256).sort(), ['src/physics/VehiclePhysics.js', 'src/physics/World.js'])
  assert.equal(fixture.source.joltPhysics, '1.1.0')
})

gate('the fixture covers every removal case in order and keeps spoint\'s logs', () => {
  assert.deepEqual(fixture.labels, REMOVE_CASE_LABELS)
  assert.equal(fixture.rows.length, REMOVE_CASE_LABELS.length)
  assert.equal(fixture.fault, REMOVE_FAULT)
})

gate('the removal under a Jolt throw, its log and the later queries equal spoint on every case', () => {
  assert.equal(firstDivergence(got, fixture.rows), null)
})

gate('a Jolt throw in removeVehicle is logged with spoint\'s prefix and the removal still returns true', () => {
  const row = parse(got[1])
  assert.equal(row.value, true)
  assert.deepEqual(row.logged, [[LOG_PREFIX, REMOVE_FAULT]])
})

gate('the fixture shows the logged removal fault, so a silenced log would show', () => {
  assert.deepEqual(parse(fixture.rows[1]).logged, [[LOG_PREFIX, REMOVE_FAULT]])
})

gate('a clean removal logs nothing and a second remove of the same id returns false', () => {
  assert.deepEqual(parse(got[3]).logged, [])
  assert.equal(parse(got[3]).value, true)
  assert.equal(parse(got[4]).value, false)
})

finish()
