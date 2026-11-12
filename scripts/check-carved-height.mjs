import { gate, finish } from './lib/gate.mjs'
import { createCarvedHeightQuery } from '../src/terrain-pure/carvedHeightQuery.js'
import { thermalErode, hydraulicErode } from '../src/terrain-pure/terrainErosion.js'
import { defineStructureTemplate } from '../src/terrain-pure/structureStamp.js'
import { createCaveVolume, polygonizeCaveVolume } from '../src/terrain-pure/caveSdf.js'
import { marchBox } from '../src/terrain-pure/marchingCubes.js'

const fail = (what) => { throw new Error(what) }
const near = (a, b, tol, what) => { if (!(Math.abs(a - b) <= tol)) fail(`${what}: expected ${b} within ${tol}, got ${a}`) }
const refuses = (fn, pattern, what) => {
  let thrown = null
  try { fn() } catch (error) { thrown = error }
  if (!thrown) fail(`${what}: did not throw`)
  if (!(thrown instanceof TypeError) || !pattern.test(thrown.message)) fail(`${what}: wrong error ${thrown.message}`)
}

const meshStats = (m, c, R) => {
  const edges = new Map()
  let volume = 0, worst = 0
  for (let t = 0; t < m.ic; t += 3) {
    const ids = [m.indices[t], m.indices[t + 1], m.indices[t + 2]]
    for (let e = 0; e < 3; e++) {
      const a = ids[e], b = ids[(e + 1) % 3]
      const key = a < b ? a * 16777216 + b : b * 16777216 + a
      edges.set(key, (edges.get(key) || 0) + 1)
    }
    const p = ids.map((i) => [m.positions[i * 3] - c[0], m.positions[i * 3 + 1] - c[1], m.positions[i * 3 + 2] - c[2]])
    volume += (p[0][0] * (p[1][1] * p[2][2] - p[1][2] * p[2][1]) - p[0][1] * (p[1][0] * p[2][2] - p[1][2] * p[2][0]) + p[0][2] * (p[1][0] * p[2][1] - p[1][1] * p[2][0])) / 6
  }
  let open = 0
  for (const uses of edges.values()) if (uses !== 2) open++
  for (let v = 0; v < m.vc; v++) worst = Math.max(worst, Math.abs(Math.hypot(m.positions[v * 3] - c[0], m.positions[v * 3 + 1] - c[1], m.positions[v * 3 + 2] - c[2]) - R) / R)
  return { open, euler: m.vc - edges.size + m.ic / 3, volumeRatio: Math.abs(volume) / (4 / 3 * Math.PI * R * R * R), worst }
}

const RADII = [0.25, 0.5, 1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 16, 24, 32, 48, 64, 96, 128, 256, 512, 1024]

gate('a cave sphere polygonizes to a closed surface on its radius at 22 world radii from 0.25 to 1024 and at two resolutions', () => {
  for (const R of RADII) {
    for (const [res, volumeFloor, radiusTol] of [[12, 0.94, 0.01], [24, 0.985, 0.003]]) {
      const c = [100 + R, -20, 7 - R]
      const s = meshStats(polygonizeCaveVolume(createCaveVolume(c[0], c[1], c[2], R), res), c, R)
      if (s.open !== 0 || s.euler !== 2) fail(`radius ${R} res ${res}: ${s.open} edges are not shared by two triangles, Euler ${s.euler}`)
      if (!(s.volumeRatio > volumeFloor && s.volumeRatio < 1.001)) fail(`radius ${R} res ${res}: volume ratio ${s.volumeRatio}`)
      if (!(s.worst < radiusTol)) fail(`radius ${R} res ${res}: a vertex is ${s.worst} of the radius off the sphere`)
    }
  }
})

gate('marching a box directly in world units gives a closed sphere at every radius and the same triangle count from radius 4 to 1024, including boxes far from the origin', () => {
  let reference = null
  for (const R of RADII) {
    for (const centre of [[0, 0, 0], [4000, -250, 9000]]) {
      const b = R * 1.3
      const m = marchBox(24, (x, y, z) => Math.hypot(x - centre[0], y - centre[1], z - centre[2]) - R, centre[0] - b, centre[0] + b, centre[1] - b, centre[1] + b, centre[2] - b, centre[2] + b)
      const s = meshStats(m, centre, R)
      if (s.open !== 0 || s.euler !== 2) fail(`radius ${R} at ${centre}: ${s.open} open edges, Euler ${s.euler}`)
      if (!(s.volumeRatio > 0.985 && s.volumeRatio < 1.001)) fail(`radius ${R} at ${centre}: volume ratio ${s.volumeRatio}`)
      if (centre[0] === 0 && R >= 4) {
        if (reference === null) reference = m.ic
        if (m.ic !== reference) fail(`radius ${R}: ${m.ic} indices against ${reference} at radius 4, so the mesh depends on the scale`)
      }
    }
  }
})

