import { FNV1A_32_OFFSET_BASIS, fnv1aStepString } from '../snapshot-lod-pure/fnv1a.js'

export const KIND_PLACE = 'viz.place'
export const KIND_UPDATE = 'viz.update'
export const KIND_REMOVE = 'viz.remove'
export const KIND_CLEAR = 'viz.clear'
export const KIND_DATASET = 'viz.dataset'
export const KIND_CAMERA = 'viz.camera'

export const ALL_KINDS = Object.freeze([KIND_PLACE, KIND_UPDATE, KIND_REMOVE, KIND_CLEAR, KIND_DATASET, KIND_CAMERA])

export const PRIMITIVES = Object.freeze(['box', 'sphere', 'capsule', 'cylinder', 'plane', 'model'])

export const LAYOUTS = Object.freeze(['grid', 'scatter', 'tree', 'graph', 'spiral'])

const COMPUTED_LAYOUTS = Object.freeze(['grid', 'scatter', 'tree', 'spiral'])

const fnv1aString = (text) => fnv1aStepString(FNV1A_32_OFFSET_BASIS, text) >>> 0

const isVec3 = (value) => Array.isArray(value) && value.length === 3

function isUnsafeModelPath(model) {
  return !model
    || model.split(/[\\/]/).includes('..')
    || /^[a-zA-Z]:[\\/]/.test(model)
    || model.startsWith('/')
    || model.startsWith('\\')
}

function validatePlace(payload, errors) {
  if (typeof payload.entityId !== 'string' || !payload.entityId) errors.push('payload.entityId is required')
  if (!PRIMITIVES.includes(payload.primitive)) errors.push(`payload.primitive must be one of: ${PRIMITIVES.join(', ')}`)
  if (payload.primitive === 'model' && typeof payload.model !== 'string') errors.push('payload.model is required when primitive is "model"')
  if (payload.primitive === 'model' && typeof payload.model === 'string' && isUnsafeModelPath(payload.model)) errors.push('payload.model must be a non-empty relative path with no ".." segments and no drive-absolute or root-absolute prefix')
  if (payload.position && !isVec3(payload.position)) errors.push('payload.position must be [x,y,z]')
  if (payload.scale && (!Array.isArray(payload.scale) || payload.scale.length !== 3)) errors.push('payload.scale must be [sx,sy,sz]')
}

function validateDataset(payload, errors) {
  if (typeof payload.entityId !== 'string' || !payload.entityId) errors.push('payload.entityId is required')
  if (!LAYOUTS.includes(payload.layout)) errors.push(`payload.layout must be one of: ${LAYOUTS.join(', ')}`)
  if (!Array.isArray(payload.items)) errors.push('payload.items must be an array')
}

function validateCamera(payload, errors) {
  if (!isVec3(payload.position)) errors.push('payload.position must be [x,y,z]')
  if (!isVec3(payload.target)) errors.push('payload.target must be [x,y,z]')
}

export function validateMessage(msg) {
  if (!msg || typeof msg !== 'object') {
    return { valid: false, errors: ['message must be an object'] }
  }

  const errors = []
  if (typeof msg.id !== 'string' || !msg.id) errors.push('id is required (string)')
  if (!Number.isFinite(msg.ts)) errors.push('ts is required (number, unix ms)')
  if (typeof msg.source !== 'string' || !msg.source) errors.push('source is required (string)')
  if (!ALL_KINDS.includes(msg.kind)) errors.push(`kind must be one of: ${ALL_KINDS.join(', ')}`)

  const payload = msg.payload
  if (!payload || typeof payload !== 'object') {
    errors.push('payload is required (object)')
  } else if (msg.kind === KIND_PLACE) {
    validatePlace(payload, errors)
  } else if (msg.kind === KIND_UPDATE || msg.kind === KIND_REMOVE) {
    if (typeof payload.entityId !== 'string' || !payload.entityId) errors.push('payload.entityId is required')
  } else if (msg.kind === KIND_DATASET) {
    validateDataset(payload, errors)
  } else if (msg.kind === KIND_CAMERA) {
    validateCamera(payload, errors)
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors }
}

function refuse(message) {
  return Object.assign(new TypeError(`[freddie-layout] ${message}`), { reasonCode: 'layout-refused' })
}

function requireItemId(item, where) {
  if (!item || typeof item !== 'object' || typeof item.id !== 'string') {
    throw refuse(`${where} needs an object with a string id`)
  }
  return item.id
}

function gridLayout(items, spacing, positions) {
  const cols = Math.ceil(Math.sqrt(items.length))
  const maxRow = Math.floor((items.length - 1) / cols)
  items.forEach((item, i) => {
    const row = Math.floor(i / cols)
    const col = i % cols
    positions.set(requireItemId(item, 'grid item'), [
      (col - (cols - 1) / 2) * spacing,
      0,
      (row - maxRow / 2) * spacing,
    ])
  })
}

function scatterLayout(items, spacing, positions) {
  items.forEach((item) => {
    const id = requireItemId(item, 'scatter item')
    const h = fnv1aString(id + 'x') / 0xffffffff
    const h2 = fnv1aString(id + 'z') / 0xffffffff
    positions.set(id, [
      (h - 0.5) * spacing * items.length * 0.5,
      (h2 - 0.5) * spacing * items.length * 0.5 * 0.3,
      (h2 - 0.5) * spacing * items.length * 0.5,
    ])
  })
}

function treeLayout(items, spacing, positions) {
  const place = (node, x, depth) => {
    positions.set(requireItemId(node, 'tree node'), [x * spacing, -depth * spacing * 1.5, 0])
    const children = node.children || []
    const startX = x - (children.length - 1) / 2
    children.forEach((child, i) => place(child, startX + i, depth + 1))
  }
  if (items.length > 0) place(items[0], 0, 0)
}

function spiralLayout(items, spacing, positions) {
  items.forEach((item, i) => {
    const angle = i * 0.5
    const radius = spacing * (1 + i * 0.3)
    positions.set(requireItemId(item, 'spiral item'), [
      Math.cos(angle) * radius,
      0,
      Math.sin(angle) * radius,
    ])
  })
}

const LAYOUT_BUILDERS = Object.freeze({
  grid: gridLayout,
  scatter: scatterLayout,
  tree: treeLayout,
  spiral: spiralLayout,
})

export function computeLayout(items, layout, config = {}) {
  if (!Array.isArray(items)) throw refuse('items must be an array')
  if (!LAYOUTS.includes(layout)) throw refuse(`layout must be one of: ${LAYOUTS.join(', ')}`)
  if (!COMPUTED_LAYOUTS.includes(layout)) throw refuse(`layout "${layout}" has no computed positions yet`)
  const spacing = config.spacing === undefined ? 1 : config.spacing
  if (typeof spacing !== 'number' || !Number.isFinite(spacing) || spacing <= 0) throw refuse('config.spacing must be a positive finite number')

  const positions = new Map()
  LAYOUT_BUILDERS[layout](items, spacing, positions)
  return positions
}
