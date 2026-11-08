import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gate, finish } from './lib/gate.mjs'
import { firstDivergence } from './lib/canon.mjs'
import { runVehiclesScenario } from './lib/vehiclesScenario.mjs'
import { WHEEL, WHEELED_OPTS, captureErrors } from './lib/vehicleRefusalScenario.mjs'
import { createJoltHost, loadJolt } from '../src/collision/joltHost.js'
import { PhysicsIntegration } from '../src/netcode/PhysicsIntegration.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/spoint/vehicles.json', import.meta.url), 'utf8'))
const refusalFixture = JSON.parse(readFileSync(new URL('./fixtures/spoint/vehicle-refusal.json', import.meta.url), 'utf8'))
const J = await loadJolt()
const LAYER_STATIC = 0
const LAYER_DYNAMIC = 1
const boxCr = (h, dynamic) => (dynamic ? Math.min(0.05, Math.min(h[0], h[1], h[2]) * 0.1) : 0.05)
const boxOf = (host, h, position, dynamic) => {
  const hv = new J.Vec3(h[0], h[1], h[2])
  const shape = new J.BoxShape(hv, boxCr(h, dynamic), null)
  J.destroy(hv)
  return dynamic ? host.addBody(shape, position, J.EMotionType_Dynamic, LAYER_DYNAMIC) : host.addBody(shape, position, J.EMotionType_Static, LAYER_STATIC)
}

const host = await createJoltHost({ gravity: [0, -9.81, 0] })
const integration = new PhysicsIntegration({ physicsWorld: host })
const got = runVehiclesScenario({
  addBox: (h, position, dynamic) => boxOf(host, h, position, dynamic),
  createWheeled: (chassis, wheels, opts) => integration.createWheeledVehicle(chassis, wheels, opts),
  createTracked: (chassis, wheels, opts) => integration.createTrackedVehicle(chassis, wheels, opts),
  driveWheeled: (vid, forward, right, brake, handbrake) => integration.setVehicleDriverInput(vid, forward, right, brake, handbrake),
  driveTracked: (vid, forward, left, right, brake) => integration.setTrackedVehicleDriverInput(vid, forward, left, right, brake),
  wheelTransform: (vid, i) => integration.getVehicleWheelTransform(vid, i),
  wheelSpeed: (vid, i) => integration.getVehicleWheelSpeed(vid, i),
  wheelGrounded: (vid, i) => integration.isVehicleWheelGrounded(vid, i),
  chassisState: (id) => {
    const body = host.bodies.get(id)
    if (!body) return null
    const bid = body.GetID(), p = host.bodyInterface.GetPosition(bid), q = host.bodyInterface.GetRotation(bid)
    return { position: [p.GetX(), p.GetY(), p.GetZ()], rotation: [q.GetX(), q.GetY(), q.GetZ(), q.GetW()] }
  },
  removeVehicle: (vid) => integration.removeVehicle(vid),
  step: (dt, substeps) => host.step(dt, substeps),
  aim: (rotation, direction, limits) => integration.solveTurretAim(rotation, direction, limits),
  entityAim: (vid, direction, limits) => integration.solveEntityTurretAim(vid, direction, limits),
  destroy: () => host.destroy(),
}).rows

const refusalHost = await createJoltHost({ gravity: [0, -9.81, 0] })
const refusalIntegration = new PhysicsIntegration({ physicsWorld: refusalHost })
const refusalChassis = boxOf(refusalHost, [1, 0.3, 2], [0, 1.2, 0], true)
const refusalCapture = captureErrors()
let refusedVid = 'unset'
try {
  refusedVid = refusalIntegration.createWheeledVehicle(refusalChassis, [{ ...WHEEL, suspensionSpring: { frequency: 0, damping: 0.5 } }], WHEELED_OPTS)
} catch (error) {
  refusedVid = { threw: error.message }
} finally {
  refusalCapture.restore()
}
const refusedLogs = refusalCapture.take()
const refusedError = refusalIntegration.vehicleError
refusalHost.destroy()

const bareIntegration = new PhysicsIntegration({})
let bareError = null
try {
  bareIntegration.createWheeledVehicle(1, [], {})
} catch (error) {
  bareError = error
}

const parsedRefusal = JSON.parse(refusalFixture.rows[3].replace(/s:/g, '').replace(/n:/g, ''))

gate('the spoint vehicles fixture is the reference this gate drives', () => {
  assert.equal(fixture.rows.length, 25)
})

gate('the wired path drives every vehicle case and matches spoint row for row', () => {
  assert.equal(firstDivergence(got, fixture.rows), null)
})

gate('the wired path refuses a physics world with no vehicle backend with a TypeError that names it', () => {
  assert.ok(bareError instanceof TypeError)
  assert.match(bareError.message, /vehicle backend/)
})

gate('a refused build through the wired path returns null, keeps its message in vehicleError and logs it as the backend does', () => {
  assert.equal(refusedVid, null)
  assert.equal(refusedError, parsedRefusal.logged[0][1])
  assert.deepEqual(refusedLogs, [parsedRefusal.logged[0]])
})

finish()
