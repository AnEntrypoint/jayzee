import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { createDisplayGovernor } from '../src/engine/displayGovernor.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => readFileSync(join(root, file), 'utf8')
const GLUES = ['engine/out/engine-core-64mib.mjs', 'engine/out/engine-core-512mib.mjs']
const EXPORTS = [
  'engine_models_set_lods',
  'engine_models_lod_count',
  'engine_models_lod_level',
  'engine_models_lod_indices',
  'engine_models_set_index_budget',
  'engine_models_index_budget',
  'engine_models_set_lod_pixels',
  'engine_models_lod_pixels',
  'engine_models_lod_select',
  'engine_models_lod_stats',
]
const ENGINE_OK = 0
const ENGINE_RANGE = -2
const ENGINE_BAD_ID = -4
const NO_BUDGET = 0
const MAX_LODS = 4
const LOD_UNSET = 255
const FULL_PIXELS = 256
const CLUSTER_INDICES = 384
const MODEL_LIMITS = [2048, 256, 268435456, 4, 0]
const BUDGET = 5000
const STATS_WORDS = 8

const header = read('engine/src/model_pool.h')
const pool = read('engine/src/model_pool.cpp')
const exportsSource = read('engine/src/exports_models.cpp')
const cmake = read('engine/CMakeLists.txt')
const frame = read('engine/src/render/render_frame.cpp')
const webgpu = read('engine/src/render/render_webgpu.cpp')
const webgl2 = read('engine/src/render/render_webgl2.cpp')
const witness = read('engine/test/witness_model_lod.cpp')
const buildHost = read('engine/test/build_host.sh')
const mainAll = read('engine/test/main_all.cpp')
const renderer = read('src/engine/renderer.js')

gate('every model lod export is defined as EMSCRIPTEN_KEEPALIVE and listed in ENGINE_EXPORTS', () => {
  for (const name of EXPORTS) {
    assert.match(exportsSource, new RegExp('EMSCRIPTEN_KEEPALIVE [^\\n]*\\b' + name + '\\('), name)
    assert.ok(cmake.includes('\n  _' + name + '\n'), 'CMake export list lacks _' + name)
  }
})

gate('a slot holds up to ' + MAX_LODS + ' lod ranges, the default is no index budget, and the law constants are those of the display governor', () => {
  assert.ok(header.includes('constexpr std::uint32_t kMaxLods = ' + MAX_LODS + ';'))
  assert.ok(header.includes('constexpr std::uint32_t kNoIndexBudget = ' + NO_BUDGET + ';'))
  assert.ok(header.includes('constexpr float kLodFullPixels = ' + FULL_PIXELS + '.0f;'))
  assert.ok(pool.includes('std::uint32_t gIndexBudget = kNoIndexBudget;'))
  const governor = read('src/engine/displayGovernor.js')
  assert.ok(governor.includes('hysteresis = 0.25, biasStep = 0.25, maxBias = levels, relax = 0.85, admit = 0.95'))
  for (const line of ['kLodHysteresis = 0.25f;', 'kLodBiasStep = 0.25f;', 'kLodMaxBias = static_cast<float>(kMaxLods);', 'kLodRelax = 0.85f;', 'kLodAdmit = 0.95f;']) assert.ok(header.includes('constexpr float ' + line), line)
})

gate('the selection is the governor law: level is the floor of log2 of the size ratio plus the bias inside a hysteresis band, the bias rises until the cost fits, then models are shed', () => {
  assert.ok(pool.includes('gLodScratch[slot] = std::log2(gLodFullPixels / pixels);'))
  assert.ok(pool.includes('const float t = lodOf[slot] + bias;'))
  assert.ok(pool.includes('std::floor(t - kLodHysteresis)') && pool.includes('std::floor(t + kLodHysteresis)'))
  assert.ok(pool.includes('while (limited && cost > gIndexBudget && gLodBias < kLodMaxBias)'))
  assert.ok(pool.includes('kLodRelax') && pool.includes('kLodAdmit'))
})

gate('the js governor gives the same choice on the witness scene: 8 models of 1536, 768 and 384 indices under 7000 indices settle one level coarser at a bias of 1.25', () => {
  const governor = createDisplayGovernor({ capacity: 8, levels: 4, budget: 8 * 1536 })
  const lod = new Float32Array(8)
  const weight = new Uint32Array(8).fill(1536)
  assert.equal(governor.select(8, lod, weight).cost, 8 * 1536)
  governor.setBudget(7000)
  const stats = governor.select(8, lod, weight)
  assert.equal(stats.bias, 1.25)
  assert.equal(stats.cost, 8 * 768)
  assert.equal(stats.passes, 6)
  assert.ok(witness.includes('stats.cost == kSlots * kMiddle && stats.bias == 1.25f && stats.shed == 0 && stats.passes == 6'))
})

