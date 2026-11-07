import { gate, finish } from './lib/gate.mjs'
import { SpatialIndex } from '../src/spatial-pure/octree.js'
import { DEFAULT_RELEVANCE_RADIUS_M, resolveRelevanceRadius } from '../src/spatial-pure/relevanceRadius.js'

const fail = (what) => { throw new Error(what) }

const expect = (actual, expected, what) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a !== e) fail(`${what}: expected ${e} got ${a}`)
}

const throwsWith = (fn, pattern, what) => {
  let thrown = null
  try { fn() } catch (error) { thrown = error }
  if (!thrown) fail(`${what}: did not throw`)
  if (!(thrown instanceof TypeError) || !pattern.test(thrown.message)) fail(`${what}: wrong error ${thrown.message}`)
}

const sortedIds = (ids) => [...ids].sort()

const seeded = (seed) => {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

gate('resolveRelevanceRadius keeps positive numbers and maps every other value to the default', () => {
  expect(DEFAULT_RELEVANCE_RADIUS_M, 200, 'default')
  expect(resolveRelevanceRadius(50), 50, 'positive')
  for (const bad of [0, -3, NaN, '50', undefined, null]) expect(resolveRelevanceRadius(bad), 200, `value ${String(bad)}`)
})

gate('a SpatialIndex takes its relevance radius from config and falls back to the default', () => {
  expect(new SpatialIndex().relevanceRadius, 200, 'no config')
  expect(new SpatialIndex({ relevanceRadius: 75 }).relevanceRadius, 75, 'configured')
  expect(new SpatialIndex({ relevanceRadius: -1 }).relevanceRadius, 200, 'negative config refused')
})

gate('changing the relevance radius bumps geometryEpoch and mutations, repeating the same value does not', () => {
  const index = new SpatialIndex()
  const mutations = index.mutations, epoch = index.geometryEpoch
  index.relevanceRadius = 75
  expect(index.geometryEpoch, epoch + 1, 'epoch after change')
  expect(index.mutations, mutations + 1, 'mutations after change')
  index.relevanceRadius = 75
  expect(index.geometryEpoch, epoch + 1, 'epoch after the same value')
})

gate('an invalid new radius resolves to the default, so it is no change when the default is already set', () => {
  const index = new SpatialIndex()
  index.relevanceRadius = 0
  expect(index.relevanceRadius, 200, 'zero resolves to default')
  expect(index.geometryEpoch, 0, 'no epoch bump for the resolved default')
  index.relevanceRadius = 75
  index.relevanceRadius = NaN
  expect(index.relevanceRadius, 200, 'NaN resolves to default')
  expect(index.geometryEpoch, 2, 'two real changes')
})

gate('insert adds an entity that has, getPosition and size report', () => {
  const index = new SpatialIndex()
  index.insert('a', [1, 2, 3])
  expect(index.has('a'), true, 'has')
  expect(index.size, 1, 'size')
  expect(index.getPosition('a'), [1, 2, 3], 'position')
  expect(index.has('b'), false, 'control: absent id')
})

gate('insert ignores a non-finite coordinate and leaves size and mutations unchanged', () => {
  const index = new SpatialIndex()
  const mutations = index.mutations
  for (const p of [[NaN, 0, 0], [0, Infinity, 0], [0, 0, -Infinity]]) index.insert('bad', p)
  expect(index.size, 0, 'size')
  expect(index.mutations, mutations, 'mutations')
  index.insert('good', [0, 0, 0])
  expect(index.size, 1, 'control: a finite insert counts')
})

gate('insert stores a copy of the position, so a later edit of the caller array is not seen', () => {
  const index = new SpatialIndex()
  const p = [1, 0, 1]
  index.insert('a', p)
  p[0] = 500
  expect(index.getPosition('a'), [1, 0, 1], 'stored position')
  expect(index.nearby([500, 0, 1], 1), [], 'no entity at the edited spot')
  expect(index.nearby([1, 0, 1], 1), ['a'], 'control: the stored spot is found')
})

gate('getPosition returns a copy, and null for an unknown id', () => {
  const index = new SpatialIndex()
  index.insert('a', [1, 2, 3])
  const p = index.getPosition('a')
  p[0] = 99
  expect(index.getPosition('a'), [1, 2, 3], 'stored position unchanged')
  expect(index.getPosition('missing'), null, 'control: unknown id is null')
})

gate('remove deletes one entity and bumps mutations once; removing an unknown id changes nothing', () => {
  const index = new SpatialIndex()
  index.insert('a', [0, 0, 0])
  const before = index.mutations
  index.remove('a')
  expect(index.has('a'), false, 'removed')
  expect(index.size, 0, 'size')
  expect(index.mutations, before + 1, 'one bump')
  const after = index.mutations
  index.remove('a')
  index.remove('never')
  expect(index.mutations, after, 'control: unknown and repeated remove change nothing')
})

gate('insert of an existing id moves it rather than adding a second copy', () => {
  const index = new SpatialIndex()
  index.insert('a', [0, 0, 0])
  index.insert('a', [500, 0, 500])
  expect(index.size, 1, 'size')
  expect(index.nearby([0, 0, 0], 5), [], 'old spot empty')
  expect(index.nearby([500, 0, 500], 5), ['a'], 'control: new spot holds it')
})

gate('clear empties the index, bumps mutations, and keeps the relevance radius and geometry epoch', () => {
  const index = new SpatialIndex({ relevanceRadius: 75 })
  index.insert('a', [0, 0, 0])
  const epoch = index.geometryEpoch, mutations = index.mutations
  index.clear()
  expect(index.size, 0, 'size')
  expect(index.has('a'), false, 'has')
  expect(index.mutations, mutations + 1, 'mutations')
  expect(index.relevanceRadius, 75, 'radius kept')
  expect(index.geometryEpoch, epoch, 'epoch kept')
})

gate('ids yields every live id and not the removed one', () => {
  const index = new SpatialIndex()
  index.insert('a', [0, 0, 0])
  index.insert('b', [1, 0, 0])
  index.insert('c', [2, 0, 0])
  index.remove('b')
  expect(sortedIds(index.ids()), ['a', 'c'], 'ids')
})

gate('removing entities from a shared cell keeps the rest of that cell findable', () => {
  const index = new SpatialIndex()
  for (let i = 0; i < 10; i++) index.insert(String(i), [i, 0, 0])
  index.remove('0')
  index.remove('5')
  expect(sortedIds(index.nearby([4, 0, 0], 100)), ['1', '2', '3', '4', '6', '7', '8', '9'], 'remaining entities')
  expect(index.size, 8, 'size')
})

gate('entities in distinct cells stay apart, including cells beyond the numeric key range and at its edge', () => {
  const index = new SpatialIndex()
  index.insert('origin', [0, 0, 0])
  index.insert('far', [1e11, 0, 1e11])
  index.insert('negFar', [-1e11, 0, -1e11])
  index.insert('edge', [0, 0, -1073741824])
  index.insert('beyondEdge', [0, 0, -1073741856])
  expect(index.nearby([1e11, 0, 1e11], 1), ['far'], 'far cell')
  expect(index.nearby([-1e11, 0, -1e11], 1), ['negFar'], 'negative far cell')
  expect(index.nearby([0, 0, -1073741824], 1), ['edge'], 'numeric edge cell')
  expect(index.nearby([0, 0, -1073741856], 1), ['beyondEdge'], 'string key cell')
  expect(index.nearby([0, 0, 0], 1), ['origin'], 'control: origin cell only')
})

gate('nearby includes an entity at exactly the radius and excludes one just beyond it', () => {
  const index = new SpatialIndex()
  index.insert('in', [10, 0, 0])
  index.insert('out', [10.0001, 0, 0])
  expect(index.nearby([0, 0, 0], 10), ['in'], 'boundary included, beyond excluded')
  expect(sortedIds(index.nearby([0, 0, 0], 10.0002)), ['in', 'out'], 'control: a slightly wider radius takes both')
})

gate('nearby matches a brute-force distance check over a seeded spread of points and queries', () => {
  const rand = seeded(20260731)
  const index = new SpatialIndex()
  const points = []
  for (let i = 0; i < 240; i++) {
    const p = [(rand() - 0.5) * 400, (rand() - 0.5) * 60, (rand() - 0.5) * 400]
    points.push(p)
    index.insert('p' + i, p)
  }
  let nonEmpty = 0
  for (let q = 0; q < 200; q++) {
    const c = [(rand() - 0.5) * 420, (rand() - 0.5) * 60, (rand() - 0.5) * 420]
    const r = rand() * 120
    const expected = []
    points.forEach((p, i) => {
      const dx = p[0] - c[0], dy = p[1] - c[1], dz = p[2] - c[2]
      if (dx * dx + dy * dy + dz * dz <= r * r) expected.push('p' + i)
    })
    if (expected.length > 0) nonEmpty++
    expect(sortedIds(index.nearby(c, r)), expected.sort(), `query ${q}`)
  }
  if (nonEmpty < 100) fail(`only ${nonEmpty} queries hit anything`)
  if (index.nearby([0, 0, 0], 300).length <= index.nearby([0, 0, 0], 0.001).length) fail('control: a wider radius must find more')
})

gate('nearby writes into a supplied array after clearing it and returns that same array', () => {
  const index = new SpatialIndex()
  index.insert('a', [0, 0, 0])
  const out = ['stale']
  const result = index.nearby([0, 0, 0], 1, out)
  expect(result === out, true, 'same array')
  expect(result, ['a'], 'stale entry removed')
  expect(index.nearby([900, 0, 900], 1, out), [], 'control: a query with no hits empties the array')
})

gate('nearby refuses an absent, short, NaN, negative, infinite or non-numeric centre or radius', () => {
  const index = new SpatialIndex()
  index.insert('origin', [0, 0, 0])
  throwsWith(() => index.nearby(undefined, 5), /nearby got centre/, 'absent centre')
  throwsWith(() => index.nearby([0, 0], 5), /nearby got centre/, 'short centre')
  throwsWith(() => index.nearby([NaN, 0, 0], 5), /nearby got centre/, 'NaN centre')
  throwsWith(() => index.nearby([0, 0, 0], -1), /nearby got radius/, 'negative radius')
  throwsWith(() => index.nearby([0, 0, 0], Infinity), /nearby got radius/, 'infinite radius')
  throwsWith(() => index.nearby([0, 0, 0], '5'), /nearby got radius/, 'string radius')
  expect(index.nearby([0, 0, 0], 0), ['origin'], 'control: a zero radius at the entity is valid')
})

gate('nearbyCylinder keeps an entity inside both the horizontal radius and the vertical half-height', () => {
  const index = new SpatialIndex()
  index.insert('in', [5, 4, 0])
  index.insert('edge', [0, 5, 10])
  index.insert('high', [0, 6, 0])
  index.insert('wide', [11, 0, 0])
  expect(sortedIds(index.nearbyCylinder([0, 0, 0], 10, 5)), ['edge', 'in'], 'both boundaries included, outside excluded')
  expect(index.nearbyCylinder([0, 0, 0], 10, 6.5).includes('high'), true, 'control: a taller half-height takes high')
})

gate('nearbyCylinder refuses an absent, non-numeric, NaN or negative half-height', () => {
  const index = new SpatialIndex()
  index.insert('origin', [0, 0, 0])
  for (const bad of [undefined, '3', NaN, -1]) throwsWith(() => index.nearbyCylinder([0, 0, 0], 5, bad), /nearbyCylinder got halfHeight/, `halfHeight ${String(bad)}`)
  expect(index.nearbyCylinder([0, 0, 0], 5, 0), ['origin'], 'control: a zero half-height is valid')
})

gate('nearest returns the closest entity within the radius', () => {
  const index = new SpatialIndex()
  index.insert('a', [3, 0, 0])
  index.insert('b', [1, 0, 0])
  index.insert('c', [0, 0, 8])
  expect(index.nearest([0, 0, 0], 10), 'b', 'closest')
  expect(index.nearest([0, 0, 0], 0.5), null, 'control: nothing within 0.5')
})

gate('nearest breaks an exact distance tie by the smaller String(id), in either insertion order', () => {
  const forward = new SpatialIndex()
  forward.insert('z', [2, 0, 0])
  forward.insert('m', [0, 0, 2])
  const reversed = new SpatialIndex()
  reversed.insert('m', [0, 0, 2])
  reversed.insert('z', [2, 0, 0])
  expect(forward.nearest([0, 0, 0], 5), 'm', 'forward order')
  expect(reversed.nearest([0, 0, 0], 5), 'm', 'reversed order')
  const numeric = new SpatialIndex()
  numeric.insert('9', [2, 0, 0])
  numeric.insert('10', [0, 0, 2])
  expect(numeric.nearest([0, 0, 0], 5), '10', 'control: string comparison, not numeric')
})

gate('nearest includes an entity at exactly the radius and excludes one just inside a smaller radius', () => {
  const index = new SpatialIndex()
  index.insert('edge', [5, 0, 0])
  expect(index.nearest([0, 0, 0], 5), 'edge', 'boundary included')
  expect(index.nearest([0, 0, 0], 4.999), null, 'control: just under the distance')
})

gate('nearest is null on an empty index and refuses a null or NaN centre', () => {
  const index = new SpatialIndex()
  expect(index.nearest([0, 0, 0], 10), null, 'empty index')
  throwsWith(() => index.nearest(null, 5), /nearest got centre/, 'null centre')
  throwsWith(() => index.nearest([0, NaN, 0], 5), /nearest got centre/, 'NaN centre')
  index.insert('a', [0, 0, 0])
  expect(index.nearest([0, 0, 0], 1), 'a', 'control: a populated index answers')
})

gate('update inside the move tolerance stores the new position without a mutation, measured from the last anchor', () => {
  const index = new SpatialIndex()
  index.insert('a', [1, 0, 1])
  const before = index.mutations
  index.update('a', [1.5, 0, 1.5])
  expect(index.getPosition('a'), [1.5, 0, 1.5], 'position stored')
  expect(index.mutations, before, 'no mutation inside tolerance')
  index.update('a', [1.9, 0, 1.9])
  expect(index.mutations, before + 1, 'control: displacement from the anchor reaches the tolerance')
})

gate('update across a cell boundary relinks the entity and bumps mutations', () => {
  const index = new SpatialIndex()
  index.insert('a', [1, 0, 1])
  const before = index.mutations
  index.update('a', [40, 0, 1])
  expect(index.mutations, before + 1, 'mutation')
  expect(index.nearby([1, 0, 1], 5), [], 'old cell empty')
  expect(index.nearby([40, 0, 1], 1), ['a'], 'control: new cell holds it')
})

gate('a displacement of exactly the tolerance counts as a move, just under it does not', () => {
  const exact = new SpatialIndex()
  exact.insert('a', [0, 0, 0])
  const exactBefore = exact.mutations
  exact.update('a', [1, 0, 0])
  expect(exact.mutations, exactBefore + 1, 'exactly one metre moves')
  const under = new SpatialIndex()
  under.insert('a', [0, 0, 0])
  const underBefore = under.mutations
  under.update('a', [0.999, 0, 0])
  expect(under.mutations, underBefore, 'control: just under does not')
  const vertical = new SpatialIndex()
  vertical.insert('a', [0, 0, 0])
  const verticalBefore = vertical.mutations
  vertical.update('a', [0, 2, 0])
  expect(vertical.mutations, verticalBefore + 1, 'vertical displacement counts')
})

gate('update with a non-finite position removes the entity', () => {
  const index = new SpatialIndex()
  index.insert('a', [0, 0, 0])
  index.insert('b', [5, 0, 5])
  index.update('a', [NaN, 0, 0])
  expect(index.has('a'), false, 'removed')
  expect(index.size, 1, 'size')
  expect(index.has('b'), true, 'control: other entity kept')
})

gate('update of an unknown id inserts it, and a non-finite update of an unknown id stays absent', () => {
  const index = new SpatialIndex()
  index.update('new', [4, 0, 4])
  expect(index.getPosition('new'), [4, 0, 4], 'inserted')
  index.update('ghost', [NaN, 0, 0])
  expect(index.has('ghost'), false, 'control: unknown id with non-finite position stays absent')
})

gate('mutations rises by one for each structural change and holds for no-op calls', () => {
  const index = new SpatialIndex()
  const step = (label, action, delta) => {
    const before = index.mutations
    action()
    expect(index.mutations - before, delta, label)
  }
  step('insert', () => index.insert('a', [0, 0, 0]), 1)
  step('insert non-finite', () => index.insert('b', [NaN, 0, 0]), 0)
  step('update inside tolerance', () => index.update('a', [0.5, 0, 0]), 0)
  step('update past tolerance', () => index.update('a', [3, 0, 0]), 1)
  step('update cell change', () => index.update('a', [40, 0, 0]), 1)
  step('remove unknown', () => index.remove('zzz'), 0)
  step('remove known', () => index.remove('a'), 1)
  step('rebuild', () => index.rebuild(), 1)
  step('clear', () => index.clear(), 1)
})

gate('rebuild keeps every query answer and the size', () => {
  const rand = seeded(7)
  const index = new SpatialIndex()
  for (let i = 0; i < 120; i++) index.insert('e' + i, [(rand() - 0.5) * 300, 0, (rand() - 0.5) * 300])
  const centres = [[0, 0, 0], [100, 0, -50], [-150, 0, 150]]
  const before = centres.map((c) => sortedIds(index.nearby(c, 80)))
  index.rebuild()
  const after = centres.map((c) => sortedIds(index.nearby(c, 80)))
  expect(after, before, 'answers unchanged')
  expect(before.some((ids) => ids.length > 0), true, 'control: the queries returned entities')
  expect(index.size, 120, 'size unchanged')
})

gate('reseat keeps entities with a finite position and drops the rest', () => {
  const index = new SpatialIndex()
  index.insert('a', [0, 0, 0])
  index.insert('b', [5, 0, 5])
  index.insert('c', [9, 0, 9])
  index.reseat((id) => ({ a: [1, 0, 1], b: [NaN, 0, 0], c: null })[id])
  expect(sortedIds(index.ids()), ['a'], 'only a survives')
  expect(index.getPosition('a'), [1, 0, 1], 'control: the finite position is stored')
})

gate('reseat relinks each surviving entity at its new position', () => {
  const index = new SpatialIndex()
  index.insert('a', [0, 0, 0])
  index.reseat(() => [100, 0, 100])
  expect(index.nearby([0, 0, 0], 5), [], 'old spot empty')
  expect(index.nearby([100, 0, 100], 1), ['a'], 'control: new spot holds it')
})

gate('reseat copies the positions it is given and bumps mutations', () => {
  const index = new SpatialIndex()
  index.insert('a', [0, 0, 0])
  const shared = [7, 0, 7]
  const before = index.mutations
  index.reseat(() => shared)
  shared[0] = 1000
  expect(index.getPosition('a'), [7, 0, 7], 'copy stored')
  expect(index.mutations, before + 1, 'mutation')
  expect(index.nearby([1000, 0, 7], 1), [], 'control: edited array does not move the entity')
})

gate('an entity never marked seen is first reported starved on collect 301 and again every 301 collects', () => {
  const index = new SpatialIndex()
  index.insert('a', [0, 0, 0])
  const hits = []
  for (let call = 0; call < 910; call++) if (index.collectStarved('v').length > 0) hits.push(call)
  expect(hits, [301, 602, 903], 'report schedule')
})

gate('an entity marked seen before every collect is never starved, while an unmarked one is', () => {
  const index = new SpatialIndex()
  index.insert('seen', [0, 0, 0])
  index.insert('unseen', [5, 0, 0])
  const starved = []
  for (let call = 0; call < 1000; call++) {
    index.markSeen('seen', 'v')
    starved.push(...index.collectStarved('v'))
  }
  expect(starved.filter((id) => id === 'seen').length, 0, 'seen never starved')
  expect(starved.filter((id) => id === 'unseen').length > 0, true, 'control: unseen starved')
})

gate('markSeen restarts the starvation window for that entity only', () => {
  const index = new SpatialIndex()
  index.insert('a', [0, 0, 0])
  index.markSeen('a', 'v')
  index.insert('b', [9, 0, 9])
  const hits = []
  for (let call = 0; call < 302; call++) {
    for (const id of index.collectStarved('v')) hits.push([call, id])
  }
  expect(hits, [[300, 'a'], [301, 'b']], 'marked entity reports at 300, unmarked at 301')
})

gate('starvation is tracked per viewer, so marking for one viewer leaves another starved', () => {
  const index = new SpatialIndex()
  index.insert('a', [0, 0, 0])
  const starvedForMarked = []
  const starvedForFollower = []
  for (let call = 0; call < 400; call++) {
    index.markSeen('a', 'marked')
    starvedForMarked.push(...index.collectStarved('marked'))
    starvedForFollower.push(...index.collectStarved('follower'))
  }
  expect(starvedForMarked.length, 0, 'marked viewer never starves')
  expect(starvedForFollower.length > 0, true, 'control: follower starves')
})

gate('clearStarvationKey restarts a viewer count, so a window spanning the clear is not starved', () => {
  const restarted = new SpatialIndex()
  restarted.insert('a', [0, 0, 0])
  let restartedHits = 0
  for (let call = 0; call < 200; call++) restartedHits += restarted.collectStarved('v').length
  restarted.clearStarvationKey('v')
  for (let call = 0; call < 200; call++) restartedHits += restarted.collectStarved('v').length
  expect(restartedHits, 0, 'cleared viewer restarts')
  const continuous = new SpatialIndex()
  continuous.insert('a', [0, 0, 0])
  let continuousHits = 0
  for (let call = 0; call < 400; call++) continuousHits += continuous.collectStarved('v').length
  expect(continuousHits > 0, true, 'control: without a clear the window runs out')
})

gate('collectStarved honours an explicit window in place of the 300 default', () => {
  const short = new SpatialIndex()
  short.insert('a', [0, 0, 0])
  const shortHits = []
  for (let call = 0; call < 7; call++) if (short.collectStarved('v', 5).length > 0) shortHits.push(call)
  expect(shortHits, [6], 'window 5 starves at collect 6')
  const defaults = new SpatialIndex()
  defaults.insert('a', [0, 0, 0])
  let defaultHits = 0
  for (let call = 0; call < 7; call++) defaultHits += defaults.collectStarved('v').length
  expect(defaultHits, 0, 'control: the default window does not starve by collect 6')
})

gate('a collect drops starvation records for entities that were removed', () => {
  const index = new SpatialIndex()
  index.insert('a', [0, 0, 0])
  index.insert('b', [1, 0, 0])
  index.collectStarved('v')
  const tracked = index._starveTicks.get('v').zero
  expect(tracked.size, 2, 'control: both tracked before removal')
  index.remove('a')
  index.collectStarved('v')
  expect(sortedIds(tracked.keys()), ['b'], 'removed id dropped')
})

gate('pruneIdleKeys drops a viewer with nothing tracked and keeps a live or still-tracked one', () => {
  const index = new SpatialIndex()
  index.pruneIdleKeys(new Set())
  index.insert('a', [0, 0, 0])
  index.markSeen('a', 'idle')
  index.markSeen('a', 'live')
  index.remove('a')
  index.collectStarved('idle')
  index.collectStarved('live')
  index.insert('b', [9, 0, 9])
  index.markSeen('b', 'busy')
  index.pruneIdleKeys(new Set(['live']))
  expect(index._starveTicks.has('idle'), false, 'idle pruned')
  expect(index._starveTicks.has('live'), true, 'control: live key kept')
  expect(index._starveTicks.has('busy'), true, 'control: still-tracked key kept')
})

gate('insert warns at sizes 256 and 512 only', () => {
  const warnings = []
  const original = console.warn
  console.warn = (line) => warnings.push(String(line))
  try {
    const index = new SpatialIndex()
    for (let i = 0; i < 255; i++) index.insert('e' + i, [i, 0, 0])
    expect(warnings.length, 0, 'quiet below 256')
    index.insert('e255', [255, 0, 0])
    expect(warnings, ['[SpatialIndex] size=256'], 'warns at 256')
    for (let i = 256; i < 511; i++) index.insert('e' + i, [i, 0, 0])
    expect(warnings.length, 1, 'control: quiet between powers of two')
    index.insert('e511', [511, 0, 0])
    expect(warnings, ['[SpatialIndex] size=256', '[SpatialIndex] size=512'], 'warns at 512')
  } finally {
    console.warn = original
  }
})

finish()
