import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gate, finish } from './lib/gate.mjs'
import { createSchemaValidator, PROGRESSIVE_LOD_SCHEMA_NAMES } from '../src/packages/streaming-gltf/progressive-lod-schema.js'
import { createModelPool, readProgressiveLod, planLodLoads, readModelContainer, resolveSiblingUrl, ModelPoolError, MODEL_POOL_REFUSAL, PROGRESSIVE_LOD_KEY } from '../src/packages/streaming-gltf/model-pool.js'
import { createClusterLodSelector, ClusterSelectError } from '../src/packages/streaming-gltf/cluster-lod-select.js'
import { createHizPyramid, hizMipCount, projectViewSphereRect, HizError } from '../src/packages/streaming-gltf/hiz-pyramid.js'
import { octEncode, octDecode, hemiOctEncode, hemiOctDecode, createImpostorGrid, ImpostorError } from '../src/packages/streaming-gltf/octahedral-impostor.js'
import { buildClusterLod } from '../src/packages/streaming-gltf/meshlet-codec.js'
import { buildClusterLodExtra, parseClusterLod, CLUSTER_LOD_EXTRA_KEY } from '../src/packages/streaming-gltf/cluster-lod-extras.js'

const schemaDir = new URL('../src/packages/streaming-gltf/schema/', import.meta.url)
const schemas = Object.fromEntries(PROGRESSIVE_LOD_SCHEMA_NAMES.map((name) => [name, JSON.parse(readFileSync(new URL(name, schemaDir), 'utf8'))]))
const validator = createSchemaValidator(schemas)

