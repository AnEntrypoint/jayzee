import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gate, finish } from './lib/gate.mjs'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/spoint/player-lod-plan.json', import.meta.url), 'utf8'))
const lib = await import('../src/client-pure/playerLodPlanner.js').catch((error) => ({ loadError: error.message }))
const createPlanner = () => {
  if (!lib.createPlayerLodPlanner) throw new Error('src/client-pure/playerLodPlanner.js does not export createPlayerLodPlanner: ' + (lib.loadError ?? 'no export'))
  return lib.createPlayerLodPlanner()
}
const clone = (v) => JSON.parse(JSON.stringify(v))
const shape = (r) => ({ order: [...r.order], full: [...r.full], reduced: [...r.reduced], dot: [...r.dot], tierById: [...r.tierById.entries()] })
const origin = { x: 0, y: 0, z: 0 }
const at = (id, x, y = 0, z = 0) => ({ id, x, y, z })
const ladder = (n) => Array.from({ length: n }, (_, i) => at(100 + i, 10 + i * 3))
const runStep = (planner, step) => {
  if (step.override !== undefined) planner.setFullCountOverride(step.override)
  const { tiers, dots } = planner.plan(clone(step.entries), step.viewer, step.serverDots)
  const list = dots.mode === 'none' ? null : dots.mode === 'server' ? clone(dots.list) : dots.list.map(({ id, x, y, z }) => ({ id, x, y, z }))
  return { tiers: shape(tiers), dot: { mode: dots.mode, list } }
}

gate('the fixture was generated from spoint client/core/PlayerLOD.js with a 64-hex digest', () => {
  assert.equal(fixture.source.file, 'client/core/PlayerLOD.js')
  assert.match(fixture.source.sha256, /^[0-9a-f]{64}$/)
  assert.match(fixture.spointCommit, /^[0-9a-f]{7,}$/)
})

gate('the fixture covers the override and dot source cases and thirty random plans', () => {
  const labels = fixture.scenarios.map((s) => s.label)
  for (const label of [
    'no server dots and no dot-tier player gives no dots',
    'empty scene and no server dots gives none',
    'no server dots: dot-tier players fall back in remote order',
    'empty server dots fall back to the dot-tier players',
    'server dots replace the fallback even with dot-tier players',
    'the override persists until set again or cleared',
    'an override larger than the scene makes everyone full',
    'an override of zero leaves nobody full',
    'a scene of 35 players, default count: 30 full and the rest reduced',
  ]) assert.ok(labels.includes(label), label)
  assert.equal(labels.filter((l) => l.startsWith('random plan')).length, 30)
  assert.ok(fixture.scenarios.some((s) => s.steps.some((st) => Array.isArray(st.serverDots) && st.serverDots.length > 0)), 'server dots in a random plan')
  assert.ok(fixture.scenarios.some((s) => s.steps.some((st) => st.override === null)), 'a null override in a random plan')
})

gate('every scenario equals spoint: tiers, the dot source mode and its list, tick by tick', () => {
  for (const s of fixture.scenarios) {
    const planner = createPlanner()
    for (const step of s.steps) assert.deepEqual(runStep(planner, step), step.expect, s.label)
  }
})

gate('server dots replace the fallback when present, even with dot-tier players', () => {
  const planner = createPlanner()
  planner.setFullCountOverride(0)
  const { dots } = planner.plan([at(1, 200), at(2, 5)], origin, [[1, -2, 2]])
  assert.equal(dots.mode, 'server')
  assert.deepEqual(dots.list, [[1, -2, 2]])
})

gate('empty server dots fall back to the dot-tier players in remote order', () => {
  const planner = createPlanner()
  planner.setFullCountOverride(0)
  const { dots } = planner.plan([at(1, 200), at(2, 5), at(3, 150), at(4, 8)], origin, [])
  assert.equal(dots.mode, 'fallback')
  assert.deepEqual(dots.list.map((e) => e.id), [1, 3])
})

gate('with no server dots and no dot-tier player the dot source is none', () => {
  const planner = createPlanner()
  assert.deepEqual(planner.plan([], origin, null).dots, { mode: 'none', list: null })
  assert.equal(planner.plan(ladder(20), origin, null).dots.mode, 'none')
})

gate('the override persists across plans until it is set again or cleared', () => {
  const planner = createPlanner()
  planner.setFullCountOverride(3)
  assert.equal(planner.plan(ladder(5), origin, null).tiers.full.size, 3)
  assert.equal(planner.plan(ladder(5), origin, null).tiers.full.size, 3)
  planner.setFullCountOverride(null)
  assert.equal(planner.plan(ladder(5), origin, null).tiers.full.size, 5)
})

gate('an override of zero leaves nobody full, and no override means 30', () => {
  const planner = createPlanner()
  planner.setFullCountOverride(0)
  const zero = planner.plan(ladder(35), origin, null).tiers
  assert.equal(zero.full.size, 0)
  assert.equal(zero.reduced.size, 35)
  planner.setFullCountOverride(null)
  const def = planner.plan(ladder(35), origin, null).tiers
  assert.equal(def.full.size, 30)
  assert.equal(def.reduced.size, 5)
})

gate('a fractional, negative, NaN, infinite or string override is refused, and null or undefined clears it', () => {
  const planner = createPlanner()
  for (const bad of [1.5, -1, NaN, Infinity, '3']) assert.throws(() => planner.setFullCountOverride(bad), RangeError, String(bad))
  assert.doesNotThrow(() => planner.setFullCountOverride(null))
  assert.doesNotThrow(() => planner.setFullCountOverride(undefined))
})

gate('server dots that are not an array are refused', () => {
  const planner = createPlanner()
  assert.throws(() => planner.plan([], origin, { length: 1 }), TypeError)
  assert.throws(() => planner.plan([], origin, 'abc'), TypeError)
})

gate('the fallback list is held by the planner: the next plan overwrites it, and a copy keeps the earlier one', () => {
  const planner = createPlanner()
  planner.setFullCountOverride(0)
  const first = planner.plan([at(1, 200), at(2, 5)], origin, null).dots.list
  const kept = clone(first)
  assert.deepEqual(kept, [at(1, 200)])
  const second = planner.plan([at(3, 300), at(4, 4)], origin, null).dots.list
  assert.equal(second, first)
  assert.deepEqual(clone(first), [at(3, 300)])
  assert.deepEqual(kept, [at(1, 200)])
})

gate('tierOf reads the last plan only, and a player that left has no tier', () => {
  const planner = createPlanner()
  planner.setFullCountOverride(1)
  planner.plan([at(1, 200), at(2, 5)], origin, null)
  assert.deepEqual([planner.tierOf(2), planner.tierOf(1), planner.tierOf(9)], [0, 2, undefined])
  planner.plan([at(1, 3)], origin, null)
  assert.deepEqual([planner.tierOf(1), planner.tierOf(2)], [0, undefined])
})

gate('getTiers reports the last plan', () => {
  const planner = createPlanner()
  const { tiers } = planner.plan(ladder(4), origin, null)
  assert.deepEqual(shape(planner.getTiers()), shape(tiers))
})

gate('a plan does not write to the remote entries', () => {
  const entries = [at(1, 5), at(2, 50)]
  const before = clone(entries)
  createPlanner().plan(entries, origin, null)
  assert.deepEqual(entries, before)
})

finish()
