import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { runAppWatchScenario, spointAdapter } from './lib/appWatchScenario.mjs'

const outFile = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'spoint', 'app-watch.json')
const { AppLoader } = await import(pathToFileURL('/workspace/spoint/src/apps/AppLoader.js').href)
const result = await runAppWatchScenario(spointAdapter(AppLoader))
writeFileSync(outFile, JSON.stringify({ source: 'spoint src/apps/AppLoader.js: watchAll, debounce 100 ms, onFileChange, stopWatching', ...result }, null, 2) + '\n')
console.log('wrote app-watch.json:', result.steps.length, 'steps, initial', JSON.stringify(result.initial))
console.log(JSON.stringify(result.steps.map((s) => ({ step: s.step, reloads: s.reloads.map((r) => r.name + ':' + r.label), trees: s.trees }))))