const mulberry = (seed) => () => {
  seed = (seed + 0x6D2B79F5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const codeOf = async (fn) => {
  try {
    await fn()
  } catch (error) {
    return error.code ?? 'other: ' + error.message
  }
  return 'no refusal'
}

const clone = (value) => JSON.parse(JSON.stringify(value))

const siblingRecord = {
  version: 1,
  storage: 'sibling-file',
  meshes: [{ meshIndex: 0, primIndex: 0, lods: [
    { ratio: 1.0, kind: 'textured', inline: false, path: 'lod_0.glb', bytes: 161200 },
    { ratio: 0.04, kind: 'textured', inline: true, indexCount: 312 },
    { ratio: 0.15, kind: 'textured', inline: false, path: './lods/lod_2.glb', bytes: 24010 },
  ] }],
  textures: [{ textureIndex: 0, name: 'albedo', lods: [
    { width: 2048, inline: false, path: 'tex0_2048.webp', bytes: 210000 },
    { width: 128, inline: true, bytes: 3100 },
    { width: 512, inline: false, path: 'tex0_512.webp', bytes: 22000 },
  ] }],
}

const documentWith = (record, where = 'extension') => {
  const json = { asset: { version: '2.0' }, meshes: [{ primitives: [{}] }], textures: [{}], bufferViews: [{ byteOffset: 0, byteLength: 16 }, { byteOffset: 16, byteLength: 40 }, { byteOffset: 56, byteLength: 8 }] }
  if (where === 'extension') json.extensions = { [PROGRESSIVE_LOD_KEY]: record }
  else json.extras = { [PROGRESSIVE_LOD_KEY]: record }
  return json
}

const glbOf = (json, bin) => {
  const text = new TextEncoder().encode(JSON.stringify(json))
  const jsonLength = Math.ceil(text.length / 4) * 4
  const bytes = new Uint8Array(12 + 8 + jsonLength + 8 + bin.length)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, 0x46546c67, true)
  view.setUint32(4, 2, true)
  view.setUint32(8, bytes.length, true)
  view.setUint32(12, jsonLength, true)
  view.setUint32(16, 0x4e4f534a, true)
  bytes.fill(0x20, 20, 20 + jsonLength)
  bytes.set(text, 20)
  view.setUint32(20 + jsonLength, bin.length, true)
  view.setUint32(24 + jsonLength, 0x004e4942, true)
  bytes.set(bin, 28 + jsonLength)
  return bytes
}

const jsonBytes = (json) => new TextEncoder().encode(JSON.stringify(json))

const server = (files) => {
  const calls = []
  const gates = new Map()
  const fetchBytes = async (url, range) => {
    calls.push(range ? url + '@' + range[0] + '-' + range[1] : url)
    if (gates.has(url)) await gates.get(url).promise
    const bytes = files.get(url)
    if (!bytes) throw new Error('404 ' + url)
    return range ? bytes.slice(range[0], range[1]) : bytes
  }
  const hold = (url) => {
    let open
    const promise = new Promise((resolve) => { open = resolve })
    gates.set(url, { promise })
    return () => { gates.delete(url); open() }
  }
  return { calls, fetchBytes, hold }
}

const siblingFiles = () => new Map([
  ['https://cdn.test/models/tree.gltf', jsonBytes(documentWith(siblingRecord))],
  ['https://cdn.test/models/lod_0.glb', new Uint8Array(100).fill(1)],
  ['https://cdn.test/models/lods/lod_2.glb', new Uint8Array(30).fill(2)],
  ['https://cdn.test/models/tex0_2048.webp', new Uint8Array(200).fill(3)],
  ['https://cdn.test/models/tex0_512.webp', new Uint8Array(20).fill(4)],
  ['https://cdn.test/models/rock.gltf', jsonBytes({ asset: { version: '2.0' }, meshes: [{ primitives: [{}] }] })],
  ['https://cdn.test/models/bush.gltf', jsonBytes({ asset: { version: '2.0' }, meshes: [{ primitives: [{}] }] })],
])

gate('the record is read from the extension, and from the extras key when the extension is absent', () => {
  assert.equal(readProgressiveLod(documentWith(siblingRecord), validator).source, 'extension')
  assert.equal(readProgressiveLod(documentWith(siblingRecord, 'extras'), validator).source, 'extras')
  assert.equal(readProgressiveLod({ asset: {} }, validator), null)
})

gate('mesh LODs come back coarse to fine by ratio and texture LODs small to large, whatever order the file lists them in', () => {
  const record = readProgressiveLod(documentWith(siblingRecord), validator)
  assert.deepEqual(record.meshes[0].lods.map((lod) => lod.ratio), [0.04, 0.15, 1])
  assert.deepEqual(record.textures[0].lods.map((lod) => lod.width), [128, 512, 2048])
})

gate('a record the schema rejects, a mesh the document does not hold, and a LOD with no address are each refused by name', async () => {
  const badRatio = clone(siblingRecord)
  badRatio.meshes[0].lods[0].ratio = 0
  assert.equal(await codeOf(() => readProgressiveLod(documentWith(badRatio), validator)), MODEL_POOL_REFUSAL.SCHEMA)
  const badMesh = clone(siblingRecord)
  badMesh.meshes[0].meshIndex = 3
  assert.equal(await codeOf(() => readProgressiveLod(documentWith(badMesh), validator)), MODEL_POOL_REFUSAL.MESH_INDEX)
  const noAddress = clone(siblingRecord)
  delete noAddress.meshes[0].lods[0].path
  assert.equal(await codeOf(() => readProgressiveLod(documentWith(noAddress), validator)), MODEL_POOL_REFUSAL.LOD_ADDRESS)
  const twice = clone(siblingRecord)
  twice.meshes.push(clone(siblingRecord.meshes[0]))
  assert.equal(await codeOf(() => readProgressiveLod(documentWith(twice), validator)), MODEL_POOL_REFUSAL.MESH_INDEX)
})

gate('a sibling path may not leave the root asset directory: .., an absolute path, a scheme and a backslash are refused', async () => {
  assert.equal(resolveSiblingUrl('https://cdn.test/models/tree.gltf?v=3', './lods/lod_2.glb'), 'https://cdn.test/models/lods/lod_2.glb')
  for (const path of ['../secret.glb', 'lods/../../x.glb', '/etc/passwd', 'https://evil.test/x.glb', 'a\\b.glb', '', './']) {
    assert.equal(await codeOf(() => resolveSiblingUrl('https://cdn.test/models/tree.gltf', path)), MODEL_POOL_REFUSAL.PATH, path)
  }
  const escaping = clone(siblingRecord)
  escaping.meshes[0].lods[0].path = '../other/lod_0.glb'
  assert.equal(await codeOf(() => readProgressiveLod(documentWith(escaping), validator)), MODEL_POOL_REFUSAL.PATH)
})

gate('the sibling-file plan needs no fetch for the inline level and orders each later level by byte cost', () => {
  const json = documentWith(siblingRecord)
  const plan = planLodLoads(readProgressiveLod(json, validator), { rootUrl: 'https://cdn.test/models/tree.gltf', json })
  assert.equal(plan.levels, 3)
  assert.equal(plan.fetches, 4)
  assert.deepEqual(plan.steps.map((step) => [step.level, step.kind, step.inline, step.url]), [
    [0, 'mesh', true, null],
    [0, 'texture', true, null],
    [1, 'texture', false, 'https://cdn.test/models/tex0_512.webp'],
    [1, 'mesh', false, 'https://cdn.test/models/lods/lod_2.glb'],
    [2, 'mesh', false, 'https://cdn.test/models/lod_0.glb'],
    [2, 'texture', false, 'https://cdn.test/models/tex0_2048.webp'],
  ])
})

const rangedRecord = { version: 1, storage: 'single-glb-range', meshes: [{ meshIndex: 0, primIndex: 0, lods: [{ ratio: 1, bufferView: 1 }, { ratio: 0.1, bufferView: 0 }] }], textures: [{ textureIndex: 0, lods: [{ width: 64, bufferView: 2, mime: 'image/webp' }] }] }
const rangedBin = Uint8Array.from({ length: 64 }, (_, i) => i)
const rangedGlb = () => glbOf(documentWith(rangedRecord), rangedBin)

gate('the single-glb-range plan turns each bufferView into a byte range inside the GLB BIN chunk', () => {
  const container = readModelContainer(rangedGlb())
  assert.equal(container.glb, true)
  const plan = planLodLoads(readProgressiveLod(container.json, validator), { rootUrl: 'https://cdn.test/a.glb', json: container.json, binOffset: container.binOffset })
  const meshCoarse = plan.steps.find((step) => step.kind === 'mesh' && step.level === 0)
  const meshFine = plan.steps.find((step) => step.kind === 'mesh' && step.level === 1)
  assert.deepEqual(meshCoarse.range, [container.binOffset, container.binOffset + 16])
  assert.deepEqual(meshFine.range, [container.binOffset + 16, container.binOffset + 56])
  assert.equal(plan.steps.every((step) => step.url === 'https://cdn.test/a.glb' && step.inline === false), true)
})

gate('a range that names a bufferView the GLB does not hold is refused', async () => {
  const bad = clone(rangedRecord)
  bad.meshes[0].lods[0].bufferView = 9
  assert.equal(await codeOf(() => readProgressiveLod(documentWith(bad), validator)), MODEL_POOL_REFUSAL.LOD_ADDRESS)
})

gate('the pool fetches a range and gets the bytes of that bufferView back, one refinement level at a time', async () => {
  const s = server(new Map([['https://cdn.test/a.glb', rangedGlb()]]))
  const pool = createModelPool({ fetchBytes: s.fetchBytes, validator })
  const model = await pool.acquire('https://cdn.test/a.glb')
  assert.equal(model.level, -1)
  const first = await pool.refine('https://cdn.test/a.glb')
  assert.equal(first.level, 0)
  const coarseMesh = first.steps.find((step) => step.kind === 'mesh')
  assert.deepEqual([...coarseMesh.data], [...rangedBin.subarray(0, 16)])
  const second = await pool.refine('https://cdn.test/a.glb')
  assert.deepEqual([...second.steps[0].data], [...rangedBin.subarray(16, 56)])
  assert.equal(second.complete, true)
  assert.equal(await pool.refine('https://cdn.test/a.glb'), null)
  assert.equal(s.calls.length, 4)
})

gate('two callers who acquire the same model while it loads share one fetch and one model object', async () => {
  const s = server(siblingFiles())
  const open = s.hold('https://cdn.test/models/tree.gltf')
  const pool = createModelPool({ fetchBytes: s.fetchBytes, validator })
  const a = pool.acquire('https://cdn.test/models/tree.gltf')
  const b = pool.acquire('https://cdn.test/models/tree.gltf')
  open()
  const [first, second] = await Promise.all([a, b])
  assert.equal(first, second)
  assert.deepEqual(s.calls, ['https://cdn.test/models/tree.gltf'])
  assert.equal(pool.refsOf('https://cdn.test/models/tree.gltf'), 2)
  assert.deepEqual([pool.getStats().misses, pool.getStats().hits], [1, 1])
})

gate('a sibling-file model starts at its inline level with no extra fetch and refines in plan order to the full mesh', async () => {
  const s = server(siblingFiles())
  const pool = createModelPool({ fetchBytes: s.fetchBytes, validator })
  const url = 'https://cdn.test/models/tree.gltf'
  const model = await pool.acquire(url)
  assert.equal(model.level, 0)
  assert.equal(s.calls.length, 1)
  await pool.refine(url)
  const last = await pool.refine(url)
  assert.equal(last.complete, true)
  assert.deepEqual(s.calls.slice(1), ['https://cdn.test/models/tex0_512.webp', 'https://cdn.test/models/lods/lod_2.glb', 'https://cdn.test/models/lod_0.glb', 'https://cdn.test/models/tex0_2048.webp'])
  assert.equal(model.level, 2)
  assert.equal(model.loaded.length, 6)
})

gate('two refine calls made at once run one after the other and deliver levels 1 and 2 in order', async () => {
  const s = server(siblingFiles())
  const pool = createModelPool({ fetchBytes: s.fetchBytes, validator })
  const url = 'https://cdn.test/models/tree.gltf'
  await pool.acquire(url)
  const [one, two] = await Promise.all([pool.refine(url), pool.refine(url)])
  assert.deepEqual([one.level, two.level], [1, 2])
})

gate('the pool holds its capacity: a released model is evicted least recently used first, and its evict hook runs once', async () => {
  const s = server(siblingFiles())
  const evicted = []
  const pool = createModelPool({ fetchBytes: s.fetchBytes, validator, capacity: 2, onEvict: (model) => evicted.push(model.url) })
  const tree = 'https://cdn.test/models/tree.gltf', rock = 'https://cdn.test/models/rock.gltf', bush = 'https://cdn.test/models/bush.gltf'
  await pool.acquire(tree)
  await pool.acquire(rock)
  pool.release(tree)
  pool.release(rock)
  await pool.acquire(tree)
  pool.release(tree)
  await pool.acquire(bush)
  assert.deepEqual(evicted, [rock])
  assert.deepEqual([pool.has(tree), pool.has(rock), pool.has(bush), pool.size], [true, false, true, 2])
})

gate('a pool whose every slot is still in use refuses a new model and evicts nothing', async () => {
  const s = server(siblingFiles())
  const pool = createModelPool({ fetchBytes: s.fetchBytes, validator, capacity: 2 })
  await pool.acquire('https://cdn.test/models/tree.gltf')
  await pool.acquire('https://cdn.test/models/rock.gltf')
  assert.equal(await codeOf(() => pool.acquire('https://cdn.test/models/bush.gltf')), MODEL_POOL_REFUSAL.FULL)
  assert.equal(pool.size, 2)
  assert.equal(pool.getStats().refusedFull, 1)
})

gate('a failed load reaches every waiting caller, leaves no entry behind, and the next acquire tries again', async () => {
  const files = siblingFiles()
  files.delete('https://cdn.test/models/rock.gltf')
  const s = server(files)
  const pool = createModelPool({ fetchBytes: s.fetchBytes, validator })
  const url = 'https://cdn.test/models/rock.gltf'
  const results = await Promise.allSettled([pool.acquire(url), pool.acquire(url)])
  assert.deepEqual(results.map((r) => r.status), ['rejected', 'rejected'])
  assert.equal(pool.has(url), false)
  files.set(url, jsonBytes({ asset: {}, meshes: [{ primitives: [{}] }] }))
  const model = await pool.acquire(url)
  assert.equal(model.record, null)
  assert.equal(model.levels, 0)
})

gate('a model evicted while a refinement is in flight drops the late data: refine resolves null', async () => {
  const s = server(siblingFiles())
  const pool = createModelPool({ fetchBytes: s.fetchBytes, validator, capacity: 1 })
  const tree = 'https://cdn.test/models/tree.gltf'
  const model = await pool.acquire(tree)
  const open = s.hold('https://cdn.test/models/tex0_512.webp')
  const pending = pool.refine(tree)
  pool.release(tree)
  await pool.acquire('https://cdn.test/models/rock.gltf')
  open()
  assert.equal(await pending, null)
  assert.equal(model.level, 0)
})

gate('releasing or refining a model nobody holds is refused, and so is a pool with no fetch or validator', async () => {
  const s = server(siblingFiles())
  const pool = createModelPool({ fetchBytes: s.fetchBytes, validator })
  assert.equal(await codeOf(() => pool.release('nope')), MODEL_POOL_REFUSAL.NOT_HELD)
  assert.equal(await codeOf(() => pool.refine('nope')), MODEL_POOL_REFUSAL.NOT_HELD)
  assert.equal(await codeOf(() => createModelPool({ validator })), MODEL_POOL_REFUSAL.OPTION)
  assert.equal(await codeOf(() => createModelPool({ fetchBytes: s.fetchBytes })), MODEL_POOL_REFUSAL.OPTION)
  assert.equal(await codeOf(() => createModelPool({ fetchBytes: s.fetchBytes, validator, capacity: 0 })), MODEL_POOL_REFUSAL.OPTION)
  assert.equal(await codeOf(() => readModelContainer(new Uint8Array([1, 2, 3]))), MODEL_POOL_REFUSAL.CONTAINER)
})

const gridGeometry = (nx, nz, size) => {
  const cols = nx + 1
  const position = new Float32Array(cols * (nz + 1) * 3)
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const v = j * cols + i
    position[v * 3] = (i / nx - 0.5) * size
    position[v * 3 + 1] = 0.3 * Math.sin(i * 0.9) * Math.cos(j * 0.7)
    position[v * 3 + 2] = (j / nz - 0.5) * size
  }
  const indices = []
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const a = j * cols + i, b = a + 1, c = a + cols, d = c + 1
    indices.push(a, c, b, b, c, d)
  }
  return { attributes: [{ name: 'position', array: position, itemSize: 3, normalized: false }], index: Uint32Array.from(indices) }
}

