import { refusal } from './math.js'

const MESHOPT = 'meshopt'
const VERTEX_HEADER = 0xa0
const INDEX_HEADER = 0xe1
const SEQUENCE_HEADER = 0xd1
const BLOCK_BYTES = 0x2000
const BLOCK_MAX_ELEMENTS = 256
const GROUP = 16
const INDEX_TAIL = 16
const SEQUENCE_TAIL = 4
const MAX_STRIDE = 256
const HEADER_MODES = [[0, 2, 4, 8], [0, 1, 2, 4], [1, 2, 4, 8]]

export const MESHOPT_MODES = Object.freeze(['ATTRIBUTES', 'TRIANGLES', 'INDICES'])
export const MESHOPT_FILTERS = Object.freeze(['NONE', 'OCTAHEDRAL', 'QUATERNION', 'EXPONENTIAL', 'COLOR'])

const deltas = new Uint8Array(BLOCK_BYTES)
const last = new Uint8Array(MAX_STRIDE)
const edgeFifo = new Uint32Array(32)
const vertexFifo = new Uint32Array(16)
const expBits = new Uint32Array(1)
const expFloat = new Float32Array(expBits.buffer)

const dezig = (v) => (v >>> 1) ^ -(v & 1)

const truncated = (what) => refusal(MESHOPT, 'meshopt-source-truncated', `${what} runs past the end of the encoded data`)

function checkTarget(target, count, stride) {
  if (!Number.isInteger(count) || count < 0) throw refusal(MESHOPT, 'meshopt-count-invalid', `count ${count} must be a non-negative integer`)
  if (!(target instanceof Uint8Array) || target.length < count * stride) throw refusal(MESHOPT, 'meshopt-target-small', `target must be a Uint8Array of at least ${count * stride} bytes`)
}

