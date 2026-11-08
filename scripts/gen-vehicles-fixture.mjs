import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { runVehiclesScenario } from './lib/vehiclesScenario.mjs'

const spointRoot = resolve(process.argv[2] ?? '/workspace/spoint')
const files = ['src/physics/World.js', 'src/physics/VehiclePhysics.js']
const sha256 = (file) => createHash('sha256').update(readFileSync(join(spointRoot, file))).digest('hex')
const joltVersion = JSON.parse(readFileSync(join(spointRoot, 'node_modules', 'jolt-physics', 'package.json'), 'utf8')).version

const { PhysicsWorld } = await import(pathToFileURL(join(spointRoot, 'src/physics/World.js')).href)

const quiet = console.log
const quietError = console.error
console.log = () => {}
console.error = () => {}
let rows
try {
  const world = new PhysicsWorld({ gravity: [0, -9.81, 0] })
  await world.init()
  const adapter = {
    addBox: (halfExtents, position, dynamic) => (dynamic ? world.addBody('box', halfExtents, position, 'dynamic') : world.addStaticBox(halfExtents, position)),
    createWheeled: (chassis, wheels, opts) => world.createWheeledVehicle(chassis, wheels, opts),
    createTracked: (chassis, wheels, opts) => world.createTrackedVehicle(chassis, wheels, opts),
    driveWheeled: (vid, forward, right, brake, handbrake) => world.setVehicleDriverInput(vid, forward, right, brake, handbrake),
    driveTracked: (vid, forward, left, right, brake) => world.setTrackedVehicleDriverInput(vid, forward, left, right, brake),
    wheelTransform: (vid, i) => world.getVehicleWheelTransform(vid, i),
    wheelSpeed: (vid, i) => world.getVehicleWheelSpeed(vid, i),
    wheelGrounded: (vid, i) => world.isVehicleWheelGrounded(vid, i),
    chassisState: (id) => {
      const b = world.bodies.get(id)
      if (!b) return null
      const bid = b.GetID(), p = world.bodyInterface.GetPosition(bid), q = world.bodyInterface.GetRotation(bid)
      const out = { position: [p.GetX(), p.GetY(), p.GetZ()], rotation: [q.GetX(), q.GetY(), q.GetZ(), q.GetW()] }
      return out
    },
    removeVehicle: (vid) => world.removeVehicle(vid),
    step: (dt, substeps) => world.step(dt, substeps),
    aim: (rotation, direction, limits) => world.solveTurretAim(rotation, direction, limits),
    entityAim: (vid, direction, limits) => world.solveEntityTurretAim(vid, direction, limits),
    destroy: () => world.destroy(),
  }
  ;({ rows } = runVehiclesScenario(adapter))
} finally {
  console.log = quiet
  console.error = quietError
}

const fixture = {
  source: {
    files,
    sha256: Object.fromEntries(files.map((f) => [f, sha256(f)])),
    joltPhysics: joltVersion,
  },
  rows,
}
const out = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'spoint', 'vehicles.json')
writeFileSync(out, JSON.stringify(fixture, null, 2) + '\n')
console.log('wrote ' + out + ' with ' + rows.length + ' rows')
