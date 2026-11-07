const TIME_PERIOD_SECONDS = 3600
const UV_SETS = 4
const SPECTRUM_LOW_HZ = 20
const SPECTRUM_HIGH_HZ = 20000
const DEFAULT_WORKGROUP_SIZE = 64
const INSTANCED_TYPES = Object.freeze({ float: Float32Array, int: Int32Array, uint: Uint32Array })

const NAMED_ONLY = Object.freeze([
  'positionLocal', 'positionMorphed', 'positionWorld', 'positionView', 'normalLocal', 'normalWorld', 'cameraPosition',
  'screenUV', 'screenSize', 'time', 'vertexColor', 'attribute', 'instanceIndex', 'vertexIndex', 'frontFacing',
  'sceneDepth', 'depthFade', 'viewportSharedTexture', 'materialColor', 'materialOpacity', 'materialEmissive',
  'billboarding', 'mx_noise_float', 'mx_fractal_noise_float', 'mx_worley_noise_float', 'mx_noise_vec3', 'hash', 'rand',
  'oscSine', 'oscTriangle', 'oscSquare', 'oscSawtooth', 'select', 'textureSize', 'textureLoad', 'textureLevel',
  'texture3D', 'convertToTexture', 'wgslFn', 'textureStore', 'workgroupArray', 'workgroupBarrier',
  'invocationLocalIndex', 'workgroupId', 'localId', 'deltaTime', 'objectWorldMatrix', 'objectPosition',
  'objectScale', 'objectDirection', 'mix', 'smoothstep', 'step', 'clamp', 'remap', 'remapClamp', 'oneMinus', 'saturate',
])

const refuse = (what) => {
  throw new RangeError(what + ' has no documented headless behaviour in savi; refused as a scoped negative')
}

const finiteNumber = (value, label) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(label + ' is a finite number')
  return value
}

const unitInterval = (value, label) => {
  finiteNumber(value, label)
  if (value < 0 || value > 1) throw new RangeError(label + ' is 0 to 1; a value outside it is refused, not clamped')
  return value
}

const wholeNumber = (value, label, min) => {
  if (!Number.isInteger(value) || value < min) throw new RangeError(label + ' is a whole number of at least ' + min)
  return value
}

export const shaderTime = (nowMs) => {
  finiteNumber(nowMs, 'now')
  if (nowMs < 0) throw new RangeError('now is zero or more milliseconds; a negative time would wrap backwards')
  return (nowMs / 1000) % TIME_PERIOD_SECONDS
}

export const uvSet = (index = 0) => {
  if (!Number.isInteger(index) || index < 0 || index >= UV_SETS) throw new RangeError('uv set is 0 to ' + (UV_SETS - 1) + ', the sets uv() to uv(3) name')
  return index
}

export const audioLevelOf = (value) => unitInterval(value, 'audio level')

export const spectrumFrequency = (x) => {
  const position = unitInterval(x, 'spectrum position')
  if (position === 0) return SPECTRUM_LOW_HZ
  if (position === 1) return SPECTRUM_HIGH_HZ
  return refuse('spectrum position ' + position + ' between the 20 Hz and 20 kHz ends; savi states the ends only')
}

export const instancedArray = (countOrData, type = 'float') => {
  if (!Object.hasOwn(INSTANCED_TYPES, type)) throw new RangeError('instancedArray type is float, int or uint')
  const Elements = INSTANCED_TYPES[type]
  if (typeof countOrData === 'number') return new Elements(wholeNumber(countOrData, 'count', 1))
  if (ArrayBuffer.isView(countOrData)) {
    if (!(countOrData instanceof Elements)) throw new TypeError('the data is a ' + Elements.name + ' for type ' + type)
    return countOrData
  }
  throw new TypeError('instancedArray takes a count or a typed array')
}

const elementIndex = (array, index) => {
  wholeNumber(index, 'element index', 0)
  if (index >= array.length) throw new RangeError('element ' + index + ' is past the ' + array.length + ' elements')
  return index
}

const atomicCell = (array, index) => {
  if (!(array instanceof Int32Array) && !(array instanceof Uint32Array)) throw new TypeError('atomics act on an int or uint array')
  return elementIndex(array, index)
}

const atomicOperand = (array, value) => {
  const signed = array instanceof Int32Array
  const low = signed ? -2147483648 : 0
  const high = signed ? 2147483647 : 4294967295
  if (!Number.isInteger(value) || value < low || value > high) throw new RangeError('operand ' + value + ' is outside the element type')
  return value
}

const update = (array, index, value, combine) => {
  const cell = atomicCell(array, index)
  const operand = atomicOperand(array, value)
  const previous = array[cell]
  array[cell] = combine(previous, operand)
  return previous
}

export const atomicAdd = (array, index, value) => update(array, index, value, (a, b) => a + b)
export const atomicSub = (array, index, value) => update(array, index, value, (a, b) => a - b)
export const atomicMax = (array, index, value) => update(array, index, value, (a, b) => Math.max(a, b))
export const atomicMin = (array, index, value) => update(array, index, value, (a, b) => Math.min(a, b))
export const atomicAnd = (array, index, value) => update(array, index, value, (a, b) => a & b)
export const atomicOr = (array, index, value) => update(array, index, value, (a, b) => a | b)
export const atomicXor = (array, index, value) => update(array, index, value, (a, b) => a ^ b)

export const atomicStore = (array, index, value) => {
  const cell = atomicCell(array, index)
  array[cell] = atomicOperand(array, value)
}

export const atomicLoad = (array, index) => array[atomicCell(array, index)]

export const dispatchGroups = (count, workgroupSize = DEFAULT_WORKGROUP_SIZE) => {
  wholeNumber(count, 'compute count', 1)
  wholeNumber(workgroupSize, 'workgroup size', 1)
  return Math.floor((count + workgroupSize - 1) / workgroupSize)
}

export const namedOnly = (name) => {
  if (!NAMED_ONLY.includes(name)) throw new TypeError(name + ' is not a named-only tsl name in this module')
  return refuse('tsl ' + name)
}

export const TSL_NAMED_ONLY = NAMED_ONLY
