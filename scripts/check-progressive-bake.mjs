import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gate, finish } from './lib/gate.mjs'
import { planProgressiveBake, writeProgressiveBake, decodeLodPayload, encodeLodPayload, decimateToRatio, BAKE_REFUSAL, DEFAULT_BAKE_RATIOS, ProgressiveBakeError } from '../src/packages/streaming-gltf/progressive-bake.js'
import { createSchemaValidator, PROGRESSIVE_LOD_SCHEMA_NAMES } from '../src/packages/streaming-gltf/progressive-lod-schema.js'
import { readModelContainer, readProgressiveLod, planLodLoads, createModelPool, PROGRESSIVE_LOD_KEY } from '../src/packages/streaming-gltf/model-pool.js'
import { resolveWithinRoot } from '../src/sandbox/paths.js'

const schemaDir = new URL('../src/packages/streaming-gltf/schema/', import.meta.url)
const validator = createSchemaValidator(Object.fromEntries(PROGRESSIVE_LOD_SCHEMA_NAMES.map((name) => [name, JSON.parse(readFileSync(new URL(name, schemaDir), 'utf8'))])))

const sphere = (rings, segments, radius = 1, offset = 0) => {
  const positions = []
  const indices = []
  for (let r = 0; r <= rings; r++) {
    const phi = (r / rings) * Math.PI
    for (let s = 0; s <= segments; s++) {
      const theta = (s / segments) * 2 * Math.PI
      positions.push(offset + radius * Math.sin(phi) * Math.cos(theta), radius * Math.cos(phi), radius * Math.sin(phi) * Math.sin(theta))
    }
  }
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segments; s++) {
      const a = r * (segments + 1) + s
      const b = a + segments + 1
      indices.push(a, b, a + 1, a + 1, b, b + 1)
    }
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) }
}
const ball = sphere(48, 64)
const code = (fn) => {
  try {
    fn()
  } catch (error) {
    return error.code ?? error.constructor.name
  }
  return null
}
const memoryIo = () => {
  const files = new Map()
  const dirs = []
  return { files, dirs, writeFile: (path, bytes) => files.set(path, bytes), mkdir: (path) => dirs.push(path) }
}
const contained = (root, candidate) => (candidate.includes('..') || candidate.startsWith('/') ? null : root + '/' + candidate)

gate('a bake emits a root GLB with the coarsest mesh inline and one sibling file per finer level', () => {
  const plan = planProgressiveBake({ name: 'ball', meshes: [ball] })
  assert.deepEqual(plan.files.map((f) => f.path), ['ball.glb', 'ball.m0.lod1.bin', 'ball.m0.lod2.bin'])
  const lods = plan.record.meshes[0].lods
  assert.deepEqual(lods.map((l) => l.ratio), [...DEFAULT_BAKE_RATIOS])
  assert.deepEqual(lods.map((l) => l.inline === true), [true, false, false])
  assert.deepEqual(lods.map((l) => l.path ?? null), [null, 'ball.m0.lod1.bin', 'ball.m0.lod2.bin'])
  const triangles = lods.map((l) => l.indexCount / 3)
  assert.ok(triangles[0] < triangles[1] && triangles[1] < triangles[2], triangles.join(' '))
  assert.equal(triangles[2], ball.indices.length / 3)
  assert.ok(triangles[0] <= Math.floor(ball.indices.length / 3 * 0.05) && triangles[1] <= Math.floor(ball.indices.length / 3 * 0.25))
  assert.equal(lods[1].bytes, plan.files[1].bytes.length)
})

gate('the record passes the EP_progressive_lod schema and the model pool reader accepts the root file', () => {
  const plan = planProgressiveBake({ name: 'ball', meshes: [ball, sphere(8, 8, 2, 5)] })
  assert.deepEqual(validator.validate(plan.record), { ok: true, errors: [] })
  const container = readModelContainer(plan.root.bytes)
  assert.equal(container.glb, true)
  assert.deepEqual(container.json.extensionsUsed, [PROGRESSIVE_LOD_KEY])
  const record = readProgressiveLod(container.json, validator)
  assert.equal(record.source, 'extension')
  assert.equal(record.meshes.length, 2)
  const loads = planLodLoads(record, { rootUrl: 'https://cdn.example/assets/ball.glb', json: container.json, binOffset: container.binOffset })
  assert.equal(loads.steps.filter((s) => s.inline).length, 2)
  assert.ok(loads.steps.some((s) => s.url === 'https://cdn.example/assets/ball.m0.lod1.bin'))
  const broken = { ...plan.record, storage: 'elsewhere' }
  assert.equal(validator.validate(broken).ok, false, 'negative control: the schema refuses an unknown storage')
})