const built = await buildClusterLod(gridGeometry(48, 48, 96), { maxVertices: 64, maxTriangles: 96, lodRatios: [1, 0.5, 0.25], lodError: 0.5, uvAware: false })
const clusterRecord = parseClusterLod({ [CLUSTER_LOD_EXTRA_KEY]: buildClusterLodExtra(built) })
const SOURCE_INDICES = 48 * 48 * 6

const boxPlanes = (minX, maxX) => Float32Array.from([1, 0, 0, -minX, -1, 0, 0, maxX, 0, 1, 0, 1000, 0, -1, 0, 1000, 0, 0, 1, 1000, 0, 0, -1, 1000])

gate('a built cluster record of a 4608-triangle grid selects every cluster at LOD 0 when the eye is inside it: all 27648 indices are drawn', () => {
  assert.ok(clusterRecord.clusters.length >= 20, clusterRecord.clusters.length + ' clusters')
  const selector = createClusterLodSelector(clusterRecord, { lodBase: 1000 })
  const draws = selector.select({ frame: 0, eye: [0, 1, 0] })
  let indices = 0
  for (let d = 0; d < draws; d++) indices += selector.counts[d]
  assert.equal(indices, SOURCE_INDICES)
  assert.equal(selector.getStats().indices, SOURCE_INDICES)
  assert.equal([...selector.levelOf].every((level) => level === 0), true)
})

