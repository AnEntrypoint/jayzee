import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { GRID_RESOLUTIONS_FINEST_FIRST, gridDecimate, applyGridDecimate } from '../src/packages/streaming-gltf/grid-decimate.js'
import { mergeClusterMeshesByMaterial, normalMatrixOf, transformAabb, transformSphere } from '../src/packages/streaming-gltf/cluster-material-merge.js'
import { STATIC_IMPORT_SPECIFIER, importWithBareRemap } from '../src/packages/streaming-gltf/worker-module-remap.js'

const attribute = (values, itemSize, ArrayType = Float32Array) => {
  const array = ArrayType.from(values)
  const read = (k) => (i) => array[i * itemSize + k]
  return { array, itemSize, count: array.length / itemSize, getX: read(0), getY: read(1), getZ: read(2), getW: read(3) }
}
const list = (typed) => [typed.constructor.name, ...typed]

gate('grid: the resolution ladder is spoint\'s, finest first', () => {
  assert.deepEqual([...GRID_RESOLUTIONS_FINEST_FIRST], [48, 24, 12, 8, 6, 4, 2])
})

gate('grid: no position, an empty position, or a mesh already at or under the cap returns null', () => {
  assert.equal(gridDecimate({}, null, 0), null)
  assert.equal(gridDecimate({ position: attribute([], 3) }, null, 0), null)
  assert.equal(gridDecimate({ position: attribute([0, 0, 0, 1, 0, 0, 0, 1, 0]) }, null, 1), null)
})

const clusterCase = () => ({
  position: attribute([0, 0, 0, 0.001, 0, 0, 1, 1, 1, 1, 0, 0], 3),
  uv: attribute([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8], 2),
})

gate('grid: two vertices in one 48-cell collapse, the degenerate and duplicate cell triangles drop, and the first vertex of each cell represents it', () => {
  const result = gridDecimate(clusterCase(), new Uint16Array([0, 1, 2, 0, 3, 2, 1, 3, 2]), 1)
  assert.equal(result.resolution, 48)
  assert.deepEqual(list(result.index), ['Uint16Array', 0, 2, 1])
  assert.deepEqual(list(result.attributes.position.array), ['Float32Array', 0, 0, 0, 1, 1, 1, 1, 0, 0])
  assert.deepEqual([...result.attributes.uv.array], [0.1, 0.2, 0.5, 0.6, 0.7, 0.8].map(Math.fround))
  assert.equal(result.attributes.uv.itemSize, 2)
})

gate('grid: negative control, a cap of 2 keeps the source mesh untouched', () => {
  assert.equal(gridDecimate(clusterCase(), new Uint16Array([0, 1, 2, 0, 3, 2, 1, 3, 2]), 3), null)
  const result = gridDecimate(clusterCase(), new Uint16Array([0, 1, 2, 0, 3, 2, 1, 3, 2]), 2)
  assert.deepEqual(list(result.index), ['Uint16Array', 0, 2, 1])
})

gate('grid: cell triangles are rotated to start at the smallest cell, so rotations merge and the reversed winding stays', () => {
  const position = attribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3)
  const result = gridDecimate({ position }, new Uint32Array([2, 0, 1, 1, 2, 0, 0, 2, 1, 0, 1, 2]), 1)
  assert.deepEqual(list(result.index), ['Uint16Array', 0, 1, 2, 0, 2, 1])
})

gate('grid: when no resolution meets the cap, the coarsest (2) is returned over the cap', () => {
  const position = attribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], 3)
  const result = gridDecimate({ position }, new Uint16Array([0, 1, 2, 0, 2, 3]), 1)
  assert.equal(result.resolution, 2)
  assert.deepEqual(list(result.index), ['Uint16Array', 0, 1, 2, 0, 2, 3])
})

gate('grid: a mesh whose triangles all collapse returns null, and a null index means sequential triangles, here collapsed at resolution 2 where 0.5 and 1 share the upper cell', () => {
  const position = attribute([0, 0, 0, 0.001, 0, 0, 1, 1, 1, 0.002, 0, 0, 1, 1, 0.999, 0, 0.001, 0], 3)
  assert.equal(gridDecimate({ position }, null, 1), null)
  const open = attribute([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 1, 0.5, 0.5, 0.5], 3)
  const sequential = gridDecimate({ position: open }, null, 1)
  assert.equal(sequential.resolution, 2)
  assert.deepEqual(list(sequential.index), ['Uint16Array', 0, 1, 2])
})

