import { createTranscoder, decodeIndices, decodeVertices, loadBasisFactory } from './decodeCore.js'

const basisJs = new URL('../../node_modules/three/examples/jsm/libs/basis/basis_transcoder.js', import.meta.url).href
const basisWasm = new URL('../../node_modules/three/examples/jsm/libs/basis/basis_transcoder.wasm', import.meta.url).href

let transcoder = null
const transcoderFor = async () => {
  if (transcoder === null) {
    const [source, wasmBinary] = await Promise.all([
      fetch(basisJs).then((response) => response.text()),
      fetch(basisWasm).then((response) => response.arrayBuffer()),
    ])
    transcoder = createTranscoder(loadBasisFactory(source), wasmBinary)
  }
  return transcoder
}

const handlers = {
  async vertices({ bytes, count, size, filter }) {
    return { bytes: await decodeVertices(bytes, count, size, filter) }
  },
  async indices({ bytes, count, size }) {
    return { bytes: await decodeIndices(bytes, count, size) }
  },
  async ktx2({ bytes }) {
    return (await transcoderFor()).transcodeKtx2(bytes)
  },
}

self.onmessage = async ({ data }) => {
  const { id, kind } = data
  try {
    const result = await handlers[kind](data)
    const transfer = []
    if (result.bytes) transfer.push(result.bytes.buffer)
    if (result.rgba) transfer.push(result.rgba.buffer)
    self.postMessage({ id, result }, transfer)
  } catch (error) {
    self.postMessage({ id, error: String(error && error.message ? error.message : error) })
  }
}
