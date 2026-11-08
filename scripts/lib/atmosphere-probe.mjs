import { createHash } from 'node:crypto'

export const encodeValue = (value) => {
  if (value === undefined) return 'undefined'
  if (Array.isArray(value)) return Array.from(value, encodeValue)
  if (typeof value === 'number') {
    if (Object.is(value, -0)) return '-0'
    if (!Number.isFinite(value)) return String(value)
    return value
  }
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encodeValue(v)]))
  return value
}

const digest = (floats) => createHash('sha256').update(new Uint8Array(floats.buffer, floats.byteOffset, floats.byteLength)).digest('hex')

const attempt = (fn) => {
  try {
    return { value: encodeValue(fn()) }
  } catch (error) {
    return { threw: error.constructor.name }
  }
}

export const TRANSMITTANCE_POINTS = [
  [6360, 1], [6360, 0], [6360, -0.2], [6360, 0.3], [6380, 0.7], [6430, -0.9],
  [6499, 0.01], [6500, 1], [6500, -0.5], [6600, -1], [6600, 0.5], [6350, 1], [6000, 0.2],
]

export const GLSL_CASES = [
  ['vec3', [1, 2, 3]], ['vec3', [0.5]], ['vec3', [[1, 2, 3]]], ['vec3', [[1, 2], 3]], ['vec3', [[1, 2, 3, 4]]],
  ['vec3', [1, 2]], ['vec2', [[1, 2, 3]]], ['vec4', [7]], ['vec4', [[1, 2], [3, 4, 5]]], ['vec4', [1, 2, 3]],
  ['ivec2', [1.9, -1.9]], ['ivec3', [[2.5, -2.5, 3.99]]], ['uvec2', [-1, 4.7]], ['uvec3', [[-2, 3, 2 ** 32 + 5]]],
  ['add', [0.1, 0.2]], ['add', [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]]], ['add', [[1, 2], 0.1]], ['add', [0.1, [1, 2, 3, 4]]],
  ['sub', [0.3, 0.1]], ['sub', [[1, 2, 3], 0.1]], ['mul', [0.1, 3]], ['mul', [[1, 2, 3], [0.1, 0.2, 0.3]]],
  ['div', [1, 3]], ['div', [[1, 2, 3], 0]], ['div', [1, [3, 7]]], ['neg', [0]], ['neg', [[0, 1.1, -2]]],
  ['floor', [-1.5]], ['floor', [[1.5, -0.5, 2.9]]], ['ceil', [[1.1, -1.1]]], ['abs', [-0.1]], ['abs', [[-0.1, 0.2]]],
  ['fract', [-1.25]], ['fract', [[1.3, -0.7, 2]]], ['fract', [[0.1, 0.2, 0.3, 0.4]]], ['sign', [[-3, 0, -0, 2]]],
  ['sqrt', [2]], ['sin', [1]], ['cos', [[0, 1]]], ['tan', [0.5]], ['exp', [1]], ['tanh', [[0.5, -3]]],
  ['pow', [2, 0.5]], ['pow', [[2, 3], 2]], ['min', [[1, 5], 3]], ['max', [3, [1, 5]]], ['mod', [-1, 3]], ['mod', [[5.5, -5.5], 2]],
  ['clamp', [1.5, 0, 1]], ['clamp', [[-1, 0.5, 2], 0, 1]], ['clamp', [[-1, 0.5, 2], [0, 0.6, 0], [1, 1, 1.5]]], ['clamp', [0.3, [0.4], [1]]], ['clamp', [0.1, 1, 0]],
  ['mix', [0, 1, 0.3]], ['mix', [[0, 10, 20], [1, 11, 21], 0.25]], ['mix', [1, 2, [0.5, 1]]],
  ['smoothstep', [0, 1, 0.25]], ['smoothstep', [0, 1, [-1, 0.5, 2]]], ['smoothstep', [1, 1, 1]], ['smoothstep', [[0, 1], [1, 2], [0.5, 1.5]]],
  ['step', [0.5, [0.2, 0.5, 0.8]]], ['step', [[1, 2], 1.5]],
  ['dot', [[1, 2, 3], [4, 5, 6]]], ['dot', [[0.1, 0.2], [0.3, 0.4]]], ['length', [[3, 4]]], ['length', [-2]],
  ['distance', [[0, 0, 0], [1, 2, 2]]], ['normalize', [[3, 4, 0]]], ['normalize', [[0, 0, 0]]], ['normalize', [-5]], ['normalize', [0]],
  ['cross', [[1, 0, 0], [0, 1, 0]]], ['cross', [[1, 2, 3], [4, 5, 6]]],
  ['sw', [[1, 2, 3, 4], 'x']], ['sw', [[1, 2, 3, 4], 'q']], ['sw', [[1, 2, 3, 4], 'k']], ['sw', [[1, 2, 3, 4], 'zyx']], ['sw', [[1, 2, 3, 4], 'rgba']], ['sw', [[1, 2, 3, 4], 'xk']],
  ['mat3', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]], ['mat3mul', [[1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 0, -1]]],
  ['float', ['2.5']], ['int', [-2.7]], ['u', [-1]], ['umul', [0xffffffff, 3]], ['uadd', [0xffffffff, 2]], ['uxor', [-1, 0xff]],
  ['ushr', [-1, 28]], ['ushl', [0x80000001, 1]], ['ushl', [1, 33]],
]