gate('grid: more than 65535 occupied cells switch the index to Uint32', () => {
  const values = []
  for (let x = 0; x < 48; x++) for (let y = 0; y < 48; y++) for (let z = 0; z < 48; z++) values.push(x / 47, y / 47, z / 47)
  const position = attribute(values, 3)
  const result = gridDecimate({ position }, new Uint32Array([0, 1, 48, 0, 1, 48, 0, 1, 48]), 1)
  assert.equal(result.resolution, 48)
  assert.equal(result.attributes.position.array.length, 48 * 48 * 48 * 3)
  assert.deepEqual(list(result.index), ['Uint32Array', 0, 1, 48])
})

gate('grid: applyGridDecimate sets each attribute non-normalised, then the index, then the sphere and box, and returns the resolution', () => {
  const calls = []
  class FakeAttribute { constructor(array, itemSize, normalized) { this.array = array; this.itemSize = itemSize; this.normalized = normalized } }
  const attributes = clusterCase()
  const geometry = {
    attributes,
    index: { array: new Uint16Array([0, 1, 2, 0, 3, 2, 1, 3, 2]) },
    setAttribute: (name, value) => calls.push(['setAttribute', name, value.itemSize, value.normalized]),
    setIndex: (value) => calls.push(['setIndex', list(value.array), value.itemSize]),
    computeBoundingSphere: () => calls.push(['sphere']),
    computeBoundingBox: () => calls.push(['box']),
  }
  assert.equal(applyGridDecimate(geometry, 1, FakeAttribute), 48)
  assert.deepEqual(calls, [['setAttribute', 'position', 3, false], ['setAttribute', 'uv', 2, false], ['setIndex', ['Uint16Array', 0, 2, 1], 1], ['sphere'], ['box']])
  calls.length = 0
  assert.equal(applyGridDecimate(geometry, 9, FakeAttribute), null)
  assert.deepEqual(calls, [])
})

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const triangleMesh = (material, dx, extra = {}) => ({
  geometry: {
    attributes: {
      position: attribute([dx, 0, 0, dx + 1, 0, 0, dx, 1, 0], 3),
      normal: attribute([0, 0, 1, 0, 0, 1, 1, 1, 0], 3),
      tangent: attribute([1, 1, 0, -1, 1, 0, 0, 1, 0, 1, 0, 1], 4),
      ...(extra.attributes || {}),
    },
    index: 'index' in extra ? extra.index : { array: (extra.IndexArray || Uint16Array).from(extra.indices || [0, 1, 2, 2, 1, 0]) },
  },
  material,
  clusterSet: { clusters: [{ aabb: [0, 0, 0, 1, 1, 0], sphere: [0.5, 0.5, 0, 1], lods: [{ offset: 0, count: 3, stream: 0 }, { offset: 0, count: 3, stream: 1 }] }], materialBucket: 'bucket-a' },
  lod0Count: 3,
  materialBucket: 'mesh-bucket',
})

gate('merge: an empty or missing list is returned as given, or as an empty list', () => {
  const empty = []
  assert.equal(mergeClusterMeshesByMaterial(empty), empty)
  assert.deepEqual(mergeClusterMeshesByMaterial(null), [])
})

gate('merge: two meshes sharing a material merge with lod0 first and the coarse stream after, offsets relative to each stream', () => {
  const stone = { name: 'stone' }
  const wood = { name: 'wood' }
  const meshes = [triangleMesh(stone, 0, { attributes: { uv: attribute([0, 0, 1, 0, 0, 1], 2) } }), triangleMesh(wood, 10), triangleMesh(stone, 5, { indices: [0, 1, 2, 0, 2, 1] })]
  const out = mergeClusterMeshesByMaterial(meshes, null)
  assert.equal(out.length, 2)
  const [merged, single] = out
  assert.equal(merged.material, stone)
  assert.deepEqual(merged._sourceIndices, [0, 2])
  assert.equal(merged._mergedSourceCount, 2)
  assert.equal(merged.lod0Count, 6)
  assert.equal(merged.materialBucket, 'mesh-bucket')
  assert.equal(merged.clusterSet.materialBucket, 'bucket-a')
  assert.deepEqual(list(merged.geometry.index), ['Uint16Array', 0, 1, 2, 3, 4, 5, 2, 1, 0, 3, 5, 4])
  assert.deepEqual(merged.clusterSet.clusters.map((cluster) => cluster.lods), [
    [{ offset: 0, count: 3, stream: 0 }, { offset: 0, count: 3, stream: 1 }],
    [{ offset: 3, count: 3, stream: 0 }, { offset: 3, count: 3, stream: 1 }],
  ])
  assert.equal(merged.clusterSet.clusters[0].aabb, meshes[0].clusterSet.clusters[0].aabb)
  assert.deepEqual(Object.keys(merged.geometry.attributes), ['position', 'normal', 'tangent'])
  assert.deepEqual([...merged.geometry.attributes.position.array], [0, 0, 0, 1, 0, 0, 0, 1, 0, 5, 0, 0, 6, 0, 0, 5, 1, 0])
  assert.deepEqual(merged.geometry.boundingBox, { min: [0, 0, 0], max: [6, 1, 0] })
  assert.deepEqual(merged.geometry.boundingSphere, { center: [3, 0.5, 0], radius: Math.sqrt(9.25) })
  assert.equal(merged.degenerateCollapsed, 0)
  assert.equal(single.material, wood)
  assert.deepEqual(single._sourceIndices, [1])
  assert.equal(single.geometry, meshes[1].geometry)
})

