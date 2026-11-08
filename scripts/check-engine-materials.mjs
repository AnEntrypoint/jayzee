import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { createMaterials, createTextures, TABLE_STATUS, TEXTURE_FORMAT } from '../src/engine/materials.js'
import { createMaterialPool, createTexturePool } from '../src/client/resourcePools.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const glue = pathToFileURL(join(root, 'engine/out/engine-core-64mib.mjs')).href

const SLOT_SPAN = 65536
const LAST_GENERATION = 65534
const EXPECTED_STRIDE_BYTES = 40
const EXPECTED_WORDS = 10
const EXPECTED_ALBEDO_WORD = 9
const TEXTURE_MAX_DIMENSION = 16384
const TEXTURE_FORMAT_UNORM = 1
const TEXTURE_FORMAT_SRGB = 2
const MATERIAL = { r: 0.5, g: 0.25, b: 0.125, a: 1, roughness: 0.5, metallic: 0, emissiveR: 2, emissiveG: 0, emissiveB: 0 }
const MATERIAL_READ = [0.5, 0.25, 0.125, 1, 0.5, 0, 2, 0, 0]

const load = async () => {
  const factory = (await import(glue)).default
  const module = await factory()
  module._engine_init(64, 1, 67108864)
  return module
}

const tables = async () => {
  const module = await load()
  const materials = createMaterials(module, {
    offset: module._engine_material_view_offset(),
    count: module._engine_material_count(),
    stride: module._engine_material_stride_bytes()
  })
  const textures = createTextures(module)
  return { module, materials, textures }
}

const pools = async (width = 1, height = 1) => {
  const { module, materials, textures } = await tables()
  const pixels = new Uint8Array(textures.capacity * width * height * 4)
  const texturePool = createTexturePool({ layers: textures.capacity, width, height, host: textures, pixels })
  const materialPool = createMaterialPool({ capacity: materials.capacity, host: materials, textures: texturePool })
  return { module, materials, textures, texturePool, materialPool }
}

gate('the material table is 40 bytes a slot: ten words, the albedo handle in the tenth', async () => {
  const { module, materials } = await tables()
  assert.equal(module._engine_material_stride_bytes(), EXPECTED_STRIDE_BYTES)
  assert.equal(materials.words.length, materials.capacity * EXPECTED_WORDS)
  assert.equal(materials.data.length, materials.capacity * EXPECTED_WORDS)
  assert.equal(EXPECTED_ALBEDO_WORD, EXPECTED_WORDS - 1)
  assert.equal(materials.data.byteOffset % 4, 0)
})

gate('materials: a material is a slot, read back exactly, and an invalid one is refused before a slot is taken', async () => {
  const { materialPool: materials } = await pools()
  const handle = materials.add(MATERIAL)
  const out = new Float32Array(9)
  assert.equal(materials.read(handle, out), 0)
  assert.deepEqual(Array.from(out), MATERIAL_READ)
  const before = materials.count()
  assert.throws(() => materials.add({ ...MATERIAL, r: 2 }), RangeError)
  assert.throws(() => materials.add({ ...MATERIAL, emissiveR: -1 }), RangeError)
  assert.throws(() => materials.add({ ...MATERIAL, roughness: NaN }), RangeError)
  assert.throws(() => materials.add({ ...MATERIAL, metallic: Infinity }), RangeError)
  assert.throws(() => materials.add({ ...MATERIAL, a: 1.5 }), RangeError)
  assert.throws(() => materials.add({ ...MATERIAL, emissiveB: Infinity }), RangeError)
  assert.throws(() => materials.add({ ...MATERIAL, albedo: 1.5 }), RangeError)
  assert.throws(() => materials.add(null), TypeError)
  assert.equal(materials.count(), before)
})

gate('materials: the table refuses each bad value with kRange and leaves its slots unchanged', async () => {
  const { materials } = await tables()
  assert.equal(materials.add(NaN, 0, 0, 1, 0, 0, 0, 0, 0, 0), TABLE_STATUS.RANGE)
  assert.equal(materials.add(0, 0, 0, 1, 0, 0, -0.5, 0, 0, 0), TABLE_STATUS.RANGE)
  assert.equal(materials.add(0, 0, 0, 1, 0, 0, 0, 0, 0, 1.5), TABLE_STATUS.RANGE)
  assert.equal(materials.add(0, 0, 0, 1, 0, 0, 0, 0, 0, 4294967296), TABLE_STATUS.RANGE)
  assert.equal(materials.liveCount(), 0)
})

