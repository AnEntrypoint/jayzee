import { refusal } from './math.js'
import { decodeGltfBuffer } from './meshoptCodec.js'
import { applyTransformMatrix, buildNodeTransforms } from './transforms.js'

const GLB = 'glb'
const INT8 = 5120
const UINT8 = 5121
const INT16 = 5122
const UINT16 = 5123
const FLOAT32 = 5126
const MESHOPT_EXT = 'EXT_meshopt_compression'
const UINT32 = 5125
const JSON_HEADER_END = 20
const BIN_CHUNK_HEADER = 8

export const GLB_SKIP_MATERIALS = Object.freeze(new Set(['aaatrigger', '{invisible', 'playerclip', 'clip', 'nodraw', 'trigger', 'sky', 'toolsclip', 'toolsplayerclip', 'toolsnodraw', 'toolsskybox', 'toolstrigger']))

const dataViewOf = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

export function parseGlb(bytes) {
  if (bytes.length < JSON_HEADER_END || new TextDecoder().decode(bytes.subarray(0, 4)) !== 'glTF') {
    throw refusal(GLB, 'glb-magic-invalid', 'not a GLB file')
  }
  const jsonLength = dataViewOf(bytes).getUint32(12, true)
  if (JSON_HEADER_END + jsonLength > bytes.length) throw refusal(GLB, 'glb-json-truncated', 'JSON chunk runs past the end of the file')
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(JSON_HEADER_END, JSON_HEADER_END + jsonLength)))
  return { json, binOffset: JSON_HEADER_END + jsonLength + BIN_CHUNK_HEADER }
}

function readIndices(view, start, componentType, count) {
  const width = componentType === UINT8 ? 1 : componentType === UINT16 ? 2 : componentType === UINT32 ? 4 : 0
  if (width === 0) throw refusal(GLB, 'glb-index-type-unsupported', `index component type ${componentType} is not 5121, 5123 or 5125`)
  if (start < 0 || start + count * width > view.byteLength) throw refusal(GLB, 'glb-index-range-invalid', 'index accessor runs past the end of its data')
  const out = new Uint32Array(count)
  if (width === 1) for (let i = 0; i < count; i++) out[i] = view.getUint8(start + i)
  else if (width === 2) for (let i = 0; i < count; i++) out[i] = view.getUint16(start + i * 2, true)
  else for (let i = 0; i < count; i++) out[i] = view.getUint32(start + i * 4, true)
  return out
}

const POSITION_READERS = {
  [FLOAT32]: { size: 4, read: (view, at) => view.getFloat32(at, true), scale: 1 },
  [INT8]: { size: 1, read: (view, at) => view.getInt8(at), scale: 127 },
  [UINT8]: { size: 1, read: (view, at) => view.getUint8(at), scale: 255 },
  [INT16]: { size: 2, read: (view, at) => view.getInt16(at, true), scale: 32767 },
  [UINT16]: { size: 2, read: (view, at) => view.getUint16(at, true), scale: 65535 },
}

function readPositions(view, start, stride, accessor) {
  const reader = POSITION_READERS[accessor.componentType]
  if (!reader) throw refusal(GLB, 'glb-position-type-unsupported', `position component type ${accessor.componentType} is not 5120, 5121, 5122, 5123 or 5126`)
  const count = accessor.count
  const step = stride || reader.size * 3
  if (count > 0 && (start < 0 || start + (count - 1) * step + reader.size * 3 > view.byteLength)) throw refusal(GLB, 'glb-position-range-invalid', 'position accessor runs past the end of its data')
  const normalized = accessor.normalized === true && accessor.componentType !== FLOAT32
  const signed = accessor.componentType === INT8 || accessor.componentType === INT16
  const vertices = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const at = start + i * step
    for (let k = 0; k < 3; k++) {
      const raw = reader.read(view, at + k * reader.size)
      vertices[i * 3 + k] = normalized ? (signed ? Math.max(raw / reader.scale, -1) : raw / reader.scale) : raw
    }
  }
  return vertices
}