gate('adjacent ranges on one stream are merged, so the draw count is below the cluster count and the ranges never overlap', () => {
  const selector = createClusterLodSelector(clusterRecord, { lodBase: 1000 })
  const draws = selector.select({ frame: 0, eye: [0, 1, 0] })
  assert.ok(draws < clusterRecord.clusters.length, draws + ' draws for ' + clusterRecord.clusters.length + ' clusters')
  const ranges = Array.from({ length: draws }, (_, d) => [selector.streams[d], selector.offsets[d], selector.offsets[d] + selector.counts[d]]).sort((a, b) => a[0] - b[0] || a[1] - b[1])
  for (let i = 1; i < ranges.length; i++) if (ranges[i][0] === ranges[i - 1][0]) assert.ok(ranges[i][1] >= ranges[i - 1][2], 'ranges overlap')
})

gate('a far eye picks coarser levels: the same mesh draws fewer indices from 5000 m than from inside it, and never more than the coarse stream holds', () => {
  const selector = createClusterLodSelector(clusterRecord)
  selector.select({ frame: 0, eye: [0, 5000, 0] })
  const far = selector.getStats().indices
  assert.ok(far < SOURCE_INDICES * 0.6, far + ' indices from afar')
  assert.equal([...selector.levelOf].every((level, c) => level === clusterRecord.clusters[c].lods.length - 1), true)
})

