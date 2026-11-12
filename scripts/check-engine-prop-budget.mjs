import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => readFileSync(join(root, file), 'utf8')
const GLUES = ['engine/out/engine-core-64mib.mjs', 'engine/out/engine-core-512mib-threads.mjs']
const EXPORTS = ['engine_render_set_prop_budget', 'engine_render_prop_budget', 'engine_render_prop_cutoff_bins', 'engine_render_props_in_frustum', 'engine_render_props_shed']
const NO_BUDGET = 0
const CUTOFF_BINS = 256
const BUDGET = 2000
const ENGINE_OK = 0

const frame = read('engine/src/render/render_frame.cpp')
const header = read('engine/src/render/render_frame.h')
const exportsSource = read('engine/src/exports_render.cpp')
const cmake = read('engine/CMakeLists.txt')
const witness = read('engine/test/witness_phase10_plan.cpp')

gate('every prop budget export is defined as EMSCRIPTEN_KEEPALIVE and listed in ENGINE_EXPORTS', () => {
  for (const name of EXPORTS) {
    assert.match(exportsSource, new RegExp('EMSCRIPTEN_KEEPALIVE [^\\n]*\\b' + name + '\\('), name)
    assert.ok(cmake.includes('\n  _' + name + '\n'), 'CMake export list lacks _' + name)
  }
})

gate('the default is no budget, and the cutoff has ' + CUTOFF_BINS + ' distance bands', () => {
  assert.ok(header.includes('constexpr std::uint32_t kNoPropBudget = ' + NO_BUDGET + ';'))
  assert.ok(header.includes('constexpr std::uint32_t kPropBudgetBins = ' + CUTOFF_BINS + ';'))
  assert.ok(frame.includes('PropBudget budget{kNoPropBudget, kPropBudgetBins};'))
})

gate('the budgeted plan uses a fixed histogram on the stack, with no sort and no heap', () => {
  const start = frame.indexOf('std::uint32_t carryCutoff(')
  const end = frame.indexOf('std::uint32_t firstFreeLayer(')
  assert.ok(start > 0 && end > start)
  const body = frame.slice(start, end)
  assert.ok(body.includes('std::uint32_t histogram[kPropBudgetBins];'))
  assert.doesNotMatch(frame, /std::sort|std::nth_element|std::vector|\bmalloc\s*\(|\bnew\s+[A-Za-z_]/)
})

gate('the host witness plans under a budget and checks the kept set against a full sort', () => {
  assert.ok(witness.includes('propBudgetWitness(scene);'))
  assert.ok(witness.includes('std::sort(sortedDistance, sortedDistance + every);'))
  assert.ok(witness.includes('rnd::setPropBudget(kBudget);'))
})

for (const glue of GLUES) {
  gate(glue + ': the built module exports the prop budget, starts with no budget, and a set budget reads back and clears', async () => {
    const module = await (await import(pathToFileURL(join(root, glue)).href)).default()
    for (const name of EXPORTS) assert.equal(typeof module['_' + name], 'function', name)
    assert.equal(module._engine_render_prop_budget(), NO_BUDGET)
    assert.equal(module._engine_render_prop_cutoff_bins(), CUTOFF_BINS)
    assert.equal(module._engine_render_props_shed(), 0)
    assert.equal(module._engine_render_set_prop_budget(BUDGET), ENGINE_OK)
    assert.equal(module._engine_render_prop_budget(), BUDGET)
    assert.equal(module._engine_render_set_prop_budget(NO_BUDGET), ENGINE_OK)
    assert.equal(module._engine_render_prop_budget(), NO_BUDGET)
    assert.equal(module._engine_render_prop_cutoff_bins(), CUTOFF_BINS)
  })
}

finish()
