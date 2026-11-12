import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { finish, gate } from './lib/gate.mjs'
import { loadEngineModule, releaseEngineModule, resolvePlan } from '../src/engine/EngineWorld.js'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const glueUrl = (path) => pathToFileURL(join(root, path)).href
const read = (file) => readFileSync(join(root, file), 'utf8')
const ENGINE_OK = 0
const ENGINE_RANGE = -2
const MAX_PROMOTED = 64
const PROMOTED_BIT_NAME = 'kPromotedBit = 0x80000000u'
const EXPORTS = ['engine_veg_set_promotion', 'engine_veg_promotion_cap', 'engine_veg_promoted_count', 'engine_veg_promotion_refusals', 'engine_veg_promoted_rows', 'engine_veg_restore']
const SLOT_MASK = (1 << 17) - 1
const CAPACITY = 64
const TICK_RATE = 60
const RADIUS = 0.5
const ITERATIONS = 10
const FIELD_ORIGIN = -128
const CELL = 8
const TRUNK_CLASS = 0
const TRUNKS = 3
const SPACING = 16
const CAP = 2
const FIRE_HEIGHT = 2
const HIGH_HEIGHT = 5
const START_X = -5
const SPEED = 10
const TICKS = 60
const WARM_TICKS = 20
const STOP_MIN = -1
const STOP_MAX = -0.8
const PASS_CLEARANCE = 3
const ANCHOR_TOLERANCE = 1e-5
const TIERS = Object.freeze([
  { label: '64 MiB fixed', glue: 'engine/out/engine-core-64mib.mjs', players: 64, workers: 1, budgetBytes: 64 * 1024 * 1024 },
  { label: '512 MiB threaded, 2 workers', glue: 'engine/out/engine-core-512mib-threads.mjs', players: 1024, workers: 2, budgetBytes: 512 * 1024 * 1024 },
])

const open = async (tier, cap) => {
  const module = await loadEngineModule(glueUrl(tier.glue), resolvePlan({ players: tier.players, workers: tier.workers, budgetBytes: tier.budgetBytes }))
  assert.equal(module._engine_world_configure(CAPACITY, TICK_RATE, 0, 0, RADIUS, 0, ITERATIONS), ENGINE_OK)
  assert.equal(module._engine_veg_configure(FIELD_ORIGIN, CELL), ENGINE_OK)
  for (let i = 0; i < TRUNKS; i++) assert.equal(module._engine_veg_place(0, 0, i * SPACING, 0, 1, TRUNK_CLASS), ENGINE_OK)
  assert.equal(module._engine_veg_attach(), ENGINE_OK)
  const capBefore = module._engine_veg_promotion_cap()
  if (cap > 0) assert.equal(module._engine_veg_set_promotion(cap), ENGINE_OK)
  return { module, capBefore }
}

const positionOf = (module, handle) => {
  const base = module._engine_positions() / 8 + (handle & SLOT_MASK) * 3
  return [module.HEAPF64[base], module.HEAPF64[base + 1], module.HEAPF64[base + 2]]
}

const fire = (module, y, z) => module._engine_spawn(START_X, y, z, SPEED, 0, 0)

const volley = async (tier, cap) => {
  const { module, capBefore } = await open(tier, cap)
  const handles = []
  for (let i = 0; i < TRUNKS; i++) handles.push(fire(module, FIRE_HEIGHT, i * SPACING))
  for (let t = 0; t < WARM_TICKS; t++) module._engine_tick(1)
  module._engine_mark_warmup()
  const anchors = []
  let firstTick = 0
  for (let t = 0; t < TICKS; t++) {
    module._engine_tick(1)
    if (firstTick === 0 && module._engine_veg_promoted_count() > 0) {
      firstTick = WARM_TICKS + t + 1
      const rows = module._engine_veg_promoted_rows() / 4
      for (let i = 0; i < module._engine_veg_promoted_count(); i++) anchors.push(positionOf(module, module.HEAPU32[rows + i * 2 + 1]))
    }
  }
  const promoted = module._engine_veg_promoted_count()
  const rowsAt = module._engine_veg_promoted_rows() / 4
  const rows = Array.from({ length: promoted * 2 }, (_, i) => module.HEAPU32[rowsAt + i])
  const out = {
    capBefore, promoted, rows, anchors, firstTick,
    refusals: module._engine_veg_promotion_refusals(),
    bodies: module._engine_body_count(),
    spheres: handles.map((handle) => positionOf(module, handle)),
    allocations: Number(module._engine_allocations_since_warmup()),
    failures: Number(module._engine_allocation_failures()),
    overCap: module._engine_veg_set_promotion(MAX_PROMOTED + 1),
  }
  const high = fire(module, HIGH_HEIGHT, 0)
  for (let t = 0; t < TICKS; t++) module._engine_tick(1)
  out.highX = positionOf(module, high)[0]
  out.restore = module._engine_veg_restore()
  out.promotedAfterRestore = module._engine_veg_promoted_count()
  out.bodiesAfterRestore = module._engine_body_count()
  const again = fire(module, HIGH_HEIGHT, 0)
  for (let t = 0; t < TICKS; t++) module._engine_tick(1)
  out.againX = positionOf(module, again)[0]
  await releaseEngineModule(module)
  return out
}

