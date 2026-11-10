import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { finish, gate } from './lib/gate.mjs'
import { buildPlanetScene, PLANET_ENTITY_COUNT, sceneSpec } from '../src/engine/planetScene.js'
import { OPEN_ITEMS, PLANET_FRAME_BUDGET_MS, PLANET_MIN_FRAMES, PLANET_RUNS, PLANET_TABLE_COLUMNS, comparePlanetRuns, planetQuery, planetVerdict } from '../src/engine/planetWitness.js'
import { capAreaKm2 } from '../src/engine/population.js'
import { densityFor } from '../src/engine/populationDensity.js'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const fakeModule = () => ({ _engine_planet_height: () => 0 })
const clock = () => { let t = 0; return () => (t += 1) }
const frames = (value, n = PLANET_MIN_FRAMES) => Array.from({ length: n }, () => value)
const goodScene = { entities: PLANET_ENTITY_COUNT, colliderCounts: { 'very-static': 1, static: 5, dynamic: PLANET_ENTITY_COUNT }, vegetationBound: true }
const good = (over = {}) => ({
  ok: true,
  errors: [],
  backend: 'webgpu',
  tier: 1024,
  players: PLANET_ENTITY_COUNT,
  adapter: { api: 'webgpu', isFallbackAdapter: false, description: 'NVIDIA' },
  frameTimesMs: frames(10),
  wallIntervalsMs: frames(10),
  allocationsSinceWarmup: '0',
  createsAfterSeal: 0,
  scene: goodScene,
  ...over,
})
const webgpu1024 = { backend: 'webgpu', tier: 1024 }

gate('the planet scene has the entity count, the dynamic bodies, the static trees and the terrain, counted from the modules', () => {
  const scene = buildPlanetScene({ module: fakeModule(), now: clock(), generate: false })
  const r = scene.report()
  const area = capAreaKm2(scene.spec.capRad, scene.spec.radiusM)
  assert.equal(r.entities, PLANET_ENTITY_COUNT)
  assert.equal(r.trees, Math.round(densityFor('trees') * area))
  assert.deepEqual(r.colliderCounts, { 'very-static': 1, static: r.trees, dynamic: PLANET_ENTITY_COUNT })
  assert.deepEqual(r.stepCost, { 'very-static': 0, static: 0, dynamic: PLANET_ENTITY_COUNT })
  assert.equal(r.heightCalls, PLANET_ENTITY_COUNT)
  assert.equal(r.patches, scene.spec.patchSide ** 2)
  assert.equal(r.vegetationBound, null)
})

gate('the scene refuses a missing clock, a bad entity count, a bad cap and a bad device limit', () => {
  assert.throws(() => buildPlanetScene({ module: fakeModule(), generate: false }), TypeError)
  assert.throws(() => sceneSpec({ entities: 0 }), RangeError)
  assert.throws(() => sceneSpec({ entities: 1.5 }), RangeError)
  assert.throws(() => sceneSpec({ capRad: 2 }), RangeError)
  assert.throws(() => sceneSpec({ deviceBufferBytes: 0 }), RangeError)
})

gate('a run that meets the budget on every frame and every requirement passes', () => {
  const v = planetVerdict(good(), webgpu1024)
  assert.equal(v.ok, true, v.failures.join('; '))
  assert.equal(v.budgetMs, 16.7)
  assert.equal(v.longFrames.length, 0)
})

gate('the verdict fails when the p99 is over the budget, and names the frames over it', () => {
  const times = frames(10)
  for (let i = 0; i < 60; i++) times[i] = 17.5
  const v = planetVerdict(good({ frameTimesMs: times }), webgpu1024)
  assert.equal(v.ok, false)
  assert.ok(v.failures.some((f) => f.includes('p99')))
  assert.equal(v.longFrames.length, 60)
})

gate('a rAF interval over 25 ms is a missed frame and fails the run, and jitter below it does not', () => {
  const jitter = frames(10).map(() => 17.7)
  assert.equal(planetVerdict(good({ wallIntervalsMs: jitter }), webgpu1024).ok, true)
  const wall = frames(10)
  wall[300] = 25.2
  const v = planetVerdict(good({ wallIntervalsMs: wall }), webgpu1024)
  assert.equal(v.ok, false)
  assert.equal(v.missedFrames, 1)
  assert.ok(v.failures.some((f) => f.includes('missed frames: 1') && f.includes('frame 300')))
  assert.equal(v.longFrames.length, 0)
})

gate('a work time over 16.7 ms on any frame fails the run, whatever the intervals', () => {
  const times = frames(10)
  times[10] = 16.9
  const v = planetVerdict(good({ frameTimesMs: times }), webgpu1024)
  assert.equal(v.ok, false)
  assert.ok(v.failures.some((f) => f.includes('worst work 16.9')))
})

