import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { finish, gate } from './lib/gate.mjs'
import { PLANET_RADIUS_M } from '../src/engine/sphere.js'
import { RENDER_COLLISION_RANGE_M, RENDER_COLLISION_TOLERANCE_M, absolutePosition, float32SpacingAt, maxAbsDifference, relativeErrorBound, relativeLookAt, renderedPosition } from '../src/engine/cameraRelative.js'
import { createVegetationPool, planVegetationPool } from '../src/engine/vegetation.js'

const R = PLANET_RADIUS_M
const CAP = 1024
const CAP_RAD = 1.0e-5
const clock = () => { let t = 0; return () => (t += 1) }
const patchCentre = (id) => ({ latRad: 0.2 + 0.0001 * id, lonRad: 0.4 + 0.0001 * id, capRad: CAP_RAD })
const heightAt = (n) => 3 + 40 * n[0] + 25 * n[2]
const FRAME_ORIGINS = [[0, 0, 0], [12.5, -3.25, 40.75], [600, -300, 700]]
const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

const makePool = () => {
  const pool = createVegetationPool({
    plan: planVegetationPool({ maxBufferBytes: 1e12, residentPatches: 2, capacityPerPatch: CAP }),
    worldSeed: 42,
    heightAt,
    patchCentre,
    now: clock(),
    cullRadiusM: 64,
  })
  pool.sync([1, 2])
  pool.step()
  return pool
}

const eachInstance = (pool, visit) => {
  const m = pool.memory()
  const counts = pool.counts()[0]
  for (let slot = 0; slot < m.slots; slot++) {
    const buf = pool.buffers()[0][slot]
    for (let i = 0; i < counts[slot]; i++) {
      const transform = buf.subarray(i * 16 + 12, i * 16 + 15)
      const origin = m.origins.subarray(slot * 3, slot * 3 + 3)
      visit({ slot, i, origin, transform })
    }
  }
}

gate('the tolerance is 1e-3 m, the value the ENGINE.md section records', () => {
  assert.equal(RENDER_COLLISION_TOLERANCE_M, 1e-3)
})

gate('the render position of every resident instance matches its collision position within the tolerance, at planet radius, for each frame origin', () => {
  const pool = makePool()
  const truth = [0, 0, 0]
  for (const F of FRAME_ORIGINS) {
    const frameOrigin = F.map((v, k) => pool.memory().origins[k] + v)
    let worst = 0
    let checked = 0
    const rel = [0, 0, 0]
    const rendered = [0, 0, 0]
    eachInstance(pool, ({ slot, i, origin, transform }) => {
      const reach = Math.hypot(origin[0] - frameOrigin[0], origin[1] - frameOrigin[1], origin[2] - frameOrigin[2])
      if (reach > RENDER_COLLISION_RANGE_M) return
      renderedPosition(origin, frameOrigin, transform, rel, rendered)
      pool.readWorld(0, slot, i, truth)
      worst = Math.max(worst, maxAbsDifference(rendered, truth))
      checked += 1
    })
    assert.ok(checked > 0, 'no instances were checked')
    assert.ok(worst <= RENDER_COLLISION_TOLERANCE_M, 'frame origin ' + F.join(',') + ': worst difference ' + worst + ' m is above ' + RENDER_COLLISION_TOLERANCE_M + ' m')
  }
})

const TRANSLATION_BOUND_M = 128
const REACH_DIRECTIONS = 64
const REACH_ROWS = Object.freeze([
  { reachM: 4096, within: true },
  { reachM: 8192, within: true },
  { reachM: 16384, within: false },
  { reachM: 50000, within: false },
])

const seededDirections = (count) => {
  let seed = 20261111
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }
  return Array.from({ length: count }, () => {
    const z = random() * 2 - 1
    const a = random() * 2 * Math.PI
    const r = Math.sqrt(1 - z * z)
    return [r * Math.cos(a), r * Math.sin(a), z]
  })
}