export function decodeVertexBuffer(target, count, stride, source) {
  if (!Number.isInteger(stride) || stride <= 0 || stride > MAX_STRIDE || stride % 4 !== 0) throw refusal(MESHOPT, 'meshopt-stride-invalid', `vertex stride ${stride} must be a multiple of 4 from 4 to 256`)
  checkTarget(target, count, stride)
  if (source.length < 1 || (source[0] & 0xf0) !== VERTEX_HEADER) throw refusal(MESHOPT, 'meshopt-header-invalid', 'vertex data does not start with 0xa0 or 0xa1')
  const version = source[0] & 0x0f
  if (version > 1) throw refusal(MESHOPT, 'meshopt-version-unsupported', `vertex codec version ${version} is not 0 or 1`)
  const tailSize = version === 0 ? stride : stride + stride / 4
  const tailPadded = Math.max(tailSize, version === 0 ? 32 : 24)
  const end = source.length - tailPadded
  if (end < 1) throw truncated('vertex tail')
  const tailAt = source.length - tailSize
  for (let i = 0; i < stride; i++) last[i] = source[tailAt + i]
  const channelsAt = tailAt + stride
  const blockElements = Math.min((BLOCK_BYTES / stride) & ~0x0f, BLOCK_MAX_ELEMENTS)
  let at = 1
  for (let base = 0; base < count; base += blockElements) {
    const n = Math.min(count - base, blockElements)
    const groupCount = (n + 15) >>> 4
    const headerBytes = (groupCount + 3) >>> 2
    const controlAt = at
    if (version === 1) {
      at += stride / 4
      if (at > end) throw truncated('control bits')
    }
    deltas.fill(0, 0, stride * n)
    for (let byte = 0; byte < stride; byte++) {
      const deltaBase = byte * n
      const control = version === 0 ? 0 : (source[controlAt + (byte >>> 2)] >>> ((byte & 3) << 1)) & 3
      if (control === 2) continue
      if (control === 3) {
        if (at + n > end) throw truncated('raw byte column')
        deltas.set(source.subarray(at, at + n), deltaBase)
        at += n
        continue
      }
      const headerAt = at
      at += headerBytes
      if (at > end) throw truncated('group header')
      const modes = HEADER_MODES[version === 0 ? 0 : control + 1]
      for (let group = 0; group < groupCount; group++) {
        const bits = modes[(source[headerAt + (group >>> 2)] >>> ((group & 3) << 1)) & 3]
        const out = deltaBase + (group << 4)
        const members = Math.min(GROUP, n - (group << 4))
        if (bits === 0) continue
        if (bits === 8) {
          if (at + GROUP > end) throw truncated('verbatim group')
          for (let m = 0; m < members; m++) deltas[out + m] = source[at + m]
          at += GROUP
          continue
        }
        const packedAt = at
        at += bits * 2
        if (at > end) throw truncated('packed group')
        const sentinel = (1 << bits) - 1
        for (let m = 0; m < GROUP; m++) {
          let delta
          if (bits === 1) delta = (source[packedAt + (m >>> 3)] >>> (m & 7)) & 1
          else if (bits === 2) delta = (source[packedAt + (m >>> 2)] >>> (6 - ((m & 3) << 1))) & 3
          else delta = (source[packedAt + (m >>> 1)] >>> (4 - ((m & 1) << 2))) & 15
          if (delta === sentinel) {
            if (at >= end) throw truncated('group overflow byte')
            delta = source[at++]
          }
          if (m < members) deltas[out + m] = delta
        }
      }
    }
    for (let elem = 0; elem < n; elem++) {
      const dst = (base + elem) * stride
      for (let g = 0; g < stride; g += 4) {
        const channel = version === 0 ? 0 : source[channelsAt + (g >>> 2)]
        const mode = channel & 3
        if (mode === 0) {
          for (let byte = g; byte < g + 4; byte++) {
            const value = (last[byte] + dezig(deltas[byte * n + elem])) & 0xff
            last[byte] = value
            target[dst + byte] = value
          }
        } else if (mode === 1) {
          for (let byte = g; byte < g + 4; byte += 2) {
            const delta = dezig(deltas[byte * n + elem] | (deltas[(byte + 1) * n + elem] << 8))
            const value = ((last[byte] | (last[byte + 1] << 8)) + delta) & 0xffff
            last[byte] = value & 0xff
            last[byte + 1] = value >>> 8
            target[dst + byte] = value & 0xff
            target[dst + byte + 1] = value >>> 8
          }
        } else if (mode === 2) {
          const delta = (deltas[g * n + elem] | (deltas[(g + 1) * n + elem] << 8) | (deltas[(g + 2) * n + elem] << 16) | (deltas[(g + 3) * n + elem] << 24)) >>> 0
          const rot = channel >>> 4
          const prev = (last[g] | (last[g + 1] << 8) | (last[g + 2] << 16) | (last[g + 3] << 24)) >>> 0
          const value = (prev ^ ((delta >>> rot) | (delta << (32 - rot)))) >>> 0
          for (let k = 0; k < 4; k++) {
            const b = (value >>> (k * 8)) & 0xff
            last[g + k] = b
            target[dst + g + k] = b
          }
        } else {
          throw refusal(MESHOPT, 'meshopt-channel-invalid', 'vertex channel mode 3 is not defined')
        }
      }
    }
  }
  if (at !== end) throw refusal(MESHOPT, 'meshopt-source-trailing', `vertex data has ${end - at} bytes left over`)
  return target
}

function indexWriter(target, count, stride) {
  if (stride !== 2 && stride !== 4) throw refusal(MESHOPT, 'meshopt-index-stride-invalid', `index stride ${stride} must be 2 or 4`)
  checkTarget(target, count, stride)
  return new DataView(target.buffer, target.byteOffset, target.byteLength)
}

