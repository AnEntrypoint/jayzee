import { createHash } from 'node:crypto'
import { canon } from './canon.mjs'

const RECORD_KEY = 'EP_cluster_lod'

const rng = (seed) => {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
}

const grid = ({ nx, nz, size, uv = true, Position = Float32Array, positionItemSize = 3, Index = Uint32Array, uvName = 'uv' }) => {
  const rand = rng(nx * 31 + nz)
  const cols = nx + 1
  const count = cols * (nz + 1)
  const position = new Position(count * positionItemSize)
  const uvs = new Float32Array(count * 2)
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const v = j * cols + i
      const x = (i / nx - 0.5) * size
      const z = (j / nz - 0.5) * size
      const y = 0.3 * Math.sin(i * 0.9) * Math.cos(j * 0.7) + 0.05 * rand()
      position[v * positionItemSize] = x
      position[v * positionItemSize + 1] = y
      position[v * positionItemSize + 2] = z
      if (positionItemSize === 4) position[v * 4 + 3] = 1
      uvs[v * 2] = i / nx
      uvs[v * 2 + 1] = j / nz
    }
  }
  const indices = []
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * cols + i
      const b = a + 1
      const c = a + cols
      const d = c + 1
      indices.push(a, c, b, b, c, d)
    }
  }
  const attributes = [{ name: 'position', array: position, itemSize: positionItemSize, normalized: false }]
  if (uv) attributes.push({ name: uvName, array: uvs, itemSize: 2, normalized: false })
  return { attributes, index: Index.from(indices) }
}

const sphere = (rings, segments, radius) => {
  const position = []
  const normal = []
  const uvs = []
  const indices = []
  for (let r = 0; r <= rings; r++) {
    const phi = Math.PI * r / rings
    for (let s = 0; s <= segments; s++) {
      const theta = 2 * Math.PI * s / segments
      const x = Math.sin(phi) * Math.cos(theta)
      const y = Math.cos(phi)
      const z = Math.sin(phi) * Math.sin(theta)
      position.push(x * radius, y * radius, z * radius)
      normal.push(x, y, z)
      uvs.push(s / segments, r / rings)
    }
  }
  const cols = segments + 1
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segments; s++) {
      const a = r * cols + s
      const b = a + 1
      const c = a + cols
      const d = c + 1
      indices.push(a, c, b, b, c, d)
    }
  }
  return {
    attributes: [
      { name: 'position', array: Float32Array.from(position), itemSize: 3, normalized: false },
      { name: 'normal', array: Float32Array.from(normal), itemSize: 3, normalized: false },
      { name: 'uv', array: Float32Array.from(uvs), itemSize: 2, normalized: false },
    ],
    index: Uint32Array.from(indices),
  }
}

const cube = () => {
  const corners = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]
  const faces = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 4, 7, 3], [1, 2, 6, 5], [3, 7, 6, 2], [0, 1, 5, 4]]
  const uvPattern = [0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]
  const position = []
  const uvs = []
  for (const [a, b, c, d] of faces) {
    for (const k of [a, b, c, a, c, d]) position.push(...corners[k])
    uvs.push(...uvPattern)
  }
  return {
    attributes: [
      { name: 'position', array: Float32Array.from(position), itemSize: 3, normalized: false },
      { name: 'uv', array: Float32Array.from(uvs), itemSize: 2, normalized: false },
    ],
    index: null,
  }
}

const singleTriangle = () => ({
  attributes: [{ name: 'position', array: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 0, 1]), itemSize: 3, normalized: false }],
  index: Uint32Array.from([0, 1, 2]),
})

