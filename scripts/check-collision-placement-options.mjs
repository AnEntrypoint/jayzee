import assert from 'node:assert/strict'
import { finish, gate } from './lib/gate.mjs'
import { createEngineWorld } from '../src/engine/EngineWorld.js'
import { PLANET } from '../src/engine/sceneSetup.js'
import { PAGE_SIDE, PAGE_SPAN } from '../src/engine/pageLayout.js'
import { RENDER_COLLISION_TOLERANCE_M } from '../src/engine/cameraRelative.js'
import { PLACEMENT_GPU_QUERY, PLACEMENT_GROUND_QUERY, PLACEMENT_JOLT_HEIGHTFIELD, chooseByMeasurement, createGroundQueryPlacement, createJoltHeightfieldPlacement } from '../src/engine/collisionPlacement.js'
import { createSharedHeightStore } from '../src/engine/sharedData.js'
import { createJoltHost } from '../src/collision/joltHost.js'
import { createJoltHeightfieldBackend } from '../src/collision/joltHeightfield.js'

const MAX_ERROR_M = RENDER_COLLISION_TOLERANCE_M
const PLACEMENTS = 4096
const PLACEMENT_SEED = 12345
const PATCH_SIDE = 128
const CELL_M = PAGE_SPAN / (PAGE_SIDE - 1)
const HEIGHTFIELD_CEILING_M = 0.02
const now = () => performance.now()

const lcg = (seedIn) => {
  let seed = seedIn
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }
}

const pageSamples = (key) => {
  const k = Math.abs(Number(key)) % 97
  const samples = new Float32Array(PAGE_SIDE * PAGE_SIDE)
  for (let s = 0; s < samples.length; s++) {
    const h = Math.imul(s + 1, 2654435761) ^ Math.imul(k + 7, 40503)
    samples[s] = ((h >>> 0) / 4294967296 - 0.5) * 0.8
  }
  return samples
}

const hillAt = (x, z) => 6 * Math.sin(x * 0.083) * Math.cos(z * 0.052) + 0.4 * Math.sin(x * 0.43 + z * 0.52)

const renderedHeight = (samples, side, gx, gy) => {
  const i0 = Math.min(Math.floor(gx), side - 2)
  const j0 = Math.min(Math.floor(gy), side - 2)
  const tx = gx - i0
  const ty = gy - j0
  const s00 = samples[j0 * side + i0]
  const s10 = samples[j0 * side + i0 + 1]
  const s01 = samples[(j0 + 1) * side + i0]
  const s11 = samples[(j0 + 1) * side + i0 + 1]
  if (ty <= tx) return s00 + tx * (s10 - s00) + ty * (s11 - s10)
  return s00 + ty * (s01 - s00) + tx * (s11 - s01)
}

const errorStats = (errors) => {
  const sorted = Float64Array.from(errors).sort()
  return { maxM: sorted[sorted.length - 1], p99M: sorted[Math.min(sorted.length - 1, Math.ceil(0.99 * sorted.length) - 1)] }
}

const relief = (samples) => samples.reduce((m, h) => Math.max(m, h), -Infinity) - samples.reduce((m, h) => Math.min(m, h), Infinity)

const measureHeightfield = async (samples, side, placements, truthOf) => {
  const host = await createJoltHost()
  const backend = createJoltHeightfieldBackend(host)
  const placement = createJoltHeightfieldPlacement({ buildHeightfield: backend.buildHeightfield, raycastDown: backend.raycastDown, now })
  const t0 = now()
  const built = placement.build(samples, CELL_M)
  const buildMs = now() - t0
  const errors = []
  let misses = 0
  for (const p of placements) {
    const h = placement.query(p.gx * CELL_M, p.gy * CELL_M)
    if (h === null) misses += 1
    else errors.push(Math.abs(h - truthOf(p)))
  }
  host.destroy()
  return { name: PLACEMENT_JOLT_HEIGHTFIELD, buildMs, buildBytes: built.residentBytes, copiedSampleBytes: built.sampleBytes, misses, measure: placement.measure(), error: errorStats(errors) }
}

const locate = (world, p) => {
  const local = world.faceLocal(p)
  const offsetX = (local.ox + PLANET.radius) / PLANET.cellSize
  const offsetY = (local.oy + PLANET.radius) / PLANET.cellSize
  const cx = Math.floor(offsetX)
  const cy = Math.floor(offsetY)
  return { face: local.face, cx, cy, u: offsetX - cx, v: offsetY - cy }
}