gate('the pool allocates nothing after bind: the lod rows are part of bytesFor, and the source has no heap call', () => {
  assert.ok(pool.includes('+ clusterBytes(layout) + lodBytes(layout.slots);'))
  assert.ok(pool.includes('static_assert(sizeof(SlotLod) == 40);'))
  assert.doesNotMatch(pool, /std::vector|\bmalloc\s*\(|\bnew\s+[A-Za-z_]|std::sort/)
})

gate('both backends select the levels each frame after the uploads, the draw takes the selected cluster window, and the WebGPU cull shader reads the same window', () => {
  assert.ok(frame.includes('void selectModelLods(const Camera& camera, const FrameOrigin& origin, std::uint32_t viewportHeight)'))
  assert.ok(webgl2.includes('engine::render::selectModelLods(camera, scene.origin, surfaceHeight);'))
  assert.ok(webgpu.includes('engine::render::selectModelLods(camera, scene.origin, surfaceHeight);'))
  assert.ok(pool.includes('const std::uint32_t window = slotClusterWindow(slot);'))
  assert.ok(webgpu.includes('readyWords[s] = engine::models::slotReady(s) ? engine::models::slotClusterWindow(s) : 0u;'))
  assert.ok(webgpu.includes('if (local < (window >> 16u) || local >= (window & 0xffffu) || clusters[gid * 6u + 5u] == 0u) {'))
})

gate('the host witness is built, listed and called, and checks the ranges, the hysteresis, the budget and a camera sweep', () => {
  assert.ok(buildHost.includes('"$engine/test/witness_model_lod.cpp"'))
  assert.ok(mainAll.includes('void modelLod();') && mainAll.includes('engine::witness::modelLod();'))
  for (const text of ['flips == 0', 'over == 0 && mismatched == 0', 'stats.shed == 1', 'engine::arena::carves() == carves']) assert.ok(witness.includes(text), text)
})

gate('the renderer wraps the budget, the ranges and the stats, and the device loader sets the index budget from the device budget', () => {
  for (const text of ['setModelIndexBudget(indices)', 'setModelLods(handle, indexCounts)', 'modelLod()', 'instanceBudgetFor(budget, MODEL_INDEX_DISPLAY_BYTES)']) assert.ok(renderer.includes(text), text)
})

for (const glue of GLUES) {
  gate(glue + ': the built module starts with no index budget, accepts and refuses lod ranges on a loaded model, and gives an unfinished upload no level and no cost', async () => {
    const module = await (await import(pathToFileURL(join(root, glue)).href)).default()
    for (const name of EXPORTS) assert.equal(typeof module['_' + name], 'function', name)
    assert.equal(module._engine_models_index_budget(), NO_BUDGET)
    assert.equal(module._engine_models_lod_pixels(), FULL_PIXELS)
    assert.equal(module._engine_init(64, 1, 64 * 1024 * 1024), ENGINE_OK)
    const tier = module._engine_models_bind_plan(...MODEL_LIMITS)
    assert.ok(tier >= 0, 'the model pool did not bind: ' + tier)
    const allocations = Number(module._engine_allocations_total())
    const indices = CLUSTER_INDICES * 7
    const handle = module._engine_models_load(64, indices, 7)
    assert.ok(handle > 0)
    assert.equal(module._engine_models_lod_count(handle), 1)
    assert.equal(module._engine_models_lod_level(handle), LOD_UNSET)
    assert.equal(module._engine_models_set_lods(handle, CLUSTER_INDICES, CLUSTER_INDICES * 2, CLUSTER_INDICES * 4, 0), ENGINE_OK)
    assert.equal(module._engine_models_lod_count(handle), 3)
    assert.equal(module._engine_models_lod_indices(handle, 0), CLUSTER_INDICES * 4)
    assert.equal(module._engine_models_lod_indices(handle, 2), CLUSTER_INDICES)
    assert.equal(module._engine_models_set_lods(handle, 381, indices - 381, 0, 0), ENGINE_RANGE)
    assert.equal(module._engine_models_set_lods(handle, CLUSTER_INDICES, 0, CLUSTER_INDICES * 6, 0), ENGINE_RANGE)
    assert.equal(module._engine_models_set_lods(handle, CLUSTER_INDICES, CLUSTER_INDICES, 0, 0), ENGINE_RANGE)
    assert.equal(module._engine_models_set_lods(handle + 1, CLUSTER_INDICES, CLUSTER_INDICES * 6, 0, 0), ENGINE_BAD_ID)
    assert.equal(module._engine_models_lod_count(handle), 3)
    assert.equal(module._engine_models_set_lod_pixels(0), ENGINE_RANGE)
    assert.equal(module._engine_models_set_index_budget(BUDGET), ENGINE_OK)
    assert.equal(module._engine_models_index_budget(), BUDGET)
    const stats = module._engine_models_lod_select(0, 0, 0, 1000) / 4
    assert.equal(stats, module._engine_models_lod_stats() / 4)
    const words = Array.from(module.HEAPU32.subarray(stats, stats + STATS_WORDS - 1))
    assert.deepEqual(words, [0, 0, BUDGET, 1, 0, 0, 0], 'cost, demand, budget, passes, shed, changed, slots')
    assert.equal(module._engine_models_lod_level(handle), LOD_UNSET)
    assert.equal(module._engine_models_set_index_budget(NO_BUDGET), ENGINE_OK)
    assert.equal(module._engine_models_unload(handle), ENGINE_OK)
    assert.equal(Number(module._engine_allocations_total()), allocations, 'lod calls allocated')
  })
}

finish()
