import * as THREE from 'three'

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

async function awaitManifestResidence(entityMeshes, manifestUrls, waitMs, env) {
  const startedAt = env.now()
  const deadline = startedAt + waitMs
  const maxPolls = Math.max(1, Math.min(MANIFEST_RESIDENCE_MAX_POLLS, Math.ceil(waitMs / MANIFEST_RESIDENCE_POLL_MS)))
  for (let poll = 0; poll <= maxPolls; poll++) {
    const unresolved = manifestUnresolvedUrls(entityMeshes, manifestUrls)
    const waitedMs = env.now() - startedAt
    if (unresolved.length === 0) return { unresolved, waitedMs, polls: poll, aborted: false }
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
