import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => readFileSync(join(root, file), 'utf8')
const GLUES = ['engine/out/engine-core-64mib.mjs', 'engine/out/engine-core-512mib.mjs']
const EXPORTS = ['engine_terrain_lod_configure', 'engine_terrain_lod_select', 'engine_terrain_lod_state', 'engine_render_set_page_lod', 'engine_render_pages_placed', 'engine_render_pages_shed', 'engine_render_page_records']
const ENGINE_OK = 0
const ENGINE_RANGE = -2
const BUDGET = 64
const LEVELS = 6
const FULL_M = 100
const HYSTERESIS = 0.25
const MORPH_BAND = 0.5
const SWEEP_STEPS = 2000
const SWEEP_TOP = 6.5

const header = read('engine/src/terrain_lod.h')
const source = read('engine/src/terrain_lod.cpp')
const frame = read('engine/src/render/render_frame.cpp')
const frameHeader = read('engine/src/render/render_frame.h')
const exportsSource = read('engine/src/exports_render.cpp')
const cmake = read('engine/CMakeLists.txt')
const witness = read('engine/test/witness_terrain_lod.cpp')
const buildHost = read('engine/test/build_host.sh')
const mainAll = read('engine/test/main_all.cpp')
const renderer = read('src/engine/renderer.js')

const stateOf = (module, at) => ({
  pageBudget: module.HEAPU32[at >> 2],
  levels: module.HEAPU32[(at >> 2) + 1],
  level: module.HEAPU32[(at >> 2) + 2],
  window: module.HEAPU32[(at >> 2) + 3],
  spanCells: module.HEAPU32[(at >> 2) + 4],
  switches: module.HEAPU32[(at >> 2) + 5],
  morph: module.HEAPF32[(at >> 2) + 6],
  ratio: module.HEAPF32[(at >> 2) + 7],
})

const levelAfter = (previous, ratio) => {
  const up = Math.floor(Math.fround(ratio - HYSTERESIS))
  const down = Math.floor(Math.fround(ratio + HYSTERESIS))
  const level = up > previous ? up : down < previous ? down : previous
  return Math.min(LEVELS - 1, Math.max(0, level))
}

gate('every terrain lod export is defined as EMSCRIPTEN_KEEPALIVE and listed in ENGINE_EXPORTS, and the source is compiled into the wasm and the host witness', () => {
  for (const name of EXPORTS) {
    assert.match(exportsSource, new RegExp('EMSCRIPTEN_KEEPALIVE [^\\n]*\\b' + name + '\\('), name)
    assert.ok(cmake.includes('\n  _' + name + '\n'), 'CMake export list lacks _' + name)
  }
  assert.ok(cmake.includes('\n  src/terrain_lod.cpp\n'))
  assert.ok(buildHost.includes('"$engine/src/terrain_lod.cpp"') && buildHost.includes('"$engine/test/witness_terrain_lod.cpp"'))
  assert.ok(mainAll.includes('void terrainLod();') && mainAll.includes('engine::witness::terrainLod();'))
})