gate('distance levels are monotone: moving the eye away never lowers a cluster level', () => {
  let previous = null
  for (const height of [1, 20, 60, 150, 400, 1200, 4000]) {
    const selector = createClusterLodSelector(clusterRecord, { hysteresis: 0 })
    selector.select({ frame: 0, eye: [0, height, 0] })
    const levels = [...selector.levelOf]
    if (previous) levels.forEach((level, c) => assert.ok(level >= previous[c], 'cluster ' + c + ' went from ' + previous[c] + ' to ' + level + ' at height ' + height))
    previous = levels
  }
})

gate('frustum planes cull: a slab over x from 0 to 48 draws every cluster that reaches it and none that lies wholly outside', () => {
  const selector = createClusterLodSelector(clusterRecord, { lodBase: 1000 })
  selector.select({ frame: 0, eye: [0, 1, 0], planes: boxPlanes(0, 48) })
  const stats = selector.getStats()
  assert.ok(stats.culled > 0 && stats.visible > 0, stats.visible + ' visible, ' + stats.culled + ' culled')
  clusterRecord.clusters.forEach((cluster, c) => {
    const [x, , , r] = cluster.sphere
    const reaches = x + r >= 0 && x - r <= 48
    assert.equal(selector.levelOf[c] >= 0, reaches, 'cluster ' + c + ' at x ' + x + ' radius ' + r)
  })
  assert.ok(stats.indices < SOURCE_INDICES && stats.indices > SOURCE_INDICES * 0.4, stats.indices + ' indices')
})

gate('a mesh is selected at most once per frame: a second call in the same frame returns the first result without recomputing', () => {
  const selector = createClusterLodSelector(clusterRecord)
  const first = selector.select({ frame: 7, eye: [0, 1, 0] })
  const second = selector.select({ frame: 7, eye: [0, 9000, 0] })
  assert.equal(second, first)
  assert.deepEqual([selector.getStats().selections, selector.getStats().repeats], [1, 1])
  const third = selector.select({ frame: 8, eye: [0, 9000, 0] })
  assert.notEqual(selector.getStats().indices, SOURCE_INDICES)
  assert.equal(selector.getStats().selections, 2)
  assert.ok(third > 0)
})

gate('hysteresis holds a level across its boundary: an eye that crosses the LOD 1 threshold of a cluster by 3 percent and back changes its level without hysteresis and keeps it with', () => {
  const [cx, cy, cz, radius] = clusterRecord.clusters[0].sphere
  const base = 8
  const heightAt = (factor) => cy + radius + base * radius * 2 * factor
  const run = (hysteresis) => {
    const selector = createClusterLodSelector(clusterRecord, { lodBase: base, hysteresis })
    return [0.97, 1.03, 0.97, 1.03].map((factor, frame) => {
      selector.select({ frame, eye: [cx, heightAt(factor), cz] })
      return selector.levelOf[0]
    })
  }
  assert.deepEqual(run(0), [0, 1, 0, 1])
  assert.deepEqual(run(0.1), [0, 0, 0, 0])
})

