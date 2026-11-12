import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { listBookmarks } from '../src/shared/bookmarks.js'
import { COAST_BAND_M, DENSITY_MIN, HILL_MIN_SLOPE, SEARCH_KINDS, SEARCH_MAX_RADIUS_M, SEARCH_STEP_M, resolveBookmarkSpec, searchBookmark } from '../src/sessions-pure/relocationSearch.js'
import { resolveTarget } from '../src/sessions-pure/relocationTarget.js'

const SEA = 10

const island = (x, z) => {
  const r = Math.hypot(x, z)
  if (r > 1000) return SEA - 20
  if (r > 900) return SEA + (1000 - r) * 0.05
  const ridge = Math.max(0, 1 - Math.abs(x - 500) / 60) * 80
  return SEA + 5 + ridge
}

const forest = (x, z) => (z < -300 && Math.hypot(x, z) < 880 ? 0.8 : 0.1)
const rocks = (x, z) => (Math.abs(x - 500) < 80 ? 0.9 : 0)

const ctxOf = (extra = {}) => ({ origin: [0, 0], heightAt: island, seaLevelY: SEA, treeDensityAt: forest, rockDensityAt: rocks, ...extra })

gate('the search kinds are the four search bookmarks listBookmarks names, in the same order', () => {
  const searches = listBookmarks({}, null).filter((b) => b.search).map((b) => b.search)
  assert.deepEqual(searches, [...SEARCH_KINDS])
  assert.deepEqual([...SEARCH_KINDS], ['coast', 'hills', 'forest', 'rocks'])
})

gate('coast finds dry ground within the coast band that has water one step away, on the nearest ring that has any', () => {
  const hit = searchBookmark('coast', ctxOf())
  assert.equal(hit.found, true)
  const h = island(hit.spec.x, hit.spec.z)
  assert.ok(h - SEA >= 0.1 && h - SEA <= COAST_BAND_M, 'height above sea ' + (h - SEA))
  const r = Math.hypot(hit.spec.x, hit.spec.z)
  assert.ok(r > 968 && r <= 1000, 'coast radius ' + r)
  assert.equal(hit.distanceM, hit.ring * SEARCH_STEP_M)
  const wet = [[SEARCH_STEP_M, 0], [-SEARCH_STEP_M, 0], [0, SEARCH_STEP_M], [0, -SEARCH_STEP_M]].filter(([dx, dz]) => island(hit.spec.x + dx, hit.spec.z + dz) < SEA)
  assert.ok(wet.length > 0, 'no water beside the coast point')
  const earlier = searchBookmark('coast', ctxOf({ maxRadiusM: hit.distanceM - SEARCH_STEP_M }))
  assert.deepEqual({ found: earlier.found, reason: earlier.reason }, { found: false, reason: 'no-match' })
})

gate('hills finds the steep ridge flank, above the slope threshold, and never a point under the sea', () => {
  const hit = searchBookmark('hills', ctxOf())
  assert.equal(hit.found, true)
  assert.ok(hit.score >= HILL_MIN_SLOPE, 'slope ' + hit.score)
  assert.ok(Math.abs(hit.spec.x - 500) < 64, 'ridge x ' + hit.spec.x)
  assert.ok(island(hit.spec.x, hit.spec.z) >= SEA)
  const flat = searchBookmark('hills', ctxOf({ heightAt: () => SEA + 3 }))
  assert.equal(flat.found, false)
})

gate('forest and rocks take the densest sample of the first ring that reaches the density threshold', () => {
  const trees = searchBookmark('forest', ctxOf())
  assert.equal(trees.found, true)
  assert.ok(trees.spec.z < -300 && trees.score >= DENSITY_MIN)
  assert.ok(trees.distanceM >= 300 && trees.distanceM < 300 + 2 * SEARCH_STEP_M, 'forest distance ' + trees.distanceM)
  const stone = searchBookmark('rocks', ctxOf())
  assert.equal(stone.found, true)
  assert.ok(Math.abs(stone.spec.x - 500) < 80)
  const moved = searchBookmark('rocks', ctxOf({ origin: [500, 0] }))
  assert.equal(moved.ring, 1)
})

gate('the search is a function of its inputs: the same call gives the same answer and a moved origin moves it', () => {
  const a = searchBookmark('coast', ctxOf())
  const b = searchBookmark('coast', ctxOf())
  assert.deepEqual(a, b)
  const c = searchBookmark('coast', ctxOf({ origin: [800, 0] }))
  assert.ok(c.distanceM < a.distanceM)
  assert.ok(c.spec.x > 900)
})

