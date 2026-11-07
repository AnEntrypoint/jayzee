const names = (list) => Object.freeze([...list])

const MATERIALS = names(['MeshStandardNodeMaterial', 'MeshPhysicalNodeMaterial', 'MeshSSSNodeMaterial', 'MeshBasicNodeMaterial', 'MeshPhongNodeMaterial', 'MeshLambertNodeMaterial', 'MeshToonNodeMaterial', 'MeshMatcapNodeMaterial', 'LineBasicNodeMaterial', 'Line2NodeMaterial', 'SpriteNodeMaterial', 'PointsNodeMaterial'])
const LINE_MATERIALS = names(['LineBasicNodeMaterial', 'Line2NodeMaterial'])
const SIDES = names(['FrontSide', 'BackSide', 'DoubleSide'])
const BLENDINGS = names(['NoBlending', 'NormalBlending', 'AdditiveBlending', 'SubtractiveBlending', 'MultiplyBlending', 'CustomBlending'])
const EQUATIONS = names(['AddEquation', 'SubtractEquation', 'ReverseSubtractEquation', 'MinEquation', 'MaxEquation'])
const FACTORS = names(['ZeroFactor', 'OneFactor', 'SrcColorFactor', 'OneMinusSrcColorFactor', 'SrcAlphaFactor', 'OneMinusSrcAlphaFactor', 'DstColorFactor', 'OneMinusDstColorFactor', 'DstAlphaFactor', 'OneMinusDstAlphaFactor', 'SrcAlphaSaturateFactor'])
const MAPPINGS = names(['Plane'])
const WRAPPINGS = names(['RepeatWrapping', 'ClampToEdgeWrapping', 'MirroredRepeatWrapping'])
const FILTERS = names(['NearestFilter', 'LinearFilter', 'NearestMipmapNearestFilter', 'NearestMipmapLinearFilter', 'LinearMipmapNearestFilter', 'LinearMipmapLinearFilter'])
const COLOR_SPACES = names(['NoColorSpace', 'SRGBColorSpace'])
const FORMATS = names(['RGBAFormat', 'RGFormat', 'RedFormat', 'RGBAIntegerFormat', 'RGIntegerFormat', 'RedIntegerFormat'])
const TYPES = names(['UnsignedByteType', 'HalfFloatType', 'FloatType', 'UnsignedIntType'])
const VALUE_TYPES = names(['Color', 'Vector2', 'Vector3', 'Vector4'])
const CHANNELS = Object.freeze({ RGBAFormat: 4, RGFormat: 2, RedFormat: 1, RGBAIntegerFormat: 4, RGIntegerFormat: 2, RedIntegerFormat: 1 })
const ARRAY_OF_TYPE = Object.freeze({ UnsignedByteType: Uint8Array, HalfFloatType: Uint16Array, FloatType: Float32Array, UnsignedIntType: Uint32Array })
const NODE_PROPERTIES = names(['vertexNode', 'positionNode', 'sizeNode', 'colorNode', 'opacityNode', 'depthNode', 'attributeNode', 'dataNode'])
const CONTEXT_ROOTS = names(['params', 'param', 'constants', 'texture', 'field', 'terrain', 'tile', 'sprite', 'view', 'portal', 'fx', 'device', 'quality'])
const PLAN_KEYS = names(['type', 'opacity', 'transparent', 'blending', 'side', 'size', 'sizeAttenuation', 'linewidth', 'shape'])
const DECLARATION_KEYS = names(['kind', 'script', 'params'])
const DATA_KEYS = names(['data', 'width', 'height', 'format', 'type'])

export const THREE_NAMES = Object.freeze({
  materials: MATERIALS,
  sides: SIDES,
  blendings: BLENDINGS,
  equations: EQUATIONS,
  factors: FACTORS,
  mappings: MAPPINGS,
  wrappings: WRAPPINGS,
  filters: FILTERS,
  colorSpaces: COLOR_SPACES,
  formats: FORMATS,
  types: TYPES,
  values: VALUE_TYPES,
})

const refuse = (what) => {
  throw new RangeError(what + ' has no documented headless behaviour in upstream; refused as a scoped negative')
}

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

const inList = (list, value, label) => {
  if (!list.includes(value)) throw new RangeError(label + ' ' + String(value) + ' is not an upstream name')
  return value
}

const onlyKeys = (value, allowed, label) => {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) refuse(label + ' option ' + key)
  }
}

const positiveNumber = (value, label) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new RangeError(label + ' is a positive finite number')
  return value
}