gate('negative control: a sphere marched with its vertices welded on a 10-bit key at 0.01 units is not closed beyond 5 units', () => {
  const R = 8, b = R * 1.3
  const m = marchBox(24, (x, y, z) => Math.hypot(x, y, z) - R, -b, b, -b, b, -b, b)
  const weld = new Map()
  const remap = new Uint32Array(m.vc)
  for (let v = 0; v < m.vc; v++) {
    const key = ((((m.positions[v * 3] * 100) | 0) + 512) << 20) | ((((m.positions[v * 3 + 1] * 100) | 0) + 512) << 10) | (((m.positions[v * 3 + 2] * 100) | 0) + 512)
    if (!weld.has(key)) weld.set(key, v)
    remap[v] = weld.get(key)
  }
  const indices = []
  for (let t = 0; t < m.ic; t += 3) {
    const a = remap[m.indices[t]], bb = remap[m.indices[t + 1]], c = remap[m.indices[t + 2]]
    if (a !== bb && bb !== c && c !== a) indices.push(a, bb, c)
  }
  const s = meshStats({ positions: m.positions, vc: m.vc, indices, ic: indices.length }, [0, 0, 0], R)
  if (s.open === 0) fail('the overflowing weld still produced a closed surface, so the closed-surface check cannot see the defect')
})

const cliff = (x, z) => (x > 40 ? 30 : 0) + 0.02 * z
const TILE = { cornerX: 0, cornerZ: 0, width: 41, spacing: 2 }

gate('negative control: with no erosion, spline, cave or stamp the query returns the base ground everywhere', () => {
  const q = createCarvedHeightQuery({ baseHeightAt: cliff })
  for (let i = 0; i < 200; i++) {
    const x = (i * 37) % 97 - 8, z = (i * 53) % 91 - 5
    if (q.heightAt(x, z) !== cliff(x, z)) fail(`(${x}, ${z}) differs from the base`)
  }
  if (q.posts.length !== 0 || q.kindAt(3, 3) !== null) fail('an empty query reported a post or a kind')
})

gate('thermal erosion in the query path lowers the cliff top, raises its foot, and equals thermalErode at the interior nodes', () => {
  const thermal = { talusAngle: Math.PI / 6, iterations: 60, rate: 0.05 }
  const q = createCarvedHeightQuery({ baseHeightAt: cliff, tile: TILE, erosion: { thermal } })
  if (!(q.heightAt(42, 40) < cliff(42, 40) - 1)) fail(`cliff top at 42 stayed at ${q.heightAt(42, 40)}`)
  if (!(q.heightAt(40, 40) > cliff(40, 40) + 1)) fail(`cliff foot at 40 stayed at ${q.heightAt(40, 40)}`)
  const n = TILE.width
  const base = new Float32Array(n * n)
  for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) base[iz * n + ix] = cliff(ix * 2, iz * 2)
  const direct = thermalErode(base, n, 2, thermal.talusAngle, thermal.iterations, thermal.rate)
  let compared = 0
  for (let iz = 2; iz < n - 2; iz++) for (let ix = 2; ix < n - 2; ix++) { near(q.heightAt(ix * 2, iz * 2), direct[iz * n + ix], 1e-4, `node ${ix}, ${iz}`); compared++ }
  if (compared !== 37 * 37) fail('interior nodes not compared')
  let moved = 0, sum = 0
  for (let i = 0; i < n * n; i++) { moved += Math.abs(direct[i] - base[i]); sum += direct[i] - base[i] }
  if (!(moved > 100)) fail(`erosion moved only ${moved} m of height`)
  near(sum, 0, moved * 1e-3, 'thermal erosion conserves material')
})

