import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gate, finish } from './lib/gate.mjs'
import { runAppWatchScenario, jayzeeAdapter } from './lib/appWatchScenario.mjs'
import { createAppLoader } from '../src/apps/appLoader.js'
import { createNodeAppHost } from '../src/apps/nodeAppHost.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/spoint/app-watch.json', import.meta.url), 'utf8'))
const got = await runAppWatchScenario(jayzeeAdapter(createAppLoader, createNodeAppHost))
const stepOf = (name) => got.steps.find((s) => s.step === name)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

gate('the initial load registers the same apps with the same labels as spoint', () => {
  assert.ok(same(got.initial, fixture.initial), JSON.stringify(got.initial))
})

gate('every step reproduces spoint: reloads, client reload sources and tree changes, in order', () => {
  assert.ok(same(got.steps, fixture.steps), 'steps differ from spoint')
})

gate('two writes inside the debounce window reload the app once, with the final source', () => {
  const s = stepOf('two writes inside the debounce window reload once')
  assert.deepEqual(s.reloads, [{ name: 'flat', label: 'v2' }])
  assert.equal(s.clientReloads.length, 1)
  assert.ok(s.clientReloads[0].code.includes("label: 'v2'"))
})

gate('a nested file reloads the folder app by its folder name, as spoint maps it', () => {
  assert.deepEqual(stepOf('an edit to a folder app reloads the folder by name').reloads, [{ name: 'folder', label: 'f2' }])
  assert.deepEqual(stepOf('a nested non-index file reloads its folder app').reloads, [{ name: 'folder', label: 'f2' }])
  assert.deepEqual(stepOf('a nested non-index file reloads its folder app').trees, ['folder/helper.js'])
})

gate('a non-js change is reported to the tree callback and reloads nothing', () => {
  const s = stepOf('a non-js file is reported and reloads nothing')
  assert.deepEqual(s.reloads, [])
  assert.deepEqual(s.trees, ['notes.txt'])
})

gate('a refused source is not reloaded and the running app stays the last good one', () => {
  const s = stepOf('a refused source is not reloaded')
  assert.deepEqual(s.reloads, [])
  assert.equal(s.clientReloads.length, 0)
})

gate('the next valid edit loads the new source, not a cached module', () => {
  assert.deepEqual(stepOf('the next valid edit loads the new source, not a cached module').reloads, [{ name: 'flat', label: 'v3' }])
})

gate('stopWatching ends the watch: an edit after it reports and reloads nothing', () => {
  const s = stepOf('an edit after stopWatching reloads nothing')
  assert.deepEqual(s.reloads, [])
  assert.deepEqual(s.trees, [])
})

finish()
