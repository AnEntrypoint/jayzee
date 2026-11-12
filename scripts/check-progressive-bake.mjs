import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MeshoptSimplifier } from 'meshoptimizer'
import { gate, finish } from './lib/gate.mjs'
import { createSchemaValidator, PROGRESSIVE_LOD_SCHEMA_NAMES } from '../src/packages/streaming-gltf/progressive-lod-schema.js'
import { planLodLoads, readModelContainer, readProgressiveLod } from '../src/packages/streaming-gltf/model-pool.js'
import { BAKE_REFUSAL, DEFAULT_LOD_RATIOS, bakeProgressiveLod, boundsOf, compactMesh, createMeshoptSimplify, decodeLodFile, encodeLodFile, isContainedPath, resolveBakedFile, writeBake } from '../src/static/progressiveBake.js'

await MeshoptSimplifier.ready
const simplify = createMeshoptSimplify(MeshoptSimplifier)
const schemaDir = fileURLToPath(new URL('../src/packages/streaming-gltf/schema/', import.meta.url))
const validator = createSchemaValidator(Object.fromEntries(PROGRESSIVE_LOD_SCHEMA_NAMES.map((name) => [name, JSON.parse(readFileSync(join(schemaDir, name), 'utf8'))])))

const gridMesh = (cells, size) => {
  const side = cells + 1
  const positions = new Float32Array(side * side * 3)
  for (let z = 0; z < side; z++) {
    for (let x = 0; x < side; x++) {
      const o = (z * side + x) * 3
      positions[o] = (x / cells) * size
      positions[o + 1] = Math.sin(x * 0.4) * Math.cos(z * 0.3) * 0.5
      positions[o + 2] = (z / cells) * size
    }
  }
  const indices = new Uint32Array(cells * cells * 6)
  let w = 0
  for (let z = 0; z < cells; z++) {
    for (let x = 0; x < cells; x++) {
      const a = z * side + x
      indices.set([a, a + side, a + 1, a + 1, a + side, a + side + 1], w)
      w += 6
    }
  }
  return { positions, indices }
}

const buildGlb = (meshes) => {
  const chunks = []
  let offset = 0
  const bufferViews = []
  const accessors = []
  const push = (bytes) => {
    const padded = (bytes.length + 3) & ~3
    const chunk = new Uint8Array(padded)
    chunk.set(bytes)
    chunks.push(chunk)
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length })
    offset += padded
    return bufferViews.length - 1
  }
  const gltfMeshes = meshes.map((mesh, m) => {
    const attributes = {}
    const bounds = boundsOf(mesh.positions)
    accessors.push({ bufferView: push(new Uint8Array(mesh.positions.buffer.slice(0))), componentType: 5126, count: mesh.positions.length / 3, type: 'VEC3', min: bounds.min, max: bounds.max })
    attributes.POSITION = accessors.length - 1
    if (mesh.uv) {
      accessors.push({ bufferView: push(new Uint8Array(new Float32Array((mesh.positions.length / 3) * 2).buffer)), componentType: 5126, count: mesh.positions.length / 3, type: 'VEC2' })
      attributes.TEXCOORD_0 = accessors.length - 1
    }
    const primitive = { attributes }
    if (mesh.mode !== undefined) primitive.mode = mesh.mode
    if (mesh.indices) {
      const narrow = mesh.positions.length / 3 <= 0x10000 && !mesh.wide
      const data = narrow ? Uint16Array.from(mesh.indices) : mesh.indices
      accessors.push({ bufferView: push(new Uint8Array(data.buffer.slice(0))), componentType: narrow ? 5123 : 5125, count: mesh.indices.length, type: 'SCALAR' })
      primitive.indices = accessors.length - 1
    }
    return { name: 'mesh' + m, primitives: [primitive] }
  })
  const json = { asset: { version: '2.0' }, buffers: [{ byteLength: offset }], bufferViews, accessors, meshes: gltfMeshes, nodes: gltfMeshes.map((_, m) => ({ mesh: m })), scenes: [{ nodes: gltfMeshes.map((_, m) => m) }], scene: 0 }
  const text = new TextEncoder().encode(JSON.stringify(json))
  const jsonPadded = (text.length + 3) & ~3
  const out = new Uint8Array(12 + 8 + jsonPadded + 8 + offset)
  const view = new DataView(out.buffer)
  view.setUint32(0, 0x46546c67, true)
  view.setUint32(4, 2, true)
  view.setUint32(8, out.length, true)
  view.setUint32(12, jsonPadded, true)
  view.setUint32(16, 0x4e4f534a, true)
  out.fill(0x20, 20, 20 + jsonPadded)
  out.set(text, 20)
  view.setUint32(20 + jsonPadded, offset, true)
  view.setUint32(24 + jsonPadded, 0x004e4942, true)
  let at = 28 + jsonPadded
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}

