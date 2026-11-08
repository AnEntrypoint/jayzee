import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { canon, firstDivergence } from './lib/canon.mjs'
import { runRecastBakeScenario, RECAST_CASE_LABELS, bakeCase } from './lib/recastBakeScenario.mjs'
import { bakeNavmesh } from '../src/pathfinding/recastBake.js'

const fixture = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'spoint', 'recast-bake.json'), 'utf8'))
const got = await runRecastBakeScenario({ bakeNavmesh })

gate('the fixture was generated from spoint src/pathfinding/RecastIntegration.js with recast-navigation 0.43.1', () => {
  assert.equal(fixture.source.file, 'src/pathfinding/RecastIntegration.js')
  assert.equal(fixture.source.recastNavigation, '0.43.1')
  assert.match(fixture.source.sha256, /^[0-9a-f]{64}$/)
})

gate('the fixture covers every scenario case in order, including the refusals and the recast failure', () => {
  assert.equal(fixture.sections.bakes.length, RECAST_CASE_LABELS.length)
  assert.ok(fixture.sections.bakes.some((row) => row.includes('positions must be a flat xyz array')))
  assert.ok(fixture.sections.bakes.some((row) => row.includes('indices must be a flat triangle list')))
})

gate('bakeNavmesh equals spoint on every case: vertices, polygons, links, bounds and config, with the same refusals', () => {
  assert.equal(firstDivergence(got.bakes, fixture.sections.bakes), null)
})

gate('the fixture holds a navmesh with links, so a link difference would show', () => {
  const flat = fixture.sections.bakes[RECAST_CASE_LABELS.indexOf('ground with an elevated 2 m box')]
  assert.ok(flat.includes('"links"') && !flat.includes('"links":[]'))
})

gate('negative control: a changed cell size moves the flat-ground navmesh away from the spoint fixture', async () => {
  const { mesh } = bakeCase('flat ground 10 m, default agent')
  const { positions, indices } = mesh()
  const changed = canon({ label: 'flat ground 10 m, default agent', result: await bakeNavmesh({ positions, indices, cellSize: 0.2 }) })
  assert.notEqual(changed, fixture.sections.bakes[RECAST_CASE_LABELS.indexOf('flat ground 10 m, default agent')])
})

finish()
