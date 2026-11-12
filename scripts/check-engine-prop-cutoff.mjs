import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => readFileSync(join(root, file), 'utf8')
const GLUES = ['engine/out/engine-core-64mib.mjs', 'engine/out/engine-core-512mib.mjs']
const EXPORT = 'engine_render_prop_cutoff_squared'
const BIN_SHIFT = 20
const NEAR_BITS = 0x3e800000 >>> BIN_SHIFT
const BINS = 256

const frame = read('engine/src/render/render_frame.cpp')
const header = read('engine/src/render/render_frame.h')
const webgpu = read('engine/src/render/render_webgpu.cpp')
const exportsSource = read('engine/src/exports_render.cpp')
const cmake = read('engine/CMakeLists.txt')
const witness = read('engine/test/witness_phase10_plan.cpp')

const bitsOf = (value) => new Uint32Array(new Float32Array([value]).buffer)[0]
const floatOf = (bits) => new Float32Array(new Uint32Array([bits]).buffer)[0]
const binOf = (squared) => {
  const bits = bitsOf(squared) >>> BIN_SHIFT
  return bits <= NEAR_BITS ? 0 : Math.min(bits - NEAR_BITS, BINS - 1)
}
const cutoffOf = (bins) => floatOf(((bins + NEAR_BITS) << BIN_SHIFT) >>> 0)

gate('the cutoff export is defined as EMSCRIPTEN_KEEPALIVE and listed in ENGINE_EXPORTS', () => {
  assert.match(exportsSource, new RegExp('EMSCRIPTEN_KEEPALIVE [^\\n]*\\b' + EXPORT + '\\('))
  assert.ok(cmake.includes('\n  _' + EXPORT + '\n'))
})

gate('the camera keeps its 240 bytes: the cutoff rides in the spare eye word and the flag in the spare count word', () => {
  assert.ok(header.includes('static_assert(sizeof(Camera) == 240);'))
  assert.ok(header.includes('constexpr std::uint32_t kCameraCutoffFlagWord = 2;'))
  assert.ok(header.includes('constexpr std::uint32_t kCameraCutoffWord = 3;'))
  assert.ok(frame.includes('camera.counts[kCameraCutoffFlagWord] = cut ? 1u : 0u;'))
  assert.ok(frame.includes('camera.eye[kCameraCutoffWord] = cut && budget.bins != 0 ? propCutoffSquared(budget.bins) : 0.0f;'))
})

gate('with no budget the flag and the cutoff word are zero, so the uniform and the shader result are what they were', () => {
  assert.ok(frame.includes('const bool cut = budget.limit != kNoPropBudget && budget.bins < kPropBudgetBins;'))
  assert.ok(webgpu.includes('let inside = cam.counts.z == 0u || dot(away, away) < cam.eye.w;'))
  assert.ok(webgpu.includes('clipOf(cam.viewProj * vec4f(world, 1.0)), shown && inside);'))
  assert.ok(witness.includes('camera.counts[rnd::kCameraCutoffFlagWord] == 0 && camera.eye[rnd::kCameraCutoffWord] == 0.0f'))
})

gate('under a budget the WebGPU frame plans the props every frame, so the cutoff follows the camera', () => {
  assert.ok(exportsSource.includes('if (rnd::propBudget().limit != rnd::kNoPropBudget) scene.skipProps = false;'))
})

gate('a squared distance below the carried cutoff is exactly a distance band below the cutoff band, over a million distances', () => {
  let seed = 12345
  let wrong = 0
  for (let i = 0; i < 1000000; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    const squared = Math.fround(2 ** ((seed / 4294967296) * 40 - 8))
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    const bins = seed % BINS
    if (bins === 0) continue
    if ((squared < cutoffOf(bins)) !== (binOf(squared) < bins)) wrong += 1
  }
  assert.equal(wrong, 0)
  assert.equal(cutoffOf(1), floatOf(((1 + NEAR_BITS) << BIN_SHIFT) >>> 0))
  assert.ok(witness.includes('ruleMismatches == 0'))
  assert.ok(witness.includes('shaderShown == nearerThanBoundary && shaderShown <= kBudget'))
})

for (const glue of GLUES) {
  gate(glue + ': the built module exports the cutoff and reports none before a renderer plans a frame', async () => {
    const module = await (await import(pathToFileURL(join(root, glue)).href)).default()
    assert.equal(typeof module['_' + EXPORT], 'function')
    assert.equal(module['_' + EXPORT](), 0)
  })
}

finish()
