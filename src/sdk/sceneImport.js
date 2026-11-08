const VEC3 = Object.freeze(['x', 'y', 'z'])

function refusal(reasonCode, message) {
  return Object.assign(new Error(`SceneImport: ${message}`), { reasonCode })
}

function requireTable(kindToTemplate) {
  if (!kindToTemplate || typeof kindToTemplate !== 'object') throw refusal('scene-kind-table', 'kindToTemplate must be an object')
}

function finiteList(value, length) {
  if (!Array.isArray(value) || value.length !== length) return null
  const out = []
  for (let i = 0; i < length; i++) {
    if (!Number.isFinite(value[i])) return null
    out.push(value[i])
  }
  return out
}

function vec3(value, where) {
  if (value == null) return [0, 0, 0]
  const list = finiteList(value, 3)
  if (list) return list
  if (typeof value === 'object' && VEC3.every(k => Number.isFinite(value[k]))) return VEC3.map(k => value[k])
  throw refusal('scene-vector', `${where} must be [x,y,z] or {x,y,z} of finite numbers`)
}

function quat(value, where) {
  if (value == null) return [0, 0, 0, 1]
  const list = finiteList(value, 4)
  if (list) return list
  throw refusal('scene-quaternion', `${where} must be [x,y,z,w] of finite numbers`)
}

function templateFor(kind, kindToTemplate, where) {
  requireTable(kindToTemplate)
  const template = typeof kind === 'string' && Object.hasOwn(kindToTemplate, kind) ? kindToTemplate[kind] : undefined
  if (typeof template !== 'string' || template.length === 0) {
    throw refusal('scene-kind-unmapped', `${where} kind "${String(kind)}" has no template`)
  }
  return template
}

function customOf(state, where) {
  if (state == null) return {}
  if (typeof state !== 'object' || Array.isArray(state)) throw refusal('scene-state', `${where}.state must be an object`)
  return { ...state }
}

export function mapSceneObject(object, kindToTemplate, index = 0) {
  const where = `object[${index}]`
  if (!object || typeof object !== 'object') throw refusal('scene-object', `${where} must be an object`)
  if (typeof object.id !== 'string' || object.id.length === 0) throw refusal('scene-object-id', `${where} needs a non-empty string id`)
  const template = templateFor(object.kind, kindToTemplate, where)
  const position = vec3(object.position, `${where}.position`)
  const rotation = quat(object.rotation, `${where}.rotation`)
  const scale = vec3(object.scale ?? [1, 1, 1], `${where}.scale`)
  const custom = customOf(object.state, where)
  return Object.freeze({ id: object.id, template, position, rotation, scale, custom })
}

export function mapScene(scene, kindToTemplate) {
  if (!scene || typeof scene !== 'object') throw refusal('scene-root', 'scene must be an object')
  if (typeof scene.id !== 'string' || scene.id.length === 0) throw refusal('scene-id', 'scene needs a non-empty string id')
  requireTable(kindToTemplate)
  const objects = scene.objects == null ? [] : scene.objects
  if (!Array.isArray(objects)) throw refusal('scene-objects', 'scene.objects must be an array when present')
  const seen = new Set()
  const placements = []
  for (let index = 0; index < objects.length; index++) {
    const placement = mapSceneObject(objects[index], kindToTemplate, index)
    if (seen.has(placement.id)) throw refusal('scene-object-duplicate', `object[${index}] id "${placement.id}" repeats`)
    seen.add(placement.id)
    placements.push(placement)
  }
  return Object.freeze({
    place: Object.freeze({ id: scene.id, spawn: vec3(scene.spawn, 'scene.spawn') }),
    placements: Object.freeze(placements),
  })
}
