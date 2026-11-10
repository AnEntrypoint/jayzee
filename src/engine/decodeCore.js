import { MeshoptDecoder } from '../../node_modules/meshoptimizer/meshopt_decoder.mjs'

export const TRANSCODE_RGBA32 = 13

const KTX2_IDENTIFIER = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]

const hasKtx2Identifier = (bytes) => bytes.length >= KTX2_IDENTIFIER.length && KTX2_IDENTIFIER.every((byte, i) => bytes[i] === byte)

export const decodeVertices = async (bytes, count, size, filter) => {
  await MeshoptDecoder.ready
  if (!MeshoptDecoder.supported) throw new Error('meshopt decoder is not supported on this host')
  const target = new Uint8Array(count * size)
  MeshoptDecoder.decodeVertexBuffer(target, count, size, bytes, filter)
  return target
}

export const decodeIndices = async (bytes, count, size) => {
  await MeshoptDecoder.ready
  if (!MeshoptDecoder.supported) throw new Error('meshopt decoder is not supported on this host')
  const target = new Uint8Array(count * size)
  MeshoptDecoder.decodeIndexBuffer(target, count, size, bytes)
  return target
}

export const loadBasisFactory = (source, host = {}) => {
  const holder = { exports: {} }
  return new Function('module', 'exports', 'require', '__dirname', '__filename', source + '\nreturn module.exports;')(holder, holder.exports, host.require, host.dirname, host.filename)
}

export const createTranscoder = (basisFactory, wasmBinary) => {
  let ready = null
  const basis = () => {
    if (ready === null) {
      ready = new Promise((resolve, reject) => {
        const instance = { wasmBinary, onRuntimeInitialized: () => resolve(instance) }
        try {
          basisFactory(instance)
        } catch (error) {
          reject(error)
        }
      }).then((instance) => {
        instance.initializeBasis()
        return instance
      })
    }
    return ready
  }

  return {
    async transcodeKtx2(bytes) {
      if (!hasKtx2Identifier(bytes)) throw new Error('not a valid KTX2 file')
      const module = await basis()
      const file = new module.KTX2File(new Uint8Array(bytes))
      try {
        if (!file.isValid()) throw new Error('not a valid KTX2 file')
        if (file.isHDR()) throw new Error('HDR KTX2 is not decoded here')
        if (file.getFaces() !== 1) throw new Error('cube KTX2 is not decoded here')
        if (!file.startTranscoding()) throw new Error('KTX2 startTranscoding failed')
        const width = file.getWidth()
        const height = file.getHeight()
        const rgba = new Uint8Array(file.getImageTranscodedSizeInBytes(0, 0, 0, TRANSCODE_RGBA32))
        if (!file.transcodeImage(rgba, 0, 0, 0, TRANSCODE_RGBA32, 0, -1, -1)) throw new Error('KTX2 transcodeImage failed')
        return { width, height, rgba }
      } finally {
        file.close()
        file.delete()
      }
    },
  }
}
