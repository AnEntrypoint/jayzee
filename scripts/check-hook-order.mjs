import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { HOOK_NAMES, createHookRunner, phaseOrderHolds } from '../src/apps/hookOrder.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sourcePath = join(root, 'src', 'apps', 'hookOrder.js')
const TICK_DT = 1 / 64

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}
const same = (actual, expected, label = 'value') => {
  assert(actual === expected, label + ' is ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected))
}
const sameJson = (actual, expected, label = 'value') => same(JSON.stringify(actual), JSON.stringify(expected), label)
const near = (actual, expected, label, tolerance = 1e-12) => {
  assert(Math.abs(actual - expected) <= tolerance, label + ' is ' + actual + ', expected ' + expected)
}
const mustReject = (check) => {
  let rejected = false
  try {
    check()
  } catch (_) {
    rejected = true
  }
  assert(rejected, 'negative control was accepted')
}

gate('onSpawn runs once, before the first update of its object, and never again', () => {
  const events = []
  const runner = createHookRunner({ tickDt: TICK_DT })
  runner.add(1, {
    onSpawn: () => events.push('spawn'),
    update: () => events.push('update'),
  })
  runner.tick(0)
  runner.tick(1)
  sameJson(events, ['spawn', 'update', 'update'], 'event order')
  same(runner.isSpawned(1), true, 'spawned flag')
  mustReject(() => sameJson(events, ['update', 'spawn', 'update'], 'event order'))
})

gate('update runs on its every-N gate with the cadence step, and each object keeps its own phase', () => {
  const calls = { a: [], b: [] }
  let now = 0
  const runner = createHookRunner({ tickDt: TICK_DT })
  runner.add(0, { update: (ctx, dt) => calls.a.push({ tick: now, dt }) }, { every: 3 })
  runner.add(1, { update: (ctx, dt) => calls.b.push({ tick: now, dt }) }, { every: 3 })
  for (now = 0; now < 8; now++) runner.tick(now)
  sameJson(calls.a.map((c) => c.tick), [0, 3, 6], 'object 0 ticks')
  sameJson(calls.b.map((c) => c.tick), [1, 4, 7], 'object 1 ticks')
  near(calls.a[0].dt, 3 * TICK_DT, 'cadence step')
  mustReject(() => sameJson(calls.a.map((c) => c.tick), [0, 1, 2], 'object 0 ticks'))
})

gate('lateUpdate runs after update and after the physics step, in the same tick its update ran, and never on a skipped tick', () => {
  const events = []
  const runner = createHookRunner({ tickDt: TICK_DT, physics: () => events.push('physics') })
  runner.add(0, {
    update: () => events.push('update'),
    lateUpdate: () => events.push('lateUpdate'),
  }, { every: 2 })
  const first = runner.tick(0)
  const second = runner.tick(1)
  sameJson(events, ['update', 'physics', 'lateUpdate', 'physics'], 'event order over two ticks')
  same(phaseOrderHolds(first.log), true, 'first tick order')
  same(second.log.some((e) => e.phase === 'lateUpdate'), false, 'skipped tick lateUpdate')
  mustReject(() => same(phaseOrderHolds([{ phase: 'lateUpdate', id: 0 }, { phase: 'physics', id: null }, { phase: 'update', id: 0 }]), true, 'reversed order'))
})

gate('a lateUpdate-only object runs its lateUpdate on the update gate, and has no update of its own', () => {
  const events = []
  const runner = createHookRunner({ tickDt: TICK_DT })
  runner.add(7, { lateUpdate: () => events.push('late') }, { every: 2 })
  for (let t = 0; t < 4; t++) runner.tick(t)
  same(runner.updateImplied(7), true, 'update implied')
  sameJson(events, ['late', 'late'], 'lateUpdate ticks')
  mustReject(() => same(runner.updateImplied(7), false, 'update implied'))
})

gate('onInput is delivered to its object in the input phase, before update in the same tick, and only to bound objects', () => {
  const events = []
  const runner = createHookRunner({ tickDt: TICK_DT })
  runner.add(1, {
    onInput: (ctx, input) => events.push('input:' + input.axis),
    update: () => events.push('update'),
  })
  runner.deliverInput(1, { axis: 2 })
  const { log } = runner.tick(0)
  sameJson(events, ['input:2', 'update'], 'input before update')
  same(log.findIndex((e) => e.phase === 'onInput') < log.findIndex((e) => e.phase === 'update'), true, 'log order')
  mustReject(() => runner.deliverInput(99, { axis: 1 }))
})

gate('onDestroy runs once on remove, and the removed object gets no further hooks', () => {
  const events = []
  const runner = createHookRunner({ tickDt: TICK_DT })
  runner.add(3, {
    onDestroy: () => events.push('destroy'),
    update: () => events.push('update'),
  })
  runner.tick(0)
  sameJson(runner.remove(3), [], 'remove errors')
  sameJson(runner.remove(3), [], 'second remove')
  runner.tick(1)
  sameJson(events, ['update', 'destroy'], 'events')
  same(runner.has(3), false, 'still bound')
  mustReject(() => sameJson(events, ['update'], 'events'))
})

gate('a throwing hook is recorded and does not stop the other objects or their lateUpdate', () => {
  const events = []
  const runner = createHookRunner({ tickDt: TICK_DT })
  runner.add(1, { update: () => { throw new Error('boom') }, lateUpdate: () => events.push('late1') })
  runner.add(2, { update: () => events.push('update2'), lateUpdate: () => events.push('late2') })
  const { errors } = runner.tick(0)
  sameJson(events, ['update2', 'late1', 'late2'], 'other object events')
  sameJson(errors.map((e) => [e.id, e.hook, e.message]), [[1, 'update', 'boom']], 'recorded error')
  mustReject(() => sameJson(events, ['late1', 'update2', 'late2'], 'events'))
})

gate('the runner refuses an unknown hook, a non-function hook, a duplicate id, a bad cadence, a bad step and a bad tick', () => {
  const runner = createHookRunner({ tickDt: TICK_DT })
  mustReject(() => runner.add(1, { onCollide: () => {} }))
  mustReject(() => runner.add(1, { update: 'not a function' }))
  runner.add(1, { update: () => {} })
  mustReject(() => runner.add(1, { update: () => {} }))
  mustReject(() => runner.add(2, { update: () => {} }, { every: 0 }))
  mustReject(() => createHookRunner({ tickDt: 0 }))
  mustReject(() => runner.tick(-1))
  sameJson([...HOOK_NAMES], ['onSpawn', 'onDestroy', 'update', 'lateUpdate', 'onInput'], 'supported hooks')
})

gate('the injected clock drives the ticks, and a clock that never advances is refused on its second step', () => {
  const seen = []
  let now = 0
  const runner = createHookRunner({ tickDt: TICK_DT, clock: () => now })
  runner.add(1, { update: (ctx, dt) => seen.push(dt) })
  for (now = 0; now < 3; now++) runner.step()
  same(seen.length, 3, 'updates driven by the clock')
  const stuck = createHookRunner({ tickDt: TICK_DT, clock: () => 0 })
  stuck.add(1, { update: () => {} })
  stuck.step()
  mustReject(() => stuck.step())
  mustReject(() => createHookRunner({ tickDt: TICK_DT }).step())
})

gate('a tick number that does not advance is refused, so no hook runs twice on one tick', () => {
  const events = []
  const runner = createHookRunner({ tickDt: TICK_DT })
  runner.add(1, { update: () => events.push('u') })
  runner.tick(4)
  mustReject(() => runner.tick(4))
  mustReject(() => runner.tick(3))
  sameJson(events, ['u'], 'updates after a repeated tick')
})

gate('a missing hook is skipped rather than invented, and an object without update or lateUpdate runs nothing', () => {
  const events = []
  const runner = createHookRunner({ tickDt: TICK_DT, physics: () => events.push('p') })
  runner.add(1, {})
  runner.add(2, { onInput: () => events.push('in') })
  runner.deliverInput(1, { axis: 0 })
  runner.tick(0)
  sameJson(events, ['p'], 'events with only missing hooks')
  mustReject(() => sameJson(events, ['u', 'p'], 'events with only missing hooks'))
})

gate('a duplicate object id is refused, so one object cannot be driven twice', () => {
  const events = []
  const runner = createHookRunner({ tickDt: TICK_DT })
  runner.add(5, { update: () => events.push('a') })
  mustReject(() => runner.add(5, { update: () => events.push('b') }))
  runner.tick(0)
  sameJson(events, ['a'], 'events after a refused duplicate')
})

const hostGlobals = ['process', 'performance', 'Date', 'setTimeout', 'clearTimeout', 'setImmediate', 'setInterval', 'console', 'window', 'globalThis', 'require', 'Buffer']

const findingsIn = (source) => {
  const found = []
  if (source.includes('//') || source.includes('/*')) found.push('comment marker')
  if (source.includes('Math.random')) found.push('uses Math.random')
  for (const piece of source.split("from '").slice(1)) {
    const specifier = piece.slice(0, piece.indexOf("'"))
    if (!specifier.startsWith('.')) found.push('bare import ' + specifier)
  }
  const words = new Set(source.split(/[^A-Za-z0-9_$]/))
  for (const token of hostGlobals) {
    if (words.has(token)) found.push('uses ' + token)
  }
  return found
}

gate('src/apps/hookOrder.js is comment-free, imports nothing bare, reads no host clock or random source', () => {
  sameJson(findingsIn(readFileSync(sourcePath, 'utf8')), [], 'findings')
  mustReject(() => assert(findingsIn("import fs from 'node:fs'\nconst t = performance.now() // x").length === 0, 'negative sample'))
})

finish()