gate('merge: negative control, equal-looking but distinct materials are grouped by identity and do not merge', () => {
  const out = mergeClusterMeshesByMaterial([triangleMesh({ name: 'stone' }, 0), triangleMesh({ name: 'stone' }, 5)], null)
  assert.deepEqual(out.map((mesh) => mesh._sourceIndices), [[0], [1]])
  assert.equal(out[0]._mergedSourceCount, undefined)
})

gate('merge: a node matrix bakes positions by the full matrix, normals by the normal matrix, tangents by the upper 3x3 keeping w, and the cluster bounds', () => {
  const stone = {}
  const matrix = { elements: [2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 2, 3, 1] }
  const [merged] = mergeClusterMeshesByMaterial([triangleMesh(stone, 0), triangleMesh(stone, 0)], [matrix, null])
  const attributes = merged.geometry.attributes
  assert.deepEqual([...attributes.position.array.slice(0, 9)], [1, 2, 3, 3, 2, 3, 1, 3, 3])
  const n = 1 / Math.sqrt(1.25)
  assert.deepEqual([...attributes.normal.array.slice(6, 9)], [0.5 * n, 1 * n, 0].map(Math.fround))
  assert.deepEqual([...attributes.normal.array.slice(15, 18)], [1, 1, 0])
  const t = 1 / Math.sqrt(5)
  assert.deepEqual([...attributes.tangent.array.slice(0, 4)], [2 * t, 1 * t, 0, -1].map(Math.fround))
  assert.deepEqual(merged.clusterSet.clusters[0].aabb, [1, 2, 3, 3, 3, 3])
  assert.deepEqual(merged.clusterSet.clusters[0].sphere, [2, 2.5, 3, 2])
  assert.deepEqual(merged.clusterSet.clusters[1].aabb, [0, 0, 0, 1, 1, 0])
})

gate('merge: a plain 16-number matrix bakes the same as one with elements, and a matrix of exact identity is skipped', () => {
  const stone = {}
  const elements = [2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 2, 3, 1]
  const a = mergeClusterMeshesByMaterial([triangleMesh(stone, 0), triangleMesh(stone, 0)], [{ elements }, null])[0]
  const b = mergeClusterMeshesByMaterial([triangleMesh(stone, 0), triangleMesh(stone, 0)], [elements, IDENTITY])[0]
  assert.deepEqual([...a.geometry.attributes.position.array], [...b.geometry.attributes.position.array])
  assert.deepEqual([...a.geometry.attributes.normal.array], [...b.geometry.attributes.normal.array])
})

gate('merge: a singular matrix gives a zero normal matrix, so baked normals are zero, as three\'s Matrix3.invert does', () => {
  assert.deepEqual(normalMatrixOf([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]), [0, 0, 0, 0, 0, 0, 0, 0, 0])
  const stone = {}
  const flat = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]
  const [merged] = mergeClusterMeshesByMaterial([triangleMesh(stone, 0), triangleMesh(stone, 0)], [flat, null])
  assert.deepEqual([...merged.geometry.attributes.normal.array.slice(0, 9)], [0, 0, 0, 0, 0, 0, 0, 0, 0])
  assert.deepEqual(normalMatrixOf([0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]).map((value) => value + 0), [0, 1, 0, -1, 0, 0, 0, 0, 1])
})

gate('merge: the aabb of an empty box is returned unchanged, and a sphere radius scales by the given factor', () => {
  const translate = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 5, 5, 1]
  assert.deepEqual(transformAabb([1, 1, 1, 0, 0, 0], translate), [1, 1, 1, 0, 0, 0])
  assert.deepEqual(transformAabb([0, 0, 0, 1, 1, 1], translate), [5, 5, 5, 6, 6, 6])
  assert.deepEqual(transformSphere([0, 0, 0, 2], translate, 3), [5, 5, 5, 6])
})

