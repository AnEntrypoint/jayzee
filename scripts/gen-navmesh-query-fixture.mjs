import { writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { runNavmeshQueries } from './lib/navmeshQueryScenario.mjs'

const spointRoot = resolve(process.argv[2] ?? '/workspace/spoint')
const outFile = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'spoint', 'navmesh-query.json')
const load = (rel) => import(pathToFileURL(join(spointRoot, rel)).href)

const { NavmeshQuery } = await load('src/pathfinding/NavmeshQuery.js')
const { ChartNavmeshQuery } = await load('src/pathfinding/ChartNavmeshQuery.js')

const log = runNavmeshQueries({ NavmeshQuery, ChartNavmeshQuery })
const fixture = {
  source: 'spoint src/pathfinding/NavmeshQuery.js and ChartNavmeshQuery.js, run on scripts/lib/navmeshQueryScenario.mjs. Neither spoint file imports three.js or recast-navigation, so no import is stubbed.',
  counts: {
    NavmeshQuery: log.filter((line) => line.class === 'NavmeshQuery').length,
    ChartNavmeshQuery: log.filter((line) => line.class === 'ChartNavmeshQuery').length,
  },
  log,
}
writeFileSync(outFile, JSON.stringify(fixture) + '\n')
console.log('wrote navmesh-query.json', JSON.stringify(fixture.counts))
