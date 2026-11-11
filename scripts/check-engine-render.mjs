import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => readFileSync(join(root, file), 'utf8')
const RENDER_FILES = ['engine/src/render/render_frame.h', 'engine/src/render/render_frame.cpp', 'engine/src/render/render_backend.h', 'engine/src/render/render_webgpu.h', 'engine/src/render/render_webgpu.cpp', 'engine/src/render/render_webgl2.h', 'engine/src/render/render_webgl2.cpp', 'engine/src/exports_render.cpp']

const EXPECT_EXPORTS = [
  'engine_render_init',
  'engine_render_seal',
  'engine_render_frame',
  'engine_render_camera',
  'engine_render_body_classes',
  'engine_render_body_slots',
  'engine_render_placements',
  'engine_render_lights',
  'engine_render_set_light_count',
  'engine_render_material_table',
  'engine_render_bind_materials',
  'engine_render_albedo_staging',
  'engine_render_commit_albedo',
  'engine_render_place_page',
  'engine_render_unplace_page',
  'engine_render_mark_page',
  'engine_render_backend',
  'engine_render_api_calls_last_frame',
  'engine_render_frames',
  'engine_render_checksum',
  'engine_render_visible',
  'engine_render_pages',
  'engine_render_uploads',
  'engine_render_light_count',
  'engine_render_creates_after_seal',
  'engine_render_allocations_since_warmup',
  'engine_render_set_count_readback',
  'engine_render_cull_ready',
  'engine_render_cull_counts',
]