const TERRAIN = gridMesh(40, 20)
const SMALL = gridMesh(6, 3)
const SOURCE = buildGlb([{ ...TERRAIN }, { ...SMALL, uv: true }])
const bake = (overrides = {}) => bakeProgressiveLod({ glb: SOURCE, baseName: 'terrain', simplify, ...overrides })
const codeOf = (fn) => {
  try {
    fn()
  } catch (error) {
    return error.code
  }
  return null
}

gate('the bake of a 3200-triangle mesh writes one inline source level and three smaller sibling files in ratio order', () => {
  const { extension, files } = bake()
  const lods = extension.meshes[0].lods
  assert.deepEqual(lods.map((lod) => lod.ratio), [1, 0.5, 0.25, 0.125])
  assert.equal(lods[0].inline, true)
  assert.equal(lods[0].indexCount, 9600)
  assert.equal(lods[0].vertexCount, 41 * 41)
  for (const lod of lods.slice(1)) {
    assert.equal(lod.inline, false)
    assert.equal(files.has(lod.path), true)
    assert.equal(files.get(lod.path).length, lod.bytes)
  }
  assert.deepEqual(lods.slice(1).map((lod) => lod.path), ['terrain.m0p0.r0500.lod', 'terrain.m0p0.r0250.lod', 'terrain.m0p0.r0125.lod'])
})

gate('each level holds at most its ratio of the source triangles, within one percent, and fewer than the level before it', () => {
  const lods = bake().extension.meshes[0].lods
  for (let level = 1; level < lods.length; level++) {
    const cap = 9600 * lods[level].ratio * 1.01
    assert.ok(lods[level].indexCount <= cap, 'ratio ' + lods[level].ratio + ' holds ' + lods[level].indexCount + ' indices, above ' + cap)
    assert.ok(lods[level].indexCount >= 9600 * lods[level].ratio * 0.5, 'ratio ' + lods[level].ratio + ' fell to ' + lods[level].indexCount + ' indices')
    assert.ok(lods[level].indexCount < lods[level - 1].indexCount)
    assert.ok(lods[level].vertexCount < lods[level - 1].vertexCount)
  }
})

gate('negative control: a simplifier that returns its input writes no smaller level, so the ratio check has something to fail on', () => {
  const lazy = bake({ simplify: (indices) => indices })
  assert.deepEqual(lazy.extension.meshes[0].lods.map((lod) => lod.ratio), [1])
  assert.equal(lazy.files.size, 0)
})

gate('every sibling file decodes to the counts in its entry, with every index inside its vertices and its box inside the source box', () => {
  const { extension, files } = bake()
  const source = boundsOf(TERRAIN.positions)
  for (const lod of extension.meshes[0].lods.slice(1)) {
    const decoded = decodeLodFile(files.get(lod.path))
    assert.equal(decoded.indexCount, lod.indexCount)
    assert.equal(decoded.vertexCount, lod.vertexCount)
    assert.ok(decoded.indices.every((index) => index < decoded.vertexCount))
    assert.deepEqual(boundsOf(decoded.positions), lod.decodeAABB)
    for (let k = 0; k < 3; k++) {
      assert.ok(lod.decodeAABB.min[k] >= source.min[k] - 1e-6 && lod.decodeAABB.max[k] <= source.max[k] + 1e-6)
    }
  }
})

gate('every vertex of a reduced level is a vertex of the source mesh, so the reduction moves nothing', () => {
  const { extension, files } = bake()
  const known = new Set()
  for (let i = 0; i < TERRAIN.positions.length; i += 3) known.add(TERRAIN.positions[i] + ',' + TERRAIN.positions[i + 1] + ',' + TERRAIN.positions[i + 2])
  const decoded = decodeLodFile(files.get(extension.meshes[0].lods.at(-1).path))
  for (let i = 0; i < decoded.positions.length; i += 3) {
    assert.equal(known.has(decoded.positions[i] + ',' + decoded.positions[i + 1] + ',' + decoded.positions[i + 2]), true)
  }
})

gate('the written extension passes the EP_progressive_lod schemas, and a textured primitive is marked textured', () => {
  const { extension } = bake()
  const checked = validator.validate(extension)
  assert.deepEqual(checked.errors ?? [], [])
  assert.equal(checked.ok, true)
  assert.equal(extension.meshes[0].lods[0].kind, 'unskinned')
  assert.equal(extension.meshes[1].lods[0].kind, 'textured')
  assert.deepEqual([extension.version, extension.storage], [1, 'sibling-file'])
})