const worstAtReach = (pool, reachM) => {
  const rel = [0, 0, 0]
  const rendered = [0, 0, 0]
  const truth = [0, 0, 0]
  let worst = 0
  let checked = 0
  let finite = true
  let translation = 0
  for (const dir of seededDirections(REACH_DIRECTIONS)) {
    eachInstance(pool, ({ slot, i, origin, transform }) => {
      const frameOrigin = [origin[0] + dir[0] * reachM, origin[1] + dir[1] * reachM, origin[2] + dir[2] * reachM]
      const got = renderedPosition(origin, frameOrigin, transform, rel, rendered)
      pool.readWorld(0, slot, i, truth)
      finite = finite && got.every(Number.isFinite)
      worst = Math.max(worst, maxAbsDifference(rendered, truth))
      translation = Math.max(translation, Math.abs(transform[0]), Math.abs(transform[1]), Math.abs(transform[2]))
      checked += 1
    })
  }
  return { reachM, worst, checked, finite, translation }
}

gate('float32 spacing is 2^-11 m in [4096, 8192), 2^-10 m in [8192, 16384) and 2^-8 m at 50 km, and the two-rounding bound is the mean of the spacing at the reach and at the reach plus the translation', () => {
  assert.equal(float32SpacingAt(4096), 2 ** -11)
  assert.equal(float32SpacingAt(8191), 2 ** -11)
  assert.equal(float32SpacingAt(8192), 2 ** -10)
  assert.equal(float32SpacingAt(50000), 2 ** -8)
  assert.equal(float32SpacingAt(1), Math.fround(1 + 2 ** -23) - 1)
  assert.equal(relativeErrorBound(4096, TRANSLATION_BOUND_M), 2 ** -11)
  assert.equal(relativeErrorBound(8192, TRANSLATION_BOUND_M), 2 ** -10)
  assert.equal(relativeErrorBound(16384 - TRANSLATION_BOUND_M, TRANSLATION_BOUND_M), (2 ** -10 + 2 ** -9) / 2)
  assert.ok(relativeErrorBound(8192, TRANSLATION_BOUND_M) <= RENDER_COLLISION_TOLERANCE_M)
  assert.ok(relativeErrorBound(16384, TRANSLATION_BOUND_M) > RENDER_COLLISION_TOLERANCE_M)
  assert.throws(() => relativeErrorBound(-1), RangeError)
  assert.throws(() => float32SpacingAt(Infinity), RangeError)
})

for (const row of REACH_ROWS) {
  const verdict = row.within ? 'stays within the tolerance' : 'misses the tolerance, and is drawn anyway: nothing refuses or culls it by distance'
  gate('an instance ' + row.reachM + ' m from the eye, at planet radius, in ' + REACH_DIRECTIONS + ' seeded directions: the render position ' + verdict, () => {
    const measured = worstAtReach(makePool(), row.reachM)
    const bound = relativeErrorBound(row.reachM, TRANSLATION_BOUND_M)
    console.log('reach ' + JSON.stringify({ ...measured, boundM: bound, toleranceM: RENDER_COLLISION_TOLERANCE_M }))
    assert.ok(measured.checked > 0, 'no instances were checked')
    assert.ok(measured.translation <= TRANSLATION_BOUND_M, 'a translation of ' + measured.translation + ' m is above the ' + TRANSLATION_BOUND_M + ' m the bound assumes')
    assert.equal(measured.finite, true, 'renderedPosition returned a non-finite position')
    assert.ok(measured.worst <= bound, 'worst error ' + measured.worst + ' m is above the derived bound ' + bound + ' m')
    assert.equal(measured.worst <= RENDER_COLLISION_TOLERANCE_M, row.within, 'worst error ' + measured.worst + ' m against the tolerance ' + RENDER_COLLISION_TOLERANCE_M + ' m')
  })
}

