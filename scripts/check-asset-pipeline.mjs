import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { KTX2_IDENTIFIER, isKtx2, parseGlb, validateAsset, validateKtx2 } from '../tools/asset-pipeline/validate.mjs'

const ktx2 = (length = 80) => {
  const bytes = new Uint8Array(length)
  bytes.set(KTX2_IDENTIFIER, 0)
  return bytes
}

const pad4 = (value) => (value + 3) & ~3

const glb = (json, bin = new Uint8Array(0)) => {
  const jsonBytes = Buffer.from(JSON.stringify(json), 'utf8')
  const jsonLength = pad4(jsonBytes.length)
  const binLength = bin.length === 0 ? 0 : pad4(bin.length)
  const total = 12 + 8 + jsonLength + (bin.length === 0 ? 0 : 8 + binLength)
  const out = Buffer.alloc(total)
  out.writeUInt32LE(0x46546c67, 0)
  out.writeUInt32LE(2, 4)
  out.writeUInt32LE(total, 8)
  out.writeUInt32LE(jsonLength, 12)
  out.writeUInt32LE(0x4e4f534a, 16)
  jsonBytes.copy(out, 20)
  out.fill(0x20, 20 + jsonBytes.length, 20 + jsonLength)
  if (bin.length > 0) {
    const at = 20 + jsonLength
    out.writeUInt32LE(binLength, at)
    out.writeUInt32LE(0x004e4942, at + 4)
    Buffer.from(bin).copy(out, at + 8)
  }
  return out
}

const binChunk = () => {
  const bin = new Uint8Array(128)
  bin.set(ktx2(), 48)
  return bin
}

const scene = (overrides = {}) => ({
  asset: { version: '2.0' },
  extensionsUsed: ['EXT_meshopt_compression'],
  extensionsRequired: ['EXT_meshopt_compression'],
  buffers: [{ byteLength: 128 }, { byteLength: 42, extensions: { EXT_meshopt_compression: { fallback: true } } }],
  bufferViews: [
    { buffer: 1, byteOffset: 0, byteLength: 36, extensions: { EXT_meshopt_compression: { buffer: 0, byteOffset: 0, byteLength: 20, byteStride: 12, count: 3, mode: 'ATTRIBUTES' } } },
    { buffer: 1, byteOffset: 36, byteLength: 6, extensions: { EXT_meshopt_compression: { buffer: 0, byteOffset: 20, byteLength: 8, byteStride: 2, count: 3, mode: 'TRIANGLES' } } },
    { buffer: 0, byteOffset: 48, byteLength: 80 },
  ],
  accessors: [
    { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
    { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
  ],
  meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
  images: [{ bufferView: 2, mimeType: 'image/ktx2' }],
  ...overrides,
})

const withView = (index, patch) => {
  const doc = scene()
  doc.bufferViews[index] = { ...doc.bufferViews[index], ...patch }
  return doc
}

const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])

gate('a KTX2 texture with its identifier and header is accepted', () => {
  const result = validateAsset('albedo.ktx2', ktx2())
  assert.deepEqual([result.ok, result.reasons], [true, []])
  assert.equal(isKtx2(ktx2()), true)
})

gate('a KTX2 file shorter than its header is refused', () => {
  assert.equal(validateKtx2(ktx2(40)).length, 1)
  assert.equal(validateAsset('short.ktx2', ktx2(40)).ok, false)
})

gate('a PNG texture is refused as not KTX2', () => {
  const result = validateAsset('albedo.png', pngBytes)
  assert.equal(result.ok, false)
  assert.match(result.reasons[0], /not a KTX2 texture or a GLB model/)
})

gate('a file whose name says KTX2 but whose bytes are a GLB is refused', () => {
  const result = validateAsset('albedo.ktx2', glb(scene(), binChunk()))
  assert.equal(result.ok, false)
  assert.match(result.reasons[0], /the file name says ktx2 but the bytes are glb/)
})

