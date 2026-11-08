import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { VRMLoaderPlugin } from '@pixiv/three-vrm'
import { createModelErrorHandler } from '../shared/modelLoadErrors.js'
import { renderDeferringUnreadyPrograms } from './programReadiness.js'

const STUCK_PIPELINE_ERROR_THRESHOLD = 3
const STUCK_PIPELINE_WINDOW_MS = 2000
const STUCK_PIPELINE_RECOVERY_COOLDOWN_MS = 5000
const TEXTURE_SIZE_LIMIT = 2048

export const MAX_UNMANIFESTED_WARMUP_MESHES = 50
export const MANIFEST_RESIDENCE_WAIT_MS = 10000
export const MANIFEST_RESIDENCE_POLL_MS = 50
export const MANIFEST_RESIDENCE_MAX_POLLS = Math.ceil(MANIFEST_RESIDENCE_WAIT_MS / MANIFEST_RESIDENCE_POLL_MS)

let skeletonUploadSkipInstalled = false

export function createScene({ installUnderwaterTint = () => {}, host = null } = {}) {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x87ceeb)
  scene.fog = new THREE.FogExp2(0x87ceeb, 0.0025)
  if (host && !Number.isFinite(host.__fogFar)) host.__fogFar = 200
  installUnderwaterTint()
  installSkeletonUploadSkip()
  return scene
}

export function installSkeletonUploadSkip() {
  if (skeletonUploadSkipInstalled) return
  skeletonUploadSkipInstalled = true
  const origUpdate = THREE.Skeleton.prototype.update
  THREE.Skeleton.prototype.update = function () {
    const tex = this.boneTexture
    if (tex === null) return origUpdate.call(this)
    const vBefore = tex.version
    origUpdate.call(this)
    const m = this.boneMatrices
    let prev = this._spointPrevBoneMatrices
    if (prev === undefined || prev.length !== m.length) {
      this._spointPrevBoneMatrices = m.slice()
      return
    }
    let same = true
    for (let i = 0, l = m.length; i < l; i++) { if (m[i] !== prev[i]) { same = false; break } }
    if (same) { tex.version = vBefore; return }
    prev.set(m)
    let back = this._spointBackBoneTexture
    if (back === undefined) {
      back = new THREE.DataTexture(new Float32Array(m.length), tex.image.width, tex.image.height, THREE.RGBAFormat, THREE.FloatType)
      this._spointBackBoneTexture = back
    }
    if (back.image.data.length === m.length) {
      tex.version = vBefore
      back.image.data.set(m)
      back.needsUpdate = true
      this.boneTexture = back
      this._spointBackBoneTexture = tex
    }
  }
  const origDispose = THREE.Skeleton.prototype.dispose
  THREE.Skeleton.prototype.dispose = function () {
    if (this._spointBackBoneTexture) { this._spointBackBoneTexture.dispose(); this._spointBackBoneTexture = undefined }
    origDispose.call(this)
  }
}

export function installStuckPipelineRecovery(renderer, scene, env) {
  if (!renderer || renderer.isWebGPURenderer !== true || !scene) return
  if (!env || typeof env.now !== 'function') throw new TypeError('installStuckPipelineRecovery needs env.now')
  const warn = env.warn ?? ((message) => console.warn(message))
  let errorTimestamps = []
  let lastRecoveryAt = 0
  let pipelineErrorCount = 0
  if (env.host) env.host.__pipelineErrors = pipelineErrorCount
  const priorOnError = typeof renderer.onError === 'function' ? renderer.onError.bind(renderer) : null
  renderer.onError = (info) => {
    if (priorOnError) priorOnError(info)
    const msg = (info && info.message) || ''
    if (!/RenderPipeline|CommandBuffer/.test(msg)) return
    pipelineErrorCount++
    if (env.host) env.host.__pipelineErrors = pipelineErrorCount
    const now = env.now()
    errorTimestamps.push(now)
    errorTimestamps = errorTimestamps.filter(t => now - t <= STUCK_PIPELINE_WINDOW_MS)
    if (errorTimestamps.length < STUCK_PIPELINE_ERROR_THRESHOLD) return
    if (now - lastRecoveryAt < STUCK_PIPELINE_RECOVERY_COOLDOWN_MS) return
    lastRecoveryAt = now
    errorTimestamps = []
    warn('[renderer] stuck WebGPU pipeline failure detected -- forcing a scene-wide material recompile')
    scene.traverse(obj => {
      const mats = Array.isArray(obj.material) ? obj.material : (obj.material ? [obj.material] : [])
      for (const m of mats) m.needsUpdate = true
    })
  }
}