gate('no distance limit is applied in code: the range constant is read only by the gates, and the vegetation draw culls by frustum plane and patch radius, not by reach', () => {
  assert.equal(RENDER_COLLISION_RANGE_M, 4096)
  for (const file of ['src/engine/renderer.js', 'src/engine/vegetation.js', 'src/engine/planetScene.js']) {
    assert.equal(read(file).includes('RENDER_COLLISION_RANGE_M'), false, file + ' reads the range')
  }
  const draw = read('engine/src/render/vegetation_draw.h')
  assert.ok(draw.includes('if (planes != nullptr && outsidePlane(planes, rel, b.radius)) continue;'))
  assert.equal(/4096\.0|kRenderRange|maxReach/.test(draw), false)
})

gate('negative control: the absolute float32 path (fround(origin) + translation) misses the tolerance at planet radius', () => {
  const pool = makePool()
  const truth = [0, 0, 0]
  const absolute = [0, 0, 0]
  let worst = 0
  eachInstance(pool, ({ slot, i, origin, transform }) => {
    absolutePosition(origin, transform, absolute)
    pool.readWorld(0, slot, i, truth)
    worst = Math.max(worst, maxAbsDifference(absolute, truth))
  })
  assert.ok(worst > RENDER_COLLISION_TOLERANCE_M, 'absolute path worst difference ' + worst + ' m does not exceed the tolerance, so the control does not test it')
})

gate('the per-frame relative position returns the same out object and writes no new arrays', () => {
  const pool = makePool()
  const rel = [0, 0, 0]
  const out = [0, 0, 0]
  const truth = [0, 0, 0]
  const frameOrigin = [1, 2, 3]
  let first = null
  eachInstance(pool, ({ origin, transform }) => {
    const got = renderedPosition(origin, frameOrigin, transform, rel, out)
    if (first === null) first = got
    assert.equal(got, out)
  })
  assert.equal(first, out)
  assert.equal(pool.readWorld(0, 0, 0, truth), truth)
})

gate('the relative look-at carries no translation: the eye sits at the origin, and the target lies on the negative z axis', () => {
  const eye = [R * 0.5, 1234.5, -R * 0.25]
  const target = [R * 0.5 + 40, 1230, -R * 0.25 + 30]
  const view = relativeLookAt(eye, target, [0, 1, 0], new Float64Array(16))
  assert.equal(view[12], 0)
  assert.equal(view[13], 0)
  assert.equal(view[14], 0)
  const d = [target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]]
  const x = view[0] * d[0] + view[4] * d[1] + view[8] * d[2]
  const y = view[1] * d[0] + view[5] * d[1] + view[9] * d[2]
  const z = view[2] * d[0] + view[6] * d[1] + view[10] * d[2]
  const len = Math.hypot(d[0], d[1], d[2])
  assert.ok(Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9, 'target is off the view axis')
  assert.ok(Math.abs(z + len) < 1e-9, 'target is not at -' + len + ' on the view axis, got ' + z)
})

gate('the C++ side computes the render origin from the same float64 frame origin, in one shared header', () => {
  const header = read('engine/src/render/camera_relative.h')
  assert.ok(header.includes('struct FrameOrigin {'))
  assert.ok(header.includes('inline void relativeOf(const double world[3], const FrameOrigin& origin, float out[3]) {'))
  assert.ok(header.includes('inline void relativeOfFloat(const float world[3], const FrameOrigin& origin, float out[3]) {'))
  const frameHeader = read('engine/src/render/render_frame.h')
  assert.ok(frameHeader.includes('camera_relative.h'))
  assert.ok(frameHeader.includes('static_assert(sizeof(PagePlacement) == 56);'))
  assert.ok(frameHeader.includes('FrameOrigin origin;'))
  const frame = read('engine/src/render/render_frame.cpp')
  assert.ok(frame.includes('relativeOf(pageOrigin, origin, rel);'))
  assert.ok(frame.includes('relativeOfBody(body, scene.bodyOrigin, scene.origin, rel);'))
  const exports = read('engine/src/exports_render.cpp')
  assert.ok(exports.includes('FrameOrigin origin;'))
  assert.ok(exports.includes('EMSCRIPTEN_KEEPALIVE int engine_render_set_origin(double x, double y, double z) {'))
  assert.ok(exports.includes('rnd::relativeOf(absolute, state.origin, rel);'))
  const cm = read('engine/CMakeLists.txt')
  assert.ok(cm.includes('_engine_render_set_origin'))
  const modelPool = read('engine/src/model_pool.cpp')
  assert.ok(modelPool.includes('frameOrigin'))
})

