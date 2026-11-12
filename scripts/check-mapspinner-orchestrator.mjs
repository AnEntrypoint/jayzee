import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { createPlanetOrchestrator, faceLocalInto, PlanetOrchestratorError, PLANET_FRAME_OK, PLANET_FRAME_LEVEL_CAPPED, PLANET_FRAME_OVER_BUDGET } from '../src/packages/mapspinner/planet-orchestrator.js'
import { pickFace, worldToFaceLocal } from '../src/packages/mapspinner/planet-orchestrator-cull.js'
import { Mat4 } from '../src/packages/mapspinner/mat4.js'
import { Quadtree } from '../src/packages/mapspinner/quadtree.js'
import { resolveLodConfig, applyLodConfig } from '../src/packages/mapspinner/lod-config.js'

const R = 6360000
const FOVY = 1
const H = 1080
const lookFrom = (dir) => Mat4.mul(Mat4.perspective(FOVY, 16 / 9, 0.1, 1e8), Mat4.lookAt([0, 0, 0], dir, [0, 1, 0]))
const faceArea = (o, face) => {
  let area = 0
  for (let i = o.faceStart[face]; i < o.faceStart[face + 1]; i++) area += o.leaves.l[i] * o.leaves.l[i]
  return area
}
const keys = (o) => {
  const set = new Set()
  for (let i = 0; i < o.stats.count; i++) set.add(`${o.leaves.face[i]}:${o.leaves.level[i]}:${o.leaves.tx[i]}:${o.leaves.ty[i]}`)
  return set
}
const code = (fn) => {
  try {
    fn()
  } catch (error) {
    return error.code ?? error.constructor.name
  }
  return null
}

gate('without a frustum the six faces are tiled exactly, at every altitude', () => {
  const o = createPlanetOrchestrator({ maxLeaves: 4096 })
  for (const alt of [2, 5000, 1e6, 2e7]) {
    const stats = o.frame({ eye: [0, R + alt, 0], fovy: FOVY, viewportH: H })
    assert.equal(stats.status, PLANET_FRAME_OK)
    assert.equal(o.faceStart[6], stats.count)
    for (let f = 0; f < 6; f++) assert.ok(Math.abs(faceArea(o, f) / (4 * R * R) - 1) < 1e-12, `face ${f} at ${alt} m`)
  }
})

gate('one frame equals six Quadtree updates configured by resolveLodConfig and applyLodConfig', () => {
  const eye = [1200000, R * 0.9, -800000]
  const o = createPlanetOrchestrator({})
  const stats = o.frame({ eye, fovy: FOVY, viewportH: H })
  const cfg = resolveLodConfig({}, FOVY)
  let n = 0
  for (let f = 0; f < 6; f++) {
    const tree = new Quadtree(R)
    applyLodConfig(tree, R, H, cfg)
    const local = [0, 0, 0]
    faceLocalInto(f, eye, R, local)
    const want = tree.updateQuadtree(local[0], local[1], local[2], local[0], local[1], undefined, undefined, Math.hypot(...eye) - R)
    assert.equal(o.faceStart[f + 1] - o.faceStart[f], want.length, `face ${f} leaf count`)
    for (const leaf of want) {
      assert.equal(o.leaves.face[n], f)
      assert.equal(o.leaves.level[n], leaf.level)
      assert.equal(o.leaves.tx[n], leaf.tx)
      assert.equal(o.leaves.ty[n], leaf.ty)
      assert.equal(o.leaves.ox[n], leaf.ox)
      assert.equal(o.leaves.l[n], leaf.l)
      n++
    }
  }
  assert.equal(n, stats.count)
  assert.equal(stats.nearestFace, pickFace(eye))
  assert.equal(stats.splitDist, new Quadtree(R).computeSplitDist(cfg.splitFactor * 7.2, H, FOVY))
})

