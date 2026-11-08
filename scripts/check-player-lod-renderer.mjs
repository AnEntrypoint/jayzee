import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { gate, finish } from './lib/gate.mjs'
import { TIER_DOT } from '../src/client-pure/playerTierSplit.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/spoint/player-lod-renderer.json', import.meta.url), 'utf8'))
const lib = await import('../src/client/playerLodRenderer.js').catch((error) => ({ loadError: error.message }))
const install = (scene) => {
  if (!lib.installPlayerLodRenderer) throw new Error('src/client/playerLodRenderer.js does not export installPlayerLodRenderer: ' + (lib.loadError ?? 'no export'))
  return lib.installPlayerLodRenderer(scene, {})
}
const clone = (v) => JSON.parse(JSON.stringify(v))
const shape = (r) => ({ order: [...r.order], full: [...r.full], reduced: [...r.reduced], dot: [...r.dot], tierById: [...r.tierById.entries()] })
const groundFn = (spec) => (spec === null ? null : (x, z) => spec.a + spec.b * x + spec.c * z)
const close = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b))
const player = (id, x, y = 0, z = 0) => ({ id, x, y, z })
const origin = { x: 0, y: 0, z: 0 }

const readFrame = (renderer) => {
  const arr = renderer.dots.instancedMesh.instanceMatrix.array
  const instances = []
  for (let i = 0; i < renderer.dots.count; i++) {
    const o = i * 16
    instances.push({
      position: [arr[o + 12], arr[o + 13], arr[o + 14]],
      scale: [Math.hypot(arr[o], arr[o + 1], arr[o + 2]), Math.hypot(arr[o + 4], arr[o + 5], arr[o + 6]), Math.hypot(arr[o + 8], arr[o + 9], arr[o + 10])],
    })
  }
  return instances
}
const runTick = (renderer, step, ground) => {
  if (step.override !== undefined) renderer.setFullCountOverride(step.override)
  renderer.tick(clone(step.entries), step.viewer, step.serverDots, groundFn(ground))
  return { tiers: shape(renderer.getTiers()), count: renderer.dots.count, instances: readFrame(renderer) }
}
const sameFrame = (got, want, label) => {
  assert.deepEqual(got.tiers, want.tiers, label + ' tiers')
  assert.equal(got.count, want.count, label + ' count')
  assert.equal(got.instances.length, want.instances.length, label + ' instance rows')
  want.instances.forEach((w, i) => {
    const g = got.instances[i]
    for (let k = 0; k < 3; k++) assert.equal(g.position[k], Math.fround(w.position[k]), label + ' position ' + i + ' axis ' + k)
    for (let k = 0; k < 3; k++) assert.ok(close(g.scale[k], w.scale[k]), label + ' scale ' + i + ' axis ' + k)
  })
}

gate('the fixture was generated from spoint client/core/PlayerLOD.js through the WebGL dot renderer', () => {
  assert.equal(fixture.source.file, 'client/core/PlayerLOD.js')
  assert.match(fixture.source.sha256, /^[0-9a-f]{64}$/)
  assert.match(fixture.spointCommit, /^[0-9a-f]{7,}$/)
  assert.equal(fixture.path, 'createCrowdDotRendererWebGL')
})

gate('the fixture covers bucket, fallback, lift, cap, capacity, clear and thirty random frames', () => {
  const labels = fixture.scenarios.map((s) => s.label)
  for (const label of [
    'server bucket dots with no ground use the viewer height',
    'server bucket dots over a sloped ground',
    'the fallback draws flat dots from the remote entries in remote order',
    'the fallback over a sloped ground',
    'a bucket of 49 players and one of 400 are both capped at three dot sizes',
    'growing past the 512 starting capacity keeps every instance',
    'an empty tick after dots clears the instances',
  ]) assert.ok(labels.includes(label), label)
  assert.equal(labels.filter((l) => l.startsWith('random frame')).length, 20)
  assert.ok(fixture.scenarios.some((s) => s.steps.some((st) => st.expect.count > 512)), 'a frame past the starting capacity')
})

