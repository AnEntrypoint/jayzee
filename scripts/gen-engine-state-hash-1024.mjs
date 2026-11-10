import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { FIXED_GLUE, STATE_KEY, THREADED_GLUE, THREADED_WORKERS, runStateScenario, stateHash } from './lib/stateHash1024.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const pinsPath = join(root, 'engine/state-hashes.json')
const glueUrl = (path) => pathToFileURL(join(root, path)).href

const fixed = stateHash(await runStateScenario(glueUrl(FIXED_GLUE), 1))
const threaded = stateHash(await runStateScenario(glueUrl(THREADED_GLUE), THREADED_WORKERS))
if (fixed !== threaded) {
  console.error('FAIL fixed ' + fixed + ' and threaded ' + threaded + ' disagree; no pin written')
  process.exitCode = 1
} else {
  const pins = JSON.parse(readFileSync(pinsPath, 'utf8'))
  pins[STATE_KEY] = fixed
  writeFileSync(pinsPath, JSON.stringify(pins, null, 2) + '\n')
  console.log('PIN ' + STATE_KEY + ' ' + fixed)
}
