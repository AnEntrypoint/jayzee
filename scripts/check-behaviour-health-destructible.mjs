import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { SCENARIOS, runScenarios, makeHost, makeSite } from './lib/healthDestructibleScenarios.mjs'
import { HEALTH_SCHEMA, createHealthPool, defineHealthPooled, registerHealthSchema } from '../src/behaviours/healthPool.js'
import { createDestructiblePool, jitter, resolveDebrisImpulsePattern, validateDestructibleSpec } from '../src/behaviours/destructiblePool.js'
import { getComponentSchema } from '../src/protocol/componentSchema.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = JSON.parse(readFileSync(join(here, 'fixtures', 'spoint', 'health-destructible.json'), 'utf8'))
const expected = fixture.scenarios

function portAdapter() {
  const pool = createHealthPool()
  return {
    begin() {},
    healthSchema: () => HEALTH_SCHEMA,
    health: (spec, host) => defineHealthPooled(spec, { pool, now: host.now, registerDisposer: host.registerDisposer }),
    destructible: (spec, site, host) => createDestructiblePool(spec, {
      world: site.world,
      entity: site.entity,
      players: site.players,
      now: host.now,
      random: host.random,
    }),
  }
}

const port = runScenarios(portAdapter)

gate('fixture records a 40-hex spoint head and 64-hex digests for its three sources (format only)', () => {
  assert.match(fixture.spointHead, /^[0-9a-f]{40}$/)
  assert.deepEqual(Object.keys(fixture.sources).sort(), ['src/behaviours/destructible.js', 'src/behaviours/destructibleSpec.js', 'src/behaviours/health.js'])
  for (const digest of Object.values(fixture.sources)) assert.match(digest, /^[0-9a-f]{64}$/)
})

gate('fixture covers every scenario and no other', () => {
  assert.deepEqual(Object.keys(expected).sort(), SCENARIOS.map((s) => s.name).sort())
})

for (const { name } of SCENARIOS) {
  gate(`spoint parity: ${name}`, () => {
    assert.deepStrictEqual(port[name], expected[name])
  })
}

gate('health schema matches spoint field for field', () => {
  assert.deepStrictEqual(JSON.parse(JSON.stringify(HEALTH_SCHEMA)), expected['health-schema'])
})

gate('health stores hp as float32 but reports the unrounded hp to onDamage', () => {
  const r = port['health-float32-storage']
  assert.notEqual(r.returned, 99.9)
  assert.equal(r.returned, r.hp)
  assert.deepEqual(r.events, [['onDamage', { amount: 0.1, hp: 99.9, max: 100, source: null }]])
})

gate('invulnerability window reads the injected clock and refuses hits inside it', () => {
  assert.deepEqual(port['health-invulnerability-window'].seq, [[1000, 90], [1100, 90], [1600, 80]])
})

gate('a dead health ignores damage and heal and fires one death', () => {
  const steps = port['health-death-and-hooks'].steps
  assert.deepEqual(steps.map((s) => s[1]), [70, 0, 0, null, 0])
  assert.equal(port['health-death-and-hooks'].events.filter((e) => e[0] === 'onDeath').length, 1)
})

gate('pool growth past one block keeps every earlier handle reading its own slot', () => {
  assert.equal(port['health-pool-growth-keeps-handles'].states[0][0], 0.5)
  assert.deepEqual(port['health-pool-growth-keeps-handles'].states[19], [0, 10, false])
})

gate('a released slot is reused, and the stale handle reads the new occupant', () => {
  const r = port['health-dispose-and-slot-reuse']
  assert.equal(r.after.hp, 20)
  assert.equal(r.staleHandle.hp, 20)
})

gate('destroy parks the parent far below and pieces are spawned with the pattern', () => {
  const steps = port['destructible-destroy-and-debris'].steps
  assert.deepEqual(steps[1][2].position, [10, -4998, -4])
  assert.deepEqual(steps[1][2].scale, [0, 0, 0])
  assert.equal(port['destructible-destroy-and-debris'].world.filter((op) => op[0] === 'spawnChild').length, 3)
})

gate('fractured pieces are keyed and never returned to the free list', () => {
  const steps = port['destructible-fractured-keyed-pieces'].steps
  assert.equal(steps[0][2].poolSize, 2)
  assert.equal(steps[2][2].poolSize, 2)
  assert.equal(steps[2][2].poolFree, 0)
})

gate('validation messages are spoint text, one per refused field', () => {
  const messages = port['destructible-validation-messages']
  assert.equal(messages.valid, null)
  assert.equal(messages.health0, '[destructible] health must be a positive finite number')
  assert.equal(messages.fracturedNoCount, expected['destructible-validation-messages'].fracturedNoCount)
  assert.ok(messages.fracturedNoCount.includes('pieces.json'))
})

gate('negative control: the parity comparator refuses a one-value change', () => {
  const mutated = structuredClone(port['health-death-and-hooks'])
  mutated.steps[0][1] = 71
  assert.throws(() => assert.deepStrictEqual(mutated, expected['health-death-and-hooks']))
})

gate('negative control: the parity comparator refuses a missing spawn record', () => {
  const mutated = structuredClone(port['destructible-drain-destroys-pool'])
  mutated.world.pop()
  assert.throws(() => assert.deepStrictEqual(mutated, expected['destructible-drain-destroys-pool']))
})

gate('defineHealthPooled refuses a missing pool and a non-function clock', () => {
  assert.throws(() => defineHealthPooled({ max: 1 }, { now: () => 0 }), /pool is required/)
  assert.throws(() => defineHealthPooled({ max: 1 }, { pool: createHealthPool(), now: 0 }), /now must be a function/)
})

gate('createDestructiblePool refuses a missing world before touching the entity', () => {
  const entity = { id: 'x', position: [1, 2, 3], scale: [1, 1, 1] }
  const host = makeHost(99)
  assert.throws(() => createDestructiblePool({ debrisCount: 2 }, { entity, players: { getAll: () => [] }, now: host.now, random: host.random }), /required/)
  assert.deepEqual(entity.position, [1, 2, 3])
})

gate('createDestructiblePool refuses an invalid spec before reading the world', () => {
  const host = makeHost(98)
  const site = makeSite(host)
  site.world.spawnChild = () => { throw new Error('world must not be read') }
  assert.throws(() => createDestructiblePool({ health: 0 }, { world: site.world, entity: site.entity, players: site.players, now: host.now, random: host.random }), /health must be a positive finite number/)
  assert.throws(() => validateDestructibleSpec('x'), /spec must be an object/)
})

gate('jitter and the up pattern take the injected random, not Math.random', () => {
  assert.equal(jitter(2, () => 0.5), 0)
  assert.deepEqual(resolveDebrisImpulsePattern('up', () => 0)(0, 1), [0, 6, 0])
  const custom = () => [1, 2, 3]
  assert.equal(resolveDebrisImpulsePattern(custom, () => 0), custom)
})

gate('importing healthPool leaves the component registry alone until registerHealthSchema runs', () => {
  assert.equal(getComponentSchema('health'), null)
  assert.equal(registerHealthSchema(), HEALTH_SCHEMA)
  assert.equal(getComponentSchema('health'), HEALTH_SCHEMA)
})

gate('the port reads no wall clock or Math.random while it runs', () => {
  const realNow = Date.now
  const realRandom = Math.random
  const trap = () => { throw new Error('host global read') }
  Date.now = trap
  Math.random = trap
  try {
    const again = runScenarios(portAdapter)
    assert.deepStrictEqual(again, expected)
  } finally {
    Date.now = realNow
    Math.random = realRandom
  }
})

finish()
