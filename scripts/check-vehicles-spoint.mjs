import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gate, finish } from './lib/gate.mjs'
import { firstDivergence } from './lib/canon.mjs'
import { VEHICLE_CASE_LABELS, runVehiclesScenario } from './lib/vehiclesScenario.mjs'
import { createJoltHost } from '../src/collision/joltHost.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/spoint/vehicles.json', import.meta.url), 'utf8'))

const LAYER_STATIC = 0
const LAYER_DYNAMIC = 1
const boxCr = (h, dynamic) => (dynamic ? Math.min(0.05, Math.min(h[0], h[1], h[2]) * 0.1) : 0.05)

function joltAdapter(host) {
  const J = host.Jolt
  return {
    addBox: (h, position, dynamic) => {
      const hv = new J.Vec3(h[0], h[1], h[2])
      const shape = new J.BoxShape(hv, boxCr(h, dynamic), null)
      J.destroy(hv)
      return dynamic
        ? host.addBody(shape, position, J.EMotionType_Dynamic, LAYER_DYNAMIC)
        : host.addBody(shape, position, J.EMotionType_Static, LAYER_STATIC)
    },
    createWheeled: (chassis, wheels, opts) => host.vehicles.createWheeledVehicle(chassis, wheels, opts),
    createTracked: (chassis, wheels, opts) => host.vehicles.createTrackedVehicle(chassis, wheels, opts),
    driveWheeled: (vid, forward, right, brake, handbrake) => host.vehicles.setVehicleDriverInput(vid, forward, right, brake, handbrake),
    driveTracked: (vid, forward, left, right, brake) => host.vehicles.setTrackedVehicleDriverInput(vid, forward, left, right, brake),
    wheelTransform: (vid, i) => host.vehicles.getVehicleWheelTransform(vid, i),
    wheelSpeed: (vid, i) => host.vehicles.getVehicleWheelSpeed(vid, i),
    wheelGrounded: (vid, i) => host.vehicles.isVehicleWheelGrounded(vid, i),
    chassisState: (id) => {
      const body = host.bodies.get(id)
      if (!body) return null
      const bid = body.GetID(), p = host.bodyInterface.GetPosition(bid), q = host.bodyInterface.GetRotation(bid)
      return { position: [p.GetX(), p.GetY(), p.GetZ()], rotation: [q.GetX(), q.GetY(), q.GetZ(), q.GetW()] }
    },
    removeVehicle: (vid) => host.vehicles.removeVehicle(vid),
    step: (dt, substeps) => host.step(dt, substeps),
    aim: (rotation, direction, limits) => host.vehicles.solveTurretAim(rotation, direction, limits),
    entityAim: (vid, direction, limits) => host.vehicles.solveEntityTurretAim(vid, direction, limits),
    destroy: () => host.destroy(),
  }
}

const got = runVehiclesScenario(joltAdapter(await createJoltHost({ gravity: [0, -9.81, 0] })))

const firstZ = (row) => {
  const m = row.match(/"position":\[n:[^,]+,n:[^,]+,n:([^\]]+)\]/)
  return m ? Number(m[1].replace('n:', '')) : NaN
}

gate('the fixture was generated from spoint src/physics/World.js and VehiclePhysics.js with jolt-physics 1.1.0', () => {
  assert.deepEqual(Object.keys(fixture.source.sha256).sort(), ['src/physics/VehiclePhysics.js', 'src/physics/World.js'])
  assert.equal(fixture.source.joltPhysics, '1.1.0')
})

gate('the fixture covers every vehicle case in order, including the refusals and the unknown-id queries', () => {
  assert.equal(fixture.rows.length, VEHICLE_CASE_LABELS.length)
  VEHICLE_CASE_LABELS.forEach((label, i) => assert.ok(fixture.rows[i].includes('s:' + JSON.stringify(label)), label))
})

gate('wheeled and tracked vehicles, turret aim and the refusals equal spoint on every case', () => {
  assert.equal(firstDivergence(got.rows, fixture.rows), null)
})

gate('the fixture shows the wheeled chassis moving under drive, so a dead drive input would show', () => {
  const settled = firstZ(fixture.rows[1])
  const driven = firstZ(fixture.rows[2])
  assert.ok(driven - settled > 0.5, 'z moved ' + (driven - settled))
})

gate('the fixture shows the tracked chassis moving under drive, so a dead track input would show', () => {
  const settled = fixture.rows[16].match(/"position":\[n:([^,]+),n:[^,]+,n:([^\]]+)\]/)
  const driven = fixture.rows[17].match(/"position":\[n:([^,]+),n:[^,]+,n:([^\]]+)\]/)
  assert.ok(Number(driven[2].replace('n:', '')) - Number(settled[2].replace('n:', '')) > 0.5)
})

gate('the fixture holds the refusals as null, so a vehicle created on a bad input would show', () => {
  for (const i of [9, 10, 11, 12, 13, 14, 24]) assert.ok(fixture.rows[i].endsWith('"value":null}'), VEHICLE_CASE_LABELS[i])
})

finish()