gate('the inline level is real glTF geometry: accessors index the BIN chunk and reproduce the coarse mesh', () => {
  const plan = planProgressiveBake({ name: 'ball', meshes: [ball] })
  const { json, binOffset } = readModelContainer(plan.root.bytes)
  const primitive = json.meshes[0].primitives[0]
  const positionAccessor = json.accessors[primitive.attributes.POSITION]
  const indexAccessor = json.accessors[primitive.indices]
  const view = (accessor) => json.bufferViews[accessor.bufferView]
  const bytes = plan.root.bytes
  const positions = new Float32Array(bytes.buffer.slice(bytes.byteOffset + binOffset + view(positionAccessor).byteOffset, bytes.byteOffset + binOffset + view(positionAccessor).byteOffset + view(positionAccessor).byteLength))
  const indices = new Uint32Array(bytes.buffer.slice(bytes.byteOffset + binOffset + view(indexAccessor).byteOffset, bytes.byteOffset + binOffset + view(indexAccessor).byteOffset + view(indexAccessor).byteLength))
  const coarse = decimateToRatio(ball.positions, ball.indices, DEFAULT_BAKE_RATIOS[0])
  assert.deepEqual(Array.from(positions), Array.from(coarse.positions))
  assert.deepEqual(Array.from(indices), Array.from(coarse.indices))
  assert.equal(positionAccessor.count, plan.record.meshes[0].lods[0].vertexCount)
  assert.equal(new DataView(bytes.buffer, bytes.byteOffset).getUint32(8, true), bytes.length)
  for (let i = 0; i < positions.length; i++) assert.ok(positions[i] >= positionAccessor.min[i % 3] && positions[i] <= positionAccessor.max[i % 3])
})

gate('a sibling payload decodes against its decodeAABB to the decimated mesh within one quantization step', () => {
  const plan = planProgressiveBake({ name: 'ball', meshes: [ball] })
  for (const level of [1, 2]) {
    const lod = plan.record.meshes[0].lods[level]
    const decoded = decodeLodPayload(plan.files[level].bytes, lod.decodeAABB)
    const want = decimateToRatio(ball.positions, ball.indices, lod.ratio)
    assert.deepEqual(Array.from(decoded.indices), Array.from(want.indices))
    assert.equal(decoded.positions.length, want.positions.length)
    let worst = 0
    for (let i = 0; i < want.positions.length; i++) worst = Math.max(worst, Math.abs(decoded.positions[i] - want.positions[i]))
    assert.ok(worst <= 2 / 65535 + 1e-7, `level ${level} worst ${worst}`)
  }
  const fine = plan.record.meshes[0].lods[2]
  assert.equal(code(() => decodeLodPayload(plan.files[2].bytes.subarray(0, 40), fine.decodeAABB)), BAKE_REFUSAL.PAYLOAD)
  assert.equal(code(() => decodeLodPayload(new Uint8Array(32), fine.decodeAABB)), BAKE_REFUSAL.PAYLOAD)
  assert.equal(code(() => decodeLodPayload(plan.files[2].bytes)), BAKE_REFUSAL.PAYLOAD)
  const wide = encodeLodPayload(new Float32Array(70000 * 3), Uint32Array.of(0, 69999, 1), { min: [0, 0, 0], max: [1, 1, 1] })
  assert.deepEqual(Array.from(decodeLodPayload(wide, { min: [0, 0, 0], max: [1, 1, 1] }).indices), [0, 69999, 1])
})

gate('the write goes through the injected io and the contained-path check, siblings first and the root last', () => {
  const io = memoryIo()
  const out = writeProgressiveBake({ name: 'ball', meshes: [ball], outDir: '/bake/out', io, containedPath: contained })
  assert.deepEqual(io.dirs, ['/bake/out'])
  assert.deepEqual([...io.files.keys()], ['/bake/out/ball.m0.lod1.bin', '/bake/out/ball.m0.lod2.bin', '/bake/out/ball.glb'])
  assert.equal(out.root, '/bake/out/ball.glb')
  assert.deepEqual(out.written.map((w) => w.path), ['ball.glb', 'ball.m0.lod1.bin', 'ball.m0.lod2.bin'])
  assert.equal(out.written.reduce((n, w) => n + w.bytes, 0), [...io.files.values()].reduce((n, b) => n + b.length, 0))
})

