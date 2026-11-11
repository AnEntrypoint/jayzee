import { MeshoptEncoder } from '../../node_modules/meshoptimizer/meshopt_encoder.js'
import { createDecodeWorker } from '../../src/engine/decodeClient.js'

const COUNT = 64
const SIZE = 32
const result = { phase: 'decode-worker', done: false, ok: false, errors: [] }
window.decodeWorkerResult = result

const run = async () => {
  const started = performance.now()
  const source = new Uint8Array(COUNT * SIZE).map((_, i) => (i * 37 + (i >> 5)) & 0xff)
  await MeshoptEncoder.ready
  const encoded = MeshoptEncoder.encodeVertexBuffer(source, COUNT, SIZE)
  const worker = createDecodeWorker()
  try {
    const decodeAt = performance.now()
    const decoded = await worker.decodeVertices(encoded, COUNT, SIZE)
    result.meshoptDecodeMs = Math.round((performance.now() - decodeAt) * 100) / 100
    result.meshoptVertexEqual = decoded.length === source.length && decoded.every((value, i) => value === source[i])
    try {
      await worker.transcodeKtx2(new Uint8Array([1, 2, 3, 4]))
      result.ktx2Refusal = null
    } catch (error) {
      result.ktx2Refusal = error.message
    }
    const identifier = new Uint8Array([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(100).fill(0)])
    const transcodeAt = performance.now()
    try {
      await worker.transcodeKtx2(identifier)
      result.transcoderRefusal = null
    } catch (error) {
      result.transcoderRefusal = error.message
    }
    result.transcoderMs = Math.round((performance.now() - transcodeAt) * 100) / 100
    const ktx2Path = new URLSearchParams(location.search).get('ktx2')
    if (ktx2Path !== null) {
      const bytes = new Uint8Array(await (await fetch('/' + ktx2Path)).arrayBuffer())
      const realAt = performance.now()
      const image = await worker.transcodeKtx2(bytes)
      let hash = 0x811c9dc5
      for (let i = 0; i < image.rgba.length; i++) hash = Math.imul(hash ^ image.rgba[i], 0x01000193) >>> 0
      result.ktx2 = { sourceBytes: bytes.length, width: image.width, height: image.height, rgbaBytes: image.rgba.length, fnv: hash.toString(16).padStart(8, '0'), ms: Math.round((performance.now() - realAt) * 100) / 100 }
    }
  } finally {
    worker.close()
  }
  result.wallMs = Math.round((performance.now() - started) * 100) / 100
  result.ok = result.meshoptVertexEqual === true && result.ktx2Refusal === 'not a valid KTX2 file' && /not a valid KTX2 file|not decoded here|startTranscoding/.test(result.transcoderRefusal ?? '')
  result.done = true
}

run().catch((error) => {
  result.errors.push(String(error && error.stack ? error.stack : error))
  result.done = true
})