gate('merge: a source with no index or groups with no shared position fall back to unmerged copies', () => {
  const stone = {}
  const noIndex = mergeClusterMeshesByMaterial([triangleMesh(stone, 0), triangleMesh(stone, 5, { index: null })], null)
  assert.deepEqual(noIndex.map((mesh) => mesh._sourceIndices), [[0], [1]])
  const noPosition = triangleMesh(stone, 0)
  noPosition.geometry = { attributes: { normal: noPosition.geometry.attributes.normal }, index: noPosition.geometry.index }
  const out = mergeClusterMeshesByMaterial([noPosition, triangleMesh(stone, 0)], null)
  assert.deepEqual(out.map((mesh) => mesh._sourceIndices), [[0], [1]])
})

gate('merge: zero-area triangles are collapsed in place and reported through the injected warn with spoint\'s text', () => {
  const stone = {}
  const warnings = []
  const [merged] = mergeClusterMeshesByMaterial([triangleMesh(stone, 0, { indices: [0, 0, 1, 2, 1, 0] }), triangleMesh(stone, 5)], null, { warn: (line) => warnings.push(line) })
  assert.equal(merged.degenerateCollapsed, 1)
  assert.deepEqual(list(merged.geometry.index).slice(1, 4), [0, 0, 0])
  assert.deepEqual(warnings, ['[cluster-material-merge] collapsed 1 degenerate (zero-area) triangle(s) after merging 2 source(s)'])
  const silent = mergeClusterMeshesByMaterial([triangleMesh(stone, 0, { indices: [0, 0, 1, 2, 1, 0] }), triangleMesh(stone, 5)], null)
  assert.equal(silent[0].degenerateCollapsed, 1)
})

gate('merge: the index widens to Uint32 past 65535 vertices, or when any source index value exceeds 65535 even outside the lod ranges', () => {
  const stone = {}
  const big = triangleMesh(stone, 0, { attributes: {} })
  big.geometry.attributes = { position: attribute(new Float32Array(40000 * 3).map((_, i) => i % 7), 3) }
  const other = triangleMesh(stone, 0)
  other.geometry.attributes = { position: attribute(new Float32Array(40000 * 3).map((_, i) => i % 5), 3) }
  assert.equal(mergeClusterMeshesByMaterial([big, other], null)[0].geometry.index.constructor, Uint32Array)
  const stray = triangleMesh(stone, 0, { indices: [0, 1, 2, 2, 1, 0, 70000], IndexArray: Uint32Array })
  assert.equal(mergeClusterMeshesByMaterial([stray, triangleMesh(stone, 5)], null)[0].geometry.index.constructor, Uint32Array)
  assert.equal(mergeClusterMeshesByMaterial([triangleMesh(stone, 0), triangleMesh(stone, 5)], null)[0].geometry.index.constructor, Uint16Array)
})

gate('merge: the vertex boundary is spoint\'s strict test, 65535 vertices stay Uint16 and 65536 widen to Uint32', () => {
  const stone = {}
  const sized = (count) => {
    const mesh = triangleMesh(stone, 0)
    mesh.geometry.attributes = { position: attribute(new Float32Array(count * 3).map((_, i) => i % 11), 3) }
    return mesh
  }
  assert.equal(mergeClusterMeshesByMaterial([sized(65532), sized(3)], null)[0].geometry.index.constructor, Uint16Array)
  assert.equal(mergeClusterMeshesByMaterial([sized(65533), sized(3)], null)[0].geometry.index.constructor, Uint32Array)
})

gate('remap: the static import pattern finds static imports and re-exports but not a dynamic import', () => {
  const source = "import a from './a.js'\nexport { b } from \"./b.js\";import './c.js'\nexport * as d from 'd'\nconst e = () => import('./e.js')"
  assert.deepEqual([...source.matchAll(STATIC_IMPORT_SPECIFIER)].map((match) => match[3]), ['./a.js', './b.js', './c.js', 'd'])
})

const BASE = 'https://host.test/mods/'
const modules = {
  'entry.js': "import { leaf } from './sub/leaf.js'\nimport plain from './plain.js'\nexport { shared } from './shared.js'\nimport * as bare from 'bare-lib'\nimport other from 'unmapped'\nconst dyn = () => import('./plain.js')\n",
  'sub/leaf.js': "import { shared } from '../shared.js';import { y } from \"bare-lib\"\nexport const leaf = shared + y\n",
  'shared.js': 'export const shared = 1\n',
  'plain.js': 'export default 100\n',
  'cyc-a.js': "import './cyc-b.js'\n",
  'cyc-b.js': "import './cyc-a.js'\n",
}
const BARE = 'data:text/javascript,export const y = 1000'