gate('a path the containment check refuses stops the bake before any byte is written', () => {
  const io = memoryIo()
  const refusing = (root, candidate) => (candidate.endsWith('lod2.bin') ? null : root + '/' + candidate)
  assert.equal(code(() => writeProgressiveBake({ name: 'ball', meshes: [ball], outDir: '/bake/out', io, containedPath: refusing })), BAKE_REFUSAL.PATH)
  assert.equal(io.files.size, 0)
  assert.deepEqual(io.dirs, [])
  for (const name of ['../ball', 'a/b', '', '.hidden', 'a b', null]) assert.equal(code(() => planProgressiveBake({ name, meshes: [ball] })), BAKE_REFUSAL.NAME, String(name))
  assert.equal(resolveWithinRoot('/bake/out', '../ball.glb'), null, 'the real contained-path check refuses a climbing path')
})

gate('bad meshes, ratios and options are refused with their code', () => {
  const tri = { positions: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0) }
  assert.equal(planProgressiveBake({ name: 't', meshes: [tri] }).record.meshes[0].lods.length, 1, 'a mesh too small to decimate keeps one inline level')
  assert.equal(code(() => planProgressiveBake({ name: 't', meshes: [] })), BAKE_REFUSAL.MESH)
  assert.equal(code(() => planProgressiveBake({ name: 't', meshes: [{ positions: Float32Array.of(0, 0) }] })), BAKE_REFUSAL.MESH)
  assert.equal(code(() => planProgressiveBake({ name: 't', meshes: [{ positions: Float32Array.of(0, 0, NaN) }] })), BAKE_REFUSAL.MESH)
  assert.equal(code(() => planProgressiveBake({ name: 't', meshes: [{ ...tri, indices: Uint32Array.of(0, 1, 5) }] })), BAKE_REFUSAL.MESH)
  assert.equal(code(() => planProgressiveBake({ name: 't', meshes: [{ ...tri, indices: Uint32Array.of(0, 1) }] })), BAKE_REFUSAL.MESH)
  assert.equal(code(() => planProgressiveBake({ name: 't', meshes: [tri], ratios: [0.5, 0.2] })), BAKE_REFUSAL.RATIOS)
  assert.equal(code(() => planProgressiveBake({ name: 't', meshes: [tri], ratios: [0, 1] })), BAKE_REFUSAL.RATIOS)
  assert.equal(code(() => planProgressiveBake({ name: 't', meshes: [tri], ratios: [] })), BAKE_REFUSAL.RATIOS)
  assert.equal(code(() => writeProgressiveBake({ name: 't', meshes: [tri], outDir: '/x', containedPath: contained })), BAKE_REFUSAL.OPTION)
  assert.equal(code(() => writeProgressiveBake({ name: 't', meshes: [tri], outDir: '/x', io: memoryIo() })), BAKE_REFUSAL.OPTION)
  assert.equal(code(() => writeProgressiveBake({ name: 't', meshes: [tri], io: memoryIo(), containedPath: contained })), BAKE_REFUSAL.OPTION)
  assert.ok(new ProgressiveBakeError('a', 'b') instanceof Error)
})

gate('baked to a real directory, the model pool loads the root and refines through every level from the files on disk', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jz-bake-'))
  try {
    const out = writeProgressiveBake({
      name: 'ball',
      meshes: [ball],
      outDir: join(dir, 'assets'),
      io: { writeFile: (path, bytes) => writeFileSync(path, bytes), mkdir: (path) => mkdirSync(path, { recursive: true }) },
      containedPath: resolveWithinRoot,
    })
    assert.deepEqual(readdirSync(join(dir, 'assets')).sort(), ['ball.glb', 'ball.m0.lod1.bin', 'ball.m0.lod2.bin'])
    const fetched = []
    const pool = createModelPool({
      validator,
      fetchBytes: async (url) => {
        fetched.push(url.slice(url.lastIndexOf('/') + 1))
        return new Uint8Array(readFileSync(url))
      },
    })
    const model = await pool.acquire(out.root)
    assert.equal(model.level, 0)
    assert.equal(model.levels, 3)
    const first = await pool.refine(out.root)
    const second = await pool.refine(out.root)
    assert.equal(second.complete, true)
    assert.deepEqual(fetched, ['ball.glb', 'ball.m0.lod1.bin', 'ball.m0.lod2.bin'])
    const lods = model.record.meshes[0].lods
    const mid = decodeLodPayload(first.steps[0].data, lods[1].decodeAABB)
    const full = decodeLodPayload(second.steps[0].data, lods[2].decodeAABB)
    assert.equal(mid.indices.length, lods[1].indexCount)
    assert.equal(full.indices.length, ball.indices.length)
    assert.equal(await pool.refine(out.root), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

finish()
