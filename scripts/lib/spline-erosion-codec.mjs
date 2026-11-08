import { Buffer } from 'node:buffer'

export const bytesOf = (view) => Buffer.from(view.buffer, view.byteOffset, view.byteLength).toString('base64')

export const viewOf = (b64, Ctor) => {
  const bytes = Buffer.from(b64, 'base64')
  return new Ctor(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
}

export const fnv1a = (bytes) => {
  let h = 0x811c9dc5
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 0x01000193)
  return h >>> 0
}

export const enc = (value) => {
  if (value === undefined || value === null) return null
  if (typeof value === 'number') return Object.is(value, -0) ? '-0' : Number.isFinite(value) ? value : String(value)
  if (value instanceof Set) return [...value].sort((a, b) => a - b).map(enc)
  if (Array.isArray(value)) return value.map(enc)
  if (typeof value === 'object') {
    const out = {}
    for (const key of Object.keys(value)) out[key] = enc(value[key])
    return out
  }
  return value
}

export const canon = (value) => JSON.stringify(enc(value))

export const runSample = (mod, input) => mod.sampleSpline(input.controlPoints, input.stepSize, input.closed)

export const runCarve = (mod, input) => {
  const heights = viewOf(input.heightsB64, Float32Array)
  const result = mod.carveSpline(
    heights,
    input.width,
    input.spacing,
    input.cornerX,
    input.cornerZ,
    input.controlPoints,
    input.carveWidth,
    input.carveDepth,
    input.opts ?? {}
  )
  return {
    heights: bytesOf(result.heights),
    carvedCells: result.carvedCells,
    flag: result.flag,
  }
}

export const runErode = (mod, input) => {
  const heights = viewOf(input.heightsB64, Float32Array)
  return { heights: bytesOf(mod.hydraulicErode(heights, input.width, input.spacing, input.opts ?? {})) }
}

export const runStamps = (mod, kind, placements) => (kind === 'rock' ? mod.rockContactStamps(placements) : mod.treeContactStamps(placements))

const snapshot = (field) => ({
  size: field.size,
  windowM: field.windowM,
  texelM: field.texelM,
  originX: field.originX,
  originZ: field.originZ,
  centreX: field.centreX,
  centreZ: field.centreZ,
  dirty: field.dirty,
  chunks: [...field.chunks].map(([key, chunk]) => ({ key, stamps: chunk.stamps.length, bounds: chunk.bounds })),
  digest: fnv1a(field.data),
  data: field.size <= 64 ? bytesOf(field.data) : null,
})

const applyOp = (mod, field, op) => {
  if (op.op === 'load') return mod.contactFieldLoadChunk(field, op.key, op.stamps)
  if (op.op === 'unload') return mod.contactFieldUnloadChunk(field, op.key)
  if (op.op === 'recentre') return mod.contactFieldRecentre(field, op.x, op.z)
  throw new Error('unknown op ' + op.op)
}

export const replayField = (mod, spec) => {
  const field = mod.createContactField(spec.options ?? {})
  return spec.ops.map((op) => {
    const result = applyOp(mod, field, op)
    return { op: op.op, key: op.key ?? null, result, state: snapshot(field) }
  })
}

export const firstDiff = (a, b) => {
  let i = 0
  while (i < a.length && a[i] === b[i]) i++
  return 'first difference at character ' + i + ': ' + a.slice(i, i + 80) + ' vs ' + b.slice(i, i + 80)
}
