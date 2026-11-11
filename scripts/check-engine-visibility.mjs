import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => readFileSync(join(root, file), 'utf8')

const NEW_EXPORTS = [
  'engine_models_acquire',
  'engine_models_cluster_stride',
  'engine_models_cluster_bytes',
  'engine_models_clusters_ptr',
  'engine_render_set_model_path',
  'engine_render_model_path',
  'engine_render_model_path_effective',
  'engine_render_set_occlusion',
  'engine_render_occlusion',
  'engine_models_slot_of',
  'engine_render_set_count_readback',
  'engine_render_cull_ready',
  'engine_render_cull_counts',
]
const EXPORT_SOURCES = ['engine/src/exports_models.cpp', 'engine/src/exports_render.cpp']
const WEBGPU = 'engine/src/render/render_webgpu.cpp'
const WEBGL2 = 'engine/src/render/render_webgl2.cpp'
const COMMENT_FREE = [
  WEBGPU,
  WEBGL2,
  'engine/src/render/render_frame.h',
  'engine/src/render/render_frame.cpp',
  'engine/src/model_pool.cpp',
  'engine/src/model_pool.h',
  'engine/test/occlusion_reference.h',
  'engine/test/witness_visibility.cpp',
  'scripts/browser/visibility-browser.js',
  'scripts/browser/visibility-run.mjs',
  'scripts/check-engine-visibility.mjs',
  'src/engine/renderer.js',
]
const BROWSER_FILES = ['scripts/browser/visibility.html', 'scripts/browser/visibility-browser.js', 'scripts/browser/visibility-run.mjs']

const cmake = read('engine/CMakeLists.txt')
const webgpu = read(WEBGPU)
const webgl2 = read(WEBGL2)
const renderer = read('src/engine/renderer.js')
const buildHost = read('engine/test/build_host.sh')
const mainAll = read('engine/test/main_all.cpp')
const witness = read('engine/test/witness_visibility.cpp')
const exportText = EXPORT_SOURCES.map(read).join('\n')

gate('every visibility export is listed in ENGINE_EXPORTS', () => {
  const missing = NEW_EXPORTS.filter((name) => !cmake.includes('  _' + name + '\n') && !cmake.includes('  _' + name + ')'))
  if (missing.length > 0) throw new Error('not listed: ' + missing.join(', '))
})

gate('every visibility export is defined in its source file', () => {
  const missing = NEW_EXPORTS.filter((name) => !new RegExp('EMSCRIPTEN_KEEPALIVE [^\\n]*\\b' + name + '\\(').test(exportText))
  if (missing.length > 0) throw new Error('not defined: ' + missing.join(', '))
})

gate('the WebGPU model shader clips through clipOf in both the forward and id paths', () => {
  if (/out\.clip = cam\.viewProj/.test(webgpu)) throw new Error('a raw GL-style viewProj clip remains in the WGSL')
  if (!/fn vsModel[\s\S]*?out\.clip = clipOf\(cam\.viewProj/.test(webgpu)) throw new Error('vsModel does not clip through clipOf')
  if (!/fn vsId[\s\S]*?out\.clip = clipOf\(cam\.viewProj/.test(webgpu)) throw new Error('vsId does not clip through clipOf')
})

gate('the depth format is Depth32Float everywhere the WebGPU renderer makes a depth attachment', () => {
  if (webgpu.includes('Depth24Plus')) throw new Error('Depth24Plus is still named')
  const count = webgpu.split('wgpu::TextureFormat::Depth32Float').length - 1
  if (count < 3) throw new Error('expected Depth32Float on the props, models and id pipelines, found ' + count)
})

gate('the HZB is power-of-two and clamps its tail levels to one texel', () => {
  if (webgpu.includes('levelDim(')) throw new Error('the ceil level size helper is still used')
  if (!webgpu.includes('powerOfTwoAtLeast(width)')) throw new Error('the HZB is not padded to a power of two')
  if (!/max\(params\.hzbWidth >> level, 1u\)/.test(webgpu)) throw new Error('the occlusion sampler does not clamp the tail level width')
  if (!/textureDimensions\(depthSrc\)/.test(webgpu)) throw new Error('the depth copy does not guard against padding texels')
})

gate('the surface is configured for copy-out and the storage binding limit is requested', () => {
  if (!webgpu.includes('wgpu::TextureUsage::CopySrc')) throw new Error('the surface lacks CopySrc')
  if (!renderer.includes('maxStorageBufferBindingSize')) throw new Error('renderer.js does not request maxStorageBufferBindingSize')
  if (!/Math\.min\(maxBufferSize, maxStorageBufferBindingSize\)/.test(renderer)) throw new Error('the pool size is not clamped to the storage binding limit')
})

gate('the WebGL2 renderer draws models forward with CPU cluster culling and reports the forward path', () => {
  if (!webgl2.includes('drawModels(camera, scene.origin)')) throw new Error('the WebGL2 frame does not draw models')
  if (!webgl2.includes('visibleRuns(s, camera.planes, modelRuns, &kept, frameOrigin)')) throw new Error('the WebGL2 model draw does not use the CPU cluster culling')
  if (!webgl2.includes('drawn += kept')) throw new Error('the WebGL2 model draw does not count the clusters it keeps')
  if (!webgl2.includes('counters().modelPath = engine::render::kModelPathForward')) throw new Error('the WebGL2 frame does not report the forward path')
})

gate('renderer.js exposes the model path, occlusion and cluster stride controls', () => {
  const needed = ['setModelPath(path)', 'setOcclusion(on)', 'get modelPath()', 'get effectiveModelPath()', 'get occlusion()', 'clusterStride()']
  const missing = needed.filter((text) => !renderer.includes(text))
  if (missing.length > 0) throw new Error('missing: ' + missing.join(', '))
})

gate('the host witness is built, listed and called', () => {
  if (!buildHost.includes('"$engine/test/witness_visibility.cpp"')) throw new Error('build_host.sh does not compile witness_visibility.cpp')
  if (!mainAll.includes('void visibilityAndOcclusion();')) throw new Error('main_all.cpp does not declare visibilityAndOcclusion')
  if (!mainAll.includes('engine::witness::visibilityAndOcclusion();')) throw new Error('main_all.cpp does not call visibilityAndOcclusion')
})

gate('the witness checks the id round trip, the pyramid and conservative occlusion', () => {
  const needed = ['visibilityId(kLargestCluster, 127) == 16777216u', 'pyramidMismatches() == 0u', 'random.violations == 0u', 'blank.occluded == 0u']
  const missing = needed.filter((text) => !witness.includes(text))
  if (missing.length > 0) throw new Error('missing: ' + missing.join(', '))
  if (!witness.includes('"occlusion_reference.h"')) throw new Error('the witness does not include the reference')
})

gate('the browser witness files exist', () => {
  const missing = BROWSER_FILES.filter((file) => !existsSync(join(root, file)))
  if (missing.length > 0) throw new Error('missing: ' + missing.join(', '))
})

gate('the test script runs this gate', () => {
  const pkg = JSON.parse(read('package.json'))
  if (!pkg.scripts['check:engine-visibility']) throw new Error('package.json has no check:engine-visibility script')
  if (!JSON.parse(read('scripts/test-chain.json')).includes('check:engine-visibility')) throw new Error('npm test does not run check:engine-visibility')
})

gate('the files this change adds or edits carry no comments', () => {
  const marker = /\/\/|\/\*/
  const found = COMMENT_FREE.filter((file) => existsSync(join(root, file)) && marker.test(read(file)))
  if (found.length > 0) throw new Error('comment markers in: ' + found.join(', '))
})

finish()