export function setupLights(scene) {
  const ambient = new THREE.AmbientLight(0xfff4d6, 0.5)
  scene.add(ambient)
  ambient.updateMatrix(); ambient.matrixAutoUpdate = false
  const studio = new THREE.DirectionalLight(0x4488ff, 0.4)
  studio.position.set(-20, 30, -10); studio.castShadow = false; scene.add(studio)
  const sun = new THREE.DirectionalLight(0xffffff, 1.5)
  sun.position.set(21, 50, 20); sun.castShadow = true
  sun.shadow.mapSize.set(1024, 1024)
  sun.shadow.bias = -0.0005
  sun.shadow.normalBias = 0.05
  sun.shadow.radius = 4
  sun.shadow.camera.near = 0.5
  sun.shadow.camera.far = 200
  scene.add(sun); scene.add(sun.target)
  const warmupPoint = new THREE.PointLight(0xffffff, 0, 1); scene.add(warmupPoint)
  warmupPoint.updateMatrix(); warmupPoint.matrixAutoUpdate = false
  return { ambient, studio, sun, warmupPoint }
}

export function limitTextureSize(texture, makeCanvas = null) {
  if (!texture || !texture.image) return texture
  const maxDim = Math.max(texture.image.width, texture.image.height)
  if (maxDim > TEXTURE_SIZE_LIMIT) {
    if (typeof makeCanvas !== 'function') throw new TypeError('limitTextureSize needs makeCanvas for a texture over ' + TEXTURE_SIZE_LIMIT + ' pixels')
    const scale = TEXTURE_SIZE_LIMIT / maxDim
    const c = makeCanvas()
    c.width = Math.floor(texture.image.width * scale); c.height = Math.floor(texture.image.height * scale)
    const ctx = c.getContext('2d'); ctx.drawImage(texture.image, 0, 0, c.width, c.height)
    texture.image = c; texture.needsUpdate = true
  }
  return texture
}

export function applySceneConfig(s, scene, ambient, sun, studio, camera, host = null) {
  if (s.skyColor != null) scene.background = new THREE.Color(s.skyColor)
  if (s.fogColor != null) {
    const _far = s.fogFar ?? 200
    if (s.fogType === 'exp2') {
      scene.fog = new THREE.FogExp2(s.fogColor, s.fogDensity ?? 0.0025)
    } else {
      scene.fog = new THREE.Fog(s.fogColor, s.fogNear ?? 80, _far)
    }
    if (host) host.__fogFar = _far
  }
  if (s.ambientColor != null) { ambient.color.set(s.ambientColor); ambient.intensity = s.ambientIntensity ?? 0.3 }
  if (s.sunColor != null) { sun.color.set(s.sunColor); sun.intensity = s.sunIntensity ?? 1.5 }
  if (s.sunPosition) sun.position.set(...s.sunPosition)
  if (s.fillColor != null) { studio.color.set(s.fillColor); studio.intensity = s.fillIntensity ?? 0.4 }
  if (s.fillPosition) studio.position.set(...s.fillPosition)
  if (s.shadowMapSize) sun.shadow.mapSize.set(s.shadowMapSize, s.shadowMapSize)
  if (s.shadowBias != null) sun.shadow.bias = s.shadowBias
  if (s.shadowNormalBias != null) sun.shadow.normalBias = s.shadowNormalBias
  if (s.shadowRadius != null) sun.shadow.radius = s.shadowRadius
  if (s.shadowBlurSamples != null) sun.shadow.blurSamples = s.shadowBlurSamples
  if (s.fov) { camera.fov = s.fov; camera.updateProjectionMatrix() }
}

