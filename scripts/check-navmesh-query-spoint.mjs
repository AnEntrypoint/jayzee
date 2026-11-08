import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gate, finish } from './lib/gate.mjs'
import { runNavmeshQueries } from './lib/navmeshQueryScenario.mjs'
import { NavmeshQuery } from '../src/pathfinding/NavmeshQuery.js'
import { ChartNavmeshQuery } from '../src/pathfinding/ChartNavmeshQuery.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/spoint/navmesh-query.json', import.meta.url), 'utf8'))
const ours = runNavmeshQueries({ NavmeshQuery, ChartNavmeshQuery })
const forClass = (log, cls) => log.filter((line) => line.class === cls)
const valueOf = (log, step) => {
  const found = log.find((line) => line.step === step)
  assert.ok(found, `no step "${step}" in the fixture`)
  return found.value
}

gate('NavmeshQuery matches spoint on every path, locate, contains, distance, corridor, portal, funnel, cache and refusal case', () => {
  assert.equal(JSON.stringify(forClass(ours, 'NavmeshQuery')), JSON.stringify(forClass(fixture.log, 'NavmeshQuery')))
})

gate('ChartNavmeshQuery matches spoint on every transfer, delegation, fetch-per-epoch and getter case', () => {
  assert.equal(JSON.stringify(forClass(ours, 'ChartNavmeshQuery')), JSON.stringify(forClass(fixture.log, 'ChartNavmeshQuery')))
})

gate('the fixture covers a successful path, a failed path, a shared-border locate, a chart transfer and a cache hit', () => {
  assert.ok(Array.isArray(valueOf(fixture.log, 'path straight across the shared edge')), 'no successful path')
  assert.equal(valueOf(fixture.log, 'path from off the mesh (failed)'), null, 'the off-mesh path was not refused')
  assert.equal(valueOf(fixture.log, 'locate [2,0,1]'), 0, 'the shared border did not locate to the first polygon')
  assert.ok(Array.isArray(valueOf(fixture.log, 'chart transfer findPath')), 'no chart transfer path')
  assert.equal(valueOf(fixture.log, 'cache solve calls after two identical queries'), 1, 'the second identical query was not a cache hit')
})

finish()
