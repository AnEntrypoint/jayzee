import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { captureErrors } from './lib/vehicleRefusalScenario.mjs'
import { REMOVE_CASE_LABELS, REMOVE_FAULT, runVehicleRemoveScenario } from './lib/vehicleRemoveScenario.mjs'

const spointRoot = resolve(process.argv[2] ?? '/workspace/spoint')
const files = ['src/physics/World.js', 'src/physics/VehiclePhysics.js']
const sha256 = (file) => createHash('sha256').update(readFileSync(join(spointRoot, file))).digest('hex')
const joltVersion = JSON.parse(readFileSync(join(spointRoot, 'node_modules', 'jolt-physics', 'package.json'), 'utf8')).version
const { PhysicsWorld } = await import(pathToFileURL(join(spointRoot, 'src/physics/World.js')).href)

const quiet = console.log
console.log = () => {}
const capture = captureErrors()
let rows
try {
  const world = new PhysicsWorld({ gravity: [0, -9.81, 0] })
  await world.init()
  const adapter = {
    addBox: (halfExtents, position, dynamic) => world.addBody('box', halfExtents, position, dynamic ? 'dynamic' : 'static'),
    createWheeled: (chassis, wheels, opts) => world.createWheeledVehicle(chassis, wheels, opts),
    removeVehicle: (vid) => world.removeVehicle(vid),
    wheelGrounded: (vid, i) => world.isVehicleWheelGrounded(vid, i),
    injectRemoveFault: (message) => { world.physicsSystem.RemoveConstraint = () => { throw new Error(message) } },
    clearRemoveFault: () => { delete world.physicsSystem.RemoveConstraint },
    destroy: () => world.destroy(),
  }
  ;({ rows } = runVehicleRemoveScenario(adapter, capture))
} finally {
  capture.restore()
  console.log = quiet
}

const fixture = {
  source: {
    files,
    sha256: Object.fromEntries(files.map((f) => [f, sha256(f)])),
    joltPhysics: joltVersion,
  },
  labels: REMOVE_CASE_LABELS,
  fault: REMOVE_FAULT,
  rows,
}
const out = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'spoint', 'vehicle-remove.json')
writeFileSync(out, JSON.stringify(fixture, null, 2) + '\n')
console.log('wrote ' + out + ' with ' + rows.length + ' rows')
