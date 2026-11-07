import { refusal } from './math.js'

const MESHOPT = 'meshopt'
const INT16 = 5122
const POSITION_PACKED_STRIDE = 12
const NORMALIZED_INT16_STRIDE = 8
const NORMALIZED_INT16_SCALE = 32767
const DEFAULT_INDEX_STRIDE = 2

export function dequantizePositions(decoded, count, stride, normalized, componentType) {
  const vertices = new Float32Array(count * 3)
  if (stride === NORMALIZED_INT16_STRIDE && normalized && componentType === INT16) {
    const raw = new Int16Array(decoded.buffer, decoded.byteOffset, decoded.byteLength / 2)
    for (let i = 0; i < count; i++) {
      vertices[i * 3] = raw[i * 4] / NORMALIZED_INT16_SCALE
      vertices[i * 3 + 1] = raw[i * 4 + 1] / NORMALIZED_INT16_SCALE
      vertices[i * 3 + 2] = raw[i * 4 + 2] / NORMALIZED_INT16_SCALE
    }
    return vertices
  }
  if (stride === POSITION_PACKED_STRIDE) {
    vertices.set(new Float32Array(decoded.buffer, decoded.byteOffset, count * 3))
    return vertices
  }
  if (stride % 4 !== 0) throw refusal(MESHOPT, 'meshopt-stride-invalid', `float stride ${stride} is not a multiple of 4`)
  const floats = new Float32Array(decoded.buffer, decoded.byteOffset, decoded.byteLength / 4)
  const floatStride = stride / 4
  for (let i = 0; i < count; i++) {
    vertices[i * 3] = floats[i * floatStride]
    vertices[i * 3 + 1] = floats[i * floatStride + 1]
    vertices[i * 3 + 2] = floats[i * floatStride + 2]
  }
  return vertices
}

export function indexView(decoded, byteStride) {
  const width = byteStride || DEFAULT_INDEX_STRIDE
  if (width === 2) return new Uint16Array(decoded.buffer, decoded.byteOffset, decoded.byteLength / 2)
  if (width === 4) return new Uint32Array(decoded.buffer, decoded.byteOffset, decoded.byteLength / 4)
  throw refusal(MESHOPT, 'meshopt-index-stride-invalid', `index stride ${width} must be 2 or 4`)
}

export function indexSlice(view, accessorByteOffset, byteStride, count) {
  const start = (accessorByteOffset || 0) / (byteStride || DEFAULT_INDEX_STRIDE)
  return new Uint32Array(view.subarray(start, start + count))
}