function manifestUnresolvedUrls(entityMeshes, manifestUrls) {
  const resident = new Set()
  for (const mesh of entityMeshes.values()) {
    const url = mesh && mesh.userData ? mesh.userData.modelUrl : null
    if (url && manifestUrls.has(url)) resident.add(url)
  }
  return [...manifestUrls].filter(u => !resident.has(u))
}

async function awaitManifestResidence(entityMeshes, manifestUrls, waitMs, env, isAborted = () => false) {
  const startedAt = env.now()
  const deadline = startedAt + waitMs
  const maxPolls = Math.max(1, Math.min(MANIFEST_RESIDENCE_MAX_POLLS, Math.ceil(waitMs / MANIFEST_RESIDENCE_POLL_MS)))
  for (let poll = 0; poll <= maxPolls; poll++) {
    const unresolved = manifestUnresolvedUrls(entityMeshes, manifestUrls)
    const waitedMs = env.now() - startedAt
    if (unresolved.length === 0) return { unresolved, waitedMs, polls: poll, aborted: false }
    if (isAborted()) return { unresolved, waitedMs, polls: poll, aborted: true }
    if (waitedMs >= waitMs || env.now() >= deadline) return { unresolved, waitedMs, polls: poll, aborted: false }
    await env.sleep(MANIFEST_RESIDENCE_POLL_MS)
  }
  return { unresolved: manifestUnresolvedUrls(entityMeshes, manifestUrls), waitedMs: env.now() - startedAt, polls: maxPolls, aborted: false }
}

export async function waitForManifestResidence(entityMeshes, manifest, waitMs = MANIFEST_RESIDENCE_WAIT_MS, env = null) {
  const manifestUrls = manifest && Array.isArray(manifest.modelUrls) && manifest.modelUrls.length ? new Set(manifest.modelUrls) : null
  if (!manifestUrls) return { unresolved: [], waitedMs: 0, polls: 0, aborted: false }
  if (!env || typeof env.now !== 'function' || typeof env.sleep !== 'function') throw new TypeError('waitForManifestResidence needs env.now and env.sleep when a manifest is given')
  return awaitManifestResidence(entityMeshes, manifestUrls, waitMs, env)
}

export function describeRenderer(renderer) {
  if (!renderer.isWebGPURenderer) {
    const gl = renderer.getContext()
    return { class: 'WebGLRenderer', backend: 'webgl2-legacy', glRenderer: unmaskedGlRenderer(gl), glVendor: unmaskedGlVendor(gl) }
  }
  const backend = renderer.backend
  if (backend.isWebGLBackend) {
    return { class: 'WebGPURenderer', backend: 'webgl2', glRenderer: unmaskedGlRenderer(backend.gl), glVendor: unmaskedGlVendor(backend.gl) }
  }
  const device = backend.device
  return { class: 'WebGPURenderer', backend: 'webgpu', glRenderer: webgpuAdapterLabel(device), glVendor: webgpuAdapterVendor(device) }
}

function unmaskedGlRenderer(gl) {
  if (!gl) return null
  const ext = gl.getExtension('WEBGL_debug_renderer_info')
  return gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER)
}

function unmaskedGlVendor(gl) {
  if (!gl) return null
  const ext = gl.getExtension('WEBGL_debug_renderer_info')
  return gl.getParameter(ext ? ext.UNMASKED_VENDOR_WEBGL : gl.VENDOR)
}

function webgpuAdapterLabel(device) {
  const info = device && device.adapterInfo
  if (!info) return null
  return [info.vendor, info.architecture, info.description].filter(Boolean).join(' ') || null
}