gate('the selector refuses an empty record, a fractional frame, a NaN eye and a plane list of the wrong length', async () => {
  const code = (fn) => { try { fn() } catch (error) { return error instanceof ClusterSelectError ? error.code : String(error) } return null }
  assert.equal(code(() => createClusterLodSelector({ clusters: [] })), 'cluster-select-record')
  const selector = createClusterLodSelector(clusterRecord)
  assert.equal(code(() => selector.select({ frame: 0.5, eye: [0, 0, 0] })), 'cluster-select-frame')
  assert.equal(code(() => selector.select({ frame: 1, eye: [NaN, 0, 0] })), 'cluster-select-eye')
  assert.equal(code(() => selector.select({ frame: 2, eye: [0, 0, 0], planes: new Float32Array(8) })), 'cluster-select-planes')
  assert.equal(code(() => createClusterLodSelector(clusterRecord, { hysteresis: 0.5 })), 'cluster-select-option')
})

const W = 96, H = 64
const sceneDepth = (seed) => {
  const random = mulberry(seed)
  const depth = new Float32Array(W * H).fill(100)
  for (let k = 0; k < 14; k++) {
    const x0 = Math.floor(random() * W), y0 = Math.floor(random() * H)
    const w = 4 + Math.floor(random() * 40), h = 4 + Math.floor(random() * 30)
    const d = 5 + random() * 60
    for (let y = y0; y < Math.min(H, y0 + h); y++) for (let x = x0; x < Math.min(W, x0 + w); x++) if (d < depth[y * W + x]) depth[y * W + x] = d
  }
  return depth
}

gate('the pyramid of a 96 by 64 buffer has 8 mips down to 1 by 1, and each texel is the farthest depth of the texels under it', () => {
  assert.equal(hizMipCount(W, H), 8)
  const pyramid = createHizPyramid(W, H)
  const depth = sceneDepth(1)
  pyramid.build(depth)
  assert.deepEqual([pyramid.widths[7], pyramid.heights[7]], [1, 1])
  let farthest = -Infinity
  for (const d of depth) if (d > farthest) farthest = d
  assert.equal(pyramid.texels[pyramid.starts[7]], farthest)
  for (let m = 1; m < pyramid.mipCount; m++) {
    for (let y = 0; y < pyramid.heights[m]; y++) for (let x = 0; x < pyramid.widths[m]; x++) {
      let want = -Infinity
      for (let sy = y << m; sy < Math.min(H, (y + 1) << m); sy++) for (let sx = x << m; sx < Math.min(W, (x + 1) << m); sx++) if (depth[sy * W + sx] > want) want = depth[sy * W + sx]
      assert.equal(pyramid.texels[pyramid.starts[m] + y * pyramid.widths[m] + x], want, 'mip ' + m + ' texel ' + x + ',' + y)
    }
  }
})

gate('over 4000 seeded rectangles the pyramid never hides a visible box: each occluded verdict is confirmed by a scan of every pixel', () => {
  const pyramid = createHizPyramid(W, H)
  const depth = sceneDepth(2)
  pyramid.build(depth)
  const random = mulberry(9)
  let hidden = 0, trulyHidden = 0
  for (let i = 0; i < 4000; i++) {
    const x0 = Math.floor(random() * W), y0 = Math.floor(random() * H)
    const x1 = Math.min(W - 1, x0 + Math.floor(random() * 24)), y1 = Math.min(H - 1, y0 + Math.floor(random() * 24))
    const d = random() * 110
    let scanHidden = true
    for (let y = y0; y <= y1 && scanHidden; y++) for (let x = x0; x <= x1; x++) if (!(d > depth[y * W + x])) { scanHidden = false; break }
    if (scanHidden) trulyHidden++
    if (pyramid.isOccluded(x0, y0, x1 + 0.5, y1 + 0.5, d)) {
      hidden++
      assert.equal(scanHidden, true, 'rectangle ' + i + ' was called occluded with a visible pixel')
    }
  }
  assert.ok(trulyHidden > 400, 'the seeded set holds only ' + trulyHidden + ' hidden rectangles')
  assert.ok(hidden >= trulyHidden * 0.6, 'the pyramid found ' + hidden + ' of ' + trulyHidden + ' hidden rectangles')
})

gate('negative control: a pyramid that kept the nearest depth instead of the farthest would hide visible boxes on the same set', () => {
  const depth = sceneDepth(2)
  const random = mulberry(9)
  let wrong = 0
  for (let i = 0; i < 4000; i++) {
    const x0 = Math.floor(random() * W), y0 = Math.floor(random() * H)
    const x1 = Math.min(W - 1, x0 + Math.floor(random() * 24)), y1 = Math.min(H - 1, y0 + Math.floor(random() * 24))
    const d = random() * 110
    let nearest = Infinity, farthest = -Infinity
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const v = depth[y * W + x]; if (v < nearest) nearest = v; if (v > farthest) farthest = v }
    if (d > nearest && !(d > farthest)) wrong++
  }
  assert.ok(wrong > 100, 'only ' + wrong + ' rectangles tell the two reductions apart')
})