gate('the default is no page budget, the hysteresis is a quarter level, and the morph band fits between two hysteresis bands', () => {
  assert.ok(header.includes('constexpr std::uint32_t kNoPageBudget = 0;'))
  assert.ok(header.includes('constexpr float kLevelHysteresis = ' + HYSTERESIS + 'f;'))
  assert.ok(header.includes('constexpr float kMorphBand = ' + MORPH_BAND + 'f;'))
  assert.ok(header.includes('static_assert(kMorphBand <= 1.0f - 2.0f * kLevelHysteresis);'))
  assert.ok(header.includes('static_assert(sizeof(LodState) == 48);') && header.includes('static_assert(sizeof(PageLod) == 4);'))
  assert.doesNotMatch(source, /std::vector|\bmalloc\s*\(|\bnew\s+[A-Za-z_]/)
})

gate('the page record carries the blend factor in word 1, the parent layer in word 2 and the level and quadrant in word 3, and the plan sheds pages over the budget by level', () => {
  assert.ok(frameHeader.includes('constexpr std::uint32_t kPageMorphWord = 1;'))
  assert.ok(frameHeader.includes('constexpr std::uint32_t kPageParentWord = 2;'))
  assert.ok(frameHeader.includes('constexpr std::uint32_t kPageLodWord = 3;'))
  assert.ok(frame.includes('out[kPageMorphWord] = bitsOf(morph);'))
  assert.ok(frame.includes('const float morph = parentLayer == kNoLayer ? 0.0f : terrain::morphOf(page.level, lod.ratio, lod.levels);'))
  assert.ok(frame.includes('if (!terrain::enabled()) return;'))
  assert.ok(frame.includes('std::uint32_t room = lod.pageBudget;'))
})

gate('the host witness checks the switches, the hysteresis, the blend at every switch, the records and the page budget', () => {
  for (const text of ['levelSwitches == 2 * (kLevels - 1) && pops == 0', 'overBudget == 0', 'lod.switches == before', 'rnd::counters().pagesShed == kPages - kTightBudget', 'engine::arena::carves() == carves']) assert.ok(witness.includes(text), text)
})

gate('the renderer wraps the configuration, the selection, the page level and the shed count', () => {
  for (const text of ['configureTerrainLod({ pageBudget, levels = TERRAIN_MAX_LEVELS, fullDetailAltitudeM = 1 })', 'selectTerrainLod(altitudeM)', 'setPageLod(slot, { level, parentSlot = TERRAIN_NO_PARENT, quadrant = 0 })', 'terrainPages()']) assert.ok(renderer.includes(text), text)
})

for (const glue of GLUES) {
  gate(glue + ': the built module starts with no page budget, refuses a bad configuration, and over a sweep up and down picks the level by log2 of the altitude ratio with a quarter-level hysteresis band', async () => {
    const module = await (await import(pathToFileURL(join(root, glue)).href)).default()
    for (const name of EXPORTS) assert.equal(typeof module['_' + name], 'function', name)
    const off = stateOf(module, module._engine_terrain_lod_state())
    assert.deepEqual(off, { pageBudget: 0, levels: 0, level: 0, window: 0, spanCells: 0, switches: 0, morph: 0, ratio: 0 })
    assert.deepEqual(stateOf(module, module._engine_terrain_lod_select(5000)), off, 'a selection with no budget changed the state')
    assert.equal(module._engine_terrain_lod_configure(BUDGET, 0, FULL_M), ENGINE_RANGE)
    assert.equal(module._engine_terrain_lod_configure(BUDGET, 17, FULL_M), ENGINE_RANGE)
    assert.equal(module._engine_terrain_lod_configure(BUDGET, LEVELS, 0), ENGINE_RANGE)
    assert.equal(module._engine_render_set_page_lod(0, 1, -1, 0), ENGINE_RANGE, 'a page level was accepted before the renderer exists')
    assert.equal(module._engine_terrain_lod_configure(BUDGET, LEVELS, FULL_M), ENGINE_OK)
    const allocations = Number(module._engine_allocations_total())
    let level = 0
    let switches = 0
    let worstMorphGap = 0
    for (let pass = 0; pass < 2; pass++) {
      for (let step = 0; step <= SWEEP_STEPS; step++) {
        const along = step / SWEEP_STEPS
        const altitude = FULL_M * 2 ** (SWEEP_TOP * (pass === 0 ? along : 1 - along))
        const state = stateOf(module, module._engine_terrain_lod_select(altitude))
        const expected = levelAfter(level, state.ratio)
        assert.equal(state.level, expected, 'at ' + altitude + ' m')
        if (expected !== level) switches += 1
        level = expected
        assert.equal(state.window, 8)
        assert.equal(state.spanCells, 1 << level)
        assert.ok(state.window * state.window <= BUDGET)
        const morph = level === LEVELS - 1 ? 0 : Math.min(1, Math.max(0, (state.ratio - (level + 1 - HYSTERESIS - MORPH_BAND)) / MORPH_BAND))
        worstMorphGap = Math.max(worstMorphGap, Math.abs(morph - state.morph))
      }
    }
    assert.equal(switches, 2 * (LEVELS - 1))
    assert.equal(stateOf(module, module._engine_terrain_lod_state()).switches, switches)
    assert.ok(worstMorphGap < 1e-5, 'the blend factor is off the law by ' + worstMorphGap)
    assert.equal(Number(module._engine_allocations_total()), allocations, 'selection allocated')
    assert.equal(module._engine_terrain_lod_configure(0, 0, 0), ENGINE_OK)
    assert.deepEqual(stateOf(module, module._engine_terrain_lod_state()), off)
  })
}

finish()