gate('the baked GLB carries the extension, keeps its binary chunk byte for byte, and the model pool reader plans one fetch per sibling file', () => {
  const baked = bake()
  const before = readModelContainer(SOURCE)
  const after = readModelContainer(baked.glb)
  assert.deepEqual(after.json.extensionsUsed, ['EP_progressive_lod'])
  assert.deepEqual(Buffer.from(baked.glb.subarray(after.binOffset)), Buffer.from(SOURCE.subarray(before.binOffset)))
  assert.equal(new DataView(baked.glb.buffer).getUint32(8, true), baked.glb.length)
  const record = readProgressiveLod(after.json, validator)
  assert.equal(record.source, 'extension')
  assert.deepEqual(record.meshes[0].lods.map((lod) => lod.ratio), [0.125, 0.25, 0.5, 1])
  const plan = planLodLoads(record, { rootUrl: 'https://host.test/models/terrain.glb', json: after.json, binOffset: after.binOffset })
  assert.equal(plan.fetches, baked.files.size)
  const urls = plan.steps.filter((step) => !step.inline).map((step) => step.url)
  assert.equal(urls.every((url) => url.startsWith('https://host.test/models/terrain.m')), true)
  assert.equal(plan.steps[0].ratio, 0.125)
})

gate('two bakes of the same source give the same files byte for byte', () => {
  const first = bake()
  const second = bake()
  assert.deepEqual([...first.files.keys()], [...second.files.keys()])
  for (const [path, bytes] of first.files) assert.deepEqual(Buffer.from(bytes), Buffer.from(second.files.get(path)))
  assert.deepEqual(Buffer.from(first.glb), Buffer.from(second.glb))
})

gate('a primitive that is not a triangle list is skipped with a reason, and a mesh with no index list is baked from its vertex order', () => {
  const soup = new Float32Array(TERRAIN.indices.length * 3)
  for (let i = 0; i < TERRAIN.indices.length; i++) soup.set(TERRAIN.positions.subarray(TERRAIN.indices[i] * 3, TERRAIN.indices[i] * 3 + 3), i * 3)
  const glb = buildGlb([{ positions: SMALL.positions, indices: SMALL.indices, mode: 1 }, { positions: soup }])
  const baked = bakeProgressiveLod({ glb, baseName: 'soup', simplify })
  assert.deepEqual(baked.skipped, [{ meshIndex: 0, primIndex: 0, reason: 'not-a-triangle-list' }])
  assert.deepEqual(baked.extension.meshes.map((mesh) => mesh.meshIndex), [1])
  assert.equal(baked.extension.meshes[0].lods[0].indexCount, 9600)
})

gate('a mesh too small to reduce keeps only its source level', () => {
  const tiny = buildGlb([{ positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 0, 1]), indices: Uint32Array.from([0, 2, 1]) }])
  const baked = bakeProgressiveLod({ glb: tiny, baseName: 'tiny', simplify })
  assert.deepEqual(baked.extension.meshes[0].lods.map((lod) => lod.ratio), [1])
  assert.equal(baked.files.size, 0)
})

gate('a LOD file round trips with 16-bit indices, and with 32-bit indices past 65536 vertices', () => {
  const small = compactMesh(SMALL.positions, SMALL.indices)
  const back = decodeLodFile(encodeLodFile(small))
  assert.deepEqual(back.positions, small.positions)
  assert.deepEqual(back.indices, small.indices)
  const wide = { positions: new Float32Array(70000 * 3), indices: Uint32Array.from([0, 69999, 35000]) }
  const wideBytes = encodeLodFile(wide)
  assert.equal(new DataView(wideBytes.buffer).getUint32(16, true), 4)
  assert.deepEqual(decodeLodFile(wideBytes).indices, wide.indices)
})

gate('a LOD file with a wrong magic, a cut tail, an index past its vertices or a bad width is refused', () => {
  const good = encodeLodFile(compactMesh(SMALL.positions, SMALL.indices))
  const withByte = (at, value) => { const copy = good.slice(); copy[at] = value; return copy }
  assert.equal(codeOf(() => decodeLodFile(withByte(0, 0))), BAKE_REFUSAL.LOD_FILE)
  assert.equal(codeOf(() => decodeLodFile(good.subarray(0, good.length - 4))), BAKE_REFUSAL.LOD_FILE)
  assert.equal(codeOf(() => decodeLodFile(withByte(16, 3))), BAKE_REFUSAL.LOD_FILE)
  const high = good.slice()
  new DataView(high.buffer).setUint16(20 + compactMesh(SMALL.positions, SMALL.indices).positions.byteLength, 60000, true)
  assert.equal(codeOf(() => decodeLodFile(high)), BAKE_REFUSAL.LOD_FILE)
  assert.equal(codeOf(() => decodeLodFile(good)), null)
})