gate('materials: a full table refuses a new material, and a removed one leaves zeros and a stale handle', async () => {
  const { materialPool: materials, materials: host } = await pools()
  const handles = []
  for (;;) {
    const handle = materials.add(MATERIAL)
    if (handle === -1) break
    handles.push(handle)
  }
  assert.equal(handles.length, host.capacity)
  assert.equal(materials.add(MATERIAL), -1)
  const first = handles[0]
  const slot = host.slot(first)
  assert.equal(materials.remove(first), true)
  assert.deepEqual(Array.from(host.words.subarray(slot * EXPECTED_WORDS, slot * EXPECTED_WORDS + EXPECTED_WORDS)), new Array(EXPECTED_WORDS).fill(0))
  assert.equal(materials.isLive(first), false)
  assert.equal(host.slot(first), -1)
  assert.throws(() => materials.read(first, new Float32Array(9)), RangeError)
  assert.throws(() => materials.set(first, MATERIAL), RangeError)
  assert.equal(materials.remove(first), false)
})

gate('materials: an albedo must be a live texture, and a texture removed under a material leaves -1 until it is replaced', async () => {
  const { materialPool: materials, texturePool: textures } = await pools(1, 1)
  const texture = textures.add(new Uint8Array(4).fill(9))
  const material = materials.add({ ...MATERIAL, albedo: texture })
  assert.equal(materials.albedoOffset(material), textures.layerOffset(texture))
  assert.throws(() => materials.add({ ...MATERIAL, albedo: texture + SLOT_SPAN }), RangeError)
  assert.throws(() => materials.add({ ...MATERIAL, albedo: 4294967295 }), RangeError)
  textures.remove(texture)
  assert.equal(materials.albedoOffset(material), -1)
  const replacement = textures.add(new Uint8Array(4).fill(7))
  assert.notEqual(replacement, texture)
  assert.equal(materials.albedoOffset(material), -1)
  assert.throws(() => materials.add({ ...MATERIAL, albedo: texture }), RangeError)
})

gate('materials: a set changes the slot in place, a bad set is refused and leaves the slot as it was', async () => {
  const { materialPool: materials, materials: host } = await pools()
  const handle = materials.add(MATERIAL)
  const slot = host.slot(handle)
  materials.set(handle, { ...MATERIAL, r: 0, g: 1 })
  const out = new Float32Array(9)
  materials.read(handle, out)
  assert.equal(out[0], 0)
  assert.equal(out[1], 1)
  assert.equal(host.slot(handle), slot)
  assert.throws(() => materials.set(handle, { ...MATERIAL, r: 3 }), RangeError)
  materials.read(handle, out)
  assert.equal(out[0], 0)
})

gate('materials: churn during play keeps the same backing buffers', async () => {
  const { materialPool: materials, materials: host } = await pools()
  const data = materials.data
  const words = materials.words
  for (let i = 0; i < 10000; i++) materials.remove(materials.add(MATERIAL))
  assert.equal(materials.data, data)
  assert.equal(materials.words, words)
  assert.equal(host.data.buffer, data.buffer)
  assert.equal(materials.count(), 0)
})

gate('materials: a slot retires at its last generation, and no handle it issued resolves again', async () => {
  const { materials: host } = await pools()
  const issued = []
  const args = [...Object.values(MATERIAL), 0]
  let handle = host.add(...args)
  while (handle >= 0 && handle % SLOT_SPAN === 0) {
    issued.push(handle)
    assert.equal(host.remove(handle), TABLE_STATUS.OK)
    handle = host.add(...args)
  }
  assert.equal(issued.length, LAST_GENERATION)
  assert.equal(new Set(issued).size, LAST_GENERATION)
  assert.ok(handle < 0 || handle % SLOT_SPAN !== 0, 'the retired slot is not handed out again')
  for (const old of issued) assert.equal(host.isLive(old), false)
  assert.equal(host.remove(issued[issued.length - 1]), TABLE_STATUS.BAD_ID)
})