gate('a rectangle off the screen is never occluded, one that straddles the edge is clamped, and a test before any build is refused', () => {
  const pyramid = createHizPyramid(W, H)
  let code = null
  try { pyramid.isOccluded(0, 0, 4, 4, 50) } catch (error) { code = error instanceof HizError ? error.code : String(error) }
  assert.equal(code, 'hiz-not-built')
  pyramid.build(new Float32Array(W * H).fill(10))
  assert.equal(pyramid.isOccluded(-50, -50, -10, -10, 99), false)
  assert.equal(pyramid.isOccluded(-10, -10, 5, 5, 99), true)
  assert.equal(pyramid.isOccluded(-10, -10, 5, 5, 9), false)
  assert.throws(() => pyramid.build(new Float32Array(3)), HizError)
  assert.throws(() => createHizPyramid(0, 4), HizError)
})

gate('the view-space sphere rectangle contains the projection of 400 points on the sphere, and its depth is the nearest of them', () => {
  const lens = { focalX: 1.2, focalY: 1.8, near: 0.1 }
  const random = mulberry(5)
  const out = {}
  for (let s = 0; s < 40; s++) {
    const centre = [(random() - 0.5) * 20, (random() - 0.5) * 12, -(6 + random() * 40)]
    const radius = 0.5 + random() * 3
    assert.equal(projectViewSphereRect(lens, centre, radius, W, H, out), true)
    for (let k = 0; k < 400; k++) {
      const u = random() * 2 - 1, phi = random() * 2 * Math.PI, t = Math.sqrt(1 - u * u)
      const p = [centre[0] + radius * t * Math.cos(phi), centre[1] + radius * u, centre[2] + radius * t * Math.sin(phi)]
      const depth = -p[2]
      const sx = (lens.focalX * p[0] / depth + 1) * 0.5 * W, sy = (1 - lens.focalY * p[1] / depth) * 0.5 * H
      assert.ok(sx >= out.minX - 1e-9 && sx <= out.maxX + 1e-9 && sy >= out.minY - 1e-9 && sy <= out.maxY + 1e-9, 'a sphere point projects outside the rectangle')
      assert.ok(depth >= out.nearestDepth - 1e-9, 'a sphere point is nearer than the rectangle depth')
    }
  }
  assert.equal(projectViewSphereRect(lens, [0, 0, -1], 1, W, H, out), false)
})

gate('a sphere behind a wall is occluded and the same sphere in front of it is not, end to end through the projection', () => {
  const lens = { focalX: 1, focalY: 1.5, near: 0.1 }
  const pyramid = createHizPyramid(W, H)
  pyramid.build(new Float32Array(W * H).fill(20))
  const out = {}
  projectViewSphereRect(lens, [1, 0.5, -30], 2, W, H, out)
  assert.equal(pyramid.isOccluded(out.minX, out.minY, out.maxX, out.maxY, out.nearestDepth), true)
  projectViewSphereRect(lens, [1, 0.5, -10], 2, W, H, out)
  assert.equal(pyramid.isOccluded(out.minX, out.minY, out.maxX, out.maxY, out.nearestDepth), false)
})

gate('octahedral encode and decode round trip 2000 seeded directions within 1e-12, over the full sphere and the upper hemisphere', () => {
  const random = mulberry(21)
  for (let i = 0; i < 2000; i++) {
    const u = random() * 2 - 1, phi = random() * 2 * Math.PI, t = Math.sqrt(1 - u * u)
    const dir = [t * Math.cos(phi), u, t * Math.sin(phi)]
    const uv = octEncode(dir)
    assert.ok(uv[0] >= 0 && uv[0] <= 1 && uv[1] >= 0 && uv[1] <= 1, 'uv outside the unit square')
    const back = octDecode(uv)
    assert.ok(Math.hypot(back[0] - dir[0], back[1] - dir[1], back[2] - dir[2]) < 1e-12, 'full sphere round trip')
    const up = [dir[0], Math.abs(dir[1]), dir[2]]
    const hemiUv = hemiOctEncode(up)
    assert.ok(hemiUv[0] >= -1e-15 && hemiUv[0] <= 1 + 1e-15 && hemiUv[1] >= -1e-15 && hemiUv[1] <= 1 + 1e-15, 'hemisphere uv outside the unit square')
    const hemiBack = hemiOctDecode(hemiUv)
    assert.ok(Math.hypot(hemiBack[0] - up[0], hemiBack[1] - up[1], hemiBack[2] - up[2]) < 1e-12, 'hemisphere round trip')
  }
})

gate('the poles and the horizon land where the layout says: up is the centre of both maps and down is a corner of the full map', () => {
  assert.deepEqual(octEncode([0, 1, 0]), [0.5, 0.5])
  assert.deepEqual(hemiOctEncode([0, 1, 0]), [0.5, 0.5])
  const down = octEncode([0, -1, 0])
  assert.ok((down[0] === 0 || down[0] === 1) && (down[1] === 0 || down[1] === 1), 'down at ' + down)
  assert.deepEqual(hemiOctEncode([1, 0, 0]), [1, 0])
  assert.throws(() => hemiOctEncode([0, -1, 0]), ImpostorError)
  assert.throws(() => octEncode([0, 0, 0]), ImpostorError)
})