gate('the bake refuses a source that is not a GLB, a base name with a path, ratios without 1, a repeated or zero ratio, a missing simplifier and a Draco primitive', () => {
  assert.equal(codeOf(() => bake({ glb: new Uint8Array(64) })), BAKE_REFUSAL.INPUT)
  assert.equal(codeOf(() => bake({ glb: 'terrain.glb' })), BAKE_REFUSAL.INPUT)
  for (const baseName of ['../terrain', 'a/b', 'Terrain', '', '.hidden']) assert.equal(codeOf(() => bake({ baseName })), BAKE_REFUSAL.NAME)
  assert.equal(codeOf(() => bake({ ratios: [0.5, 0.25] })), BAKE_REFUSAL.RATIOS)
  assert.equal(codeOf(() => bake({ ratios: [1, 0.5, 0.5] })), BAKE_REFUSAL.RATIOS)
  assert.equal(codeOf(() => bake({ ratios: [1, 0] })), BAKE_REFUSAL.RATIOS)
  assert.equal(codeOf(() => bake({ ratios: [] })), BAKE_REFUSAL.RATIOS)
  assert.equal(codeOf(() => bake({ simplify: null })), BAKE_REFUSAL.SIMPLIFY)
  assert.equal(codeOf(() => bake({ simplify: () => [1, 2, 3] })), BAKE_REFUSAL.SIMPLIFY)
  const draco = readModelContainer(SOURCE)
  draco.json.meshes[0].primitives[0].extensions = { KHR_draco_mesh_compression: {} }
  const text = new TextEncoder().encode(JSON.stringify(draco.json))
  const padded = (text.length + 3) & ~3
  const rest = SOURCE.subarray(draco.binOffset - 8)
  const glb = new Uint8Array(20 + padded + rest.length)
  glb.set(SOURCE.subarray(0, 20))
  glb.fill(0x20, 20, 20 + padded)
  glb.set(text, 20)
  glb.set(rest, 20 + padded)
  new DataView(glb.buffer).setUint32(12, padded, true)
  assert.equal(codeOf(() => bake({ glb })), BAKE_REFUSAL.DRACO)
  assert.deepEqual([...DEFAULT_LOD_RATIOS], [1, 0.5, 0.25, 0.125])
})

gate('the bake writes its files under the served root, and each one resolves and reads back as written', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jz-progressive-bake-'))
  try {
    const baked = bake()
    const written = await writeBake({ root, dir: 'cache/lod', result: baked, fs: { mkdir, writeFile } })
    assert.equal(written.length, baked.files.size)
    for (const [path, bytes] of baked.files) {
      const resolved = await resolveBakedFile(root, 'cache/lod/' + path, { realpath })
      assert.equal(resolved, join(await realpath(root), 'cache', 'lod', path))
      assert.deepEqual(Buffer.from(await readFile(resolved)), Buffer.from(bytes))
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

gate('a baked path with dot-dot, an absolute path outside the root, a missing file and a symlink that leaves the root are all refused', async () => {
  const base = await mkdtemp(join(tmpdir(), 'jz-progressive-bake-'))
  try {
    const root = join(base, 'served')
    await mkdir(join(root, 'cache'), { recursive: true })
    await writeFile(join(base, 'secret.txt'), 'outside')
    await writeFile(join(root, 'cache', 'inside.lod'), 'inside')
    await symlink(join(base, 'secret.txt'), join(root, 'cache', 'leak.lod'))
    await symlink(join(root, 'cache', 'inside.lod'), join(root, 'cache', 'alias.lod'))
    assert.equal(await resolveBakedFile(root, '../secret.txt', { realpath }), null)
    assert.equal(await resolveBakedFile(root, 'cache/../../secret.txt', { realpath }), null)
    assert.equal(await resolveBakedFile(root, join(base, 'secret.txt'), { realpath }), null)
    assert.equal(await resolveBakedFile(root, 'cache/absent.lod', { realpath }), null)
    assert.equal(await resolveBakedFile(root, 'cache/leak.lod', { realpath }), null)
    assert.equal(await resolveBakedFile(root, '', { realpath }), null)
    assert.equal(await resolveBakedFile(root, 'cache/alias.lod', { realpath }), join(await realpath(root), 'cache', 'inside.lod'))
    assert.equal(isContainedPath(root, 'cache/leak.lod'), true)
    assert.equal(isContainedPath(root, '../secret.txt'), false)
    const escaping = { files: new Map([['../../out.lod', new Uint8Array(4)]]) }
    await assert.rejects(writeBake({ root, dir: 'cache', result: escaping, fs: { mkdir, writeFile } }), (error) => error.code === BAKE_REFUSAL.PATH)
    await assert.rejects(writeBake({ root, dir: '../elsewhere', result: escaping, fs: { mkdir, writeFile } }), (error) => error.code === BAKE_REFUSAL.PATH)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

finish()
