import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { finish, gate } from './lib/gate.mjs'
import { FIXED_GLUE, STATE_KEY, THREADED_GLUE, THREADED_WORKERS, runStateScenario, stateHash } from './lib/stateHash1024.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const glueUrl = (path) => pathToFileURL(join(root, path)).href
const pins = JSON.parse(readFileSync(join(root, 'engine/state-hashes.json'), 'utf8'))

const fixedPositions = await runStateScenario(glueUrl(FIXED_GLUE), 1)
const threadedPositions = await runStateScenario(glueUrl(THREADED_GLUE), THREADED_WORKERS)
const fixed = stateHash(fixedPositions)

gate('the 1024-tier scenario moves bodies, so the hash is not of a still world', () => {
  assert.equal(fixedPositions.length, 10240 * 3)
  assert.notDeepEqual(fixedPositions.slice(0, 3), [0, 0, 0])
})

gate('the fixed and threaded builds agree on the 1024-tier state, bit for bit', () => {
  assert.equal(stateHash(threadedPositions), fixed)
})

gate('the 1024-tier state hash equals its pin in engine/state-hashes.json', () => {
  assert.ok(typeof pins[STATE_KEY] === 'string' && /^[0-9a-f]{8}$/.test(pins[STATE_KEY]), 'no pin for ' + STATE_KEY + '; run gen-engine-state-hash-1024')
  assert.equal(fixed, pins[STATE_KEY])
})

finish()