gate('face-local camera coordinates equal spoint worldToFaceLocal in front of a face and run on past the edge behind it', () => {
  const eye = [1200000, R * 0.9, -800000]
  const out = new Float64Array(3)
  for (const f of [0, 2, 5]) {
    const want = worldToFaceLocal(f, eye, R)
    faceLocalInto(f, eye, R, out)
    assert.ok(want[2] > 1)
    for (let k = 0; k < 3; k++) assert.ok(Math.abs(out[k] - want[k]) <= 1e-9 * R, `face ${f} component ${k}`)
  }
  const behind = [20000, 30000, -(R + 300)]
  faceLocalInto(4, behind, R, out)
  assert.ok(Math.abs(out[0]) > 2 * R || Math.abs(out[1]) > 2 * R, 'a camera behind the face lands beyond the face square')
  const corner = worldToFaceLocal(4, behind, R)
  assert.deepEqual([Math.abs(corner[0]), Math.abs(corner[1])], [R, R], 'negative control: spoint pins that camera to a face corner')
  const o = createPlanetOrchestrator({})
  o.frame({ eye: behind, fovy: FOVY, viewportH: H })
  assert.ok(o.faceStart[5] - o.faceStart[4] <= 4, 'the far face stays coarse')
})

gate('the finest leaves sit on the face under the camera and that face holds the most leaves', () => {
  const o = createPlanetOrchestrator({})
  const stats = o.frame({ eye: [20000, 30000, -(R + 300)], fovy: FOVY, viewportH: H })
  assert.equal(stats.nearestFace, 5)
  let finest = 0
  let finestFace = -1
  for (let i = 0; i < stats.count; i++) {
    if (o.leaves.level[i] > finest) {
      finest = o.leaves.level[i]
      finestFace = o.leaves.face[i]
    }
  }
  assert.equal(finest, 11)
  assert.equal(finestFace, 5)
  for (let f = 0; f < 5; f++) assert.ok(o.faceStart[f + 1] - o.faceStart[f] < o.faceStart[6] - o.faceStart[5])
})

gate('a view-projection culls to a subset of the unculled leaves and a turned camera keeps other leaves', () => {
  const o = createPlanetOrchestrator({})
  const eye = [0, R + 5000, 0]
  o.frame({ eye, fovy: FOVY, viewportH: H })
  const all = keys(o)
  const east = o.frame({ eye, fovy: FOVY, viewportH: H, viewProjRel: lookFrom([1, -0.2, 0]) }).count
  const eastKeys = keys(o)
  assert.ok(east < all.size && east > 0, `${east} of ${all.size}`)
  for (const k of eastKeys) assert.ok(all.has(k), `culled run made a leaf the unculled run lacks: ${k}`)
  o.frame({ eye, fovy: FOVY, viewportH: H, viewProjRel: lookFrom([-1, -0.2, 0]) })
  const westKeys = keys(o)
  let onlyWest = 0
  for (const k of westKeys) if (!eastKeys.has(k)) onlyWest++
  assert.ok(onlyWest > 0, 'negative control: looking the other way keeps different leaves')
  const up = o.frame({ eye: [0, R + 2e6, 0], fovy: FOVY, viewportH: H, viewProjRel: lookFrom([0, 1, 0]) }).count
  assert.ok(up <= 6 * 16, `looking away from the planet keeps only the uncullable top levels, got ${up}`)
})

gate('a leaf budget lowers the level cap until the frame fits and the faces stay tiled without holes', () => {
  const view = { eye: [0, R + 2, 0], fovy: FOVY, viewportH: H }
  const free = createPlanetOrchestrator({}).frame(view).count
  const o = createPlanetOrchestrator({ maxLeaves: 200 })
  const stats = o.frame(view)
  assert.ok(free > 200, 'negative control: the unbudgeted frame is over 200 leaves')
  assert.equal(stats.status, PLANET_FRAME_LEVEL_CAPPED)
  assert.ok(stats.count <= 200 && stats.count > 6, String(stats.count))
  assert.ok(stats.levelCap < stats.maxLevel && stats.passes === stats.maxLevel - stats.levelCap + 1)
  assert.equal(stats.dropped, 0)
  for (let f = 0; f < 6; f++) assert.ok(Math.abs(faceArea(o, f) / (4 * R * R) - 1) < 1e-12)
  for (let i = 0; i < stats.count; i++) assert.ok(o.leaves.level[i] <= stats.levelCap)
  const tiny = createPlanetOrchestrator({ maxLeaves: 6 })
  assert.equal(tiny.frame(view).count, 6)
  assert.equal(tiny.stats.levelCap, 0)
})

gate('a forced near-field floor that no level cap can fit is reported as over budget with the dropped count', () => {
  const o = createPlanetOrchestrator({ maxLeaves: 40 })
  assert.equal(o.setNearFieldLeafFloor(4, 2), 4)
  const stats = o.frame({ eye: [0, R + 2, 0], fovy: FOVY, viewportH: H })
  assert.equal(stats.status, PLANET_FRAME_OVER_BUDGET)
  assert.equal(stats.count, 40)
  assert.ok(stats.dropped > 0)
  assert.equal(stats.levelCap, 0)
  o.setNearFieldLeafFloor(0)
  assert.equal(o.frame({ eye: [0, R + 2, 0], fovy: FOVY, viewportH: H }).dropped, 0)
})