gate('the verdict fails when the wall-clock intervals are missing', () => {
  const v = planetVerdict(good({ wallIntervalsMs: undefined }), webgpu1024)
  assert.equal(v.ok, false)
  assert.ok(v.failures.some((f) => f.includes('wall-clock intervals')))
})

gate('the verdict fails on the 362.9 ms outlier, and reports the frame index of that outlier', () => {
  const times = frames(10)
  times[417] = 362.9
  const v = planetVerdict(good({ backend: 'webgl2', frameTimesMs: times, adapter: { api: 'webgl2' } }), { backend: 'webgl2', tier: 1024 })
  assert.equal(v.ok, false)
  assert.deepEqual(v.longFrames, [{ frame: 417, ms: 362.9 }])
  assert.ok(v.failures.some((f) => f.includes('worst work 362.9')))
})

gate('the verdict fails with no adapter, and with a fallback WebGPU adapter; WebGL2 has no fallback flag and passes', () => {
  assert.equal(planetVerdict(good({ adapter: null }), webgpu1024).ok, false)
  assert.equal(planetVerdict(good({ adapter: { api: 'webgpu', adapter: null } }), webgpu1024).ok, false)
  assert.equal(planetVerdict(good({ adapter: { api: 'webgpu', isFallbackAdapter: true } }), webgpu1024).ok, false)
  assert.equal(planetVerdict(good({ backend: 'webgl2', adapter: { api: 'webgl2' } }), { backend: 'webgl2', tier: 1024 }).ok, true)
})

gate('the verdict fails on a short run, a wrong player count, a missing scene, an unbound vegetation path and a dynamic count that is not 1024', () => {
  assert.equal(planetVerdict(good({ frameTimesMs: frames(10, PLANET_MIN_FRAMES - 1) }), webgpu1024).ok, false)
  assert.equal(planetVerdict(good({ players: 1023 }), webgpu1024).ok, false)
  assert.equal(planetVerdict(good({ scene: undefined }), webgpu1024).ok, false)
  assert.equal(planetVerdict(good({ scene: { ...goodScene, vegetationBound: null } }), webgpu1024).ok, false)
  assert.equal(planetVerdict(good({ scene: { ...goodScene, colliderCounts: { dynamic: 1000 } } }), webgpu1024).ok, false)
})

gate('the 64 tier has no scene requirement and is timed, and a page error or an allocation after warm-up fails it', () => {
  const v64 = planetVerdict(good({ tier: 64, players: 64, scene: undefined }), { backend: 'webgpu', tier: 64 })
  assert.equal(v64.ok, true, v64.failures.join('; '))
  assert.equal(planetVerdict(good({ tier: 64, scene: undefined, errors: ['x'] }), { backend: 'webgpu', tier: 64 }).ok, false)
  assert.equal(planetVerdict(good({ allocationsSinceWarmup: '5' }), webgpu1024).ok, false)
  assert.equal(planetVerdict(null, webgpu1024).ok, false)
})

gate('the run plan covers both tiers on both backends, every run is timed, and the query carries the frame count', () => {
  const pairs = PLANET_RUNS.map((r) => r.tier + '/' + r.backend).sort()
  assert.deepEqual(pairs, ['1024/webgl2', '1024/webgpu', '64/webgl2', '64/webgpu'])
  assert.equal(PLANET_RUNS.find((r) => r.backend === 'webgpu').phase, 10)
  assert.equal(PLANET_RUNS.find((r) => r.backend === 'webgl2').phase, 11)
  for (const r of PLANET_RUNS) {
    const q = planetQuery(r, 900)
    assert.ok(q.includes('timed=1'), q)
    assert.ok(q.includes('path=planet'), q)
    assert.ok(q.includes('frames=900'), q)
    assert.equal(q.includes('threads=1'), r.threads)
  }
})

gate('the comparison refuses runs whose inputs differ, and returns the three rows with the budget', () => {
  const inputs = { radiusM: 6360000, seed: 1, capRad: 1e-4, entities: 1024, trees: 67500, tier: 1024, frames: 900, budgetMs: 16.7 }
  const engine = { inputs, frameTimesMs: frames(10) }
  const spoint = { inputs: { ...inputs }, frameTimesMs: frames(12) }
  const rows = comparePlanetRuns(engine, spoint)
  assert.equal(rows.length, 3)
  assert.ok(rows.every((r) => r.budgetMs === PLANET_FRAME_BUDGET_MS))
  assert.equal(rows[0].engine, 10)
  assert.equal(rows[0].spoint, 12)
  assert.throws(() => comparePlanetRuns(engine, { inputs: { ...inputs, seed: 2 }, frameTimesMs: frames(12) }), RangeError)
  assert.throws(() => comparePlanetRuns(engine, { inputs, frameTimesMs: null }), TypeError)
  assert.deepEqual(PLANET_TABLE_COLUMNS, ['metric', 'budget ms', 'engine WebGPU', 'engine WebGL2', 'spoint', 'inputs'])
})

