import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => readFileSync(join(root, file), 'utf8')
const GLUES = ['engine/out/engine-core-64mib.mjs', 'engine/out/engine-core-512mib.mjs']
const EXPORTS = ['engine_render_shadow_budget', 'engine_render_set_shadows', 'engine_render_set_sun', 'engine_render_shadow_state']
const ENGINE_OK = 0
const ENGINE_RANGE = -2
const TIER_BUDGETS = [[2, 1024], [3, 1024], [4, 2048]]
const STATE_BYTES = 32 + 4 * 96
const MIB = 1048576

const header = read('engine/src/render/shadow_cascades.h')
const source = read('engine/src/render/shadow_cascades.cpp')
const frame = read('engine/src/render/render_frame.cpp')
const exportsSource = read('engine/src/exports_render.cpp')
const cmake = read('engine/CMakeLists.txt')
const witness = read('engine/test/witness_shadow_cascades.cpp')
const buildHost = read('engine/test/build_host.sh')
const mainAll = read('engine/test/main_all.cpp')
const webgpu = read('engine/src/render/render_webgpu.cpp')
const webgl2 = read('engine/src/render/render_webgl2.cpp')

gate('every shadow export is defined as EMSCRIPTEN_KEEPALIVE and listed in ENGINE_EXPORTS, and the planner is compiled into the wasm and the host witness', () => {
  for (const name of EXPORTS) {
    assert.match(exportsSource, new RegExp('EMSCRIPTEN_KEEPALIVE [^\\n]*\\b' + name + '\\('), name)
    assert.ok(cmake.includes('\n  _' + name + '\n'), 'CMake export list lacks _' + name)
  }
  assert.ok(cmake.includes('\n  src/render/shadow_cascades.cpp\n'))
  assert.ok(buildHost.includes('"$engine/src/render/shadow_cascades.cpp"') && buildHost.includes('"$engine/test/witness_shadow_cascades.cpp"'))
  assert.ok(mainAll.includes('engine::witness::shadowCascades();'))
})

gate('shadows are off by default, the plan is a fixed table by device tier, it is refused after the seal, and the fit runs only when shadows are on', () => {
  assert.ok(source.includes('constexpr Budget kTierBudget[kTiers] = {{2, 1024}, {3, 1024}, {4, 2048}};'))
  assert.ok(source.includes('State current{0, 0, 0, 0, 0.0f, {0.0f, -1.0f, 0.0f}, {}};'))
  assert.ok(exportsSource.includes('if (rnd::counters().sealed != 0) return engine::kSealed;\n  return rnd::shadows::configure(cascades, resolution, distance)'))
  assert.ok(frame.includes('if (shadows::enabled()) shadows::fit(camera.viewProj);'))
  assert.ok(header.includes('static_assert(sizeof(State) == 32 + kMaxCascades * 96);'))
  assert.doesNotMatch(source, /std::vector|\bmalloc\s*\(|\bnew\s+[A-Za-z_]/)
})

gate('neither backend draws a shadow pass yet: the planner is the CPU half only', () => {
  assert.ok(!webgpu.includes('shadow_cascades.h') && !webgl2.includes('shadow_cascades.h'), 'a backend now uses the cascades, so this gate and the ledger row need the depth pass witnessed')
})

gate('the host witness checks the containment of every slice, whole-texel motion over camera moves, and a constant cascade size', () => {
  for (const text of ['cornersOutside(viewProj) == 0', 'worstFraction <= kTexelSlack', 'radiusChanges == 0', 'engine::arena::carves() == carves']) assert.ok(witness.includes(text), text)
})

for (const glue of GLUES) {
  gate(glue + ': the built module starts with shadows off, reports the tier table, refuses a bad plan, and holds a fixed number of map bytes once configured', async () => {
    const module = await (await import(pathToFileURL(join(root, glue)).href)).default()
    for (const name of EXPORTS) assert.equal(typeof module['_' + name], 'function', name)
    const at = module._engine_render_shadow_state()
    const words = () => Array.from(module.HEAPU32.subarray(at >> 2, (at >> 2) + 4))
    assert.deepEqual(words(), [0, 0, 0, 0])
    TIER_BUDGETS.forEach(([cascades, resolution], tier) => assert.equal(module._engine_render_shadow_budget(tier), (cascades << 16) | resolution))
    assert.equal(module._engine_render_set_shadows(5, 1024, 100), ENGINE_RANGE)
    assert.equal(module._engine_render_set_shadows(2, 1000, 100), ENGINE_RANGE)
    assert.equal(module._engine_render_set_shadows(2, 1024, 0), ENGINE_RANGE)
    assert.equal(module._engine_render_set_sun(0, 0, 0), ENGINE_RANGE)
    assert.deepEqual(words(), [0, 0, 0, 0])
    const allocations = Number(module._engine_allocations_total())
    assert.equal(module._engine_render_set_shadows(2, 1024, 100), ENGINE_OK)
    assert.deepEqual(words(), [2, 1024, 8 * MIB, 0])
    assert.equal(module._engine_render_set_sun(1, -2, 0.5), ENGINE_OK)
    assert.equal(module._engine_render_set_shadows(0, 0, 0), ENGINE_OK)
    assert.deepEqual(words(), [0, 0, 0, 0])
    assert.equal(Number(module._engine_allocations_total()), allocations, 'the shadow plan allocated')
    assert.ok(STATE_BYTES === 416)
  })
}

finish()