const cases = [
  { label: 'grid 12x12 indexed with uv', geo: () => grid({ nx: 12, nz: 12, size: 4 }), opts: {} },
  { label: 'grid 12x12 without uv', geo: () => grid({ nx: 12, nz: 12, size: 4, uv: false }), opts: {} },
  { label: 'sphere 12x16 with normals and uv', geo: () => sphere(12, 16, 2), opts: {} },
  { label: 'cube, non-indexed, with uv', geo: () => cube(), opts: {} },
  { label: 'grid 10x10 with small clusters and two LODs, uvAware off', geo: () => grid({ nx: 10, nz: 10, size: 3 }), opts: { maxVertices: 32, maxTriangles: 64, lodRatios: [1, 0.5], lodError: 0.02, uvAware: false } },
  { label: 'grid 10x10 with four LODs', geo: () => grid({ nx: 10, nz: 10, size: 3 }), opts: { lodRatios: [1, 0.75, 0.5, 0.25] } },
  { label: 'grid with Float64 positions and uv', geo: () => grid({ nx: 8, nz: 8, size: 2, Position: Float64Array }), opts: {} },
  { label: 'grid with four-component positions', geo: () => grid({ nx: 8, nz: 8, size: 2, positionItemSize: 4 }), opts: {} },
  { label: 'grid with a Uint16 index', geo: () => grid({ nx: 9, nz: 9, size: 2, Index: Uint16Array }), opts: {} },
  { label: 'grid with a texcoord_0 attribute', geo: () => grid({ nx: 8, nz: 6, size: 2, uvName: 'texcoord_0' }), opts: {} },
  { label: 'sphere with a fill weight of 0.2 and minimum 4 triangles', geo: () => sphere(8, 10, 1), opts: { coneOrFillWeight: 0.2, minTriangles: 4 } },
  { label: 'grid 40x40 with default options', geo: () => grid({ nx: 40, nz: 40, size: 6 }), opts: {} },
  { label: 'sphere 24x32 with default options', geo: () => sphere(24, 32, 3), opts: {} },
  { label: 'grid 12x12 with a fill weight of 0', geo: () => grid({ nx: 12, nz: 12, size: 4 }), opts: { coneOrFillWeight: 0 } },
  { label: 'sphere 12x16 with a minimum of 30 triangles', geo: () => sphere(12, 16, 2), opts: { minTriangles: 30 } },
  { label: 'grid 40x40 with a minimum of 110 triangles', geo: () => grid({ nx: 40, nz: 40, size: 6 }), opts: { minTriangles: 110 } },
  { label: 'a single triangle', geo: () => singleTriangle(), opts: {} },
  { label: 'missing position attribute', geo: () => ({ attributes: [{ name: 'uv', array: Float32Array.from([0, 0, 1, 0]), itemSize: 2, normalized: false }], index: null }), opts: {} },
]

export const CASE_LABELS = cases.map(({ label }) => label)

const arrayRecord = (array) => ({
  type: array.constructor.name,
  length: array.length,
  sha256: createHash('sha256').update(Buffer.from(array.buffer, array.byteOffset, array.byteLength)).digest('hex'),
})

export const summarizeBuild = (result) => ({
  vertexCount: result.vertexCount,
  lodCount: result.lodCount,
  attributes: result.attributes.map((a) => ({ name: a.name, itemSize: a.itemSize, normalized: a.normalized, array: arrayRecord(a.array) })),
  index: arrayRecord(result.index),
  indexCoarse: arrayRecord(result.indexCoarse),
  clusters: result.clusters,
})

const thrown = (error) => ({ threw: error.message, name: error.name, code: error.code ?? null })

export const runClusterLodScenario = async (api) => {
  const build = []
  const records = []
  for (const { label, geo, opts } of cases) {
    let result
    try {
      result = await api.buildClusterLod(geo(), opts)
    } catch (error) {
      build.push(canon({ label, ...thrown(error) }))
      continue
    }
    build.push(canon({ label, summary: summarizeBuild(result) }))
    const extras = api.buildClusterLodExtra(result, -1, 'bucket')
    const wrapped = { [RECORD_KEY]: extras }
    const radiusOnly = { [RECORD_KEY]: { ...extras, clusters: extras.clusters.map((c) => ({ ...c, sphere: [c.sphere[3]] })) } }
    records.push(canon({
      label,
      extras,
      lod0: api.lod0OnlyClusterLodExtras(wrapped),
      parsed: api.parseClusterLod(wrapped),
      radiusOnly: api.parseClusterLod(radiusOnly),
    }))
  }
  const malformed = []
  for (const bad of [
    { [RECORD_KEY]: { clusters: 'nope' } },
    { [RECORD_KEY]: { clusters: [{ aabb: [1, 2, 3], sphere: [0, 0, 0, 1], lods: [[0, 3, 0]] }] } },
    { [RECORD_KEY]: { clusters: [{ aabb: [0, 0, 0, 1, 1, 1], sphere: [0, 0, 0, 1], lods: [[-1, 3, 0]] }] } },
  ]) {
    try {
      api.parseClusterLod(bad)
      malformed.push(canon({ accepted: true }))
    } catch (error) {
      malformed.push(canon(thrown(error)))
    }
  }
  return { build, records, malformed }
}

export const buildCase = (label) => {
  const found = cases.find((c) => c.label === label)
  if (!found) throw new Error('no case ' + label)
  return found
}
