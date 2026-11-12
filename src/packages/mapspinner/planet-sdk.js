import { createPlanetOrchestrator } from './planet-orchestrator.js'
import { createAnchorField } from './anchor-field.js'
import { createHeightSampler } from './height-cpu.js'
import { buildGridGeometry } from './patch-grid-geometry.js'
import { Mat4 } from './mat4.js'

export const VERSION = '0.1.0'

const DEFAULT_GRID_SIZE = 32
const ORIGIN = [0, 0, 0]
const BACKEND_METHODS = ['resize', 'beginFrame', 'drawPatches', 'endFrame']

export class MapspinnerSdkError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`)
    this.name = 'MapspinnerSdkError'
    this.code = code
  }
}

export function cameraViewProjRel(camera, out) {
  if (!camera || !camera.eye || !camera.target) throw new MapspinnerSdkError('camera-needs-eye-and-target', 'a camera carries eye, target, fovy, aspect, near and far')
  const forward = [camera.target[0] - camera.eye[0], camera.target[1] - camera.eye[1], camera.target[2] - camera.eye[2]]
  if (!(Math.hypot(forward[0], forward[1], forward[2]) > 0)) throw new MapspinnerSdkError('camera-target-on-eye', 'the camera target must differ from its eye')
  if (!(camera.near > 0) || !(camera.far > camera.near) || !(camera.aspect > 0)) throw new MapspinnerSdkError('camera-clip-range-bad', `camera needs 0 < near < far and a positive aspect, got near ${camera.near}, far ${camera.far}, aspect ${camera.aspect}`)
  const view = Mat4.lookAt(ORIGIN, forward, camera.up ?? [0, 1, 0])
  const proj = Mat4.perspective(camera.fovy, camera.aspect, camera.near, camera.far)
  return Mat4.mul(proj, view, out)
}

export function createPlanet(opts = {}) {
  const orchestrator = createPlanetOrchestrator(opts)
  const gridSize = opts.gridSize ?? DEFAULT_GRID_SIZE
  if (!Number.isInteger(gridSize) || gridSize < 1) throw new MapspinnerSdkError('planet-grid-size-not-whole', `gridSize must be a positive integer, got ${gridSize}`)
  const view = { eye: null, fovy: 0, viewportH: 0, viewProjRel: null, altitudeM: undefined }
  const viewProjRel = new Float32Array(16)
  let anchorField = opts.anchorField ?? null
  let sampler = null
  let patchGeometry = null

  function field() {
    if (anchorField === null) anchorField = createAnchorField({ seed: opts.seed })
    return anchorField
  }

  function heightSampler() {
    if (sampler === null) sampler = createHeightSampler({ radius: orchestrator.radius, seed: opts.seed, anchorField: field(), hashVersion: opts.hashVersion, carves: opts.carves, hpfTexRes: opts.hpfTexRes, reliefScale: opts.reliefScale, uniforms: opts.uniforms })
    return sampler
  }

  function geometry() {
    if (patchGeometry === null) patchGeometry = buildGridGeometry(gridSize, opts.skirt !== false)
    return patchGeometry
  }

  function update(camera) {
    if (!camera || !(camera.viewportH > 0)) throw new MapspinnerSdkError('camera-viewport-missing', 'a camera carries a positive viewportH')
    view.eye = camera.eye
    view.fovy = camera.fovy
    view.viewportH = camera.viewportH
    view.altitudeM = camera.altitudeM
    view.viewProjRel = camera.viewProjRel ?? (camera.cull === false ? null : cameraViewProjRel(camera, viewProjRel))
    return orchestrator.frame(view)
  }

  return {
    radius: orchestrator.radius,
    gridSize,
    seed: opts.seed ?? null,
    orchestrator,
    leaves: orchestrator.leaves,
    stats: orchestrator.stats,
    update,
    geometry,
    get anchorField() { return field() },
    heightAt: (dir) => heightSampler().heightAt(dir),
    surfacePoint: (dir) => heightSampler().surfacePoint(dir),
  }
}

export function createRecordingBackend(capacity = 64) {
  if (!Number.isInteger(capacity) || capacity < 1) throw new MapspinnerSdkError('recording-capacity-not-whole', `capacity must be a positive integer, got ${capacity}`)
  const kinds = new Uint8Array(capacity)
  const values = new Float64Array(capacity * 2)
  const names = ['resize', 'beginFrame', 'drawPatches', 'endFrame']
  let written = 0
  const push = (kind, a, b) => {
    const i = written % capacity
    kinds[i] = kind
    values[i * 2] = a
    values[i * 2 + 1] = b
    written++
  }
  return {
    resize: (w, h) => push(0, w, h),
    beginFrame: (frame) => push(1, frame, 0),
    drawPatches: (leaves, count, stats) => push(2, count, stats.levelCap),
    endFrame: (frame) => push(3, frame, 0),
    get written() { return written },
    calls() {
      const out = []
      const kept = Math.min(written, capacity)
      for (let k = written - kept; k < written; k++) {
        const i = k % capacity
        out.push({ call: names[kinds[i]], a: values[i * 2], b: values[i * 2 + 1] })
      }
      return out
    },
  }
}

export function createRenderer(opts = {}) {
  const backend = opts.backend
  if (!backend) throw new MapspinnerSdkError('renderer-backend-missing', 'createRenderer needs a backend: jayzee carries no WebGL context of its own, pass one that draws or createRecordingBackend() for a headless run')
  for (const method of BACKEND_METHODS) {
    if (typeof backend[method] !== 'function') throw new MapspinnerSdkError('renderer-backend-incomplete', `the backend has no ${method} function`)
  }
  const size = { width: 0, height: 0 }
  let frames = 0

  function resize(width, height) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new MapspinnerSdkError('renderer-size-not-whole', `the drawing size must be positive integers, got ${width} by ${height}`)
    size.width = width
    size.height = height
    backend.resize(width, height)
  }

  function render(planet, camera) {
    if (size.height === 0) throw new MapspinnerSdkError('renderer-not-sized', 'call resize before render')
    if (!planet || typeof planet.update !== 'function') throw new MapspinnerSdkError('renderer-planet-missing', 'render needs a planet from createPlanet')
    camera.viewportH = size.height
    if (camera.aspect === undefined) camera.aspect = size.width / size.height
    frames++
    backend.beginFrame(frames)
    const stats = planet.update(camera)
    backend.drawPatches(planet.leaves, stats.count, stats)
    backend.endFrame(frames)
    return stats
  }

  if (opts.width !== undefined || opts.height !== undefined) resize(opts.width, opts.height)
  return { backend, size, resize, render, get frames() { return frames } }
}
