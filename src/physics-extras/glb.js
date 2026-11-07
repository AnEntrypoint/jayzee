import { refusal } from './math.js'
import { applyTransformMatrix, buildNodeTransforms } from './transforms.js'

const GLB = 'glb'
const UINT16 = 5123
const UINT32 = 5125
const POSITION_PACKED_STRIDE = 12
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
  if (componentType === UINT16) {
    const out = new Uint32Array(count)
    for (let i = 0; i < count; i++) out[i] = view.getUint16(start + i * 2, true)
    return out
  }
  if (componentType === UINT32) {
    const out = new Uint32Array(count)
    for (let i = 0; i < count; i++) out[i] = view.getUint32(start + i * 4, true)
    return out
  }
  throw refusal(GLB, 'glb-index-type-unsupported', `index component type ${componentType} is not 5123 or 5125`)
}

export function readStandardPrimitive(bytes, json, primitive, binOffset, meshName) {
  const view = dataViewOf(bytes)
  const positionAccessor = json.accessors[primitive.attributes.POSITION]
  const positionView = json.bufferViews[positionAccessor.bufferView]
  const positionStart = binOffset + (positionView.byteOffset || 0) + (positionAccessor.byteOffset || 0)
  const stride = positionView.byteStride || POSITION_PACKED_STRIDE
  const vertices = new Float32Array(positionAccessor.count * 3)
  for (let i = 0; i < positionAccessor.count; i++) {
    const at = positionStart + i * stride
    vertices[i * 3] = view.getFloat32(at, true)
    vertices[i * 3 + 1] = view.getFloat32(at + 4, true)
    vertices[i * 3 + 2] = view.getFloat32(at + 8, true)
  }
  let indices = null
  if (primitive.indices !== undefined) {
    const indexAccessor = json.accessors[primitive.indices]
    const indexView = json.bufferViews[indexAccessor.bufferView]
    const indexStart = binOffset + (indexView.byteOffset || 0) + (indexAccessor.byteOffset || 0)
    indices = readIndices(view, indexStart, indexAccessor.componentType, indexAccessor.count)
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
  if (json.bufferViews?.some((view) => view.extensions?.EXT_meshopt_compression)) throw refusal(GLB, 'glb-meshopt-unsupported', 'Meshopt-compressed buffer needs the decoder')
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