gate('an 8 by 8 hemisphere grid of 64 by 64 frames is a 512 by 512 atlas whose frame directions are unit, upward and distinct', () => {
  const grid = createImpostorGrid({ framesPerAxis: 8, frameSize: 64 })
  assert.deepEqual([grid.frameCount, grid.atlasWidth, grid.atlasHeight], [64, 512, 512])
  const seen = new Set()
  for (let f = 0; f < 64; f++) {
    const d = grid.frameDirection(f)
    assert.ok(Math.abs(Math.hypot(d[0], d[1], d[2]) - 1) < 1e-12 && d[1] >= -1e-12, 'frame ' + f + ' direction ' + d)
    seen.add(d.map((c) => c.toFixed(9)).join(','))
  }
  assert.equal(seen.size, 64)
  assert.deepEqual(grid.frameRect(9), [1 / 8, 1 / 8, 1 / 8, 1 / 8])
})

gate('a view direction that is exactly a frame direction samples a frame with that direction at weight 1 (the full map repeats the down pole on its corners)', () => {
  for (const hemisphere of [true, false]) {
    const grid = createImpostorGrid({ framesPerAxis: 6, frameSize: 32, hemisphere })
    const sample = grid.createSample()
    for (let f = 0; f < grid.frameCount; f++) {
      grid.sample(grid.frameDirection(f), sample)
      const heaviest = grid.frameDirection(sample.nearest)
      const own = grid.frameDirection(f)
      assert.ok(heaviest[0] * own[0] + heaviest[1] * own[1] + heaviest[2] * own[2] > 1 - 1e-9, 'frame ' + f + ' sampled frame ' + sample.nearest + ', which looks another way')
      assert.ok(Math.abs(Math.max(...sample.weights) - 1) < 1e-9, 'frame ' + f + ' weight ' + Math.max(...sample.weights))
    }
  }
})

gate('over 2000 seeded views the four weights sum to 1, the four frames are a 2 by 2 block, and the heaviest frame is among the 4 nearest by angle', () => {
  const grid = createImpostorGrid({ framesPerAxis: 8, frameSize: 64 })
  const sample = grid.createSample()
  const random = mulberry(33)
  for (let i = 0; i < 2000; i++) {
    const u = random(), phi = random() * 2 * Math.PI, t = Math.sqrt(1 - u * u)
    const dir = [t * Math.cos(phi), u, t * Math.sin(phi)]
    grid.sample(dir, sample)
    assert.ok(Math.abs(sample.weights[0] + sample.weights[1] + sample.weights[2] + sample.weights[3] - 1) < 1e-12, 'weights do not sum to 1')
    assert.deepEqual([sample.frames[1] - sample.frames[0], sample.frames[2] - sample.frames[0], sample.frames[3] - sample.frames[0]], [1, 8, 9])
    const ranked = Array.from({ length: 64 }, (_, f) => f).sort((a, b) => {
      const da = grid.frameDirection(a), db = grid.frameDirection(b)
      return (db[0] * dir[0] + db[1] * dir[1] + db[2] * dir[2]) - (da[0] * dir[0] + da[1] * dir[1] + da[2] * dir[2])
    })
    assert.ok(ranked.slice(0, 4).includes(sample.nearest), 'view ' + i + ': heaviest frame ' + sample.nearest + ' is not among the 4 nearest ' + ranked.slice(0, 4))
  }
})

gate('a view from below a hemisphere impostor is clamped to the horizon, and a grid of one frame per axis is refused', () => {
  const grid = createImpostorGrid({ framesPerAxis: 8, frameSize: 64 })
  const below = grid.createSample(), level = grid.createSample()
  grid.sample([0.6, -0.8, 0], below)
  grid.sample([1, 0, 0], level)
  assert.deepEqual([...below.frames], [...level.frames])
  assert.deepEqual([...below.weights], [...level.weights])
  assert.throws(() => createImpostorGrid({ framesPerAxis: 1, frameSize: 64 }), ImpostorError)
})

gate('the four modules read no host clock, network, DOM or random source and carry no comment', () => {
  for (const name of ['model-pool.js', 'cluster-lod-select.js', 'hiz-pyramid.js', 'octahedral-impostor.js']) {
    const source = readFileSync(new URL('../src/packages/streaming-gltf/' + name, import.meta.url), 'utf8')
    assert.equal(source.includes('//') || source.includes('/*'), false, name + ' has a comment')
    for (const host of ['Date', 'performance', 'process', 'console', 'globalThis', 'Math.random', 'fetch(', 'document', 'window', 'navigator', 'setTimeout']) assert.equal(source.includes(host), false, name + ' reads ' + host)
  }
})

finish()
