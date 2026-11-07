import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { World } from '../src/world/World.js'
import { LimitError, SPAWN_KILL_AFTER_MS, SPAWN_MEMORY_CAP_BYTES, createScriptLimits } from '../src/sandbox/limits.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}
const same = (actual, expected, label = 'value') => {
  assert(actual === expected, label + ' is ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected))
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
const mustCode = (check, code) => {
  let caught = null
  try {
    check()
  } catch (error) {
    caught = error
  }
  assert(caught instanceof LimitError, 'expected a LimitError, got ' + (caught && caught.name))
  same(caught.code, code, 'limit code')
}

gate('the spawn constants are 32 MiB and 5 s', () => {
  same(SPAWN_MEMORY_CAP_BYTES, 33554432, 'memory cap bytes')
  same(SPAWN_KILL_AFTER_MS, 5000, 'kill after ms')
})

gate('the step budget allows its count per tick, refuses the next step, and resets on each tick', () => {
  let ms = 0
  const limits = createScriptLimits({ maxStepsPerTick: 3, clock: () => ms, memoryOf: () => 0 })
  limits.start()
  limits.charge(1)
  limits.charge(1)
  limits.charge(1)
  mustCode(() => limits.charge(1), 'step-budget')
  limits.beginTick()
  limits.charge(3)
  mustReject(() => limits.charge(1))
})

gate('the memory cap admits its exact size and refuses one byte more', () => {
  let bytes = SPAWN_MEMORY_CAP_BYTES
  const limits = createScriptLimits({ maxStepsPerTick: 10, clock: () => 0, memoryOf: () => bytes })
  limits.start()
  limits.checkMemory()
  bytes = SPAWN_MEMORY_CAP_BYTES + 1
  mustCode(() => limits.checkMemory(), 'memory')
})

gate('the kill fires only once elapsed time passes 5000 ms, measured on the injected clock', () => {
  let ms = 1000
  const limits = createScriptLimits({ maxStepsPerTick: 10, clock: () => ms, memoryOf: () => 0 })
  limits.start()
  ms = 6000
  same(limits.checkTime(), 5000, 'elapsed at the limit')
  ms = 6001
  mustCode(() => limits.checkTime(), 'kill')
})

gate('a clock that never advances never kills the script: the time limit depends on the injected clock', () => {
  const limits = createScriptLimits({ maxStepsPerTick: 10, clock: () => 42, memoryOf: () => 0 })
  limits.start()
  for (let i = 0; i < 5; i++) same(limits.checkTime(), 0, 'elapsed on a stuck clock')
  mustReject(() => {
    if (limits.checkTime() <= 0) throw new Error('kill expected')
  })
})

gate('a clock that runs backwards, or returns a non-finite value, is refused', () => {
  let ms = 100
  const limits = createScriptLimits({ maxStepsPerTick: 10, clock: () => ms, memoryOf: () => 0 })
  limits.start()
  ms = 50
  mustCode(() => limits.checkTime(), 'clock-backwards')
  const bad = createScriptLimits({ maxStepsPerTick: 10, clock: () => Number.NaN, memoryOf: () => 0 })
  mustReject(() => bad.start())
  mustReject(() => createScriptLimits({ maxStepsPerTick: 10, clock: 5, memoryOf: () => 0 }))
})

gate('checkTime refuses before start, and a limit with a bad option is refused', () => {
  const limits = createScriptLimits({ maxStepsPerTick: 10, clock: () => 0, memoryOf: () => 0 })
  mustReject(() => limits.checkTime())
  mustReject(() => createScriptLimits({ maxStepsPerTick: 0, clock: () => 0, memoryOf: () => 0 }))
  mustReject(() => createScriptLimits({ maxStepsPerTick: 1, killAfterMs: 0, clock: () => 0, memoryOf: () => 0 }))
})

gate('World.advance takes at most 8 ticks per call and drops the rest, so an over-cap advance is capped', () => {
  const world = new World({ capacity: 4, tickRate: 64, gravity: 0, drag: 0, radius: 0.35, restitution: 0.2, solverIterations: 1 })
  same(world.advance(10), 8, 'steps for a 10 s advance')
  same(world.tick, 8, 'tick after a 10 s advance')
  same(world.advance(0.5), 8, 'steps for a half-second advance, capped per call')
  same(world.tick, 16, 'tick after the half-second advance')
  mustReject(() => same(world.advance(1000), 9, 'steps'))
  mustReject(() => world.advance(-1))
})

finish()
