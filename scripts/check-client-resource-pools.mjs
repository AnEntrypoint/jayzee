import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { createSlotPool, createLightPool, createTexturePool, createMeshPool, createPipelineRegistry } from '../src/client/resourcePools.js'

const LIGHT = { x: 1, y: 2, z: 3, radius: 4, r: 0.5, g: 0.25, b: 0.125, intensity: 2 }
const SLOT_SPAN = 65536

gate('slot pool hands out distinct slots in order and refuses a full pool', () => {
  const pool = createSlotPool(3)
  const handles = [pool.acquire(), pool.acquire(), pool.acquire()]
  assert.deepEqual(handles.map((h) => pool.resolve(h)), [0, 1, 2])
  assert.equal(new Set(handles).size, 3)
  assert.equal(pool.acquire(), -1)
  assert.equal(pool.count(), 3)
})

gate('a released handle goes stale and its slot comes back under a new generation', () => {
  const pool = createSlotPool(2)
  const first = pool.acquire()
  assert.equal(pool.release(first), true)
  assert.equal(pool.resolve(first), -1)
  assert.equal(pool.release(first), false)
  const second = pool.acquire()
  assert.equal(pool.resolve(second), first % SLOT_SPAN)
  assert.notEqual(second, first)
  assert.equal(pool.resolve(first), -1)
})

gate('a slot retires at its last generation: no handle it issued resolves again, and the slot is never reused', () => {
  const pool = createSlotPool(1)
  const issued = []
  let handle = pool.acquire()
  while (handle >= 0) {
    issued.push(handle)
    assert.equal(pool.release(handle), true)
    handle = pool.acquire()
  }
  assert.equal(issued.length, 65534)
  assert.equal(new Set(issued).size, 65534)
  assert.equal(pool.retired(), 1)
  assert.equal(pool.count(), 0)
  for (const old of issued) assert.equal(pool.resolve(old), -1)
  assert.equal(pool.release(issued[issued.length - 1]), false)
})

gate('a slot pool refuses a capacity that is not a whole number from 1 to 65535', () => {
  for (const value of [0, 65536, 1.5, NaN, -1, '3', null]) {
    assert.throws(() => createSlotPool(value), RangeError, String(value))
  }
})

gate('a slot pool refuses handles it never issued', () => {
  const pool = createSlotPool(2)
  pool.acquire()
  for (const handle of [-1, 1.5, 'x', NaN, 3 * SLOT_SPAN]) assert.equal(pool.resolve(handle), -1, String(handle))
})

gate('lights: a stale handle is refused and a removed light leaves a zero slot', () => {
  const lights = createLightPool(2)
  const handle = lights.add(LIGHT)
  const out = lights.read(handle, new Float32Array(8))
  assert.deepEqual(Array.from(out), [1, 2, 3, 4, 0.5, 0.25, 0.125, 2])
  assert.equal(lights.remove(handle), true)
  assert.deepEqual(Array.from(lights.data.subarray(0, 8)), [0, 0, 0, 0, 0, 0, 0, 0])
  assert.equal(lights.isLive(handle), false)
  assert.throws(() => lights.set(handle, LIGHT), RangeError)
  assert.throws(() => lights.read(handle, new Float32Array(8)), RangeError)
})

gate('lights: an invalid light is refused before a slot is taken', () => {
  const lights = createLightPool(1)
  assert.throws(() => lights.add({ ...LIGHT, radius: 0 }), RangeError)
  assert.throws(() => lights.add({ ...LIGHT, x: NaN }), RangeError)
  assert.throws(() => lights.add(null), TypeError)
  assert.equal(lights.count(), 0)
  assert.notEqual(lights.add(LIGHT), -1)
})

gate('lights: churn during play keeps the same backing buffer and leaves no light behind', () => {
  const lights = createLightPool(64)
  const backing = lights.data
  const buffer = backing.buffer
  for (let i = 0; i < 10000; i++) lights.remove(lights.add(LIGHT))
  assert.equal(lights.data, backing)
  assert.equal(lights.data.buffer, buffer)
  assert.equal(lights.count(), 0)
})

gate('textures: a layer takes exactly one image, a wrong size or type is refused', () => {
  const textures = createTexturePool({ layers: 2, width: 2, height: 2 })
  const handle = textures.add(new Uint8Array(16).fill(7))
  assert.equal(textures.layerOffset(handle), 0)
  assert.equal(textures.data[0], 7)
  assert.throws(() => textures.add(new Uint8Array(15)), RangeError)
  assert.throws(() => textures.add([1, 2]), TypeError)
  assert.equal(textures.count(), 1)
})

