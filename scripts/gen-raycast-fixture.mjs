import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { runRaycastScenario } from './lib/raycastScenario.mjs'

const spointRoot = resolve(process.argv[2] ?? '/workspace/spoint')
const worldFile = 'src/physics/World.js'
const dormantFile = 'src/physics/DormantStatics.js'
const sha256 = (file) => createHash('sha256').update(readFileSync(join(spointRoot, file))).digest('hex')
const joltVersion = JSON.parse(readFileSync(join(spointRoot, 'node_modules', 'jolt-physics', 'package.json'), 'utf8')).version

const { PhysicsWorld } = await import(pathToFileURL(join(spointRoot, worldFile)).href)

const quiet = console.log
console.log = () => {}
let rows
try {
  const world = new PhysicsWorld({ gravity: [0, -9.81, 0] })
  await world.init()
  let entityId = 0
  const adapter = {
    addStatic: (vertices, indices, position) => world.addStaticTrimeshFromData(++entityId, vertices, indices, position),
    cast: (origin, direction, maxDistance, exclude) => world.raycast(origin, direction, maxDistance, exclude),
    park: (bodyId, position) => world.dormantStatics.park([{ bodyId, owner: { position, rotation: [0, 0, 0, 1] } }]),
    drainAll: () => world.dormantStatics.drainAll(),
    destroy: () => world.destroy(),
  }
  ;({ rows } = await runRaycastScenario(adapter))
} finally {
  console.log = quiet
}

const fixture = {
  source: {
    file: worldFile,
    sha256: sha256(worldFile),
    dormantFile,
    dormantSha256: sha256(dormantFile),
    joltPhysics: joltVersion,
  },
  rows,
}
const out = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'spoint', 'raycast.json')
writeFileSync(out, JSON.stringify(fixture, null, 2) + '\n')
console.log('wrote ' + out + ' from ' + worldFile + ' with ' + rows.length + ' rows')