const pageDataset = async () => {
  const world = await createEngineWorld({ capacity: 8, tickRate: 60, gravity: -9.8, drag: 0, radius: 0.5, restitution: 0 })
  world.configurePlanet(PLANET)
  const cell = locate(world, [0, PLANET.radius, 0])
  let samples = null
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const key = world.cellKey(cell.face, cell.cx + dx, cell.cy + dy)
      const page = pageSamples(key)
      if (dx === 0 && dy === 0) samples = page
      world.writePage(key, page)
    }
  }
  world.applyPages()
  const frame = world.cellFrame(cell.face, cell.cx, cell.cy)
  const random = lcg(PLACEMENT_SEED)
  const placements = []
  for (let i = 0; i < PLACEMENTS; i++) {
    const flat = [0, 1, 2].map(() => 0)
    const u = random()
    const v = random()
    for (let k = 0; k < 3; k++) flat[k] = frame.origin[k] + u * frame.uEdge[k] + v * frame.vEdge[k]
    const len = Math.hypot(flat[0], flat[1], flat[2])
    const p = flat.map((c) => (c * PLANET.radius) / len)
    const at = locate(world, p)
    assert.equal(at.cx === cell.cx && at.cy === cell.cy && at.face === cell.face, true, 'a placement left the centre cell')
    placements.push({ p, gx: at.u * (PAGE_SIDE - 1), gy: at.v * (PAGE_SIDE - 1) })
  }
  const truthOf = (p) => renderedHeight(samples, PAGE_SIDE, p.gx, p.gy)
  const ground = createGroundQueryPlacement({ sampleHeight: (x, y, z) => world.height(x, y, z), now })
  const errors = placements.map((p) => Math.abs(ground.query(p.p[0], p.p[1], p.p[2]) - truthOf(p)))
  const groundRow = { name: PLACEMENT_GROUND_QUERY, buildMs: null, buildBytes: 0, copiedSampleBytes: 0, misses: 0, measure: ground.measure(), error: errorStats(errors) }
  const joltRow = await measureHeightfield(samples, PAGE_SIDE, placements, truthOf)
  return { label: 'page', side: PAGE_SIDE, sampleBytes: samples.byteLength, reliefM: relief(samples), rows: [groundRow, joltRow] }
}

const patchDataset = async () => {
  const store = createSharedHeightStore({ patchCount: 1, patchSide: PATCH_SIDE, cellM: CELL_M })
  for (let j = 0; j < PATCH_SIDE; j++) for (let i = 0; i < PATCH_SIDE; i++) store.heights[j * PATCH_SIDE + i] = hillAt(i * CELL_M, j * CELL_M)
  const samples = store.physicsView().heights
  assert.equal(samples.buffer, store.renderView().heights.buffer)
  const random = lcg(PLACEMENT_SEED)
  const placements = Array.from({ length: PLACEMENTS }, () => ({ gx: random() * (PATCH_SIDE - 1), gy: random() * (PATCH_SIDE - 1) }))
  const truthOf = (p) => renderedHeight(samples, PATCH_SIDE, p.gx, p.gy)
  const ground = createGroundQueryPlacement({ sampleHeight: (x, y, z) => renderedHeight(samples, PATCH_SIDE, x / CELL_M, z / CELL_M), now })
  const errors = placements.map((p) => Math.abs(ground.query(p.gx * CELL_M, 0, p.gy * CELL_M) - truthOf(p)))
  const functionErrors = placements.map((p) => Math.abs(truthOf(p) - hillAt(p.gx * CELL_M, p.gy * CELL_M)))
  const groundRow = { name: PLACEMENT_GROUND_QUERY, buildMs: null, buildBytes: 0, copiedSampleBytes: 0, misses: 0, measure: ground.measure(), error: errorStats(errors) }
  const joltRow = await measureHeightfield(samples, PATCH_SIDE, placements, truthOf)
  return { label: 'patch', side: PATCH_SIDE, sampleBytes: samples.byteLength, reliefM: relief(samples), gridAgainstFunction: errorStats(functionErrors), rows: [groundRow, joltRow] }
}

const page = await pageDataset()
const patch = await patchDataset()
const decisionOf = (dataset) => chooseByMeasurement(dataset.rows.map((r) => ({ name: r.name, measure: r.measure, errorM: r.error.maxM })).concat([{ name: PLACEMENT_GPU_QUERY, measure: { count: 0 }, errorM: null }]), { maxErrorM: MAX_ERROR_M })
const decisions = { page: decisionOf(page), patch: decisionOf(patch) }

