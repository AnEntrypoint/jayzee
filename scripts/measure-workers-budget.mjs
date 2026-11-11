import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { loadEngineModule, resolvePlan } from '../src/engine/EngineWorld.js'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const glue = pathToFileURL(join(root, process.argv[2] ?? 'engine/out/engine-core-512mib-threads.mjs')).href
const workers = Number(process.argv[3] ?? 8)
const players = 1024
const ceilingBytes = Number(process.argv[4] ?? 4 * 1024 * 1024 * 1024)
const module = await loadEngineModule(glue, resolvePlan({ players: 64, workers: 1, budgetBytes: 64 * 1024 * 1024 }))
const fits = (budget) => module._engine_plan_fits(players, workers, budget) === 1
if (!fits(ceilingBytes)) {
  console.log(JSON.stringify({ workers, players, ceilingBytes, fitsAtCeiling: false }))
} else {
  let lo = 0
  let hi = ceilingBytes
  while (hi - lo > 1024) {
    const mid = Math.floor((lo + hi) / 2)
    if (fits(mid)) hi = mid
    else lo = mid
  }
  console.log(JSON.stringify({ workers, players, ceilingBytes, fitsAtCeiling: true, smallestBudgetBytes: hi, smallestBudgetMiB: Math.round((hi / 1048576) * 100) / 100 }))
}