gate('the WebGL2 and WebGPU paths both draw the relative offsets: vegetation, props and models', () => {
  const gl = read('engine/src/render/render_webgl2.cpp')
  assert.ok(gl.includes('std::uint32_t drawVegetation(const Camera& camera, const engine::render::FrameOrigin& origin) {'))
  assert.ok(gl.includes('if (engine::render::vegetation::bound()) drawVegetation(camera, scene.origin);'))
  assert.ok(gl.includes('std::uint32_t drawModels(const Camera& camera, const engine::render::FrameOrigin& origin) {'))
  assert.ok(gl.includes('engine::render::relativeOfFloat(offset, origin, relative);'))
  assert.ok(gl.includes('drawModels(camera, scene.origin)'))
  const gpu = read('engine/src/render/render_webgpu.cpp')
  assert.ok(gpu.includes('void uploadVegetation(const Camera& camera, const engine::render::FrameOrigin& origin) {'))
  assert.ok(gpu.includes('uploadVegetation(camera, scene.origin);'))
  assert.ok(gpu.includes('void uploadModelOffsets(const engine::render::FrameOrigin& origin) {'))
  assert.ok(gpu.includes('uploadModelOffsets(scene.origin);'))
  assert.ok(gpu.includes('engine::render::relativeOfFloat(offset, origin, rel);'))
  assert.ok(gpu.includes('@group(0) @binding(1) var<storage, read> modelRel: array<vec4f>;'))
  assert.ok(gpu.includes('drawVegetation(pass);'))
})

gate('the renderer sends the eye as the origin and zeroes the eye words in the Camera block', () => {
  const js = read('src/engine/renderer.js')
  assert.ok(js.includes("module._engine_render_set_origin(finite(eye[0], 'eye'), finite(eye[1], 'eye'), finite(eye[2], 'eye'))"))
  assert.ok(js.includes('f32[camera + L.CAMERA_EYE_WORD + i] = 0'))
})

gate('the browser pages build their view with the relative look-at, not the absolute one', () => {
  const engine = read('scripts/browser/engine-render-browser.js')
  assert.ok(engine.includes("import { relativeLookAt } from '../../src/engine/cameraRelative.js'"))
  assert.ok(!engine.includes('lookAt(CAMERA.eye, ORIGIN, UP, VIEW)'))
  const visibility = read('scripts/browser/visibility-browser.js')
  assert.ok(visibility.includes("import { relativeLookAt } from '../../src/engine/cameraRelative.js'"))
  assert.ok(visibility.includes('relativeLookAt(EYE, TARGET, UP, new Float64Array(16))'))
})

gate('relativeLookAt writes the same view as the reference frame, with the eye at (1, 2, 3) looking at the origin', () => {
  const view = relativeLookAt([1, 2, 3], [0, 0, 0], [0, 1, 0], new Float64Array(16))
  const expected = [0.9486832980505138, -0.16903085094570333, 0.2672612419124244, 0, 0, 0.8451542547285166, 0.5345224838248488, 0, -0.31622776601683794, -0.5070925528371099, 0.8017837257372732, 0, 0, 0, 0, 1]
  for (let k = 0; k < 16; k++) assert.ok(Math.abs(view[k] - expected[k]) < 1e-12, 'word ' + k + ' is ' + view[k])
})

finish()