const makeHost = (failImport = false) => {
  const record = { fetched: [], created: [], revoked: [], imported: [] }
  const host = {
    fetch: async (url) => {
      record.fetched.push(url)
      const name = url.slice(BASE.length)
      return Object.hasOwn(modules, name) ? { ok: true, status: 200, text: async () => modules[name] } : { ok: false, status: 404 }
    },
    resolve: (specifier, url) => new URL(specifier, url).href,
    createModuleUrl: (text) => {
      record.created.push(text)
      return 'blob:module-' + record.created.length
    },
    revokeModuleUrl: (url) => record.revoked.push(url),
    importModule: async (url) => {
      record.imported.push(url)
      if (failImport) throw new Error('import failed')
      return { url }
    },
  }
  return { host, record }
}

const cases = {}
const probe = async (label, fn) => {
  try {
    await fn()
    cases[label] = null
  } catch (error) {
    cases[label] = error
  }
}
const check = (label) => gate(label, () => {
  if (!(label in cases)) throw new Error('no probe recorded ' + label)
  if (cases[label]) throw cases[label]
})

const REMAP_REWRITE = 'remap: relative imports resolve to rewritten module urls, bare names map, unmapped bare names and dynamic imports stay, and each module is fetched once'
await probe(REMAP_REWRITE, async () => {
  const { host, record } = makeHost()
  const result = await importWithBareRemap(BASE + 'entry.js', { 'bare-lib': BARE }, host)
  assert.deepEqual(result, { url: 'blob:module-2' })
  assert.deepEqual(record.created, [
    "import { shared } from 'https://host.test/mods/shared.js';import { y } from \"" + BARE + "\"\nexport const leaf = shared + y\n",
    "import { leaf } from 'blob:module-1'\nimport plain from 'https://host.test/mods/plain.js'\nexport { shared } from 'https://host.test/mods/shared.js'\nimport * as bare from '" + BARE + "'\nimport other from 'unmapped'\nconst dyn = () => import('./plain.js')\n",
  ])
  assert.deepEqual([...record.fetched].sort(), ['entry.js', 'plain.js', 'shared.js', 'sub/leaf.js'].map((name) => BASE + name))
  assert.deepEqual(record.revoked, ['blob:module-1', 'blob:module-2'])
})
check(REMAP_REWRITE)

const REMAP_UNCHANGED = 'remap: a module whose imports need no change is imported from its own url and no module url is made'
await probe(REMAP_UNCHANGED, async () => {
  const { host, record } = makeHost()
  assert.deepEqual(await importWithBareRemap(BASE + 'shared.js', {}, host), { url: BASE + 'shared.js' })
  assert.deepEqual(record.created, [])
  assert.deepEqual(record.revoked, [])
})
check(REMAP_UNCHANGED)

const REMAP_CYCLE = 'remap: an import cycle is refused with the chain, and a failed fetch with its status'
await probe(REMAP_CYCLE, async () => {
  const { host, record } = makeHost()
  await assert.rejects(importWithBareRemap(BASE + 'cyc-a.js', {}, host), { message: 'worker-module-remap: import cycle https://host.test/mods/cyc-a.js -> https://host.test/mods/cyc-b.js -> https://host.test/mods/cyc-a.js' })
  await assert.rejects(importWithBareRemap(BASE + 'missing.js', {}, host), { message: 'worker-module-remap: fetch https://host.test/mods/missing.js: 404' })
  assert.deepEqual(record.imported, [])
})
check(REMAP_CYCLE)

const REMAP_REVOKE = 'remap: module urls are revoked even when the final import throws'
await probe(REMAP_REVOKE, async () => {
  const { host, record } = makeHost(true)
  await assert.rejects(importWithBareRemap(BASE + 'entry.js', { 'bare-lib': BARE }, host), { message: 'import failed' })
  assert.deepEqual(record.revoked, ['blob:module-1', 'blob:module-2'])
})
check(REMAP_REVOKE)

const REMAP_HOST = 'remap: a missing host or host function is refused before any fetch'
await probe(REMAP_HOST, async () => {
  await assert.rejects(importWithBareRemap(BASE + 'entry.js', {}), TypeError)
  const { host, record } = makeHost()
  await assert.rejects(importWithBareRemap(BASE + 'entry.js', {}, { ...host, revokeModuleUrl: undefined }), { message: 'worker-module-remap: host.revokeModuleUrl must be a function' })
  assert.deepEqual(record.fetched, [])
})
check(REMAP_HOST)

finish()