gate('the eroded tile meets the untouched ground outside it without a step, and outside the tile the query is the base exactly', () => {
  const q = createCarvedHeightQuery({ baseHeightAt: cliff, tile: TILE, erosion: { thermal: { iterations: 60 } } })
  for (const z of [10, 40, 70]) {
    for (const [inside, outside] of [[[0.001, z], [-0.001, z]], [[79.999, z], [80.001, z]], [[z, 0.001], [z, -0.001]], [[z, 79.999], [z, 80.001]]]) {
      const step = Math.abs((q.heightAt(inside[0], inside[1]) - cliff(inside[0], inside[1])) - (q.heightAt(outside[0], outside[1]) - cliff(outside[0], outside[1])))
      if (!(step < 0.01)) fail(`a step of ${step} m at the tile edge near (${inside})`)
    }
  }
  if (q.heightAt(-5, 40) !== cliff(-5, 40) || q.heightAt(200, 40) !== cliff(200, 40)) fail('ground outside the tile changed')
  const hard = createCarvedHeightQuery({ baseHeightAt: cliff, tile: { ...TILE, featherNodes: 0 }, erosion: { thermal: { iterations: 60 } } })
  const hardStep = Math.abs((hard.heightAt(42, 0.001) - cliff(42, 0.001)) - (hard.heightAt(42, -0.001) - cliff(42, -0.001)))
  if (!(hardStep > 0.5)) fail(`negative control: with no feather the tile edge step is only ${hardStep} m`)
})

gate('hydraulic erosion in the query path equals hydraulicErode for the same seed and differs for another seed', () => {
  const hill = (x, z) => 20 * Math.exp(-((x - 40) * (x - 40) + (z - 40) * (z - 40)) / 400)
  const opts = { drops: 3000, seed: 7, erosion: 0.3, capacity: 0.05, deposition: 0.1 }
  const a = createCarvedHeightQuery({ baseHeightAt: hill, tile: TILE, erosion: { hydraulic: opts } })
  const b = createCarvedHeightQuery({ baseHeightAt: hill, tile: TILE, erosion: { hydraulic: opts } })
  const c = createCarvedHeightQuery({ baseHeightAt: hill, tile: TILE, erosion: { hydraulic: { ...opts, seed: 8 } } })
  if (a.checksum() !== b.checksum()) fail('two builds from the same seed differ')
  if (a.checksum() === c.checksum()) fail('a different seed gave the same grid')
  const n = TILE.width
  const base = new Float32Array(n * n)
  for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) base[iz * n + ix] = hill(ix * 2, iz * 2)
  const direct = hydraulicErode(base, n, 2, opts)
  let changed = 0
  for (let iz = 2; iz < n - 2; iz++) for (let ix = 2; ix < n - 2; ix++) {
    near(a.heightAt(ix * 2, iz * 2), hill(ix * 2, iz * 2) + (direct[iz * n + ix] - base[iz * n + ix]), 1e-4, `node ${ix}, ${iz}`)
    if (direct[iz * n + ix] !== base[iz * n + ix]) changed++
  }
  if (changed < 50) fail(`hydraulic erosion changed only ${changed} interior nodes`)
})

gate('a river spline lowers the ground along its course by up to its depth, names the kind, and leaves ground beyond its banks alone', () => {
  const flat = () => 50
  const q = createCarvedHeightQuery({ baseHeightAt: flat, splines: [{ controlPoints: [[0, 100], [100, 100], [200, 120]], width: 24, depth: 6, kind: 'river' }] })
  let lowest = Infinity
  for (let x = 20; x <= 180; x += 4) {
    const z = x <= 100 ? 100 : 100 + (x - 100) * 0.2
    const h = q.heightAt(x, z)
    if (!(h < 50 - 2)) fail(`the river bed at (${x}, ${z}) is at ${h}`)
    if (q.kindAt(x, z) !== 'river') fail(`no river kind at (${x}, ${z})`)
    lowest = Math.min(lowest, h)
  }
  if (!(lowest >= 50 - 6 - 1e-9 && lowest < 50 - 5)) fail(`deepest bed ${lowest}, expected within a metre of 6 below`)
  if (q.heightAt(60, 160) !== 50 || q.kindAt(60, 160) !== null) fail('ground 60 m from the river changed')
  refuses(() => createCarvedHeightQuery({ baseHeightAt: flat, splines: [{ controlPoints: [[0, 0]], width: 4, depth: 1, kind: 'river' }] }), /spline 0 carved no cell/, 'one control point')
  refuses(() => createCarvedHeightQuery({ baseHeightAt: flat, splines: [{ controlPoints: [[0, 0], [9, 9]], width: 4, depth: 1, kind: 'canal' }] }), /spline 0 carved no cell/, 'unknown kind')
})