function webgpuAdapterVendor(device) {
  const info = device && device.adapterInfo
  return (info && info.vendor) || null
}

let sharedKtx2Loader = null

function ensureSharedKtx2Loader(renderer, basisPath) {
  if (sharedKtx2Loader || !renderer) return sharedKtx2Loader
  sharedKtx2Loader = new KTX2Loader().setTranscoderPath(basisPath).detectSupport(renderer)
  return sharedKtx2Loader
}

export function createLoaders(renderer, paths) {
  if (!paths || typeof paths.dracoDecoderPath !== 'string' || typeof paths.basisPath !== 'string') throw new TypeError('createLoaders needs paths.dracoDecoderPath and paths.basisPath')
  THREE.Cache.enabled = true
  const loadingManager = new THREE.LoadingManager()
  const modelErrors = createModelErrorHandler({ onError: err => console.error('[THREE] Failed to load:', err.url, err.reasonCode) })
  loadingManager.onError = url => modelErrors.onError(url)
  loadingManager.modelLoadErrors = modelErrors
  const gltfLoader = new GLTFLoader(loadingManager)
  const dracoLoader = new DRACOLoader(loadingManager).setDecoderPath(paths.dracoDecoderPath)
  gltfLoader.setDRACOLoader(dracoLoader)
  try { if (typeof MeshoptDecoder.useWorkers === 'function') MeshoptDecoder.useWorkers(2) } catch (e) { console.warn('[loaders] MeshoptDecoder.useWorkers unavailable, decoding on the main thread:', e?.message || e) }
  gltfLoader.setMeshoptDecoder(MeshoptDecoder)
  gltfLoader.register((parser) => new VRMLoaderPlugin(parser))
  const ktx2Loader = ensureSharedKtx2Loader(renderer, paths.basisPath)
  if (ktx2Loader) gltfLoader.setKTX2Loader(ktx2Loader)
  return { gltfLoader, dracoLoader, ktx2Loader }
}

