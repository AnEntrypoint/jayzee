import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { finish, gate } from './lib/gate.mjs'
import { SOLVER_ITERATIONS_BY_PLAYERS, SOLVER_ITERATIONS_DEFAULT, solverIterationsFor } from '../src/engine/solverIterations.js'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const read = (path) => readFileSync(join(root, path), 'utf8')

gate('the 1024 tier runs 4 solver iterations, and every other tier keeps the default of 8', () => {
  assert.equal(solverIterationsFor(1024), 4)
  for (const players of [1, 64, 128, 256, 512, 2048]) assert.equal(solverIterationsFor(players), 8, 'players ' + players)
  assert.equal(SOLVER_ITERATIONS_DEFAULT, 8)
  assert.deepEqual(Object.keys(SOLVER_ITERATIONS_BY_PLAYERS), ['1024'])
})

gate('the 1024 override table is frozen', () => {
  assert.ok(Object.isFrozen(SOLVER_ITERATIONS_BY_PLAYERS))
})

gate('the host applies the tier default only when solverIterations is not given', () => {
  const source = read('src/engine/EngineWorld.js')
  assert.ok(source.includes('options.solverIterations === undefined ? solverIterationsFor(plan.players) : settings.solverIterations'))
})

gate('the render page takes its iteration count from the same tier table', () => {
  const page = read('scripts/browser/engine-render-browser.js')
  assert.ok(page.includes("import { solverIterationsFor } from '../../src/engine/solverIterations.js'"))
  assert.ok(page.includes('iterations: solverIterationsFor(TIER)'))
  assert.ok(!page.includes('iterations: 8'))
})

finish()
