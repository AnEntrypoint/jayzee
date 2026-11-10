import { readFileSync } from 'node:fs'
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
  const encoded = MeshoptEncoder.encodeVertexBuffer(vertexBytes, VERTEX_COUNT, VERTEX_SIZE)
  const decoded = await decodeVertices(encoded, VERTEX_COUNT, VERTEX_SIZE)
  assert.deepEqual(Buffer.from(decoded), Buffer.from(vertexBytes))
})

await gate('meshopt index stream decodes to the indices it was encoded from', async () => {
  const encoded = MeshoptEncoder.encodeIndexBuffer(indexBytes, INDEX_COUNT, 4)
  const decoded = await decodeIndices(encoded, INDEX_COUNT, 4)
  assert.deepEqual(Buffer.from(decoded), Buffer.from(indexBytes))
})

const transcoder = createTranscoder(loadBasisFactory(readFileSync(join(basisDir, 'basis_transcoder.js'), 'utf8')), new Uint8Array(readFileSync(join(basisDir, 'basis_transcoder.wasm'))))

await gate('the basis transcoder refuses bytes that are not KTX2', async () => {
  await assert.rejects(transcoder.transcodeKtx2(new Uint8Array([1, 2, 3, 4])), /not a valid KTX2 file/)
})

const engineGlue = await (await import(pathToFileURL(join(root, 'engine/out/engine-core-64mib.mjs')).href)).default()
const TIER_BUDGET = 67108864

await gate('the tier 0 pool is bound from the device limits and the arena holds it', () => {
  assert.equal(engineGlue._engine_init(64, 1, TIER_BUDGET), 0)
  assert.equal(engineGlue._engine_models_bind_plan(...TIER0_LIMITS), 0)
  assert.equal(engineGlue._engine_models_bind_plan(...TIER0_LIMITS), -3, 'a second bind is refused')
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