gate('a JSON glTF file is refused, and only the GLB form is accepted', () => {
  const result = validateAsset('scene.gltf', Buffer.from(JSON.stringify(scene()), 'utf8'))
  assert.equal(result.ok, false)
})

gate('a GLB with meshopt geometry and a KTX2 image is accepted', () => {
  const result = validateAsset('model.glb', glb(scene(), binChunk()))
  assert.deepEqual(result.reasons, [])
  assert.equal(result.ok, true)
})

gate('a GLB whose geometry bufferView is not meshopt-compressed is refused', () => {
  const doc = scene()
  doc.bufferViews[0] = { buffer: 0, byteOffset: 0, byteLength: 36 }
  doc.buffers = [{ byteLength: 128 }]
  const result = validateAsset('model.glb', glb(doc, binChunk()))
  assert.equal(result.ok, false)
  assert.ok(result.reasons.some((reason) => /bufferView 0 holds mesh geometry and is not meshopt-compressed/.test(reason)))
})

gate('a meshopt bufferView missing a required field is refused', () => {
  const doc = withView(0, { extensions: { EXT_meshopt_compression: { buffer: 0, byteOffset: 0, byteStride: 12, count: 3, mode: 'ATTRIBUTES' } } })
  const result = validateAsset('model.glb', glb(doc, binChunk()))
  assert.equal(result.ok, false)
  assert.ok(result.reasons.some((reason) => /meshopt byteLength is not a positive whole number/.test(reason)))
})

gate('a meshopt bufferView with an unknown mode is refused', () => {
  const doc = withView(1, { extensions: { EXT_meshopt_compression: { buffer: 0, byteOffset: 20, byteLength: 8, byteStride: 2, count: 3, mode: 'SHRUNK' } } })
  const result = validateAsset('model.glb', glb(doc, binChunk()))
  assert.ok(result.reasons.some((reason) => /meshopt mode is not one of/.test(reason)))
})

gate('a GLB whose image is PNG is refused, even inside the binary chunk', () => {
  const doc = scene({ images: [{ bufferView: 2, mimeType: 'image/png' }] })
  const result = validateAsset('model.glb', glb(doc, binChunk()))
  assert.ok(result.reasons.some((reason) => /image 0 is image\/png, not KTX2/.test(reason)))
})

gate('a KTX2 image whose bytes are not KTX2 is refused', () => {
  const bin = new Uint8Array(128)
  const result = validateAsset('model.glb', glb(scene(), bin))
  assert.ok(result.reasons.some((reason) => /image 0 is not a KTX2 file/.test(reason)))
})

gate('an external buffer or an external image uri is refused', () => {
  const external = scene({ buffers: [{ byteLength: 128, uri: 'model.bin' }, { byteLength: 42, extensions: { EXT_meshopt_compression: { fallback: true } } }] })
  assert.ok(validateAsset('model.glb', glb(external, binChunk())).reasons.some((reason) => /buffer 0 is external/.test(reason)))
  const image = scene({ images: [{ uri: 'albedo.ktx2', mimeType: 'image/ktx2' }] })
  assert.ok(validateAsset('model.glb', glb(image, binChunk())).reasons.some((reason) => /image 0 is external/.test(reason)))
})

gate('a truncated GLB is refused with reasons and does not throw', () => {
  const full = glb(scene(), binChunk())
  const result = validateAsset('model.glb', full.subarray(0, 40))
  assert.equal(result.ok, false)
  assert.equal(result.reasons.length, 1)
  assert.throws(() => parseGlb(full.subarray(0, 4)), RangeError)
})

gate('a GLB with a wrong length field is refused', () => {
  const bytes = glb(scene(), binChunk())
  bytes.writeUInt32LE(bytes.length + 4, 8)
  assert.equal(validateAsset('model.glb', bytes).ok, false)
})

finish()