gate('textures: a replaced layer takes the new image, a removed one is zeroed and its handle is refused', () => {
  const textures = createTexturePool({ layers: 1, width: 2, height: 2 })
  const handle = textures.add(new Uint8Array(16).fill(7))
  textures.replace(handle, new Uint8Array(16).fill(9))
  assert.equal(textures.data[0], 9)
  assert.equal(textures.remove(handle), true)
  assert.equal(textures.data[0], 0)
  assert.throws(() => textures.replace(handle, new Uint8Array(16)), RangeError)
  assert.throws(() => textures.layerOffset(handle), RangeError)
})

gate('textures: a full array refuses a new layer without writing into one', () => {
  const textures = createTexturePool({ layers: 2, width: 1, height: 1 })
  textures.add(new Uint8Array(4).fill(1))
  textures.add(new Uint8Array(4).fill(2))
  assert.equal(textures.add(new Uint8Array(4).fill(3)), -1)
  assert.deepEqual(Array.from(textures.data), [1, 1, 1, 1, 2, 2, 2, 2])
})

gate('meshes: each slot holds its own range, and an oversize or out-of-range mesh is refused', () => {
  const meshes = createMeshPool({ slots: 2, vertexCapacity: 3, indexCapacity: 3, stride: 3 })
  const triangle = { vertices: new Float32Array(9).map((_, i) => i), indices: new Uint32Array([0, 1, 2]) }
  const a = meshes.add(triangle)
  const b = meshes.add(triangle)
  const out = new Uint32Array(4)
  assert.deepEqual(Array.from(meshes.rangeInto(a, out)), [0, 3, 0, 3])
  assert.deepEqual(Array.from(meshes.rangeInto(b, out)), [3, 3, 3, 3])
  assert.throws(() => meshes.add({ vertices: new Float32Array(12), indices: new Uint32Array([0]) }), RangeError)
  assert.throws(() => meshes.add({ vertices: new Float32Array(9), indices: new Uint32Array([3]) }), RangeError)
  assert.throws(() => meshes.add({ vertices: new Float32Array(9), indices: new Uint32Array(4) }), RangeError)
  assert.throws(() => meshes.add({ vertices: new Float32Array(0), indices: new Uint32Array(0) }), RangeError)
  assert.throws(() => meshes.add({ vertices: [0, 1, 2], indices: new Uint32Array([0]) }), TypeError)
})

gate('meshes: a freed slot is reused, its old handle is stale, and its range is cleared', () => {
  const meshes = createMeshPool({ slots: 1, vertexCapacity: 3, indexCapacity: 3, stride: 3 })
  const first = meshes.add({ vertices: new Float32Array(9).fill(5), indices: new Uint32Array([0, 1, 2]) })
  assert.equal(meshes.remove(first), true)
  assert.equal(meshes.vertices[0], 0)
  assert.throws(() => meshes.rangeInto(first, new Uint32Array(4)), RangeError)
  const second = meshes.add({ vertices: new Float32Array(3).fill(6), indices: new Uint32Array([0]) })
  assert.notEqual(second, first)
  assert.deepEqual(Array.from(meshes.rangeInto(second, new Uint32Array(4))), [0, 1, 0, 1])
})

gate('meshes: churn during play keeps the same backing buffers', () => {
  const meshes = createMeshPool({ slots: 8, vertexCapacity: 3, indexCapacity: 3, stride: 3 })
  const vertices = meshes.vertices
  const indices = meshes.indices
  const mesh = { vertices: new Float32Array(9), indices: new Uint32Array([0, 1, 2]) }
  for (let i = 0; i < 10000; i++) meshes.remove(meshes.add(mesh))
  assert.equal(meshes.vertices, vertices)
  assert.equal(meshes.indices, indices)
  assert.equal(meshes.count(), 0)
})

gate('pipelines: nothing compiles after seal, and an unregistered key is refused', () => {
  const registry = createPipelineRegistry()
  let calls = 0
  registry.register('a', () => { calls += 1; return { id: 'a' } })
  registry.register('b', () => { calls += 1; return { id: 'b' } })
  assert.throws(() => registry.get('a'), RangeError)
  assert.equal(registry.seal(), 2)
  assert.equal(calls, 2)
  for (let i = 0; i < 1000; i++) assert.equal(registry.get('a').id, 'a')
  assert.equal(calls, 2)
  assert.equal(registry.compileCount(), 2)
  assert.throws(() => registry.get('c'), RangeError)
  assert.throws(() => registry.register('d', () => ({})), RangeError)
})

gate('pipelines: a duplicate key or a bad compile is refused before seal', () => {
  const registry = createPipelineRegistry()
  registry.register('a', () => ({}))
  assert.throws(() => registry.register('a', () => ({})), RangeError)
  assert.throws(() => registry.register('', () => ({})), TypeError)
  assert.throws(() => registry.register('b', 3), TypeError)
  assert.equal(registry.isSealed(), false)
})

finish()