export function decodeIndexBuffer(target, count, stride, source) {
  const view = indexWriter(target, count, stride)
  if (count % 3 !== 0) throw refusal(MESHOPT, 'meshopt-count-invalid', `triangle index count ${count} is not a multiple of 3`)
  if (source.length < 1 || source[0] !== INDEX_HEADER) throw refusal(MESHOPT, 'meshopt-header-invalid', 'triangle data does not start with 0xe1')
  const triangles = count / 3
  const end = source.length - INDEX_TAIL
  if (1 + triangles > end) throw truncated('triangle codes')
  let code = 1
  let data = 1 + triangles
  let next = 0
  let lastIndex = 0
  let edgeAt = 0
  let vertexAt = 0
  let out = 0
  edgeFifo.fill(0)
  vertexFifo.fill(0)
  const leb = () => {
    let n = 0
    for (let shift = 0; shift < 35; shift += 7) {
      if (data >= end) throw truncated('index varint')
      const b = source[data++]
      n |= (b & 0x7f) << shift
      if (b < 0x80) return n >>> 0
    }
    throw refusal(MESHOPT, 'meshopt-varint-invalid', 'index varint is longer than 5 bytes')
  }
  const pushVertex = (v) => { vertexFifo[vertexAt] = v; vertexAt = (vertexAt + 1) & 15 }
  const pushEdge = (a, b) => { edgeFifo[edgeAt] = a; edgeFifo[edgeAt + 1] = b; edgeAt = (edgeAt + 2) & 31 }
  const readVertex = (n) => vertexFifo[(vertexAt - 1 - n) & 15]
  const decodeIndex = () => { lastIndex = (lastIndex + dezig(leb())) >>> 0; return lastIndex }
  const write = (v) => {
    if (stride === 2) view.setUint16(out, v & 0xffff, true)
    else view.setUint32(out, v, true)
    out += stride
  }
  for (let i = 0; i < triangles; i++) {
    const c = source[code++]
    const hi = c >>> 4
    const lo = c & 15
    let a
    let b
    let cc
    if (hi < 15) {
      a = edgeFifo[(edgeAt - 2 - (hi << 1)) & 31]
      b = edgeFifo[(edgeAt - 1 - (hi << 1)) & 31]
      if (lo === 0) { cc = next++; pushVertex(cc) }
      else if (lo < 13) cc = readVertex(lo)
      else if (lo === 13) { lastIndex = (lastIndex - 1) >>> 0; cc = lastIndex; pushVertex(cc) }
      else if (lo === 14) { lastIndex = (lastIndex + 1) >>> 0; cc = lastIndex; pushVertex(cc) }
      else { cc = decodeIndex(); pushVertex(cc) }
      pushEdge(cc, b)
      pushEdge(a, cc)
    } else {
      if (lo < 14) {
        const e = source[end + lo]
        const z = e >>> 4
        const w = e & 15
        a = next++
        b = z === 0 ? next++ : readVertex(z - 1)
        cc = w === 0 ? next++ : readVertex(w - 1)
        pushVertex(a)
        if (z === 0) pushVertex(b)
        if (w === 0) pushVertex(cc)
      } else {
        if (data >= end) throw truncated('triangle aux byte')
        const e = source[data++]
        if (e === 0) next = 0
        const z = e >>> 4
        const w = e & 15
        a = lo === 14 ? next++ : decodeIndex()
        b = z === 0 ? next++ : z === 15 ? decodeIndex() : readVertex(z - 1)
        cc = w === 0 ? next++ : w === 15 ? decodeIndex() : readVertex(w - 1)
        pushVertex(a)
        if (z === 0 || z === 15) pushVertex(b)
        if (w === 0 || w === 15) pushVertex(cc)
      }
      pushEdge(b, a)
      pushEdge(cc, b)
      pushEdge(a, cc)
    }
    write(a)
    write(b)
    write(cc)
  }
  if (data !== end) throw refusal(MESHOPT, 'meshopt-source-trailing', `triangle data has ${end - data} bytes left over`)
  return target
}

