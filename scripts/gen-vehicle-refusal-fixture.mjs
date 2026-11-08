import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { captureErrors, runRefusalScenario } from './lib/vehicleRefusalScenario.mjs'

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
    createTracked: (chassis, wheels, opts) => world.createTrackedVehicle(chassis, wheels, opts),
    destroy: () => world.destroy(),
  }
  ;({ rows } = runRefusalScenario(adapter, capture))
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
  rows,
}
const out = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'spoint', 'vehicle-refusal.json')
writeFileSync(out, JSON.stringify(fixture, null, 2) + '\n')
console.log('wrote ' + out + ' with ' + rows.length + ' rows')
