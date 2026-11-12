import { GLB_SKIP_MATERIALS, parseGlb, readStandardPrimitive } from '../physics-extras/glb.js'
import { applyTransformMatrix, buildNodeTransforms } from '../physics-extras/transforms.js'
import { createServer, resolveServerConfig } from './server.js'

export const MODEL_READ_FAILED = 'model-read-failed'
export const MODEL_EMPTY = 'model-has-no-collision-mesh'

const fail = (code, message, cause = null) => {
  const error = new Error(message)
  error.code = code
  if (cause !== null) error.cause = cause
  return error
}

export function modelBoxes(bytes, { position = [0, 0, 0], skipMaterials = GLB_SKIP_MATERIALS } = {}) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('model bytes must be a Uint8Array')
  const { json, binOffset } = parseGlb(bytes)
  const transforms = buildNodeTransforms(json)
  const nodes = json.nodes || []
  const cache = new Map()
  const boxes = []
  for (let index = 0; index < nodes.length; index++) {
    const meshIndex = nodes[index].mesh
    if (meshIndex === undefined) continue
    const mesh = json.meshes[meshIndex]
    for (const primitive of mesh.primitives) {
      const material = primitive.material === undefined ? null : json.materials?.[primitive.material]
      if (material && typeof material.name === 'string' && skipMaterials.has(material.name.toLowerCase())) continue
      const local = readStandardPrimitive(bytes, json, primitive, binOffset, mesh.name, cache)
      if (local.vertexCount === 0) continue
      const placed = applyTransformMatrix(local.vertices, transforms[index])
      const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]
      for (let v = 0; v < placed.length; v += 3) {
        for (let a = 0; a < 3; a++) {
          const value = placed[v + a] + position[a]
          if (value < box[a]) box[a] = value
          if (value > box[a + 3]) box[a + 3] = value
        }
      }
      boxes.push(box)
    }
  }
  return boxes
}

export async function bootServer({ config = {}, readModel, ...rest } = {}) {
  if (typeof readModel !== 'function') throw new TypeError('bootServer needs a readModel function that returns the bytes of a model')
  const resolved = resolveServerConfig(config)
  const boxes = []
  const staticModels = []
  for (const entity of resolved.entities) {
    if (entity.bodyType !== 'static' || entity.model === null) continue
    let bytes
    try {
      bytes = await readModel(entity.model)
    } catch (error) {
      throw fail(MODEL_READ_FAILED, 'model ' + entity.model + ' of entity ' + entity.id + ' could not be read', error)
    }
    const found = modelBoxes(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), { position: entity.position })
    if (found.length === 0) throw fail(MODEL_EMPTY, 'model ' + entity.model + ' of entity ' + entity.id + ' holds no mesh to collide with')
    staticModels.push({ id: entity.id, model: entity.model, firstBox: boxes.length, boxCount: found.length })
    for (const box of found) boxes.push(box)
  }
  const server = createServer({ ...rest, config, boxes })
  const entityOfBox = (index) => {
    for (const entry of staticModels) {
      if (index >= entry.firstBox && index < entry.firstBox + entry.boxCount) return entry.id
    }
    return null
  }
  return Object.assign(server, { staticModels: Object.freeze(staticModels), staticBoxes: boxes, entityOfBox })
}