export function decodeIndexSequence(target, count, stride, source) {
  const view = indexWriter(target, count, stride)
  if (source.length < 1 || source[0] !== SEQUENCE_HEADER) throw refusal(MESHOPT, 'meshopt-header-invalid', 'index sequence does not start with 0xd1')
  const end = source.length - SEQUENCE_TAIL
  if (end < 1) throw truncated('index sequence tail')
  let data = 1
  let lastA = 0
  let lastB = 0
  for (let i = 0; i < count; i++) {
    let v = 0
    let done = false
    for (let shift = 0; shift < 35; shift += 7) {
      if (data >= end) throw truncated('index sequence varint')
      const b = source[data++]
      v |= (b & 0x7f) << shift
      if (b < 0x80) { done = true; break }
    }
    if (!done) throw refusal(MESHOPT, 'meshopt-varint-invalid', 'index varint is longer than 5 bytes')
    v >>>= 0
    const delta = dezig(v >>> 1)
    let value
    if (v & 1) { lastB = (lastB + delta) >>> 0; value = lastB } else { lastA = (lastA + delta) >>> 0; value = lastA }
    if (stride === 2) view.setUint16(i * 2, value & 0xffff, true)
    else view.setUint32(i * 4, value, true)
  }
  if (data !== end) throw refusal(MESHOPT, 'meshopt-source-trailing', `index sequence has ${end - data} bytes left over`)
  return target
}

const f = Math.fround
const HALF = f(0.5)
const roundSigned = (v, sign) => Math.trunc(f(v + (sign >= 0 ? HALF : -HALF)))

function filterOctahedral(target, count, stride) {
  if (stride !== 4 && stride !== 8) throw refusal(MESHOPT, 'meshopt-filter-stride-invalid', `octahedral filter stride ${stride} must be 4 or 8`)
  const view = new DataView(target.buffer, target.byteOffset, target.byteLength)
  const wide = stride === 8
  const max = wide ? 32767 : 127
  for (let i = 0; i < count; i++) {
    const at = i * stride
    let x = wide ? view.getInt16(at, true) : view.getInt8(at)
    let y = wide ? view.getInt16(at + 2, true) : view.getInt8(at + 1)
    const one = wide ? view.getInt16(at + 4, true) : view.getInt8(at + 2)
    const z = f(f(one - Math.abs(x)) - Math.abs(y))
    const t = z >= 0 ? 0 : z
    x = f(x + (x >= 0 ? t : -t))
    y = f(y + (y >= 0 ? t : -t))
    const length = f(Math.sqrt(f(f(f(x * x) + f(y * y)) + f(z * z))))
    const s = f(max / length)
    const xf = roundSigned(f(x * s), x)
    const yf = roundSigned(f(y * s), y)
    const zf = roundSigned(f(z * s), z)
    if (wide) {
      view.setInt16(at, xf, true)
      view.setInt16(at + 2, yf, true)
      view.setInt16(at + 4, zf, true)
    } else {
      view.setInt8(at, xf)
      view.setInt8(at + 1, yf)
      view.setInt8(at + 2, zf)
    }
  }
}

const QUAT_SCALE = f(1 / f(Math.sqrt(2)))
const QUAT_MAX = f(32767)

function filterQuaternion(target, count, stride) {
  if (stride !== 8) throw refusal(MESHOPT, 'meshopt-filter-stride-invalid', `quaternion filter stride ${stride} must be 8`)
  const view = new DataView(target.buffer, target.byteOffset, target.byteLength)
  for (let i = 0; i < count; i++) {
    const at = i * 8
    const inputW = view.getInt16(at + 6, true)
    const maxComponent = inputW & 3
    const s = f(QUAT_SCALE / f(inputW | 3))
    const x = f(view.getInt16(at, true) * s)
    const y = f(view.getInt16(at + 2, true) * s)
    const z = f(view.getInt16(at + 4, true) * s)
    const ww = f(f(f(1 - f(x * x)) - f(y * y)) - f(z * z))
    const w = f(Math.sqrt(ww >= 0 ? ww : 0))
    view.setInt16(at + ((maxComponent + 1) & 3) * 2, roundSigned(f(x * QUAT_MAX), x), true)
    view.setInt16(at + ((maxComponent + 2) & 3) * 2, roundSigned(f(y * QUAT_MAX), y), true)
    view.setInt16(at + ((maxComponent + 3) & 3) * 2, roundSigned(f(z * QUAT_MAX), z), true)
    view.setInt16(at + maxComponent * 2, roundSigned(f(w * QUAT_MAX), 1), true)
  }
}