gate('every promotion export is defined as EMSCRIPTEN_KEEPALIVE and listed in ENGINE_EXPORTS, and the fixed cap is ' + MAX_PROMOTED + ' rows', () => {
  const core = read('engine/src/engine_core.cpp')
  const cmake = read('engine/CMakeLists.txt')
  for (const name of EXPORTS) {
    assert.match(core, new RegExp('EMSCRIPTEN_KEEPALIVE [^\\n]*\\b' + name + '\\('), name)
    assert.ok(cmake.includes('\n  _' + name + '\n'), 'CMake export list lacks _' + name)
  }
  assert.ok(read('engine/src/world.h').includes('constexpr std::uint32_t kMaxPromotedInstances = ' + MAX_PROMOTED + ';'))
  assert.ok(read('engine/src/vegetation.h').includes(PROMOTED_BIT_NAME))
})

for (const tier of TIERS) {
  const off = await volley(tier, 0)
  const first = await volley(tier, CAP)
  const second = await volley(tier, CAP)

  gate(tier.label + ': promotion is off by default, and with it off three touched trunks promote nothing and stop their spheres', () => {
    assert.equal(off.capBefore, 0)
    assert.equal(off.promoted, 0)
    assert.equal(off.refusals, 0)
    assert.equal(off.bodies, TRUNKS)
    for (const sphere of off.spheres) assert.ok(sphere[0] >= STOP_MIN && sphere[0] <= STOP_MAX, 'sphere x ' + sphere[0])
  })

  gate(tier.label + ': under a cap of ' + CAP + ' three touched trunks promote exactly ' + CAP + ' pooled bodies, in instance order, and the third touch is refused', () => {
    assert.equal(first.promoted, CAP)
    assert.equal(first.bodies, TRUNKS + CAP)
    assert.ok(first.refusals >= 1, 'refusals ' + first.refusals)
    assert.ok(first.rows[0] < first.rows[2], 'rows are in instance order')
    assert.ok(first.spheres[2][0] >= STOP_MIN && first.spheres[2][0] <= STOP_MAX, 'the refused trunk stopped its sphere at x ' + first.spheres[2][0])
    assert.equal(first.overCap, ENGINE_RANGE)
  })

  gate(tier.label + ': each pooled body is placed on the trunk axis at the touch height within ' + ANCHOR_TOLERANCE + ' m', () => {
    assert.ok(first.firstTick > WARM_TICKS, 'the first promotion came at tick ' + first.firstTick + ', inside the warm-up')
    assert.equal(first.anchors.length, CAP)
    first.anchors.forEach((anchor, i) => {
      assert.ok(Math.abs(anchor[0]) <= ANCHOR_TOLERANCE && Math.abs(anchor[1] - FIRE_HEIGHT) <= ANCHOR_TOLERANCE && Math.abs(anchor[2] - i * SPACING) <= ANCHOR_TOLERANCE, 'anchor ' + anchor)
    })
  })

  gate(tier.label + ': the static shape ignores a promoted trunk (a later sphere passes), and after restore the trunk stops a sphere again', () => {
    assert.ok(first.highX >= PASS_CLEARANCE, 'sphere through the promoted trunk reached x ' + first.highX)
    assert.equal(first.restore, ENGINE_OK)
    assert.equal(first.promotedAfterRestore, 0)
    assert.equal(first.bodiesAfterRestore, TRUNKS + 1)
    assert.ok(first.againX >= STOP_MIN && first.againX <= STOP_MAX, 'sphere at the restored trunk stopped at x ' + first.againX)
  })

  gate(tier.label + ': promoting and refusing carve nothing from the arena after warm-up and no allocation fails', () => {
    assert.equal(first.allocations, 0)
    assert.equal(first.failures, 0)
  })

  gate(tier.label + ': two runs agree bit for bit on the rows, the refusals, the tick of the first promotion and every sphere position', () => {
    assert.deepEqual(second, first)
  })
}

finish()