gate('a non-finite sample is skipped and counted, never returned, and no answer carries NaN', () => {
  const holes = (x, z) => (x > 0 ? Number.NaN : island(x, z))
  const hit = searchBookmark('coast', ctxOf({ heightAt: holes }))
  assert.equal(hit.found, true)
  assert.ok(hit.spec.x <= 0)
  assert.ok(hit.skipped > 0)
  assert.ok(Object.values(hit.spec).every(Number.isFinite))
  const none = searchBookmark('coast', ctxOf({ heightAt: () => Number.NaN, maxRadiusM: 256 }))
  assert.deepEqual({ found: none.found, reason: none.reason }, { found: false, reason: 'no-match' })
  assert.equal(none.skipped, none.samples)
  assert.equal('spec' in none, false)
})

gate('the search stops at the radius and at the sample budget, and reports which', () => {
  const far = searchBookmark('coast', ctxOf({ maxRadiusM: 512 }))
  assert.deepEqual({ found: far.found, reason: far.reason, ring: far.ring }, { found: false, reason: 'no-match', ring: 16 })
  const capped = searchBookmark('coast', ctxOf({ maxSamples: 100 }))
  assert.deepEqual({ found: capped.found, reason: capped.reason, samples: capped.samples }, { found: false, reason: 'sample-budget', samples: 100 })
  assert.equal(SEARCH_MAX_RADIUS_M, 4096)
  const fine = searchBookmark('coast', ctxOf({ stepM: 12 }))
  assert.equal(fine.found, true)
  assert.ok(fine.samples > searchBookmark('coast', ctxOf()).samples)
})

gate('an unknown kind, a missing sampler, a missing sea level, a bad origin and a non-positive step are refused by name', () => {
  assert.throws(() => searchBookmark('lava', ctxOf()), { name: 'RangeError', message: /kind must be one of coast, hills, forest, rocks; got lava/ })
  assert.throws(() => searchBookmark('toString', ctxOf()), RangeError)
  assert.throws(() => searchBookmark('coast', null), { name: 'TypeError', message: /needs a ctx object/ })
  assert.throws(() => searchBookmark('coast', ctxOf({ heightAt: null })), { name: 'TypeError', message: /coast needs ctx\.heightAt/ })
  assert.throws(() => searchBookmark('forest', ctxOf({ treeDensityAt: undefined })), { name: 'TypeError', message: /forest needs ctx\.treeDensityAt/ })
  assert.throws(() => searchBookmark('rocks', ctxOf({ rockDensityAt: undefined })), { name: 'TypeError', message: /rocks needs ctx\.rockDensityAt/ })
  assert.throws(() => searchBookmark('coast', ctxOf({ seaLevelY: undefined })), { name: 'TypeError', message: /seaLevelY/ })
  assert.throws(() => searchBookmark('coast', ctxOf({ origin: [0, Number.NaN] })), { name: 'TypeError', message: /origin/ })
  assert.throws(() => searchBookmark('coast', ctxOf({ stepM: 0 })), { name: 'RangeError', message: /stepM/ })
  assert.doesNotThrow(() => searchBookmark('coast', ctxOf({ treeDensityAt: undefined, rockDensityAt: undefined })))
})

gate('every bookmark of the list resolves to a spec the teleport target reader accepts, and a search miss stays a miss', () => {
  const world = { spawnPoint: [1, 2, 3], entities: [{ id: 'spawn-dock', app: 'spawn-point', position: [4, 5, 6] }] }
  const list = listBookmarks(world, null)
  let searched = 0
  for (const bookmark of list) {
    const resolved = resolveBookmarkSpec(bookmark, ctxOf())
    assert.equal(resolved.found, true, bookmark.name)
    if (bookmark.search) {
      searched += 1
      const target = resolveTarget(resolved.spec)
      assert.deepEqual([target.x, target.z, target.snap], [resolved.spec.x, resolved.spec.z, 'terrain'])
    } else {
      assert.equal(resolved.spec, bookmark.spec)
    }
  }
  assert.equal(searched, 4)
  assert.equal(resolveBookmarkSpec({ name: 'forest', search: 'forest' }, ctxOf({ treeDensityAt: () => 0 })).found, false)
  assert.throws(() => resolveBookmarkSpec({ name: 'broken' }, ctxOf()), { name: 'TypeError', message: /bookmark broken has neither a spec nor a search kind/ })
})

finish()
