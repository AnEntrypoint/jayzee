import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { finish, gate } from './lib/gate.mjs'
import { PLANET_RADIUS_M } from '../src/engine/sphere.js'
import { RENDER_COLLISION_TOLERANCE_M, relativeOf } from '../src/engine/cameraRelative.js'
import { PHYSICS_REBASE_M, bodyAbsolute, bodyRelative, rebaseBody, rebaseCost, rebaseDue } from '../src/engine/physicsOrigin.js'

const R = PLANET_RADIUS_M
const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')
const maxAbs = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]))

const EYE = [R * 0.6 + 0.3, R * 0.8 + 0.3, 0.1]
const LIGHT = [EYE[0] + 11.0, EYE[1] - 6.5, EYE[2] + 13.25]

gate('a light stored in float64 and made relative to the frame origin agrees with its geometry within the tolerance at planet radius', () => {
  const rel = relativeOf(LIGHT, EYE, [0, 0, 0])
  const exact = [LIGHT[0] - EYE[0], LIGHT[1] - EYE[1], LIGHT[2] - EYE[2]]
  assert.ok(maxAbs(rel, exact) <= RENDER_COLLISION_TOLERANCE_M, 'light error ' + maxAbs(rel, exact) + ' m')
})

gate('negative control: a light stored as float32 absolute misses the tolerance at planet radius', () => {
  const stored = LIGHT.map(Math.fround)
  const rel = relativeOf(stored, EYE, [0, 0, 0])
  const exact = [LIGHT[0] - EYE[0], LIGHT[1] - EYE[1], LIGHT[2] - EYE[2]]
  assert.ok(maxAbs(rel, exact) > RENDER_COLLISION_TOLERANCE_M, 'float32 light storage did not miss the tolerance, so the control is void')
})

gate('the rebase threshold is 1024 m from the physics origin, and the JS mirror and the C++ constant agree', () => {
  assert.equal(PHYSICS_REBASE_M, 1024)
  assert.equal(rebaseDue([0, 0, 0], [1024, 0, 0]), false)
  assert.equal(rebaseDue([0, 0, 0], [1025, 0, 0]), true)
  assert.ok(read('engine/src/physics_origin.h').includes('constexpr double kRebaseMetres = 1024.0;'))
})

gate('a body that the physics origin follows stays within the tolerance of its absolute position through a 4 km walk with rebases', () => {
  const B = [R + 2.3, 0, 0]
  const origin = [R, 0, 0]
  const rel = bodyRelative(B, origin, [0, 0, 0])
  const eye = [R, 0, 0]
  const abs = [0, 0, 0]
  const path = []
  for (let z = 0; z <= 4096; z += 50) path.push(z)
  for (let z = 4096; z >= 0; z -= 50) path.push(z)
  let rebases = 0
  let worst = 0
  for (const z of path) {
    eye[2] = z
    if (rebaseDue(origin, eye)) {
      rebaseBody(rel, origin, eye, rel)
      origin[0] = eye[0]
      origin[1] = eye[1]
      origin[2] = eye[2]
      rebases += 1
    }
    bodyAbsolute(rel, origin, abs)
    worst = Math.max(worst, maxAbs(abs, B))
  }
  assert.ok(rebases >= 5, 'the walk rebased only ' + rebases + ' times')
  assert.ok(worst <= RENDER_COLLISION_TOLERANCE_M, 'worst body error ' + worst + ' m')
})

gate('negative control: a body kept absolute in float32 (no rebase) misses the tolerance at planet radius', () => {
  const B = [R + 2.3, 0, 0]
  const rel = bodyRelative(B, [0, 0, 0], [0, 0, 0])
  assert.ok(maxAbs(rel, B) > RENDER_COLLISION_TOLERANCE_M, 'the absolute body did not miss the tolerance, so the control is void')
})

gate('the rebase cost is the position write per body and the readback per live slot, in bytes', () => {
  const cost = rebaseCost({ bodies: 10240, liveSlots: 1024 })
  assert.deepEqual(cost, { positionWrites: 10240, positionBytes: 10240 * 12, syncs: 1024, readbackBytes: 1024 * 76 })
})