export async function warmupShaders(renderer, scene, camera, entityMeshes, playerMeshes, loadingMgr, abortSignal = null, manifest = null, residence = null, env = null) {
  if (!env || typeof env.now !== 'function' || typeof env.epochNow !== 'function' || typeof env.sleep !== 'function' || typeof env.raf !== 'function' || !env.storage || typeof env.record !== 'function' || typeof env.log !== 'function') throw new TypeError('warmupShaders needs env.now, env.epochNow, env.sleep, env.raf, env.storage, env.record and env.log')
  const t0 = env.now()
  const isAborted = () => !!(abortSignal && abortSignal.aborted)
  const manifestUrls = manifest && Array.isArray(manifest.modelUrls) && manifest.modelUrls.length ? new Set(manifest.modelUrls) : null
  let residenceResult = residence || { unresolved: [], waitedMs: 0, polls: 0, aborted: false }
  const compileFailures = []
  const record = (extra) => env.record({
    ts: env.epochNow(),
    wallMs: env.now() - t0,
    manifestDriven: !!manifestUrls,
    manifestUrls: manifestUrls ? [...manifestUrls] : null,
    manifestResidenceWaitMs: Math.round(residenceResult.waitedMs),
    manifestUnresolvedUrls: residenceResult.unresolved.length ? residenceResult.unresolved.slice() : null,
    manifestUnresolvedReason: residenceResult.unresolved.length ? (residenceResult.aborted ? 'residence-wait-aborted' : 'residence-deadline-exceeded') : null,
    compileFailures,
    ...extra,
  })
  if (manifestUrls && !residence) residenceResult = await awaitManifestResidence(entityMeshes, manifestUrls, MANIFEST_RESIDENCE_WAIT_MS, env, isAborted)
  const allEntityMeshes = [...entityMeshes.values()]
  const manifestedMeshes = manifestUrls ? allEntityMeshes.filter(m => m.userData && manifestUrls.has(m.userData.modelUrl)).slice(0, MAX_UNMANIFESTED_WARMUP_MESHES) : []
  const residentMeshes = manifestUrls ? allEntityMeshes.filter(m => !(m.userData && manifestUrls.has(m.userData.modelUrl))) : allEntityMeshes
  const cappedResident = residentMeshes.length > MAX_UNMANIFESTED_WARMUP_MESHES ? [] : residentMeshes
  if (residentMeshes.length > MAX_UNMANIFESTED_WARMUP_MESHES && !manifestUrls) {
    env.log('[shader] skipping warmup (too many meshes:', residentMeshes.length + ')')
    record({ skipped: true, reason: 'too-many-meshes', residentCount: residentMeshes.length, total: 0, manifestedCount: 0 })
    return
  }
  const allMeshes = [...manifestedMeshes, ...cappedResident, ...playerMeshes.values()]
  const total = allMeshes.length
  if (total === 0) { record({ skipped: true, reason: 'empty', total: 0, manifestedCount: 0 }); return }
  const ids = [...entityMeshes.keys()].sort().join(',')
  const sceneKey = 'shader-warmup-v4:' + (manifestUrls ? 'm' + manifestedMeshes.length : '') + ':' + total + ':' + (ids.length > 200 ? ids.slice(0, 200) : ids)
  if (env.storage.getItem('lastShaderWarmupKey') === sceneKey) {
    env.log('[shader] skipped warmup (scene unchanged)')
    record({ skipped: true, reason: 'scene-unchanged', total, manifestedCount: manifestedMeshes.length })
    return
  }
  loadingMgr.setLabel('Compiling shaders...')
  loadingMgr.reportProcessing(0, total)
  const culled = []
  scene.traverse(obj => { if (obj.frustumCulled) { culled.push(obj); obj.frustumCulled = false } })
  try {
    let compiledCount = 0
    const WARMUP_BATCH = 6
    for (let i = 0; i < allMeshes.length; i += WARMUP_BATCH) {
      if (isAborted()) { record({ aborted: true, total, manifestedCount: manifestedMeshes.length }); return }
      await Promise.all(allMeshes.slice(i, i + WARMUP_BATCH).map(async m => {
        const url = m.userData && m.userData.modelUrl ? m.userData.modelUrl : null
        try { await renderer.compileAsync(m, camera, scene) } catch (err) {
          compileFailures.push({ url, message: String(err && err.message ? err.message : err) })
          try { renderer.compile(m, camera, scene) } catch (err2) { compileFailures.push({ url, message: String(err2 && err2.message ? err2.message : err2) }) }
        }
        compiledCount++
        loadingMgr.reportProcessing(compiledCount, total)
      }))
    }
    if (isAborted()) { record({ aborted: true, total, manifestedCount: manifestedMeshes.length }); return }
    renderer.shadowMap.needsUpdate = true
    renderDeferringUnreadyPrograms(renderer, scene, camera)
    if (isAborted()) { record({ aborted: true, total, manifestedCount: manifestedMeshes.length }); return }
    await new Promise(resolve => env.raf(resolve))
    if (isAborted()) { record({ aborted: true, total, manifestedCount: manifestedMeshes.length }); return }
    renderDeferringUnreadyPrograms(renderer, scene, camera)
    env.storage.setItem('lastShaderWarmupKey', sceneKey)
    loadingMgr.reportProcessing(total, total)
    env.log('[shader] warmup done, meshes:', total, manifestUrls ? '(' + manifestedMeshes.length + ' manifest-driven)' : '')
    record({
      total,
      manifestedCount: manifestedMeshes.length,
      residentCount: cappedResident.length,
      manifestedUrls: manifestedMeshes.map(m => m.userData && m.userData.modelUrl).filter(Boolean),
      residentModelUrls: [...new Set(residentMeshes.map(m => m.userData && m.userData.modelUrl).filter(Boolean))],
    })
  } finally {
    for (const obj of culled) obj.frustumCulled = true
  }
}
