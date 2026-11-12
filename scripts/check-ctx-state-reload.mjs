import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { APP_INVALID, APP_UNKNOWN, createAppRuntime } from '../src/apps/appRuntime.js'

const TICK_DT = 1 / 64

const counterV1 = { server: { setup: (ctx) => { ctx.state.count ??= 0 }, update: (ctx) => { ctx.state.count += 1 } } }
const counterV2 = { server: { setup: (ctx) => { ctx.state.count ??= 0; ctx.state.version = 2 }, update: (ctx) => { ctx.state.count += 10 } } }

gate('ctx.state survives a hot reload: the new code sees the values the old code wrote, on the same object', () => {
  const runtime = createAppRuntime({ tickDt: TICK_DT, capacity: 4 })
  runtime.registerApp('counter', counterV1)
  const id = runtime.spawn({ app: 'counter' })
  const before = runtime.contextOf(id).state
  for (let t = 0; t < 3; t++) runtime.tick(t)
  assert.equal(runtime.hotReload('counter', counterV2), 1)
  runtime.tick(3)
  const after = runtime.contextOf(id).state
  assert.equal(after, before)
  assert.deepEqual(after, { count: 13, version: 2 })
})

gate('the control: destroying and respawning the entity instead of reloading loses the state', () => {
  const runtime = createAppRuntime({ tickDt: TICK_DT, capacity: 4 })
  runtime.registerApp('counter', counterV1)
  const id = runtime.spawn({ app: 'counter' })
  for (let t = 0; t < 3; t++) runtime.tick(t)
  runtime.destroy(id)
  const again = runtime.spawn({ app: 'counter' })
  assert.deepEqual(runtime.contextOf(again).state, { count: 0 })
})

gate('a hot reload runs the old teardown then the new setup for every entity of that app, and leaves other apps alone', () => {
  const runtime = createAppRuntime({ tickDt: TICK_DT, capacity: 4 })
  const log = []
  const version = (n) => ({ server: { setup: (ctx) => log.push('setup' + n + ':' + ctx.entity.id), teardown: (ctx) => log.push('teardown' + n + ':' + ctx.entity.id) } })
  runtime.registerApp('a', version(1))
  runtime.registerApp('other', { server: { setup: () => log.push('other'), teardown: () => log.push('other down') } })
  runtime.spawn({ app: 'a' })
  runtime.spawn({ app: 'other' })
  runtime.spawn({ app: 'a' })
  log.length = 0
  assert.equal(runtime.hotReload('a', version(2)), 2)
  assert.deepEqual(log, ['teardown1:0', 'teardown1:2', 'setup2:0', 'setup2:2'])
})

gate('timers of the old code are cancelled by the reload, so no closure of the old module runs afterwards', () => {
  const runtime = createAppRuntime({ tickDt: TICK_DT, capacity: 2 })
  const log = []
  runtime.registerApp('a', { server: { setup: (ctx) => ctx.time.every(TICK_DT, () => log.push('old')) } })
  runtime.spawn({ app: 'a' })
  runtime.tick(1)
  runtime.hotReload('a', { server: { setup: (ctx) => ctx.time.every(TICK_DT, () => log.push('new')) } })
  runtime.tick(2)
  runtime.tick(3)
  assert.deepEqual(log, ['old', 'new', 'new'])
  assert.equal(runtime.time.pending, 1)
})

gate('a reload with an invalid module is refused by name and the old code keeps running with its state', () => {
  const runtime = createAppRuntime({ tickDt: TICK_DT, capacity: 2 })
  runtime.registerApp('counter', counterV1)
  const id = runtime.spawn({ app: 'counter' })
  runtime.tick(0)
  assert.throws(() => runtime.hotReload('counter', { server: { update: 'nope' } }), { code: APP_INVALID })
  assert.throws(() => runtime.hotReload('missing', counterV2), { code: APP_UNKNOWN })
  runtime.tick(1)
  assert.deepEqual(runtime.contextOf(id).state, { count: 2 })
})

gate('a new setup that throws is recorded, and the state it was handed is still intact', () => {
  const runtime = createAppRuntime({ tickDt: TICK_DT, capacity: 2 })
  runtime.registerApp('counter', counterV1)
  const id = runtime.spawn({ app: 'counter' })
  runtime.tick(0)
  runtime.hotReload('counter', { server: { setup: () => { throw new Error('v2 broke') } } })
  assert.deepEqual(runtime.contextOf(id).state, { count: 1 })
  assert.deepEqual(runtime.errors.map((entry) => entry.hook + ':' + entry.message), ['setup:v2 broke'])
})

gate('state holding a Map and a Set is exported, restored into a fresh runtime by entity name, and then carried through a reload there', () => {
  const build = () => {
    const runtime = createAppRuntime({ tickDt: TICK_DT, capacity: 4 })
    runtime.registerApp('bank', { server: { setup: (ctx) => { ctx.state.accounts ??= new Map(); ctx.state.seen ??= new Set() }, update: (ctx) => { ctx.state.accounts.set('a', (ctx.state.accounts.get('a') ?? 0) + 1); ctx.state.seen.add(ctx.time.tick) } } })
    runtime.spawn({ app: 'bank', name: 'vault' })
    return runtime
  }
  const first = build()
  for (let t = 0; t < 4; t++) first.tick(t)
  const saved = JSON.parse(JSON.stringify(first.exportStates()))
  const second = build()
  assert.equal(second.importStates(saved), 1)
  second.hotReload('bank', { server: { update: (ctx) => { ctx.state.accounts.set('a', ctx.state.accounts.get('a') + 100) } } })
  second.tick(0)
  const state = second.contextOf('vault').state
  assert.equal(state.accounts.get('a'), 104)
  assert.deepEqual([...state.seen], [0, 1, 2, 3])
  assert.equal(second.importStates([{ name: 'nobody', state: {} }]), 0)
})

finish()