const positiveInteger = (value, label) => {
  if (!Number.isInteger(value) || value < 1) throw new RangeError(label + ' is a whole number of at least 1')
  return value
}

const unitInterval = (value, label) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) throw new RangeError(label + ' is required, a number from 0 to 1')
  return value
}

const flag = (value, label) => {
  if (typeof value !== 'boolean') throw new TypeError(label + ' is true or false')
  return value
}

export const materialDeclaration = (decl) => {
  if (!isPlainObject(decl)) throw new TypeError('material is an object')
  onlyKeys(decl, DECLARATION_KEYS, 'material')
  if (decl.kind !== 'scripted') throw new RangeError('material kind is scripted, the only kind upstream documents')
  if (typeof decl.script !== 'string' || decl.script.length === 0) throw new TypeError('material script is a non-empty string')
  if (!isPlainObject(decl.params)) throw new TypeError('material params is an object')
  return Object.freeze({ kind: 'scripted', script: decl.script, params: Object.freeze({ ...decl.params }) })
}

const shapeSource = (shape) => {
  if (typeof shape !== 'string' || shape.length === 0) throw new TypeError('points shape is the row shape name')
  return shape === 'points' ? 'instance' : 'vertex'
}

export const planMaterial = (spec) => {
  if (!isPlainObject(spec)) throw new TypeError('a material plan is an object')
  onlyKeys(spec, PLAN_KEYS, 'material')
  const type = inList(MATERIALS, spec.type, 'material type')
  const opacity = unitInterval(spec.opacity, 'opacity')
  const transparent = spec.transparent === undefined ? false : flag(spec.transparent, 'transparent')
  if (opacity < 1 && !transparent) throw new RangeError('opacity below 1 needs transparent: true; without it three draws the material opaque')
  const blending = spec.blending === undefined ? null : inList(BLENDINGS, spec.blending, 'blending')
  const side = spec.side === undefined ? null : inList(SIDES, spec.side, 'side')
  const isPoints = type === 'PointsNodeMaterial'
  const isLine = LINE_MATERIALS.includes(type)
  if (!isPoints) {
    for (const key of ['size', 'sizeAttenuation', 'shape']) {
      if (spec[key] !== undefined) refuse(key + ' on ' + type)
    }
  }
  if (!isLine && spec.linewidth !== undefined) refuse('linewidth on ' + type)
  const points = isPoints
    ? Object.freeze({
      size: positiveNumber(spec.size, 'size'),
      sizeAttenuation: spec.sizeAttenuation === undefined ? true : flag(spec.sizeAttenuation, 'sizeAttenuation'),
      source: shapeSource(spec.shape),
    })
    : null
  const line = isLine ? Object.freeze({ linewidth: positiveNumber(spec.linewidth, 'linewidth') }) : null
  return Object.freeze({ type, opacity, transparent, blending, side, points, line })
}

export const dataTextureSpec = (spec) => {
  if (!isPlainObject(spec)) throw new TypeError('a data texture is an object')
  onlyKeys(spec, DATA_KEYS, 'data texture')
  const width = positiveInteger(spec.width, 'width')
  const height = positiveInteger(spec.height, 'height')
  const format = inList(FORMATS, spec.format === undefined ? 'RGBAFormat' : spec.format, 'format')
  const type = inList(TYPES, spec.type === undefined ? 'UnsignedByteType' : spec.type, 'type')
  const Values = ARRAY_OF_TYPE[type]
  if (!(spec.data instanceof Values)) throw new TypeError('data is a ' + Values.name + ' for ' + type)
  const values = width * height * CHANNELS[format]
  if (spec.data.length !== values) throw new RangeError('data holds ' + spec.data.length + ' values, but ' + width + ' by ' + height + ' ' + format + ' needs ' + values)
  return Object.freeze({ width, height, format, type, values })
}

export const storageTextureSpec = (width, height) => Object.freeze({
  width: positiveInteger(width, 'width'),
  height: positiveInteger(height, 'height'),
})

export const storage3DTextureSpec = (width, height, depth) => Object.freeze({
  width: positiveInteger(width, 'width'),
  height: positiveInteger(height, 'height'),
  depth: positiveInteger(depth, 'depth'),
})

export const nodeProperty = (name) => {
  inList(NODE_PROPERTIES, name, 'node property')
  return refuse('node property ' + name)
}

export const contextRoot = (name) => {
  inList(CONTEXT_ROOTS, name, 'context root')
  return refuse('context root ctx.' + name)
}