gate('the buffers are sized once: frames reuse the same typed arrays and the same stats object', () => {
  const o = createPlanetOrchestrator({ maxLeaves: 2048 })
  const buffers = [o.leaves.face, o.leaves.level, o.leaves.tx, o.leaves.ty, o.leaves.ox, o.leaves.oy, o.leaves.l, o.faceStart]
  const first = o.frame({ eye: [0, R + 50, 0], fovy: FOVY, viewportH: H })
  const count = first.count
  const cfg = o.lodConfig()
  for (let i = 0; i < 20; i++) assert.equal(o.frame({ eye: [0, R + 50, 0], fovy: FOVY, viewportH: H }), first)
  assert.equal(first.count, count)
  assert.equal(first.frame, 21)
  assert.equal(o.lodConfig(), cfg, 'an unchanged view does not resolve the LOD config again')
  assert.deepEqual([o.leaves.face, o.leaves.level, o.leaves.tx, o.leaves.ty, o.leaves.ox, o.leaves.oy, o.leaves.l, o.faceStart], buffers)
  for (const b of buffers.slice(0, 7)) assert.equal(b.length, 2048)
})

gate('a knob change or a new viewport height resolves the LOD config again', () => {
  const knobs = {}
  const o = createPlanetOrchestrator({ knobs })
  const view = { eye: [0, R + 50, 0], fovy: FOVY, viewportH: H }
  const base = o.frame(view).count
  assert.equal(knobs.__maxLevel, 11)
  knobs.__maxLevel = 6
  const capped = o.frame(view)
  assert.equal(capped.maxLevel, 6)
  assert.ok(capped.count < base)
  knobs.__maxLevel = 11
  assert.equal(o.frame(view).count, base)
  const split = o.frame({ ...view, viewportH: 2160 }).splitDist
  assert.ok(Math.abs(split / o.frame(view).splitDist - 2) < 1e-12)
})

gate('an injected backend is handed the buffers once per frame', () => {
  const seen = []
  const o = createPlanetOrchestrator({ backend: { drawPatches: (leaves, count, stats) => seen.push([leaves, count, stats.frame]) } })
  o.frame({ eye: [0, R + 50, 0], fovy: FOVY, viewportH: H })
  o.frame({ eye: [0, R + 50, 0], fovy: FOVY, viewportH: H })
  assert.equal(seen.length, 2)
  assert.equal(seen[0][0], o.leaves)
  assert.equal(seen[1][1], o.stats.count)
  assert.deepEqual([seen[0][2], seen[1][2]], [1, 2])
})

gate('bad budgets, views, matrices and backends are refused with their code', () => {
  assert.equal(code(() => createPlanetOrchestrator({ maxLeaves: 5 })), 'planet-max-leaves-not-whole')
  assert.equal(code(() => createPlanetOrchestrator({ maxLeaves: 10.5 })), 'planet-max-leaves-not-whole')
  assert.equal(code(() => createPlanetOrchestrator({ backend: {} })), 'planet-backend-has-no-draw-patches')
  assert.equal(code(() => createPlanetOrchestrator({ radiusM: -1 })), 'TypeError')
  const o = createPlanetOrchestrator({})
  assert.equal(code(() => o.frame(null)), 'planet-frame-view-missing')
  assert.equal(code(() => o.frame({ eye: [0, NaN, 0], fovy: FOVY, viewportH: H })), 'planet-frame-vector-not-finite')
  assert.equal(code(() => o.frame({ eye: [0, R, 0], fovy: FOVY, viewportH: 0 })), 'planet-viewport-not-positive')
  assert.equal(code(() => o.frame({ eye: [0, R, 0], fovy: 4, viewportH: H })), 'RangeError')
  assert.equal(code(() => o.frame({ eye: [0, R, 0], fovy: FOVY, viewportH: H, viewProjRel: new Float32Array(9) })), 'planet-view-proj-not-16')
  assert.ok(new PlanetOrchestratorError('x', 'y') instanceof Error)
  assert.equal(code(() => o.frame({ eye: [0, R + 9, 0], fovy: FOVY, viewportH: H })), null)
})

finish()