gate('the dot mesh is set up as spoint sets it: no frustum culling, matrix not auto-updated, render order 3', () => {
  const mesh = install(new THREE.Scene()).dots.instancedMesh
  assert.equal(mesh.frustumCulled, fixture.setup.frustumCulled)
  assert.equal(mesh.matrixAutoUpdate, fixture.setup.matrixAutoUpdate)
  assert.equal(mesh.renderOrder, fixture.setup.renderOrder)
})

gate('the dot material matches spoint: colour 0xffcc66, opacity 0.85, transparent, no depth write', () => {
  const mat = lib.makeDotMaterial()
  assert.equal(mat.color.getHex(), fixture.setup.material.color)
  assert.equal(mat.opacity, fixture.setup.material.opacity)
  assert.equal(mat.transparent, fixture.setup.material.transparent)
  assert.equal(mat.depthWrite, fixture.setup.material.depthWrite)
  assert.equal(typeof mat.onBeforeCompile, 'function')
})

gate('every scenario equals spoint tick by tick: tiers, count, and each instance position and scale', () => {
  for (const s of fixture.scenarios) {
    const renderer = install(new THREE.Scene())
    for (const step of s.steps) sameFrame(runTick(renderer, step, s.ground), step.expect, s.label)
  }
})

gate('the bucket lift is 0.05 above the viewer height', () => {
  const renderer = install(new THREE.Scene())
  renderer.tick([], { x: 0, y: 2, z: 0 }, [[0, 0, 1]], null)
  assert.equal(renderer.dots.instancedMesh.instanceMatrix.array[13], Math.fround(2.05))
})

gate('a bucket of 49 players is drawn at three dot sizes, not the uncapped root', () => {
  const renderer = install(new THREE.Scene())
  renderer.tick([], origin, [[3, 4, 49]], null)
  assert.ok(close(readFrame(renderer)[0].scale[0], 4.2), 'scale ' + readFrame(renderer)[0].scale[0])
})

gate('growing past the starting capacity draws all 600 dots', () => {
  const renderer = install(new THREE.Scene())
  renderer.setFullCountOverride(0)
  renderer.tick(Array.from({ length: 600 }, (_, i) => player(5000 + i, 200 + i * 0.5)), origin, null, null)
  assert.equal(renderer.dots.count, 600)
  assert.equal(renderer.dots.instancedMesh.count, 600)
})

gate('a tick with no dots sets the count to zero', () => {
  const renderer = install(new THREE.Scene())
  renderer.tick([player(1, 200)], origin, [[0, 0, 1]], null)
  assert.equal(renderer.dots.count, 1)
  renderer.tick([], origin, null, null)
  assert.equal(renderer.dots.count, 0)
  assert.equal(renderer.dots.instancedMesh.count, 0)
})

gate('dispose removes the dot mesh from the scene', () => {
  const scene = new THREE.Scene()
  const renderer = install(scene)
  const mesh = renderer.dots.instancedMesh
  assert.ok(scene.children.includes(mesh))
  renderer.dispose()
  assert.ok(!scene.children.includes(mesh))
})

gate('the billboard shader puts its block on its own line after the begin_vertex include, as GLSL needs', () => {
  const NL = String.fromCharCode(10)
  const shader = { vertexShader: 'void main() {' + NL + '#include <begin_vertex>' + NL + '}' }
  lib.makeDotMaterial().onBeforeCompile(shader)
  assert.ok(shader.vertexShader.includes('#include <begin_vertex>' + NL + '{' + NL), 'the block does not start on its own line')
  assert.ok(shader.vertexShader.includes('sx;' + NL + '}' + NL + '}'), 'the block does not end on its own line')
})

gate('a non-finite viewer is refused and leaves the instances as they were', () => {
  const renderer = install(new THREE.Scene())
  renderer.tick([], origin, [[0, 0, 1]], null)
  const before = renderer.dots.count
  assert.throws(() => renderer.tick([], { x: 0, y: NaN, z: 0 }, [[0, 0, 2], [1, 1, 1]], null), RangeError)
  assert.equal(renderer.dots.count, before)
})

gate('tierOf for an id that was never ticked is the dot tier, as in spoint', () => {
  assert.equal(install(new THREE.Scene()).tierOf(999), TIER_DOT)
})

finish()
