import { register } from 'node:module'
import { writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

register('./lib/hotQueueHooks.mjs', import.meta.url)

const spointRoot = resolve(process.argv[2] ?? '/workspace/spoint')
const outFile = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'spoint', 'hot-reload.json')
const load = (rel) => import(pathToFileURL(join(spointRoot, rel)).href)

const { HotReloadQueue } = await load('src/apps/HotReloadQueue.js')
const decide = await load('client/dev/hmr-decide.js')
const { runQueueScenarios, runDecideCases } = await import('./lib/hotReloadScenario.mjs')

const queue = await runQueueScenarios((rt) => new HotReloadQueue(rt))
const decided = runDecideCases(decide)

const fixture = {
  source: 'spoint src/apps/HotReloadQueue.js (AppContext replaced by scripts/lib/hotQueueAppContextStub.mjs through a resolve hook) and client/dev/hmr-decide.js',
  decide: decided,
  queue,
}
writeFileSync(outFile, JSON.stringify(fixture, null, 1) + '\n')
const logs = Object.values(queue).map((s) => s.log.length)
console.log('wrote hot-reload.json: queue scenarios', Object.keys(queue).length, 'log lines', logs.join('/'), 'decide cases', decided.ancestorsOf.length, decided.loadedByPath.length, decided.createLoadedPaths.length)