for (const dataset of [page, patch]) {
  console.log('dataset ' + JSON.stringify({ label: dataset.label, side: dataset.side, cellM: CELL_M, sampleBytes: dataset.sampleBytes, reliefM: dataset.reliefM, placements: PLACEMENTS, seed: PLACEMENT_SEED, maxErrorM: MAX_ERROR_M, gridAgainstFunction: dataset.gridAgainstFunction ?? null }))
  for (const r of dataset.rows) {
    console.log('option ' + JSON.stringify({ dataset: dataset.label, name: r.name, maxErrorM: r.error.maxM, p99ErrorM: r.error.p99M, buildBytes: r.buildBytes, copiedSampleBytes: r.copiedSampleBytes, buildMs: r.buildMs, queryP50Ms: r.measure.p50Ms, queryP99Ms: r.measure.p99Ms, queryMaxMs: r.measure.maxMs, queries: r.measure.count, misses: r.misses }))
  }
  console.log('option ' + JSON.stringify({ dataset: dataset.label, name: PLACEMENT_GPU_QUERY, measured: false, reason: 'needs a browser dispatch' }))
  console.log('decision ' + JSON.stringify({ dataset: dataset.label, ...decisions[dataset.label] }))
}

const rowOf = (dataset, name) => dataset.rows.find((r) => r.name === name)

gate('the tolerance is set before the run: maxErrorM is ' + MAX_ERROR_M + ' m, the render and collision tolerance, on ' + PLACEMENTS + ' placements from seed ' + PLACEMENT_SEED, () => {
  assert.equal(MAX_ERROR_M, 1e-3)
  for (const dataset of [page, patch]) for (const r of dataset.rows) assert.equal(r.measure.count, PLACEMENTS)
})

for (const dataset of [page, patch]) {
  const ground = rowOf(dataset, PLACEMENT_GROUND_QUERY)
  const jolt = rowOf(dataset, PLACEMENT_JOLT_HEIGHTFIELD)
  gate(dataset.label + ' (' + dataset.side + ' by ' + dataset.side + ' samples): the ground query places every point within ' + MAX_ERROR_M + ' m of the rendered surface and builds nothing', () => {
    assert.ok(ground.error.maxM <= MAX_ERROR_M, 'ground query max error ' + ground.error.maxM + ' m')
    assert.equal(ground.buildBytes, 0)
    assert.equal(ground.copiedSampleBytes, 0)
  })
  gate(dataset.label + ': the Jolt heightfield hits on every placement, misses ' + MAX_ERROR_M + ' m at its worst point and stays under ' + HEIGHTFIELD_CEILING_M + ' m', () => {
    assert.equal(jolt.misses, 0)
    assert.ok(jolt.error.maxM > MAX_ERROR_M, 'heightfield max error ' + jolt.error.maxM + ' m is within the tolerance now, so the recorded decision is out of date')
    assert.ok(jolt.error.maxM <= HEIGHTFIELD_CEILING_M, 'heightfield max error ' + jolt.error.maxM + ' m')
    assert.ok(jolt.error.p99M <= jolt.error.maxM)
  })
  gate(dataset.label + ': the Jolt heightfield copies all ' + dataset.sampleBytes + ' sample bytes into Jolt and keeps a second copy of the terrain resident', () => {
    assert.equal(jolt.copiedSampleBytes, dataset.sampleBytes)
    assert.ok(jolt.buildBytes > 0, 'resident bytes ' + jolt.buildBytes)
    assert.ok(jolt.buildBytes <= dataset.sampleBytes, 'resident bytes ' + jolt.buildBytes + ' against ' + dataset.sampleBytes + ' sample bytes')
  })
  gate(dataset.label + ': the decision rule picks the ground query, because it is the only measured option within ' + MAX_ERROR_M + ' m', () => {
    assert.equal(decisions[dataset.label].name, PLACEMENT_GROUND_QUERY)
  })
}

gate('the resident heightfield bytes are 976 for the 16 by 16 page and 43712 for the 128 by 128 patch, built in that order on one Jolt module', () => {
  assert.equal(rowOf(page, PLACEMENT_JOLT_HEIGHTFIELD).buildBytes, 976)
  assert.equal(rowOf(patch, PLACEMENT_JOLT_HEIGHTFIELD).buildBytes, 43712)
})

gate('the 128 by 128 grid itself is within 0.1 m of the height function it samples, the same for both options', () => {
  assert.ok(patch.gridAgainstFunction.maxM <= 0.1, 'grid against function ' + patch.gridAgainstFunction.maxM + ' m')
})

finish()