gate('materials: the pool refuses to build without a wasm host, and a capacity that does not match the table', async () => {
  const { materials } = await tables()
  assert.throws(() => createMaterialPool({ capacity: 1 }), TypeError)
  assert.throws(() => createMaterialPool({ capacity: materials.capacity + 1, host: materials }), RangeError)
})

gate('textures: a texture add refuses bad sizes and formats without taking a slot', async () => {
  const { textures } = await tables()
  const before = textures.liveCount()
  for (const [w, h, f] of [[0, 1, 1], [1, 0, 1], [1.5, 1, 1], [1, NaN, 1], [TEXTURE_MAX_DIMENSION + 1, 1, 1], [1, 1, 0], [1, 1, 3], [1, 1, 1.5]]) {
    assert.equal(textures.add(w, h, f), TABLE_STATUS.RANGE, [w, h, f].join(','))
  }
  assert.equal(textures.liveCount(), before)
  assert.notEqual(textures.add(TEXTURE_MAX_DIMENSION, 1, TEXTURE_FORMAT_SRGB), TABLE_STATUS.RANGE)
  assert.equal(TEXTURE_FORMAT.RGBA8_UNORM, TEXTURE_FORMAT_UNORM)
  assert.equal(TEXTURE_FORMAT.RGBA8_SRGB, TEXTURE_FORMAT_SRGB)
})

gate('textures: a layer takes exactly one image, a wrong size or type is refused', async () => {
  const { texturePool: textures } = await pools(2, 2)
  const handle = textures.add(new Uint8Array(16).fill(7))
  const offset = textures.layerOffset(handle)
  assert.deepEqual(Array.from(textures.data.subarray(offset, offset + 16)), new Array(16).fill(7))
  assert.throws(() => textures.add(new Uint8Array(15)), RangeError)
  assert.throws(() => textures.add([1, 2]), TypeError)
  assert.equal(textures.count(), 1)
})

gate('textures: a replaced layer takes the new image, a removed one is zeroed and its handle is refused', async () => {
  const { texturePool: textures } = await pools(2, 2)
  const handle = textures.add(new Uint8Array(16).fill(7))
  const offset = textures.layerOffset(handle)
  textures.replace(handle, new Uint8Array(16).fill(9))
  assert.equal(textures.data[offset], 9)
  assert.equal(textures.remove(handle), true)
  assert.equal(textures.data[offset], 0)
  assert.throws(() => textures.replace(handle, new Uint8Array(16)), RangeError)
  assert.throws(() => textures.layerOffset(handle), RangeError)
})

gate('textures: a full array refuses a new layer without writing into one', async () => {
  const { module, texturePool: textures } = await pools(1, 1)
  const capacity = textures.layers
  const expected = []
  for (let i = 0; i < capacity; i++) {
    const value = (i % 200) + 1
    textures.add(new Uint8Array(4).fill(value))
    expected.push(value, value, value, value)
  }
  assert.equal(textures.add(new Uint8Array(4).fill(255)), -1)
  assert.deepEqual(Array.from(textures.data), expected)
  assert.equal(module._engine_texture_count(), capacity)
})

gate('textures: a retired handle is refused, and a stale handle has no layer', async () => {
  const { textures } = await tables()
  const handle = textures.add(1, 1, TEXTURE_FORMAT.RGBA8_UNORM)
  assert.equal(textures.layer(handle) >= 0, true)
  assert.equal(textures.remove(handle), TABLE_STATUS.OK)
  assert.equal(textures.layer(handle), -1)
  assert.equal(textures.isLive(handle), false)
  assert.equal(textures.remove(handle), TABLE_STATUS.BAD_ID)
})

gate('textures: the pool refuses to build without a wasm host or pixels', async () => {
  const { textures } = await tables()
  assert.throws(() => createTexturePool({ layers: 1, width: 1, height: 1, pixels: new Uint8Array(4) }), TypeError)
  assert.throws(() => createTexturePool({ layers: textures.capacity, width: 1, height: 1, host: textures }), TypeError)
  assert.throws(() => createTexturePool({ layers: textures.capacity + 1, width: 1, height: 1, host: textures, pixels: new Uint8Array(4 * (textures.capacity + 1)) }), RangeError)
})

finish()