function meshoptView(bytes, json, bufferView, binOffset) {
  const ext = bufferView.extensions[MESHOPT_EXT]
  const { count, byteStride, mode, filter } = ext
  if (!Number.isInteger(count) || !Number.isInteger(byteStride) || !Number.isInteger(ext.byteLength) || typeof mode !== 'string') throw refusal(GLB, 'glb-meshopt-invalid', 'EXT_meshopt_compression needs integer count, byteStride and byteLength and a mode')
  if (json.buffers?.[ext.buffer]?.uri !== undefined) throw refusal(GLB, 'glb-meshopt-external-buffer', 'Meshopt data must live in the GLB BIN chunk')
  const start = binOffset + (ext.byteOffset || 0)
  if (start + ext.byteLength > bytes.length) throw refusal(GLB, 'glb-meshopt-range-invalid', 'Meshopt data runs past the end of the file')
  const decoded = new Uint8Array(count * byteStride)
  decodeGltfBuffer(decoded, count, byteStride, bytes.subarray(start, start + ext.byteLength), mode, filter)
  return { view: dataViewOf(decoded), start: 0, stride: mode === 'ATTRIBUTES' ? byteStride : 0 }
}

function resolveView(bytes, json, viewIndex, binOffset, cache) {
  if (cache.has(viewIndex)) return cache.get(viewIndex)
  const bufferView = json.bufferViews?.[viewIndex]
  if (!bufferView) throw refusal(GLB, 'glb-buffer-view-missing', `bufferView ${viewIndex} not found`)
  const resolved = bufferView.extensions?.[MESHOPT_EXT]
    ? meshoptView(bytes, json, bufferView, binOffset)
    : { view: dataViewOf(bytes), start: binOffset + (bufferView.byteOffset || 0), stride: bufferView.byteStride || 0 }
  cache.set(viewIndex, resolved)
  return resolved
}

export function readStandardPrimitive(bytes, json, primitive, binOffset, meshName, cache = new Map()) {
  const positionAccessor = json.accessors[primitive.attributes.POSITION]
  const positions = resolveView(bytes, json, positionAccessor.bufferView, binOffset, cache)
  const vertices = readPositions(positions.view, positions.start + (positionAccessor.byteOffset || 0), positions.stride, positionAccessor)
  let indices = null
  if (primitive.indices !== undefined) {
    const indexAccessor = json.accessors[primitive.indices]
    const index = resolveView(bytes, json, indexAccessor.bufferView, binOffset, cache)
    indices = readIndices(index.view, index.start + (indexAccessor.byteOffset || 0), indexAccessor.componentType, indexAccessor.count)
  }
  return {
    vertices,
    indices,
    vertexCount: positionAccessor.count,
    triangleCount: indices ? indices.length / 3 : 0,
    name: meshName,
  }
}

export function extractStandardMeshAt(bytes, container, meshIndex) {
  const { json, binOffset } = container
  const mesh = json.meshes?.[meshIndex]
  if (!mesh) throw refusal(GLB, 'glb-mesh-missing', `mesh index ${meshIndex} not found`)
  const primitive = mesh.primitives[0]
  if (primitive.extensions?.KHR_draco_mesh_compression) throw refusal(GLB, 'glb-draco-unsupported', 'Draco-compressed primitive needs the decoder')
  const result = readStandardPrimitive(bytes, json, primitive, binOffset, mesh.name)
  const nodeIndex = (json.nodes || []).findIndex((node) => node.mesh === meshIndex)
  if (nodeIndex >= 0) result.vertices = applyTransformMatrix(result.vertices, buildNodeTransforms(json)[nodeIndex])
  return result
}

export function placementsByMesh(json, nodeTransforms) {
  const byMesh = new Map()
  const nodes = json.nodes || []
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index]
    if (node.mesh === undefined) continue
    const key = nodeTransforms[index].join(',')
    if (!byMesh.has(node.mesh)) byMesh.set(node.mesh, { seen: new Set(), nodes: [] })
    const entry = byMesh.get(node.mesh)
    if (entry.seen.has(key)) continue
    entry.seen.add(key)
    entry.nodes.push(index)
  }
  return new Map([...byMesh].map(([meshIndex, entry]) => [meshIndex, entry.nodes]))
}