function filterExponential(target, count, stride) {
  if (stride % 4 !== 0) throw refusal(MESHOPT, 'meshopt-filter-stride-invalid', `exponential filter stride ${stride} must be a multiple of 4`)
  const view = new DataView(target.buffer, target.byteOffset, target.byteLength)
  const words = count * (stride / 4)
  for (let i = 0; i < words; i++) {
    const v = view.getInt32(i * 4, true)
    expBits[0] = ((v >> 24) + 127) << 23
    view.setFloat32(i * 4, expFloat[0] * ((v << 8) >> 8), true)
  }
}

function filterColor(target, count, stride) {
  if (stride !== 4 && stride !== 8) throw refusal(MESHOPT, 'meshopt-filter-stride-invalid', `color filter stride ${stride} must be 4 or 8`)
  const view = new DataView(target.buffer, target.byteOffset, target.byteLength)
  const wide = stride === 8
  const max = (1 << (stride * 2)) - 1
  for (let i = 0; i < count; i++) {
    const at = i * stride
    const y = wide ? view.getUint16(at, true) : view.getUint8(at)
    const co = wide ? view.getInt16(at + 2, true) : view.getInt8(at + 1)
    const cg = wide ? view.getInt16(at + 4, true) : view.getInt8(at + 2)
    const alpha = wide ? view.getUint16(at + 6, true) : view.getUint8(at + 3)
    const as = alpha === 0 ? 0 : (2 ** (32 - Math.clz32(alpha))) - 1
    const a = ((alpha << 1) & as) | (alpha & 1)
    const ss = f(max / f(as))
    const r = roundSigned(f(f(y + co - cg) * ss), 1)
    const g = roundSigned(f(f(y + cg) * ss), 1)
    const b = roundSigned(f(f(y - co - cg) * ss), 1)
    const aa = roundSigned(f(f(a) * ss), 1)
    if (wide) {
      view.setUint16(at, r, true)
      view.setUint16(at + 2, g, true)
      view.setUint16(at + 4, b, true)
      view.setUint16(at + 6, aa, true)
    } else {
      view.setUint8(at, r)
      view.setUint8(at + 1, g)
      view.setUint8(at + 2, b)
      view.setUint8(at + 3, aa)
    }
  }
}

const FILTERS = { OCTAHEDRAL: filterOctahedral, QUATERNION: filterQuaternion, EXPONENTIAL: filterExponential, COLOR: filterColor }

export function applyMeshoptFilter(target, count, stride, filter) {
  if (filter === undefined || filter === 'NONE') return target
  const run = FILTERS[filter]
  if (!run) throw refusal(MESHOPT, 'meshopt-filter-unknown', `filter ${filter} is not one of ${MESHOPT_FILTERS.join(', ')}`)
  run(target, count, stride)
  return target
}

export function decodeGltfBuffer(target, count, stride, source, mode, filter) {
  if (mode === 'ATTRIBUTES') {
    decodeVertexBuffer(target, count, stride, source)
    return applyMeshoptFilter(target, count, stride, filter)
  }
  if (filter !== undefined && filter !== 'NONE') throw refusal(MESHOPT, 'meshopt-filter-mode-invalid', `filter ${filter} applies to ATTRIBUTES only`)
  if (mode === 'TRIANGLES') return decodeIndexBuffer(target, count, stride, source)
  if (mode === 'INDICES') return decodeIndexSequence(target, count, stride, source)
  throw refusal(MESHOPT, 'meshopt-mode-unknown', `mode ${mode} is not one of ${MESHOPT_MODES.join(', ')}`)
}
