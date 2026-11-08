import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runAll } from './lib/clusterHandoffScenarios.mjs'

const spointRoot = resolve(process.argv[2] ?? '/workspace/spoint')
const outDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'spoint')
const routerPath = join(spointRoot, 'src/sharding/RegionRouter.js')

const sessionTokenSlice = () => {
  const text = readFileSync(routerPath, 'utf8')
  const start = text.indexOf('export const SESSION_TOKEN_MALFORMED')
  const fnStart = text.indexOf('export function parseSessionToken', start)
  const end = text.indexOf('\n}\n', fnStart) + 3
  if (start < 0 || fnStart < 0 || end < 3) throw new Error('spoint RegionRouter.js no longer carries parseSessionToken in the expected shape')
  return text.slice(start, end)
}

registerHooks({
  load(url, context, nextLoad) {
    if (url.startsWith('file:') && fileURLToPath(url) === routerPath) return { format: 'module', source: sessionTokenSlice(), shortCircuit: true }
    return nextLoad(url, context)
  },
})

const result = await runAll({
  assignment: await import(join(spointRoot, 'src/shared/clusterAssignment.js')),
  chart: await import(join(spointRoot, 'src/shared/chartAnchor.js')),
  policy: await import(join(spointRoot, 'src/shared/chartReanchorPolicy.js')),
  flow: await import(join(spointRoot, 'src/sharding/ClusterHandoff.js')),
  anchorBasis: (await import(join(spointRoot, 'src/terrain/PlanetFrame.js'))).anchorBasis,
})

mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'cluster-handoff.json'), JSON.stringify({
  generatedFrom: 'spoint src/shared/clusterAssignment.js, src/shared/chartReanchorPolicy.js, src/sharding/ClusterHandoff.js through scripts/lib/clusterHandoffScenarios.mjs',
  result,
}, null, 1) + '\n')
console.log('wrote ' + join(outDir, 'cluster-handoff.json'))