gate('the C++ body store, planet contact, gravity and vegetation field use the one physics origin, in double precision', () => {
  const world = read('engine/src/world.cpp')
  assert.ok(world.includes('void World::rebase(double x, double y, double z) {'))
  assert.ok(world.includes('Status World::follow(double x, double y, double z) {'))
  assert.ok(world.includes('for (const JPH::Body* body : runtime_->physics.GetBodies()) {'))
  assert.ok(world.includes('if (index == planetBody_ || index == vegetationBody_) continue;'))
  assert.ok(world.includes('const double x = position.GetX() + o.x;'))
  assert.ok(world.includes('position[0] = p.GetX() + o.x;'))
  assert.ok(world.includes('JPH::RVec3 toBody(const float* p) {'))
  assert.ok(read('engine/src/world.h').includes('Status follow(double x, double y, double z);'))
  const planet = read('engine/src/planet_shape.cpp')
  assert.ok(planet.includes('const double x = center.GetX() + o.x;'))
  assert.ok(!planet.includes('const double x = center.GetX();'))
  const vegetation = read('engine/src/vegetation.cpp')
  assert.ok(vegetation.includes('const double cx = static_cast<double>(center.GetX()) + o.x;'))
  assert.ok(vegetation.includes('int cellCoordinate(double value, double origin, float cellSize, std::uint32_t cellsPerSide) {'))
  assert.ok(read('engine/src/vegetation.h').includes('double origin = 0.0;'))
  assert.ok(read('engine/src/engine_core.cpp').includes('engine::vegetation::configure(engine::vegetation::state(), origin, static_cast<float>(cellSize))'))
  assert.ok(read('engine/src/engine_core.cpp').includes('EMSCRIPTEN_KEEPALIVE double engine_world_rebase_count() {'))
  assert.ok(read('engine/src/world.h').includes('std::uint64_t rebases() const { return rebases_; }'))
  assert.ok(world.includes('rebases_ += 1;'))
})

gate('the render path places each body by its physics origin minus the frame origin, and the eye follows the origin', () => {
  const frame = read('engine/src/render/render_frame.cpp')
  assert.ok(frame.includes('relativeOfBody(body, scene.bodyOrigin, scene.origin, rel);'))
  const exports = read('engine/src/exports_render.cpp')
  assert.ok(exports.includes('const engine::PhysicsOrigin& bodyOrigin = engine::physicsOrigin();'))
  assert.ok(exports.includes('scene.bodyOrigin = rnd::FrameOrigin{bodyOrigin.x, bodyOrigin.y, bodyOrigin.z};'))
  assert.ok(exports.includes('const int status = engine::world().follow(x, y, z);'))
  assert.ok(exports.includes('EMSCRIPTEN_KEEPALIVE double* engine_render_light_positions() {'))
  assert.ok(exports.includes('const double absolute[3] = {state.lightPositions[i * 3], state.lightPositions[i * 3 + 1], state.lightPositions[i * 3 + 2]};'))
  assert.ok(read('engine/src/render/camera_relative.h').includes('inline void relativeOfBody(const float body[3], const FrameOrigin& bodyOrigin, const FrameOrigin& origin, float out[3]) {'))
  assert.ok(read('engine/CMakeLists.txt').includes('_engine_render_light_positions'))
  const js = read('src/engine/renderer.js')
  assert.ok(js.includes("f64[lightPositions + slot * 3 + i] = finite(position[i], 'light position')"))
})

gate('the WebGPU visibility path culls and identifies models at their relative offsets, with no hard-coded placement', () => {
  const gpu = read('engine/src/render/render_webgpu.cpp')
  assert.equal(gpu.includes('f32(slot) * 4.0 - 8.0'), false)
  assert.ok(gpu.includes('@group(0) @binding(9) var<storage, read> modelRel: array<vec4f>;'))
  assert.ok(gpu.includes('let placed = modelRel[slot].xyz;'))
  assert.ok(gpu.includes('constexpr std::uint32_t kCullBindings = 10;'))
  assert.ok(gpu.includes('cullBindings[9] = bufferBinding(9, modelRelBuf'))
  assert.ok(gpu.includes('@group(0) @binding(6) var<storage, read> modelRel: array<vec4f>;'))
  assert.ok(gpu.includes('let world = p * 2.0 + modelRel[slot].xyz;'))
  assert.ok(gpu.includes('clip[k] = clipOf(cam.viewProj * vec4f(p * 2.0 + modelRel[slot].xyz, 1.0));'))
  assert.ok(gpu.includes('constexpr std::uint32_t kIdBindings = 7;'))
  assert.ok(gpu.includes('constexpr std::uint32_t kResolveBindings = 7;'))
  assert.ok(gpu.includes('idBindings[6] = bufferBinding(6, modelRelBuf'))
  assert.ok(gpu.includes('resolveBindings[6] = bufferBinding(6, modelRelBuf'))
})

finish()
