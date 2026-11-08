import { writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { makeScenarios, runAll } from './lib/playerCollisionScenario.mjs'

const spointRoot = resolve(process.argv[2] ?? '/workspace/spoint')
const outFile = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'spoint', 'player-collisions.json')
const { applyPlayerCollisions } = await import(pathToFileURL(join(spointRoot, 'src/netcode/CollisionSystem.js')).href)

const scenarios = makeScenarios()
const fixture = {
  source: 'spoint src/netcode/CollisionSystem.js applyPlayerCollisions, run on scripts/lib/playerCollisionScenario.mjs scenarios',
  inputsSha256: (await import('node:crypto')).createHash('sha256').update(JSON.stringify(scenarios)).digest('hex'),
  scenarios: runAll(applyPlayerCollisions),
}
writeFileSync(outFile, JSON.stringify(fixture, null, 1) + '\n')
const calls = fixture.scenarios.reduce((n, s) => n + s.frames.reduce((m, f) => m + f.calls.length, 0), 0)
const frames = fixture.scenarios.reduce((n, s) => n + s.frames.length, 0)
console.log('wrote player-collisions.json: scenarios', fixture.scenarios.length, 'frames', frames, 'position writes', calls)