gate('each open item from the earlier reports has a cause, a hook and a gate file that exists', () => {
  const ids = OPEN_ITEMS.map((i) => i.id).sort()
  assert.deepEqual(ids, ['362.9-ms-outlier', 'launcher-null-adapter', 'spoint-planet-frame-harness', 'tier-64-untimed'])
  const src = readFileSync(join(root, 'src/engine/planetWitness.js'), 'utf8')
  for (const item of OPEN_ITEMS) {
    assert.ok(item.cause.length > 20 && item.hook.length > 20, item.id)
    assert.ok(existsSync(join(root, item.gate)), item.id + ' gate missing: ' + item.gate)
  }
  assert.ok(src.includes('planetVerdict'))
})

gate('the render page exports the per-frame times, the player count and the planet scene report', () => {
  const page = readFileSync(join(root, 'scripts/browser/engine-render-browser.js'), 'utf8')
  assert.ok(page.includes('result.frameTimesMs = timed.map(roundTo2)'))
  assert.ok(page.includes('result.wallIntervalsMs = Array.from(column(5), roundTo2)'))
  assert.ok(page.includes('result.players = readLayout(module).players'))
  assert.ok(page.includes('result.scene = planetScene.report()'))
  assert.ok(page.includes('beforeSeal = TIER === 1024'))
})

gate('the planet witness is in the package scripts, and the runner calls the same verdict and exits non-zero on a miss', () => {
  const pkg = readFileSync(join(root, 'package.json'), 'utf8')
  assert.ok(pkg.includes('"check:planet-witness": "node scripts/check-planet-witness.mjs"'))
  assert.ok(pkg.includes('"planet-witness": "node scripts/browser/planet-witness-run.mjs"'))
  const runner = readFileSync(join(root, 'scripts/browser/planet-witness-run.mjs'), 'utf8')
  assert.ok(runner.includes('planetVerdict(run.result, config)'))
  assert.ok(runner.includes('process.exitCode = 1'))
})

gate('the scene spec defaults to 1024 entities on the 6,360,000 m planet, and the budget is 16.7 ms', () => {
  assert.equal(sceneSpec().radiusM, 6360000)
  assert.equal(sceneSpec().entities, PLANET_ENTITY_COUNT)
  assert.equal(PLANET_FRAME_BUDGET_MS, 16.7)
  assert.equal(PLANET_MIN_FRAMES, 600)
})

const arenaModule = () => {
  const heap = new ArrayBuffer(64 * 1024 * 1024)
  let top = 1024
  const bound = []
  return {
    HEAPU8: new Uint8Array(heap),
    _engine_planet_height: () => 0,
    _engine_arena_used: () => top,
    _engine_arena_carve: (bytes, alignment) => {
      const start = Math.ceil(top / alignment) * alignment
      if (start + bytes > heap.byteLength) return 0
      top = start + bytes
      return start
    },
    _engine_vegetation_bind: (...args) => {
      bound.push(args)
      return 1
    },
    bound,
  }
}

gate('the planet scene binds its vegetation pool to arena memory, and the bind gets the pool pointers and sizes', () => {
  const module = arenaModule()
  const scene = buildPlanetScene({ module, now: clock(), generate: false })
  const r = scene.report()
  assert.equal(r.vegetationBound, true)
  assert.equal(module.bound.length, 1)
  const [block, counts, dirty, origins, radius, species, slots, capacity] = module.bound[0]
  const memory = scene.vegetation.memory()
  assert.equal(block, memory.block.byteOffset)
  assert.equal(counts, memory.counts.byteOffset)
  assert.equal(dirty, memory.dirty.byteOffset)
  assert.equal(origins, memory.origins.byteOffset)
  assert.equal(origins % 8, 0)
  assert.equal(block % 16, 0)
  assert.equal(radius, scene.vegetation.memory().radius)
  assert.equal(species, 1)
  assert.equal(slots, r.vegetationPlan.slots)
  assert.equal(capacity, r.vegetationPlan.capacityPerPatch)
})

gate('a bind the engine refuses leaves the scene unbound, and a module without the arena keeps the JS heap pool unbound', () => {
  const refusing = arenaModule()
  refusing._engine_vegetation_bind = () => 0
  assert.equal(buildPlanetScene({ module: refusing, now: clock(), generate: false }).report().vegetationBound, false)
  assert.equal(buildPlanetScene({ module: fakeModule(), now: clock(), generate: false }).report().vegetationBound, null)
})

gate('an arena that runs out of room refuses the pool with a RangeError, and no view is handed out past its end', () => {
  const module = arenaModule()
  module._engine_arena_carve = () => 0
  assert.throws(() => buildPlanetScene({ module, now: clock(), generate: false }), RangeError)
})

finish()