export const GLSL_EXPORTS = [
  'abs', 'absf', 'add', 'ceil', 'clamp', 'cos', 'cosf', 'cross', 'distance', 'div', 'dot', 'exp', 'expf', 'float', 'floor', 'fract',
  'int', 'ivec2', 'ivec3', 'length', 'mat3', 'mat3mul', 'max', 'maxf', 'min', 'minf', 'mix', 'mod', 'modf', 'mul', 'neg', 'normalize',
  'pow', 'powf', 'sign', 'sin', 'sinf', 'smoothstep', 'sqrt', 'step', 'sub', 'sw', 'tan', 'tanf', 'tanh', 'u', 'uadd', 'umul',
  'ushl', 'ushr', 'uvec2', 'uvec3', 'uxor', 'vec2', 'vec3', 'vec4',
]

export const SMALL_TRANS = [16, 8, 40]
export const SMALL_SCAT = [8, 4, 4, 16]

export const probeAtmosphere = ({ trans, scat, rt }) => {
  const transmittance = TRANSMITTANCE_POINTS.map(([r, mu]) => ({
    r, mu,
    full: encodeValue(trans.transmittanceAt(r, mu)),
    coarse: encodeValue(trans.transmittanceAt(r, mu, 50)),
    u: encodeValue(trans.uFromR(r)),
    v: encodeValue(trans.vFromMu(mu, r)),
  }))
  const smallTrans = trans.bakeTransmittanceLUT(...SMALL_TRANS)
  const defaultTrans = trans.bakeTransmittanceLUT()
  const smallScat = scat.bakeScatteringLUT(...SMALL_SCAT, smallTrans)
  const defaultScat = scat.bakeScatteringLUT(scat.SCAT_LUT_WIDTH, scat.SCAT_LUT_HEIGHT, scat.SCAT_LUT_LAYERS, 64, defaultTrans)
  const inscatter = TRANSMITTANCE_POINTS.flatMap(([r, mu]) => [-0.4, 0.05, 0.8].map((muS) => ({ r, mu, muS, value: encodeValue(scat.inscatterAt(r, mu, muS, smallTrans)) })))
  const layers = [1, 4, 24, 7].map((count) => ({
    count,
    muS: Array.from({ length: count }, (_, i) => encodeValue(scat.muSFromLayer(i, count))),
    back: [-1, -0.999, -0.3, 0, 0.3, 0.999, 1, 2].map((muS) => scat.layerFromMuS(muS, count)),
  }))
  const glsl = GLSL_CASES.map(([name, args]) => ({ name, args: encodeValue(args), result: attempt(() => rt[name](...args)) }))
  return {
    constants: encodeValue({
      ATM_BOTTOM: trans.ATM_BOTTOM, ATM_TOP: trans.ATM_TOP, ATM_RAYLEIGH_H: trans.ATM_RAYLEIGH_H, ATM_MIE_H: trans.ATM_MIE_H,
      ATM_RAYLEIGH: trans.ATM_RAYLEIGH, ATM_MIE_EXT: trans.ATM_MIE_EXT, LUT_WIDTH: trans.LUT_WIDTH, LUT_HEIGHT: trans.LUT_HEIGHT,
      SCAT_LUT_WIDTH: scat.SCAT_LUT_WIDTH, SCAT_LUT_HEIGHT: scat.SCAT_LUT_HEIGHT, SCAT_LUT_LAYERS: scat.SCAT_LUT_LAYERS,
    }),
    transmittance,
    smallTransSha256: digest(smallTrans.data),
    defaultTransSha256: digest(defaultTrans.data),
    defaultTransShape: [defaultTrans.width, defaultTrans.height, defaultTrans.data.length],
    smallTransVerify: encodeValue(trans.verifyLUT(smallTrans)),
    defaultTransVerify: encodeValue(trans.verifyLUT(defaultTrans)),
    smallScatSha256: digest(smallScat.data),
    defaultScatSha256: digest(defaultScat.data),
    defaultScatShape: [defaultScat.width, defaultScat.height, defaultScat.layers, defaultScat.data.length],
    smallScatVerify: encodeValue(scat.verifyScatteringLUT(smallScat)),
    defaultScatVerify: encodeValue(scat.verifyScatteringLUT(defaultScat)),
    inscatter,
    layers,
    glsl,
    glslExports: Object.keys(rt).sort(),
  }
}
