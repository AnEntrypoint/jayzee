import assert from 'node:assert/strict'
import { finish, gate } from './lib/gate.mjs'
import { LAYER_DYNAMIC, LAYER_STATIC, LAYER_VERY_STATIC, createColliderSet, layerOf } from '../src/engine/colliderLayers.js'

gate('each kind maps to one of the three layers, and an unknown kind is refused', () => {
  assert.equal(layerOf('terrain'), LAYER_VERY_STATIC)
  assert.equal(layerOf('prop'), LAYER_STATIC)
  assert.equal(layerOf('body'), LAYER_DYNAMIC)
  assert.throws(() => layerOf('water'), RangeError)
})

gate('very static colliders are built once, and a change to them is refused', () => {
  const set = createColliderSet()
  set.add('planet', 'terrain')
  assert.deepEqual(set.flush(), { build: ['planet'], refit: [] })
  assert.deepEqual(set.flush(), { build: [], refit: [] })
  assert.throws(() => set.change('planet'), RangeError)
})

gate('static objects refit only when they change, and not otherwise', () => {
  const set = createColliderSet()
  set.add('crate-1', 'prop')
  set.add('crate-2', 'prop')
  assert.deepEqual(set.flush().build.sort(), ['crate-1', 'crate-2'])
  assert.deepEqual(set.flush(), { build: [], refit: [] })
  set.change('crate-1')
  assert.deepEqual(set.flush(), { build: [], refit: ['crate-1'] })
  assert.deepEqual(set.flush(), { build: [], refit: [] })
})

gate('dynamic colliders are not in the change set and are returned on every step', () => {
  const set = createColliderSet()
  set.add('ball', 'body')
  assert.deepEqual(set.flush(), { build: [], refit: [] })
  assert.throws(() => set.change('ball'), RangeError)
  assert.deepEqual(set.step(), ['ball'])
  assert.deepEqual(set.step(), ['ball'])
})

gate('a duplicate id and an unknown id are refused, and the counts by layer are exact', () => {
  const set = createColliderSet()
  set.add('a', 'terrain')
  set.add('b', 'prop')
  set.add('c', 'body')
  assert.throws(() => set.add('a', 'prop'), RangeError)
  assert.throws(() => set.change('zz'), RangeError)
  assert.deepEqual(set.counts(), { 'very-static': 1, static: 1, dynamic: 1 })
})

finish()
