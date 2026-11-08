import { writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { runClusterSlice } from './lib/clusterSliceScenario.mjs'

const spointRoot = resolve(process.argv[2] ?? '/workspace/spoint')
const outFile = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'spoint', 'cluster-slice.json')
const load = (rel) => import(pathToFileURL(join(spointRoot, rel)).href)

const { createClusterWorldHost, ClusterWorldCapacityError } = await load('src/sharding/ClusterWorldHost.js')
const { createClusterCoordinator } = await load('src/sharding/ClusterCoordinator.js')
const { createClusterManager } = await load('src/sharding/ClusterManager.js')

const out = await runClusterSlice({ createClusterWorldHost, ClusterWorldCapacityError, createClusterCoordinator, createClusterManager })
const fixture = {
  source: 'spoint src/sharding/ClusterWorldHost.js, ClusterCoordinator.js and ClusterManager.js, run on scripts/lib/clusterSliceScenario.mjs',
  ...out,
}
writeFileSync(outFile, JSON.stringify(fixture, null, 1) + '\n')
console.log('wrote cluster-slice.json: host', out.host.log.length, 'coordinator', out.coordinator.log.length, 'manager', out.manager.log.length)