gate('a cave that breaks the surface drops the ground to its floor, and a cave wholly below the surface leaves it', () => {
  const flat = () => 10
  const q = createCarvedHeightQuery({ baseHeightAt: flat, caves: [{ worldX: 0, worldY: 8, worldZ: 0, worldRadius: 5, kind: 'sphere' }, { worldX: 100, worldY: -20, worldZ: 0, worldRadius: 5, kind: 'sphere' }] })
  near(q.heightAt(0, 0), 3, 1e-9, 'the pit floor is the bottom of the sphere')
  near(q.heightAt(3, 0), 8 - 4, 1e-9, 'off centre the floor follows the sphere')
  if (q.heightAt(6, 0) !== 10) fail('ground outside the cave radius changed')
  if (q.heightAt(100, 0) !== 10) fail('a buried cave changed the surface')
  const stacked = createCarvedHeightQuery({ baseHeightAt: flat, caves: [{ worldX: 0, worldY: 8, worldZ: 0, worldRadius: 5, kind: 'sphere' }, { worldX: 0, worldY: 9, worldZ: 0, worldRadius: 3, kind: 'sphere' }] })
  near(stacked.heightAt(0, 0), 3, 1e-9, 'two overlapping caves open to the lower floor once, not the sum of both')
  refuses(() => createCarvedHeightQuery({ baseHeightAt: flat, caves: [{ worldX: 0, worldY: 0, worldZ: 0, worldRadius: -1 }] }), /cave 0/, 'negative radius')
})

gate('structure posts stand on the carved ground: a stamp in the river bed sits lower than the same stamp on the bank', () => {
  defineStructureTemplate('carved-height-hut', { footprintRadius: 3, parts: [{ model: 'post', x: 1, z: 0 }, { model: 'post', x: -1, z: 0 }] })
  const flat = () => 50
  const q = createCarvedHeightQuery({
    baseHeightAt: flat,
    splines: [{ controlPoints: [[0, 100], [100, 100], [200, 100]], width: 24, depth: 6, kind: 'river' }],
    stamps: [{ template: 'carved-height-hut', x: 100, z: 100 }, { template: 'carved-height-hut', x: 100, z: 200 }],
  })
  if (q.posts.length !== 4) fail(`${q.posts.length} posts`)
  const inRiver = q.posts.filter((p) => p.stamp === 0), onBank = q.posts.filter((p) => p.stamp === 1)
  for (const p of inRiver) near(p.y, q.heightAt(100, 100), 1e-9, 'river post height')
  for (const p of onBank) near(p.y, 50, 1e-9, 'bank post height')
  if (!(inRiver[0].y < onBank[0].y - 2)) fail('the river post is not lower than the bank post')
})

gate('all four layers compose in one query: eroded ground, then the spline, then the cave, with ground that has no height passed through', () => {
  const base = (x, z) => (x < -500 ? null : cliff(x, z) + 40)
  const q = createCarvedHeightQuery({
    baseHeightAt: base,
    tile: TILE,
    erosion: { thermal: { iterations: 40 } },
    splines: [{ controlPoints: [[10, 20], [70, 20]], width: 8, depth: 3, kind: 'road' }],
    caves: [{ worldX: 20, worldY: 39, worldZ: 60, worldRadius: 4, kind: 'sphere' }],
  })
  if (q.heightAt(-600, 0) !== null) fail('missing ground was given a height')
  const x = 44, z = 20
  near(q.heightAt(x, z), q.erodedHeightAt(x, z) + q.splineDeltaAt(x, z), 1e-9, 'road over eroded ground')
  if (!(q.splineDeltaAt(x, z) < 0 && q.erosionDeltaAt(x, z) !== 0)) fail('the sample point is not both eroded and carved')
  if (q.kindAt(x, z) !== 'road') fail('road kind missing')
  const surface = q.erodedHeightAt(20, 60)
  near(q.heightAt(20, 60), surface + q.caveDeltaAt(20, 60, surface), 1e-9, 'cave under eroded ground')
  if (!(q.heightAt(20, 60) < surface - 3)) fail('the cave did not open the surface')
  const json = q.toJSON()
  if (json.splines.splines.length !== 1 || json.caves.volumes.length !== 1) fail('the carve record does not list one spline and one cave')
})

gate('a query without a ground function, an erosion without a tile and a malformed tile are refused', () => {
  refuses(() => createCarvedHeightQuery({}), /baseHeightAt is missing/, 'no ground')
  refuses(() => createCarvedHeightQuery({ baseHeightAt: cliff, erosion: { thermal: {} } }), /tile is/, 'no tile')
  refuses(() => createCarvedHeightQuery({ baseHeightAt: cliff, erosion: { thermal: {} }, tile: { ...TILE, width: 2 } }), /width/, 'narrow tile')
  refuses(() => createCarvedHeightQuery({ baseHeightAt: cliff, erosion: { thermal: {} }, tile: { ...TILE, spacing: 0 } }), /spacing/, 'zero spacing')
  refuses(() => createCarvedHeightQuery({ baseHeightAt: cliff, erosion: { thermal: {} }, tile: { ...TILE, featherNodes: 30 } }), /featherNodes/, 'feather too wide')
})

finish()
