import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gate, finish } from './lib/gate.mjs'
import { runClusterSlice } from './lib/clusterSliceScenario.mjs'
import { createClusterWorldHost, ClusterWorldCapacityError } from '../src/sharding/clusterWorldHost.js'
import { createClusterCoordinator } from '../src/sharding/clusterCoordinator.js'
import { createClusterManager } from '../src/sharding/clusterManager.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/spoint/cluster-slice.json', import.meta.url), 'utf8'))
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const ran = await runClusterSlice({ createClusterWorldHost, ClusterWorldCapacityError, createClusterCoordinator, createClusterManager })

gate('the world host matches spoint on creation, capacity refusal, idle sweeps, destruction and the stats', () => {
  assert.ok(same(ran.host.log, fixture.host.log), 'world host log differs from spoint')
})

gate('the coordinator matches spoint on admitting, refusing and clearing clusters, handoff events and a failing world', () => {
  assert.ok(same(ran.coordinator.log, fixture.coordinator.log), 'coordinator log differs from spoint')
})

gate('the cluster manager matches spoint on the assignment steps, the period gate, rejections, listeners and the tallies', () => {
  assert.ok(same(ran.manager.log, fixture.manager.log), 'manager log differs from spoint')
})

gate('the scenarios reach the capacity refusal, a refused cluster that is admitted later, and a rejected player', () => {
  assert.ok(fixture.host.log.some((line) => line.startsWith('ensure c3 at capacity threw ["ClusterWorldCapacityError"')))
  assert.ok(fixture.coordinator.log.some((line) => line.startsWith('refusals [{"clusterId":"c"')))
  assert.ok(fixture.coordinator.log.includes('ensure c {"anchorDir":[0,1,0],"spawnCount":2}'))
  assert.ok(fixture.manager.log.some((line) => line.startsWith('warn [clusters] player 4 left out')))
})

gate('a world host and a cluster manager without a now() clock are refused, where spoint defaults to performance.now', () => {
  assert.throws(() => createClusterWorldHost({ createWorld: () => null, destroyWorld: () => null, maxWorlds: 1, idleGraceMs: 1 }), TypeError)
  assert.throws(() => createClusterManager({ config: { radius: 1, linkM: 1, memberRadiusM: 1, hz: 1 } }), TypeError)
})

finish()