const EXPECT_LAYOUT = {
  MaterialSlot: 40,
  LightSlot: 32,
  PagePlacement: 56,
  Camera: 224,
  Transform: 28,
}
const EXPECT_PAGE_SIDE = 16
const EXPECT_PAGE_LAYERS = 256
const EXPECT_PROP_CLASSES = 4
const EXPECT_ALLOCATIONS_SINCE_WARMUP = '0'
const EXPECT_FRAMES = 600
const PHASE10_MAX_API_CALLS_PER_FRAME = 64
const PHASE11_MAX_API_CALLS_PER_FRAME = 64
const FORBIDDEN_IN_RENDER = [/wgpuBufferGetMappedRange/, /WaitAny/, /\bmalloc\s*\(/, /std::vector/, /\bnew\s+[A-Za-z_]/]

const sources = Object.fromEntries(RENDER_FILES.map((file) => [file, read(file)]))
const cmake = read('engine/CMakeLists.txt')
const exportsSource = sources['engine/src/exports_render.cpp']
const renderFrameHeader = sources['engine/src/render/render_frame.h']
const renderFrameWrite = read('engine/src/render/render_frame.cpp')
const budgetSource = read('engine/src/budget.cpp')
const budgetHeader = read('engine/src/budget.h')
const gluePath = join(root, 'engine/out/engine-core-64mib.mjs')
const wasmPath = join(root, 'engine/out/engine-core-64mib.wasm')

gate('every engine_render export is defined in exports_render.cpp as EMSCRIPTEN_KEEPALIVE C linkage', () => {
  for (const name of EXPECT_EXPORTS) {
    assert.match(exportsSource, new RegExp('EMSCRIPTEN_KEEPALIVE [^\\n]*\\b' + name + '\\('), name)
  }
})

gate('every engine_render export is listed in ENGINE_EXPORTS of engine/CMakeLists.txt with a leading underscore', () => {
  for (const name of EXPECT_EXPORTS) assert.ok(cmake.includes('_' + name), 'CMake export list lacks _' + name)
})

gate('the render sources are added to the engine_core executable', () => {
  for (const file of ['src/render/render_frame.cpp', 'src/render/render_webgpu.cpp', 'src/render/render_webgl2.cpp', 'src/exports_render.cpp']) {
    assert.ok(cmake.includes(file), 'CMake add_executable lacks ' + file)
  }
})

gate('the layout static_asserts pin the byte sizes of the slot structs and the transform', () => {
  for (const [name, bytes] of Object.entries(EXPECT_LAYOUT)) {
    assert.ok(renderFrameHeader.includes('sizeof(' + name + ') == ' + bytes) || renderFrameHeader.includes('sizeof(Transform) == ' + bytes), name + ' static_assert ' + bytes)
  }
})

gate('the page is 16 by 16 float samples, the layer array is sized to the largest store, and the count is read from the store at run time', () => {
  assert.ok(renderFrameHeader.includes('kMaxPageLayers = planet::kMaxRenderedPages'))
  assert.ok(renderFrameHeader.includes('kPageSide = planet::kPageSide'))
  assert.ok(renderFrameHeader.includes('std::uint32_t pageLayers();'))
  assert.ok(renderFrameWrite.includes('std::uint32_t pageLayers() {'))
  assert.ok(renderFrameWrite.includes('planet::state().pages.pageSlotCount()'))
  assert.ok(budgetSource.includes('std::uint32_t pageSlotsFor(std::uint64_t budgetBytes)'))
  assert.ok(budgetSource.includes('constexpr std::uint64_t kPageBudgetDivisor = 8'))
  assert.ok(budgetSource.includes('next.pageSlots = pageSlotsFor(budgetBytes)'))
  assert.equal(EXPECT_PAGE_SIDE * EXPECT_PAGE_SIDE, 256)
  assert.equal(EXPECT_PAGE_LAYERS, 256)
})

gate('the prop classes and body slots match the expected instance buffer shape', () => {
  assert.ok(renderFrameHeader.includes('kPropClasses = 4'))
  assert.ok(renderFrameHeader.includes('std::uint32_t* propRecords;'), 'the instance records are not sized by the plan')
  assert.ok(renderFrameHeader.includes('std::uint32_t bodySlots;'))
  assert.ok(exportsSource.includes('engine::world().bodyCapacity()'), 'the render slots do not follow the planned bodies')
  assert.ok(budgetSource.includes('kRenderFixedBytes + bodies * kRenderBytesPerBody'), 'the plan does not charge the render slots per planned body')
  assert.ok(budgetHeader.includes('kRenderBytesPerBody = 136'))
  assert.equal(EXPECT_PROP_CLASSES, 4)
})

gate('the render sources never map a buffer, wait on a future or allocate on the heap', () => {
  for (const file of RENDER_FILES.filter((f) => f !== 'engine/src/exports_render.cpp' && f.endsWith('.cpp'))) {
    for (const pattern of FORBIDDEN_IN_RENDER) assert.doesNotMatch(sources[file], pattern, file + ' matches ' + pattern)
  }
})

gate('uploads go through queue writes or texSubImage, never mapped ranges', () => {
  const webgpu = sources['engine/src/render/render_webgpu.cpp']
  assert.ok(webgpu.includes('queue.WriteBuffer'))
  assert.ok(webgpu.includes('queue.WriteTexture'))
  assert.ok(sources['engine/src/render/render_webgl2.cpp'].includes('glTexSubImage3D'))
})

gate('the indirect args live in one buffer, written by queue writes from the CPU-culled records', () => {
  const webgpu = sources['engine/src/render/render_webgpu.cpp']
  assert.equal([...webgpu.matchAll(/argsBuf/g)].length >= 6, true)
  assert.ok(webgpu.includes('writeBuffer(argsBuf'))
  assert.ok(webgpu.includes('DrawIndirect(argsBuf'))
  const forwardStart = webgpu.indexOf('void encodeForward(')
  const cullStart = webgpu.indexOf('void dispatchCull(')
  assert.ok(forwardStart > 0 && cullStart > forwardStart)
  assert.ok(!webgpu.slice(forwardStart, cullStart).includes('DispatchWorkgroups'), 'the forward path has no compute dispatch')
})

gate('pipelines are compiled in init only, and a sealed registry refuses a create', () => {
  const webgpu = sources['engine/src/render/render_webgpu.cpp']
  const frameStart = webgpu.indexOf('int frame(')
  assert.ok(frameStart > 0)
  assert.doesNotMatch(webgpu.slice(frameStart), /CreateRenderPipeline|CreateComputePipeline|CreateShaderModule|CreateBuffer|CreateTexture/)
  assert.ok(renderFrameHeader.includes('acceptCreate'))
  assert.ok(sources['engine/src/render/render_frame.cpp'].includes('state.createsAfterSeal += 1'))
})

gate('the WebGL2 frame never compiles a program or allocates a buffer', () => {
  const gl = sources['engine/src/render/render_webgl2.cpp']
  const frameStart = gl.indexOf('int frame(')
  assert.ok(frameStart > 0)
  assert.doesNotMatch(gl.slice(frameStart), /glCreate|glGen|glBufferData|glTexStorage/)
})

gate('the backend choice is one runtime flag passed to engine_render_init', () => {
  assert.ok(exportsSource.includes('engine_render_init(std::uint32_t backend)'))
  assert.ok(sources['engine/src/render/render_backend.h'].includes('kWebGpu = 0'))
  assert.ok(sources['engine/src/render/render_backend.h'].includes('kWebGl2 = 1'))
})

gate('the per-frame API call counter is reset at the start of each frame and kept at the end', () => {
  assert.ok(exportsSource.includes('rnd::counters().apiCalls = 0'))
  assert.ok(exportsSource.includes('rnd::counters().apiCallsLast = rnd::counters().apiCalls'))
})

gate('the JS loader exports the backend choice and the layout the C++ structs use', async () => {
  const renderer = await import('../src/engine/renderer.js')
  assert.equal(renderer.chooseBackend('auto', true), 0)
  assert.equal(renderer.chooseBackend('auto', false), 1)
  assert.equal(renderer.chooseBackend('webgl2', true), 1)
  assert.throws(() => renderer.chooseBackend('webgpu', false))
  assert.equal(renderer.RENDER_LAYOUT.CAMERA_BYTES, EXPECT_LAYOUT.Camera)
  assert.equal(renderer.RENDER_LAYOUT.PLACEMENT_WORDS * 4, EXPECT_LAYOUT.PagePlacement)
  assert.equal(renderer.RENDER_LAYOUT.LIGHT_WORDS * 4, EXPECT_LAYOUT.LightSlot)
  assert.equal(renderer.RENDER_LAYOUT.MATERIAL_WORDS * 4, EXPECT_LAYOUT.MaterialSlot)
  assert.equal(renderer.RENDER_LAYOUT.PAGE_LAYERS, EXPECT_PAGE_LAYERS)
  assert.equal(renderer.RENDER_LAYOUT.ALBEDO_SIDE, 16)
})

gate('the built module exports every engine_render name when engine/out is present', async () => {
  assert.ok(existsSync(wasmPath), 'engine/out/engine-core-64mib.wasm is not built, so the module exports cannot be read')
  const mod = await (await import(pathToFileURL(gluePath).href)).default()
  for (const name of EXPECT_EXPORTS) assert.equal(typeof mod['_' + name], 'function', name)
})

gate('the witness pages exist and run the two backends the phases name', () => {
  const html = read('scripts/browser/engine-render.html')
  const page = read('scripts/browser/engine-render-browser.js')
  assert.ok(html.includes('engine-render-browser.js'))
  assert.ok(page.includes("requested = PHASE === 11 ? 'webgl2' : 'webgpu'"))
  assert.ok(page.includes('navigatorLike = PHASE === 11 ? {} : navigator'))
  assert.ok(page.includes("const FRAMES = QUERY.has('frames') ? Number(QUERY.get('frames')) : " + EXPECT_FRAMES))
  assert.ok(page.includes('allocationsSinceWarmup'))
})

gate('a recorded witness result meets the phase budgets when one is given', () => {
  const file = process.argv[2]
  if (!file) return
  const result = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(result.allocationsSinceWarmup, EXPECT_ALLOCATIONS_SINCE_WARMUP)
  assert.equal(result.frames, EXPECT_FRAMES)
  const limit = result.phase === 11 ? PHASE11_MAX_API_CALLS_PER_FRAME : PHASE10_MAX_API_CALLS_PER_FRAME
  assert.ok(result.apiCallsPerFrame <= limit, 'api calls per frame ' + result.apiCallsPerFrame + ' exceed ' + limit)
  assert.equal(result.backend, result.phase === 11 ? 'webgl2' : 'webgpu')
  assert.equal(result.errors.length, 0)
})

gate('the one buffer map in the render sources is the cull counts readback, issued after submit and gated by the witness knob', () => {
  const webgpu = sources['engine/src/render/render_webgpu.cpp']
  assert.equal([...webgpu.matchAll(/MapAsync\(/g)].length, 1, 'exactly one MapAsync call')
  const frameStart = webgpu.indexOf('int frame(')
  const submit = webgpu.indexOf('queue.Submit(', frameStart)
  const map = webgpu.indexOf('MapAsync(', frameStart)
  assert.ok(submit > frameStart && map > submit, 'the map follows the submit inside frame()')
  assert.ok(webgpu.includes('if (cullCopied)'), 'the map runs only after a counts copy')
  assert.ok(webgpu.includes('if (countReadback && !cullPending)'), 'the copy runs only with the knob on and no map in flight')
  for (const file of RENDER_FILES.filter((f) => f.endsWith('.cpp') && f !== 'engine/src/render/render_webgpu.cpp')) {
    assert.doesNotMatch(sources[file], /MapAsync\(/, file + ' maps a buffer')
  }
})

finish()
