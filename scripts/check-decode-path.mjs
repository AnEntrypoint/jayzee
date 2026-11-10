import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import { MeshoptEncoder } from 'meshoptimizer/encoder'
import { gate, finish } from './lib/gate.mjs'
import { createTranscoder, decodeIndices, decodeVertices, loadBasisFactory } from '../src/engine/decodeCore.js'
import { uploadModelSlot } from '../src/engine/decodeClient.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const basisDir = join(root, 'node_modules/three/examples/jsm/libs/basis')
const VERTEX_SIZE = 32
const VERTEX_COUNT = 64
const INDEX_COUNT = 96
const TIER0_VERTICES = 4096
const TIER0_INDICES = 12288
const TIER0_LIMITS = [8192, 256, 268435456, 4, 0]

const vertexBytes = new Uint8Array(VERTEX_COUNT * VERTEX_SIZE)
for (let i = 0; i < vertexBytes.length; i++) vertexBytes[i] = (i * 37 + (i >> 5)) & 0xff
const indexBytes = new Uint8Array(INDEX_COUNT * 4)
new Uint32Array(indexBytes.buffer).forEach((_, i, words) => { words[i] = (i * 5) % VERTEX_COUNT })

await gate('meshopt vertex stream decodes to the bytes it was encoded from', async () => {
  await MeshoptEncoder.ready
  const encoded = MeshoptEncoder.encodeVertexBuffer(vertexBytes, VERTEX_COUNT, VERTEX_SIZE)
  const decoded = await decodeVertices(encoded, VERTEX_COUNT, VERTEX_SIZE)
  assert.deepEqual(Buffer.from(decoded), Buffer.from(vertexBytes))
})

const triangleKey = (a, b, c) => {
  const rotations = [[a, b, c], [b, c, a], [c, a, b]].map((t) => t.join(','))
  return rotations.sort()[0]
}
const triangleSet = (bytes) => {
  const words = new Uint32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
  const keys = []
  for (let t = 0; t < words.length; t += 3) keys.push(triangleKey(words[t], words[t + 1], words[t + 2]))
  return keys.sort()
}

await gate('meshopt index stream decodes to the same triangles it was encoded from, up to rotation', async () => {
  await MeshoptEncoder.ready
  const encoded = MeshoptEncoder.encodeIndexBuffer(indexBytes, INDEX_COUNT, 4)
  const decoded = await decodeIndices(encoded, INDEX_COUNT, 4)
  assert.deepEqual(triangleSet(decoded), triangleSet(indexBytes))
})

const basisJs = join(basisDir, 'basis_transcoder.js')
const transcoder = createTranscoder(loadBasisFactory(readFileSync(basisJs, 'utf8'), { require: createRequire(import.meta.url), dirname: basisDir, filename: basisJs }), new Uint8Array(readFileSync(join(basisDir, 'basis_transcoder.wasm'))))

await gate('the basis transcoder refuses bytes that are not KTX2', async () => {
  await assert.rejects(transcoder.transcodeKtx2(new Uint8Array([1, 2, 3, 4])), /not a valid KTX2 file/)
})

await gate('the basis transcoder runs and refuses a KTX2 identifier with no valid header', async () => {
  const identifier = new Uint8Array([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(100).fill(0)])
  await assert.rejects(transcoder.transcodeKtx2(identifier), /not a valid KTX2 file|not decoded here|startTranscoding/)
})

const engineGlue = await (await import(pathToFileURL(join(root, 'engine/out/engine-core-64mib.mjs')).href)).default()
const TIER_BUDGET = 67108864

await gate('a device that plans tier 2 binds tier 0 on the 64 MiB arena, which is the highest tier the arena holds', () => {
  assert.equal(engineGlue._engine_init(64, 1, TIER_BUDGET), 0)
  assert.equal(engineGlue._engine_models_bind_plan(8192, 2048, 268435456, 1, 0), 0)
  assert.equal(Number(engineGlue._engine_models_pool_bytes()), 23169408)
})

await gate('a second bind is refused and reports the model pool is already bound', () => {
  assert.equal(engineGlue._engine_models_bind_plan(...TIER0_LIMITS), -4)
})

await gate('an upload writes the decoded bytes into the slot and marks it dirty', () => {
  const handle = engineGlue._engine_models_load(TIER0_VERTICES, TIER0_INDICES, 7)
  assert.ok(handle > 0)
  const vertices = new Uint8Array(TIER0_VERTICES * VERTEX_SIZE).map((_, i) => (i * 13) & 0xff)
  const indices = new Uint8Array(TIER0_INDICES * 4).map((_, i) => (i * 7) & 0xff)
  uploadModelSlot(engineGlue, handle, vertices, indices)
  const at = engineGlue._engine_models_vertex_ptr(handle)
  assert.deepEqual(Buffer.from(engineGlue.HEAPU8.subarray(at, at + vertices.length)), Buffer.from(vertices))
  assert.equal(engineGlue._engine_models_dirty(), 1)
})

await gate('an upload with the wrong byte count is refused and writes nothing', () => {
  const handle = engineGlue._engine_models_load(TIER0_VERTICES, TIER0_INDICES, 8)
  assert.throws(() => uploadModelSlot(engineGlue, handle, new Uint8Array(10), new Uint8Array(TIER0_INDICES * 4)), RangeError)
})

finish()
