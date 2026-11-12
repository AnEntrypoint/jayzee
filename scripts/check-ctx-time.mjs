import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { TIMERS_FULL, createTimeApi, secondsToTicks } from '../src/apps/timeApi.js'
import { createAppRuntime } from '../src/apps/appRuntime.js'

const TICK_DT = 1 / 64

gate('ctx.time reports the tick, the fixed deltaTime and elapsed as tick times deltaTime, with no wall clock', () => {
  const runtime = createAppRuntime({ tickDt: TICK_DT, capacity: 2 })
  const seen = []
  runtime.registerApp('probe', { server: { update: (ctx, dt) => seen.push([ctx.time.tick, ctx.time.deltaTime, ctx.time.elapsed, dt]) } })
  runtime.spawn({ app: 'probe' })
  for (const t of [0, 1, 64]) runtime.tick(t)
  assert.deepEqual(seen, [[0, TICK_DT, 0, TICK_DT], [1, TICK_DT, TICK_DT, TICK_DT], [64, TICK_DT, 1, TICK_DT]])
})

gate('after fires once at the first tick at or past its delay, never early, and every repeats on its period', () => {
  const time = createTimeApi({ tickDt: TICK_DT, capacity: 4 })
  const fired = []
  time.after(0.5, () => fired.push(['after', time.tick]))
  time.every(0.25, () => fired.push(['every', time.tick]))
  for (let t = 1; t <= 64; t++) time.advance(t)
  assert.deepEqual(fired, [['every', 16], ['after', 32], ['every', 32], ['every', 48], ['every', 64]])
  assert.equal(time.pending, 1)
  assert.equal(secondsToTicks(0.5, TICK_DT), 32)
  assert.equal(secondsToTicks(0, TICK_DT), 1)
  assert.equal(secondsToTicks(0.51, TICK_DT), 33)
})

gate('timers due on the same tick fire in the order they were scheduled, on every run', () => {
  const run = () => {
    const time = createTimeApi({ tickDt: TICK_DT, capacity: 8 })
    const order = []
    for (const name of ['c', 'a', 'b']) time.after(0.1, () => order.push(name))
    time.after(0.05, () => order.push('first'))
    for (let t = 1; t <= 10; t++) time.advance(t)
    return order.join(',')
  }
  assert.equal(run(), 'first,c,a,b')
  assert.equal(run(), run())
})

gate('cancel stops a timer, a stale timer id cancels nothing, and a cancelled slot is reused under a new id', () => {
  const time = createTimeApi({ tickDt: TICK_DT, capacity: 1 })
  const fired = []
  const id = time.after(0.1, () => fired.push('old'))
  assert.equal(time.cancel(id), true)
  assert.equal(time.cancel(id), false)
  const next = time.after(0.1, () => fired.push('new'))
  assert.notEqual(next, id)
  assert.equal(time.cancel(id), false)
  for (let t = 1; t <= 10; t++) time.advance(t)
  assert.deepEqual(fired, ['new'])
})

gate('the timer store is a fixed size: one more than its capacity is refused by name, and a fired one-shot frees its slot', () => {
  const time = createTimeApi({ tickDt: TICK_DT, capacity: 2 })
  time.after(0.1, () => {})
  time.after(0.1, () => {})
  assert.throws(() => time.after(0.1, () => {}), { code: TIMERS_FULL })
  for (let t = 1; t <= 7; t++) time.advance(t)
  assert.equal(time.pending, 0)
  time.after(0.1, () => {})
  assert.equal(time.pending, 1)
})

gate('a timer set from an app hook receives its payload, is cancelled when its entity is destroyed, and a throwing timer is recorded without stopping the others', () => {
  const runtime = createAppRuntime({ tickDt: TICK_DT, capacity: 4 })
  const fired = []
  runtime.registerApp('bomb', {
    server: {
      setup: (ctx) => {
        ctx.time.after(2 * TICK_DT, (payload) => fired.push([ctx.entity.id, payload, ctx.time.tick]), 'boom')
        ctx.time.every(TICK_DT, () => { throw new Error('tick fault') })
      },
    },
  })
  const kept = runtime.spawn({ app: 'bomb' })
  const gone = runtime.spawn({ app: 'bomb' })
  runtime.tick(0)
  runtime.destroy(gone)
  runtime.tick(1)
  runtime.tick(2)
  assert.deepEqual(fired, [[kept, 'boom', 2]])
  assert.equal(runtime.errors.every((entry) => entry.message === 'tick fault' && entry.id === kept), true)
  assert.equal(runtime.errors.length, 2)
  assert.equal(runtime.time.pending, 1)
})

gate('the clock refuses to run backwards, and refuses a negative delay or a missing function', () => {
  const time = createTimeApi({ tickDt: TICK_DT })
  time.advance(5)
  assert.throws(() => time.advance(4), RangeError)
  assert.throws(() => time.after(-1, () => {}), RangeError)
  assert.throws(() => time.after(1, null), TypeError)
  assert.throws(() => createTimeApi({ tickDt: 0 }), RangeError)
})

finish()
