import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gate, finish } from './lib/gate.mjs'
import { runQueueScenarios, runDecideCases } from './lib/hotReloadScenario.mjs'
import { HotReloadQueue } from '../src/hot/hotReloadQueue.js'
import * as decide from '../src/hot/hmrDecide.js'
import { AppContext } from './lib/hotQueueAppContextStub.mjs'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/spoint/hot-reload.json', import.meta.url), 'utf8'))
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const queue = await runQueueScenarios((rt, logger) => new HotReloadQueue(rt, { AppContext, logger }))
const decided = runDecideCases(decide)

gate('the fixture covers the five queue scenarios and the seven decision helpers this gate runs', () => {
  assert.deepEqual(Object.keys(fixture.queue).sort(), Object.keys(queue).sort())
  assert.deepEqual(Object.keys(fixture.decide).sort(), Object.keys(decided).sort())
})

gate('jayzee HotReloadQueue matches spoint on app order, teardown, setup and the entity state after reloads', () => {
  assert.ok(same(queue.order, fixture.queue.order), 'order scenario differs from spoint')
})

gate('jayzee HotReloadQueue matches spoint on the migrate forms: dual-shape, plain, undefined, a throwing migrate, and the from and to versions', () => {
  assert.ok(same(queue.migrate, fixture.queue.migrate), 'migrate scenario differs from spoint')
})

gate('jayzee HotReloadQueue matches spoint on an unversioned runtime, where the first reload runs from version 1 and persists placed models', () => {
  assert.ok(same(queue.unversioned, fixture.queue.unversioned), 'unversioned scenario differs from spoint')
})

gate('jayzee HotReloadQueue matches spoint on a failing rebuild, a throwing callback, and a drain re-entered from a callback', () => {
  assert.ok(same(queue.errors, fixture.queue.errors), 'error scenario differs from spoint')
})

gate('jayzee HotReloadQueue matches spoint on duplicate entries, which both run, and on the heartbeat reset', () => {
  assert.ok(same(queue.duplicates, fixture.queue.duplicates), 'duplicate scenario differs from spoint')
})

gate('hmrDecide ancestorsOf matches spoint on 120 random parent graphs', () => {
  assert.ok(same(decided.ancestorsOf, fixture.decide.ancestorsOf), 'ancestorsOf differs from spoint')
})

gate('hmrDecide findBoundaries matches spoint on 120 random acceptor graphs, including the null result', () => {
  assert.ok(same(decided.findBoundaries, fixture.decide.findBoundaries), 'findBoundaries differs from spoint')
})

gate('hmrDecide isClass, loadedByPath, sameValue and nothingLive match spoint', () => {
  assert.ok(same(decided.isClass, fixture.decide.isClass), 'isClass differs from spoint')
  assert.ok(same(decided.loadedByPath, fixture.decide.loadedByPath), 'loadedByPath differs from spoint')
  assert.ok(same(decided.sameValue, fixture.decide.sameValue), 'sameValue differs from spoint')
  assert.ok(same(decided.nothingLive, fixture.decide.nothingLive), 'nothingLive differs from spoint')
})

gate('hmrDecide createLoadedPaths matches spoint on 40 absorb sequences, including the reset on a shrink, and a null entry list that throws on both sides', () => {
  assert.ok(same(decided.createLoadedPaths, fixture.decide.createLoadedPaths), 'createLoadedPaths differs from spoint')
})

gate('control: the queue scenarios reach the error paths, both boundary outcomes and a shrink reset', () => {
  assert.ok(fixture.queue.migrate.log.includes('appError migrate(m) bad migrate'))
  assert.ok(fixture.queue.errors.log.includes('error [HotReloadQueue] hotReload(w) error: rebuild broke'))
  assert.ok(fixture.queue.errors.log.includes('error [HotReloadQueue] callback error: cb boom'))
  assert.ok(fixture.decide.findBoundaries.some((b) => b === null) && fixture.decide.findBoundaries.some((b) => Array.isArray(b)))
  assert.ok(fixture.decide.createLoadedPaths.some((seq) => seq.some((step) => typeof step.absorbed === 'string')))
})

finish()
