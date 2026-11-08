import { writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { MIRROR_CFG, runMirrorScenario } from './lib/collisionMirrorScenario.mjs'

const spointRoot = resolve(process.argv[2] ?? '/workspace/spoint')
const outFile = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'spoint', 'collision-mirror.json')

const { createCollisionMirror } = await import(pathToFileURL(join(spointRoot, 'src/client/CollisionMirror.js')).href)
const { PhysicsWorld } = await import(pathToFileURL(join(spointRoot, 'src/physics/World.js')).href)

const mirror = createCollisionMirror({ loadPhysicsWorld: async () => PhysicsWorld })
const records = await runMirrorScenario(mirror)
mirror.dispose()

const fixture = {
  source: 'spoint src/client/CollisionMirror.js with src/physics/World.js PhysicsWorld, jolt-physics 1.1.0',
  cfg: MIRROR_CFG,
  records,
}
writeFileSync(outFile, JSON.stringify(fixture, null, 2) + '\n')
console.log('wrote collision-mirror.json:', records.length, 'records; covered steps', records.filter((r) => r.covers).length)
