import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import * as sdk from '../src/packages/mapspinner/index.js'
import { createAnchorField } from '../src/packages/mapspinner/anchor-field.js'
import { createHeightSampler } from '../src/packages/mapspinner/height-cpu.js'
import { quadOutsideFrustum } from '../src/packages/mapspinner/planet-orchestrator-cull.js'

const R = 6360000
const code = (fn) => {
  try {
    fn()
  } catch (error) {
    return error.code ?? error.constructor.name
  }
  return null
}
const camera = (over = {}) => ({ eye: [0, R + 800, 0], target: [5000, R + 500, 0], fovy: 1, near: 0.1, far: 1e8, ...over })

gate('the barrel exports createRenderer, createPlanet, VERSION and createAnchorField', () => {
  assert.equal(typeof sdk.createRenderer, 'function')
  assert.equal(typeof sdk.createPlanet, 'function')
  assert.equal(sdk.createAnchorField, createAnchorField)
  assert.match(sdk.VERSION, /^\d+\.\d+\.\d+$/)
  assert.equal(typeof sdk.createPlanetOrchestrator, 'function')
})

gate('createRenderer refuses a missing or incomplete backend, naming why', () => {
  assert.equal(code(() => sdk.createRenderer()), 'renderer-backend-missing')
  assert.equal(code(() => sdk.createRenderer({ backend: { resize() {}, beginFrame() {}, endFrame() {} } })), 'renderer-backend-incomplete')
  assert.equal(code(() => sdk.createRenderer({ backend: sdk.createRecordingBackend(), width: 0, height: 10 })), 'renderer-size-not-whole')
  const renderer = sdk.createRenderer({ backend: sdk.createRecordingBackend() })
  assert.equal(code(() => renderer.render(sdk.createPlanet(), camera())), 'renderer-not-sized')
  renderer.resize(640, 360)
  assert.equal(code(() => renderer.render(null, camera())), 'renderer-planet-missing')
  assert.equal(code(() => renderer.render(sdk.createPlanet(), camera())), null)
})

gate('a render is resize, then beginFrame, drawPatches with the leaf count, endFrame, every frame', () => {
  const backend = sdk.createRecordingBackend()
  const renderer = sdk.createRenderer({ backend, width: 1920, height: 1080 })
  const planet = sdk.createPlanet({ maxLeaves: 2048 })
  const stats = renderer.render(planet, camera())
  const second = renderer.render(planet, camera())
  assert.equal(second, stats)
  assert.equal(renderer.frames, 2)
  assert.deepEqual(backend.calls().map((c) => c.call), ['resize', 'beginFrame', 'drawPatches', 'endFrame', 'beginFrame', 'drawPatches', 'endFrame'])
  assert.deepEqual(backend.calls()[0], { call: 'resize', a: 1920, b: 1080 })
  assert.equal(backend.calls()[2].a, stats.count)
  assert.equal(backend.calls()[5].b, stats.levelCap)
  assert.ok(stats.count > 6 && stats.count <= 2048)
})

gate('the renderer takes the viewport height and aspect from its size', () => {
  const planet = sdk.createPlanet()
  const small = sdk.createRenderer({ backend: sdk.createRecordingBackend(), width: 1920, height: 1080 })
  const large = sdk.createRenderer({ backend: sdk.createRecordingBackend(), width: 3840, height: 2160 })
  const a = small.render(planet, camera()).splitDist
  const b = large.render(planet, camera()).splitDist
  assert.ok(Math.abs(b / a - 2) < 1e-9, `${a} ${b}`)
})

gate('the recording backend is a fixed ring that keeps the newest calls', () => {
  const backend = sdk.createRecordingBackend(3)
  for (let i = 1; i <= 5; i++) backend.beginFrame(i)
  assert.equal(backend.written, 5)
  assert.deepEqual(backend.calls().map((c) => c.a), [3, 4, 5])
  assert.equal(code(() => sdk.createRecordingBackend(0)), 'recording-capacity-not-whole')
})

gate('the camera matrix is rotation only and keeps the leaves quadOutsideFrustum keeps', () => {
  const cam = camera({ aspect: 16 / 9, viewportH: 1080 })
  const vpr = sdk.cameraViewProjRel(cam)
  const moved = sdk.cameraViewProjRel({ ...cam, eye: [100, R + 900, 50], target: [5100, R + 600, 50] })
  assert.deepEqual(Array.from(moved), Array.from(vpr), 'a translated camera with the same heading gives the same matrix')
  const planet = sdk.createPlanet()
  const stats = planet.update(cam)
  const culled = stats.count
  const all = planet.update({ ...cam, cull: false }).count
  assert.ok(culled < all, `${culled} of ${all}`)
  planet.update(cam)
  let kept = 0
  for (let i = 0; i < planet.stats.count; i++) {
    if (!quadOutsideFrustum(planet.leaves.face[i], planet.leaves.ox[i], planet.leaves.oy[i], planet.leaves.l[i], R, vpr, cam.eye)) kept++
  }
  assert.ok(kept > 0.5 * culled, `${kept} of ${culled} kept leaves pass the exact nine-point test`)
  assert.equal(code(() => sdk.cameraViewProjRel({ eye: [0, 0, 0], target: [0, 0, 0], fovy: 1, aspect: 1, near: 1, far: 2 })), 'camera-target-on-eye')
  assert.equal(code(() => sdk.cameraViewProjRel({ eye: [0, 0, 0], target: [1, 0, 0], fovy: 1, aspect: 1, near: 2, far: 1 })), 'camera-clip-range-bad')
  assert.equal(code(() => planet.update({ eye: [0, R, 0] })), 'camera-viewport-missing')
})

gate('a planet carries its seed into the anchor field and its height matches createHeightSampler', () => {
  const planet = sdk.createPlanet({ radiusM: 6360, seed: 77, hpfTexRes: 16 })
  const sampler = createHeightSampler({ radius: 6360, seed: 77, hpfTexRes: 16 })
  const dirs = [[0, 1, 0], [0.3, -0.5, 0.8], [-1, 0.2, 0.1]]
  for (const dir of dirs) assert.equal(planet.heightAt(dir), sampler.heightAt(dir))
  const p = planet.surfacePoint(dirs[1])
  assert.ok(Math.abs(Math.hypot(...p) - (6360 + planet.heightAt(dirs[1]))) < 1e-2, `${Math.hypot(...p)} ${planet.heightAt(dirs[1])}`)
  assert.equal(JSON.parse(planet.anchorField.serialize()).seed, 77)
  const other = sdk.createPlanet({ radiusM: 6360, seed: 78, hpfTexRes: 16 })
  assert.ok(dirs.some((dir) => other.heightAt(dir) !== planet.heightAt(dir)), 'negative control: another seed gives another ground')
})

gate('the patch geometry is built once at the planet grid size', () => {
  const planet = sdk.createPlanet({ gridSize: 4 })
  const g = planet.geometry()
  assert.equal(g, planet.geometry())
  assert.deepEqual(Array.from(g.vertices), Array.from(sdk.buildGridGeometry(4, true).vertices))
  assert.equal(sdk.createPlanet({ gridSize: 4, skirt: false }).geometry().vertices.length, sdk.buildGridGeometry(4, false).vertices.length)
  assert.equal(code(() => sdk.createPlanet({ gridSize: 0 })), 'planet-grid-size-not-whole')
})

finish()
