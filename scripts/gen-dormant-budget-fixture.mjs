import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DORMANT_BUDGET_LABELS, runDormantBudgetScenario } from './lib/dormantBudgetScenario.mjs'

const spointRoot = resolve(process.argv[2] ?? '/workspace/spoint')
const files = ['src/physics/World.js', 'src/physics/DormantStatics.js']
const sha256 = (file) => createHash('sha256').update(readFileSync(join(spointRoot, file))).digest('hex')
const joltVersion = JSON.parse(readFileSync(join(spointRoot, 'node_modules', 'jolt-physics', 'package.json'), 'utf8')).version
const { PhysicsWorld } = await import(pathToFileURL(join(spointRoot, 'src/physics/World.js')).href)
const { createDormantStatics } = await import(pathToFileURL(join(spointRoot, 'src/physics/DormantStatics.js')).href)

const quiet = console.log
console.log = () => {}
let rows
try {
  const world = new PhysicsWorld({ gravity: [0, -9.81, 0] })
  await world.init()
  const dormant = createDormantStatics(world)
  const adapter = {
    addStatic: (position) => world.addStaticBox([0.5, 0.5, 0.5], position),
    park: (entries) => dormant.park(entries),
    drain: (budgetMs, movers, clock) => {
      const ownNow = Object.prototype.hasOwnProperty.call(performance, 'now')
      const previous = performance.now
      performance.now = clock.now
      try {
        return dormant.drain(budgetMs, movers)
      } finally {
        if (ownNow) performance.now = previous
        else delete performance.now
      }
    },
    pending: () => dormant.pendingCount,
    destroy: () => world.destroy(),
  }
  ;({ rows } = runDormantBudgetScenario(adapter))
} finally {
  console.log = quiet
}

const fixture = {
  source: {
    files,
    sha256: Object.fromEntries(files.map((f) => [f, sha256(f)])),
    joltPhysics: joltVersion,
    clock: 'the global performance.now, swapped for a counted clock during each drain call, because spoint drain reads it directly',
  },
  labels: DORMANT_BUDGET_LABELS,
  rows,
}
const out = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'spoint', 'dormant-budget.json')
writeFileSync(out, JSON.stringify(fixture, null, 2) + '\n')
console.log('wrote ' + out + ' with ' + rows.length + ' rows')
