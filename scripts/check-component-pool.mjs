import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { runComponentPoolTrace } from './lib/component-pool-trace.mjs'
import { createComponentPool } from '../src/apps/componentPool.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = JSON.parse(readFileSync(join(here, 'fixtures', 'spoint', 'component-pool.json'), 'utf8'))
const result = runComponentPoolTrace(createComponentPool)

gate('the spoint trace grows past sixteen slots and reuses the first freed slot', () => {
  assert.ok(fixture.growth.some((entry) => Array.isArray(entry) && entry[0] === 'capacity' && entry[1] > 16))
  const freed = fixture.lifecycle[3][1]
  assert.ok(fixture.lifecycle.some((entry) => entry[0] === 'reuse' && entry[1] === freed))
})

gate('lifecycle: alloc, set, get, free, reuse and zeroing match spoint', () => {
  assert.deepEqual(result.lifecycle, fixture.lifecycle)
})

gate('growth: capacity, epoch, kept values and typed column kinds match spoint', () => {
  assert.deepEqual(result.growth, fixture.growth)
})

gate('errors: an unknown field kind and a missing field list are refused as spoint refuses them', () => {
  assert.deepEqual(result.errors, fixture.errors)
  assert.ok(result.errors.every((entry) => entry[0] !== 'no error'))
})

finish()
