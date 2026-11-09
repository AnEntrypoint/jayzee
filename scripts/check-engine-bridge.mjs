import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { BRIDGE, createBridge, readLayout } from '../src/engine/bridge.js'
import { loadEngineModule } from '../src/engine/EngineWorld.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const glue = pathToFileURL(join(root, 'engine/out/engine-core-64mib.mjs')).href
const header = readFileSync(join(root, 'engine/src/bridge.h'), 'utf8')
const cppValue = (name) => {
  const match = header.match(new RegExp('\\b' + name + ' = (\\d+)'))
  assert.ok(match, 'bridge.h does not define ' + name)
  return Number(match[1])
}
const CONTROL_NAMES = {
  INPUT_HEAD: 'kInputHead',
  INPUT_TAIL: 'kInputTail',
  EPOCH: 'kEpoch',
  EVENT_HEAD: 'kEventHead',
  EVENT_TAIL: 'kEventTail',
  EVENT_DROPPED: 'kEventDropped',
  BODY_COUNT: 'kBodyCount',
  TICK_LOW: 'kTickLow',
  TICK_HIGH: 'kTickHigh',
}
const EVENT_NAMES = { INPUT_APPLIED: 'kEventInputApplied', INPUT_REJECTED: 'kEventInputRejected', TICKED: 'kEventTicked' }

const boot = async () => {
  const module = await loadEngineModule(glue)
  assert.equal(module._engine_world_configure(4, 64, -18, 0.1, 0.35, 0.2, 8), 0)
  assert.equal(module._engine_spawn(0, 5, 0, 0, 0, 0), 0)
  return module
}

const wrapCalls = (module) => {
  const calls = {}
  for (const key of Object.keys(module)) {
    if (!key.startsWith('_engine_') || typeof module[key] !== 'function') continue
    const original = module[key]
    module[key] = (...args) => {
      calls[key] = (calls[key] ?? 0) + 1
      return original(...args)
    }
  }
  return calls
}

gate('the bridge constants in src/engine/bridge.js equal engine/src/bridge.h', () => {
  for (const [key, name] of Object.entries(CONTROL_NAMES)) assert.equal(BRIDGE.CONTROL[key], cppValue(name), name)
  for (const [key, name] of Object.entries(EVENT_NAMES)) assert.equal(BRIDGE.EVENT[key], cppValue(name), name)
  assert.ok(header.includes('sizeof(InputSlot) == 20'))
  assert.ok(header.includes('sizeof(EventSlot) == 16'))
  assert.ok(header.includes('sizeof(Transform) == 28'))
  assert.equal(BRIDGE.INPUT_WORDS * 4, 20)
  assert.equal(BRIDGE.EVENT_WORDS * 4, 16)
  assert.equal(BRIDGE.TRANSFORM_WORDS * 4, 28)
})

gate('the control, input, event and transform regions sit inside the module memory on 4-byte boundaries', async () => {
  const module = await boot()
  const regions = [
    [module._engine_control(), 16 * 4],
    [module._engine_inputs(), readLayout(module).inputSlots * 20],
    [module._engine_events(), readLayout(module).eventSlots * 16],
    [module._engine_transforms(), 4096 * 28],
  ]
  for (const [pointer, bytes] of regions) {
    assert.equal(pointer % 4, 0, 'pointer ' + pointer + ' is not 4-byte aligned')
    assert.ok(pointer + bytes <= module.HEAPU8.byteLength, 'region at ' + pointer + ' runs past the memory')
  }
})

gate('one engine_tick call per tick batch, no other export call during the batches, and the buffer is never replaced', async () => {
  const module = await boot()
  const bridge = createBridge(module)
  const before = module.HEAPU8.buffer
  const calls = wrapCalls(module)
  for (let batch = 0; batch < 500; batch++) bridge.tick(64)
  assert.equal(calls._engine_tick, 500)
  for (const [name, count] of Object.entries(calls)) {
    if (name !== '_engine_tick') assert.fail(name + ' was called ' + count + ' times during the batches')
  }
  assert.equal(module.HEAPU8.buffer, before, 'the memory buffer was replaced')
  assert.equal(Number(module._engine_ticks()), 500 * 64)
})

gate('the epoch counts one per tick call, and the tick count matches the steps', async () => {
  const module = await boot()
  const bridge = createBridge(module)
  for (let i = 0; i < 7; i++) bridge.tick(10)
  assert.equal(bridge.epoch(), 7)
  assert.equal(bridge.tickCount(), 70)
  assert.equal(bridge.bodyCount(), 1)
})

gate('a queued velocity input reaches its body on the next tick, and one applied event names the body and the sequence', async () => {
  const module = await boot()
  const bridge = createBridge(module)
  bridge.drainEvents()
  const seq = bridge.pushInput(0, [0, 0, 3])
  assert.equal(seq, 1)
  bridge.tick(1)
  const events = bridge.drainEvents()
  const applied = events.filter((e) => e.kind === BRIDGE.EVENT.INPUT_APPLIED)
  assert.equal(applied.length, 1)
  assert.equal(applied[0].a, 0)
  assert.equal(applied[0].b, seq)
  const z = module._engine_velocities() / 8 + 2
  const velocityZ = module.HEAPF64[z]
  assert.ok(velocityZ > 2.9 && velocityZ < 3.1, 'body z velocity is ' + velocityZ)
})

gate('the input ring refuses a 257th unconsumed input and accepts again after one tick', async () => {
  const module = await boot()
  const bridge = createBridge(module)
  bridge.drainEvents()
  for (let i = 0; i < readLayout(module).inputSlots; i++) assert.ok(bridge.pushInput(0, [0, 0, 0]) > 0)
  assert.equal(bridge.pushInput(0, [0, 0, 0]), -1)
  bridge.tick(1)
  assert.ok(bridge.pushInput(0, [0, 0, 0]) > 0)
})

gate('the event ring counts dropped events once it is full, and drains in order', async () => {
  const module = await boot()
  const bridge = createBridge(module)
  bridge.drainEvents()
  for (let i = 0; i < 300; i++) bridge.tick(1)
  assert.equal(bridge.droppedEvents(), 300 - readLayout(module).eventSlots)
  const events = bridge.drainEvents()
  assert.equal(events.length, readLayout(module).eventSlots)
  for (const event of events) assert.equal(event.kind, BRIDGE.EVENT.TICKED)
  for (let i = 1; i < events.length; i++) assert.ok(events[i].b > events[i - 1].b)
})

gate('a sphere dropped straight down stays a unit quaternion, and in 240 ticks its rotation stays under 5 mrad and its drift under 1 mm', async () => {
  const module = await boot()
  for (let i = 0; i < 240; i++) module._engine_tick(1)
  const transform = new Float32Array(module.HEAPU8.buffer, module._engine_transforms(), BRIDGE.TRANSFORM_WORDS)
  const [x, , z, qx, qy, qz, qw] = transform
  assert.ok(Math.abs(qx * qx + qy * qy + qz * qz + qw * qw - 1) < 1e-5, 'quaternion is not unit length')
  const tilt = Math.hypot(qx, qy, qz)
  assert.ok(tilt < 5e-3, 'the drop rotated the sphere by ' + tilt + ' rad, over the 5 mrad bound')
  assert.ok(Math.abs(x) < 1e-3 && Math.abs(z) < 1e-3, 'the drop drifted to x ' + x + ', z ' + z + ', over the 1 mm bound')
})

finish()
