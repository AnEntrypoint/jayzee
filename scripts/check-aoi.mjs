import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { DEFAULT_RELEVANCE_RADIUS_M, resolveRelevanceRadius } from '../src/aoi-pure/relevanceRadius.js'
import {
  PRIORITY_ENTITY_BUDGET,
  PRIORITY_DECAY,
  BANDWIDTH_BUDGET_BYTES_PER_TICK,
  BANDWIDTH_TRIM_MIN_ENTITIES,
  BANDWIDTH_TRIM_MAX_ITERATIONS,
  RECORD_FRAMING_BYTES_ESTIMATE,
  AOI_CELL_BASE_MAX,
  AOI_CODE_EPOCH_LEN,
  STARVATION_MAX_TICKS,
} from '../src/aoi-pure/constants.js'
import { FACE_FRAME, neighborCells, packCellKey, resolveCell, verifyCubeSphereAdjacency } from '../src/aoi-pure/cubeSphereCells.js'
import { flatCellKey, resolvePlayerCell, solveCellViewer } from '../src/aoi-pure/cellKeys.js'
import { createCellBaseCache, AOI_CELL_BASE_CASE, AOI_EPOCH_CASE, AOI_EPOCH_RADIUS_SOURCE, AOI_EPOCH_REFUSAL } from '../src/aoi-pure/cellBaseCache.js'
import { createAoiWork, resetAoiWork, AOI_WORK_COUNTERS } from '../src/aoi-pure/work.js'
import { ENTITY_POSITION_CASE, positionOfEntity, withinAnyGate } from '../src/aoi-pure/entityPosition.js'
import { unpackBinRecord, primeEntryDecode } from '../src/aoi-pure/binRecord.js'
import { createPriorityScheduler } from '../src/aoi-pure/priority.js'
import { estimateEntityBytes, trimEntitiesToBudget } from '../src/aoi-pure/bandwidth.js'
import { resolveDeliveredIds } from '../src/aoi-pure/delivery.js'
import { createRingResolver } from '../src/aoi-pure/ringResolver.js'

const EPOCH = 'a'.repeat(AOI_CODE_EPOCH_LEN)
const OTHER_EPOCH = 'b'.repeat(AOI_CODE_EPOCH_LEN)
const near = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not ${expected}`)

const bin = (px, py, pz, { vx = 0, vy = 0, vz = 0, length = 29, flags = 0 } = {}) => {
  const bytes = new Uint8Array(length)
  const view = new DataView(bytes.buffer)
  view.setInt32(0, Math.round(px * 100), true)
  view.setInt32(4, Math.round(py * 100), true)
  view.setInt32(8, Math.round(pz * 100), true)
  view.setInt16(12, Math.round(vx * 100), true)
  view.setInt16(14, Math.round(vy * 100), true)
  view.setInt16(16, Math.round(vz * 100), true)
  if (length > 28) bytes[28] = flags
  return bytes
}

const located = (position) => ({ case: ENTITY_POSITION_CASE.position, position })
const unknownEntity = () => ({ case: ENTITY_POSITION_CASE.unknownEntity, position: null })

const activeCache = (work, spatial = { mutations: 0, relevanceRadius: 200 }, radius = 200, planet = 0) => {
  const cache = createCellBaseCache({ codeEpoch: EPOCH, work })
  cache.setEpoch(radius, planet, spatial)
  return cache
}

const viewerId = (cvp) => cvp.map((v) => v.toFixed(3)).join('_')

const ringHost = (overrides = {}) => ({
  baseRelevantIds: () => [],
  dynamicRelevantIds: (cvp) => new Set([viewerId(cvp)]),
  positionOf: unknownEntity,
  ...overrides,
})

const payloadEntities = (sizes, positionOf = (i) => i * 10) => sizes.map((length, i) => [`e${i}`, 'k', bin(positionOf(i), 0, 0, { length })])

gate('relevance radius default is 200 m', () => {
  assert.equal(DEFAULT_RELEVANCE_RADIUS_M, 200)
  assert.equal(resolveRelevanceRadius(undefined), 200)
  assert.equal(resolveRelevanceRadius(0), 200)
  assert.equal(resolveRelevanceRadius(-5), 200)
  assert.equal(resolveRelevanceRadius('150'), 200)
  assert.equal(resolveRelevanceRadius(NaN), 200)
  assert.equal(resolveRelevanceRadius(150), 150)
  assert.equal(resolveRelevanceRadius(Infinity), Infinity)
})

gate('flat cell lookup floors each axis and places a border in the upper cell', () => {
  const low = resolvePlayerCell([-0.1, 0, 0.5], 0, 200)
  assert.equal(low.cellCx, -1)
  assert.equal(low.cellCy, 0)
  assert.equal(low.cellFace, -1)
  assert.equal(low.cellsPerFace, 0)
  assert.equal(resolvePlayerCell([199.999, 0, 0], 0, 200).cellCx, 0)
  assert.equal(resolvePlayerCell([200, 0, 0], 0, 200).cellCx, 1)
  assert.equal(resolvePlayerCell([0, 0, -199.9], 0, 200).cellCy, -1)
  assert.notEqual(resolvePlayerCell([0, 0, -199.9], 0, 200).cellCy, 0)
  assert.equal(resolvePlayerCell([400, 0, 0], 0, 200).cellCx, resolvePlayerCell([200, 0, 0], 0, 200).cellCx + 1)
})

gate('flat cell keys are distinct per cell and stay strings outside the int16 box', () => {
  const keys = new Set()
  for (let cx = -3; cx <= 3; cx++) for (let cz = -3; cz <= 3; cz++) keys.add(flatCellKey(cx, cz))
  assert.equal(keys.size, 49)
  assert.notEqual(flatCellKey(1, 2), flatCellKey(2, 1))
  assert.equal(typeof flatCellKey(40000, 0), 'string')
  assert.notEqual(flatCellKey(40000, 0), flatCellKey(40000, 1))
})

gate('cube-sphere viewer on +Z lands in face 4 cell (5,5) of 10 per face', () => {
  const cell = resolvePlayerCell([0, 0, 1000], 1000, 200)
  assert.equal(cell.cellFace, 4)
  assert.equal(cell.cellCx, 5)
  assert.equal(cell.cellCy, 5)
  assert.equal(cell.cellsPerFace, 10)
  assert.equal(cell.cellKey, packCellKey(4, 5, 5, 10))
})

gate('cube-sphere viewer on -Z and a shifted viewer land in other cells', () => {
  const south = resolvePlayerCell([0, 0, -1000], 1000, 200)
  assert.equal(south.cellFace, 5)
  assert.notEqual(south.cellKey, resolvePlayerCell([0, 0, 1000], 1000, 200).cellKey)
  const shifted = resolvePlayerCell([500, 0, 1000], 1000, 200)
  assert.equal(shifted.cellFace, 4)
  assert.equal(shifted.cellCx, 7)
})

gate('cube-sphere cell viewers sit on the sphere surface at the planet radius', () => {
  for (const [face, cx, cy] of [[4, 5, 5], [4, 0, 0], [0, 3, 7], [5, 9, 9], [2, 4, 6]]) {
    near(Math.hypot(...solveCellViewer(face, cx, cy, 1000, 200)), 1000, 1e-6)
  }
  const flat = solveCellViewer(0, 0, 0, 0, 200)
  assert.ok(Math.abs(Math.hypot(...flat) - 1000) > 100)
  assert.notDeepEqual(solveCellViewer(4, 6, 5, 1000, 200), solveCellViewer(4, 5, 5, 1000, 200))
})

gate('flat cell viewer is the centre of its cell', () => {
  assert.deepEqual(solveCellViewer(-1, 0, 0, 0, 200), [100, 0, 100])
  assert.deepEqual(solveCellViewer(-1, 1, 0, 0, 200), [300, 0, 100])
  assert.notDeepEqual(solveCellViewer(-1, 0, 0, 0, 200), [300, 0, 100])
})

gate('cube-sphere adjacency crosses face edges and is reciprocal', () => {
  assert.equal(verifyCubeSphereAdjacency(), true)
  assert.equal(resolveCell(0, 10, 3, 10).face, 5)
  assert.equal(resolveCell(0, 9, 3, 10).face, 0)
  assert.equal(resolveCell(0, -1, 3, 10).face, 4)
  assert.equal(FACE_FRAME.length, 6)
})

gate('neighbour ring is the eight cells around the centre', () => {
  const cells = neighborCells(4, 5, 5, 10)
  assert.equal(cells.length, 8)
  const keys = new Set(cells.map((n) => packCellKey(n.face, n.cx, n.cy, 10)))
  assert.equal(keys.size, 8)
  assert.ok(!keys.has(packCellKey(4, 5, 5, 10)))
  const flat = createRingResolver({ work: createAoiWork(), host: ringHost() }).computeRingRelevantIds('flat', -1, 0, 0, 0, 0, 200)
  assert.equal(flat.relevantIds.size, 8)
  assert.ok(!flat.relevantIds.has(viewerId([100, 0, 100])))
  assert.ok(flat.relevantIds.has(viewerId([-100, 0, -100])))
  const planet = createRingResolver({ work: createAoiWork(), host: ringHost() }).computeRingRelevantIds('planet', 4, 5, 5, 10, 1000, 200)
  assert.equal(planet.relevantIds.size, 8)
  assert.ok(!planet.relevantIds.has(viewerId(solveCellViewer(4, 5, 5, 1000, 200))))
  assert.ok(planet.relevantIds.has(viewerId(solveCellViewer(4, 4, 4, 1000, 200))))
})

gate('packCellKey wraps int32 and collides at 64000 cells per face, as spoint does', () => {
  assert.equal(packCellKey(0, 0, 0, 64000), packCellKey(0, 50330, 19248, 64000))
  assert.equal(packCellKey(0, 50330, 19248, 64000), 0)
  assert.notEqual(packCellKey(0, 0, 0, 10), packCellKey(0, 50330, 19248, 10))
  const seen = new Set()
  for (let cx = 0; cx < 10; cx++) for (let cy = 0; cy < 10; cy++) seen.add(packCellKey(4, cx, cy, 10))
  assert.equal(seen.size, 100)
})

gate('cell base epoch refuses when no code epoch is installed', () => {
  const work = createAoiWork()
  const cache = createCellBaseCache({ work })
  const epoch = cache.setEpoch(200, 0, { mutations: 0 })
  assert.equal(epoch.case, AOI_EPOCH_CASE.unrepresentable)
  assert.equal(epoch.refusal, AOI_EPOCH_REFUSAL.codeEpochNotInstalled)
  assert.equal(work.epochRefusedCodeEpochNotInstalled, 1)
  cache.installCodeEpoch('0123456789abcdef')
  assert.equal(cache.setEpoch(200, 0, { mutations: 0 }).case, AOI_EPOCH_CASE.active)
})

gate('cell base epoch names each refused input and counts it', () => {
  const work = createAoiWork()
  const cache = createCellBaseCache({ codeEpoch: EPOCH, work })
  assert.equal(cache.setEpoch(200, 0, { mutations: -1 }).refusal, AOI_EPOCH_REFUSAL.mutationsNotACount)
  assert.equal(cache.setEpoch(200, 0, null).refusal, AOI_EPOCH_REFUSAL.mutationsNotACount)
  assert.equal(cache.setEpoch(0, 0, { mutations: 0 }).refusal, AOI_EPOCH_REFUSAL.relevanceRadiusNotPositive)
  assert.equal(cache.setEpoch(NaN, 0, { mutations: 0 }).refusal, AOI_EPOCH_REFUSAL.relevanceRadiusNotPositive)
  assert.equal(cache.setEpoch(200, -1, { mutations: 0 }).refusal, AOI_EPOCH_REFUSAL.planetRadiusNegative)
  assert.equal(work.epochRefusedMutationsNotACount, 2)
  assert.equal(work.epochRefusedRelevanceRadiusNotPositive, 2)
  assert.equal(work.epochRefusedPlanetRadiusNegative, 1)
  assert.equal(cache.setEpoch(200, 0, { mutations: 0 }).case, AOI_EPOCH_CASE.active)
})

gate('cell base epoch radius source is index, callerAgainstIndex or caller', () => {
  const work = createAoiWork()
  const cache = createCellBaseCache({ codeEpoch: EPOCH, work })
  assert.equal(cache.setEpoch(200, 0, { mutations: 0, relevanceRadius: 200 }).radiusSource, AOI_EPOCH_RADIUS_SOURCE.index)
  assert.equal(cache.setEpoch(300, 0, { mutations: 0, relevanceRadius: 200 }).radiusSource, AOI_EPOCH_RADIUS_SOURCE.callerAgainstIndex)
  assert.equal(cache.setEpoch(200, 0, { mutations: 0 }).radiusSource, AOI_EPOCH_RADIUS_SOURCE.caller)
  assert.notEqual(cache.setEpoch(200, 0, { mutations: 0, relevanceRadius: 200 }).radiusSource, AOI_EPOCH_RADIUS_SOURCE.caller)
})

gate('cell base cache returns a stored cell under the same epoch', () => {
  const work = createAoiWork()
  const cache = activeCache(work)
  const pos = [1, 2, 3]
  const base = [7]
  cache.store('k', pos, base)
  const hit = cache.read('k')
  assert.equal(hit.case, AOI_CELL_BASE_CASE.hit)
  assert.equal(hit.cellViewerPos, pos)
  assert.equal(hit.baseRelevantIds, base)
  assert.equal(cache.read('absent').case, AOI_CELL_BASE_CASE.miss)
  assert.equal(work.cellBaseMisses, 1)
})

gate('cell base cache drops an entry after a mutation and reports it stale', () => {
  const work = createAoiWork()
  const cache = activeCache(work)
  cache.store('k', [0, 0, 0], [])
  cache.setEpoch(200, 0, { mutations: 1, relevanceRadius: 200 })
  assert.equal(cache.read('k').case, AOI_CELL_BASE_CASE.stale)
  assert.equal(work.cellBaseStaleDrops, 1)
  assert.equal(cache.size(), 0)
  const unchanged = activeCache(createAoiWork())
  unchanged.store('k', [0, 0, 0], [])
  unchanged.setEpoch(200, 0, { mutations: 0, relevanceRadius: 200 })
  assert.equal(unchanged.read('k').case, AOI_CELL_BASE_CASE.hit)
})

gate('cell base cache evicts the oldest entry past 512 and a read refreshes recency', () => {
  assert.equal(AOI_CELL_BASE_MAX, 512)
  const work = createAoiWork()
  const cache = activeCache(work)
  for (let i = 0; i <= AOI_CELL_BASE_MAX; i++) cache.store(`k${i}`, [0, 0, 0], [])
  assert.equal(cache.size(), AOI_CELL_BASE_MAX)
  assert.equal(work.evictions, 1)
  assert.equal(cache.read('k0').case, AOI_CELL_BASE_CASE.miss)
  const full = activeCache(createAoiWork())
  for (let i = 0; i < AOI_CELL_BASE_MAX; i++) full.store(`k${i}`, [0, 0, 0], [])
  assert.equal(full.cellBaseEpoch().case, AOI_EPOCH_CASE.active)
  assert.equal(full.size(), AOI_CELL_BASE_MAX)
  full.read('k0')
  full.store('k512', [0, 0, 0], [])
  assert.equal(full.read('k0').case, AOI_CELL_BASE_CASE.hit)
  assert.equal(full.read('k1').case, AOI_CELL_BASE_CASE.miss)
})

gate('cell base cache is unusable without an active epoch and stops storing when disabled', () => {
  const work = createAoiWork()
  const cache = createCellBaseCache({ codeEpoch: EPOCH, work })
  assert.equal(cache.read('k').case, AOI_CELL_BASE_CASE.unusable)
  cache.store('k', [0, 0, 0], [])
  assert.equal(cache.size(), 0)
  assert.equal(work.cellBaseUnusable, 1)
  cache.setEpoch(200, 0, { mutations: 0 })
  cache.store('k', [0, 0, 0], [])
  assert.equal(cache.read('k').case, AOI_CELL_BASE_CASE.hit)
  cache.disable()
  assert.equal(cache.cellBaseEpoch().case, AOI_EPOCH_CASE.disabled)
  cache.store('k2', [0, 0, 0], [])
  assert.equal(cache.size(), 0)
  assert.equal(cache.read('k').case, AOI_CELL_BASE_CASE.unusable)
})

gate('installing another code epoch clears cached cells and the same epoch keeps them', () => {
  const cache = activeCache(createAoiWork())
  cache.store('k', [0, 0, 0], [])
  cache.installCodeEpoch(EPOCH)
  assert.equal(cache.size(), 1)
  cache.installCodeEpoch(OTHER_EPOCH)
  assert.equal(cache.size(), 0)
  assert.equal(cache.codeEpoch(), OTHER_EPOCH)
})

gate('entity position prefers the spatial index, then the entity map, and reports absence', () => {
  const work = createAoiWork()
  const spatial = { getPosition: (id) => (id === 'a' ? [1, 2, 3] : null) }
  const entities = new Map([['a', { position: [9, 9, 9] }], ['b', { position: [4, 5, 6] }], ['c', {}]])
  assert.deepEqual(positionOfEntity(spatial, entities, 'a', work).position, [1, 2, 3])
  assert.deepEqual(positionOfEntity(spatial, entities, 'b', work).position, [4, 5, 6])
  assert.equal(positionOfEntity(spatial, entities, 'c', work).case, ENTITY_POSITION_CASE.noPosition)
  assert.equal(positionOfEntity(spatial, entities, 'd', work).case, ENTITY_POSITION_CASE.unknownEntity)
  assert.equal(work.positionOfEntityResolves, 2)
  assert.equal(work.positionOfEntityNoPosition, 1)
  assert.equal(work.positionOfEntityUnknownEntity, 1)
  assert.deepEqual(positionOfEntity(null, entities, 'a', createAoiWork()).position, [9, 9, 9])
  assert.notDeepEqual(positionOfEntity(spatial, entities, 'a', createAoiWork()).position, [9, 9, 9])
})

gate('gate containment is inclusive at the radius and reads height only in planet mode', () => {
  const gate0 = [0, 0, 0]
  assert.equal(withinAnyGate([200, 0, 0], gate0, 0, 40000), true)
  assert.equal(withinAnyGate([200.5, 0, 0], gate0, 0, 40000), false)
  assert.equal(withinAnyGate([0, 500, 0], gate0, 0, 40000), true)
  assert.equal(withinAnyGate([0, 500, 0], gate0, 1000, 40000), false)
})

gate('bandwidth constants are 900 bytes, six entities, 32 trims and 64 priority entities', () => {
  assert.equal(BANDWIDTH_BUDGET_BYTES_PER_TICK, 900)
  assert.equal(BANDWIDTH_TRIM_MIN_ENTITIES, 6)
  assert.equal(BANDWIDTH_TRIM_MAX_ITERATIONS, 32)
  assert.equal(PRIORITY_ENTITY_BUDGET, 64)
  assert.equal(PRIORITY_DECAY, 0.02)
  assert.equal(RECORD_FRAMING_BYTES_ESTIMATE, 8)
  assert.equal(STARVATION_MAX_TICKS, 300)
  assert.notEqual(BANDWIDTH_BUDGET_BYTES_PER_TICK, 901)
  assert.notEqual(PRIORITY_DECAY, 0.021)
})

gate('bandwidth trim leaves a payload of exactly 900 bytes alone and trims one byte over', () => {
  const exact = payloadEntities([140, 140, 140, 140, 140, 140])
  const untouched = trimEntitiesToBudget(exact, 0, [0, 0, 0], new Map())
  assert.equal(untouched.trimmedCount, 0)
  assert.equal(untouched.entities, exact)
  const over = payloadEntities([141, 140, 140, 140, 140, 140])
  const trimmed = trimEntitiesToBudget(over, 0, [0, 0, 0], new Map())
  assert.equal(trimmed.trimmedCount, 1)
  assert.ok(!trimmed.entities.some((e) => e[0] === 'e5'))
  assert.equal(trimmed.entities.length, 5)
})

gate('bandwidth trim drops the farthest payload first and the viewer position decides which', () => {
  const entities = payloadEntities([141, 140, 140, 140, 140, 140])
  const fromOrigin = trimEntitiesToBudget(entities, 0, [0, 0, 0], new Map())
  assert.deepEqual(fromOrigin.entities.map((e) => e[0]), ['e0', 'e1', 'e2', 'e3', 'e4'])
  const fromBeyondE0 = trimEntitiesToBudget(entities, 0, [100, 0, 0], new Map())
  assert.ok(!fromBeyondE0.entities.some((e) => e[0] === 'e0'))
  assert.ok(fromBeyondE0.entities.some((e) => e[0] === 'e5'))
})

gate('bandwidth trim leaves lists under six non-static entities alone', () => {
  const five = trimEntitiesToBudget(payloadEntities([5000, 5000, 5000, 5000, 5000]), 0, [0, 0, 0], new Map())
  assert.equal(five.trimmedCount, 0)
  const six = trimEntitiesToBudget(payloadEntities([5000, 5000, 5000, 5000, 5000, 5000]), 0, [0, 0, 0], new Map())
  assert.ok(six.trimmedCount > 0)
})

gate('bandwidth trim removes at most 32 payloads per call', () => {
  const forty = trimEntitiesToBudget(payloadEntities(Array(40).fill(990)), 0, [0, 0, 0], new Map())
  assert.equal(forty.trimmedCount, 32)
  const twenty = trimEntitiesToBudget(payloadEntities(Array(20).fill(990)), 0, [0, 0, 0], new Map())
  assert.equal(twenty.trimmedCount, 20)
  assert.equal(twenty.entities.length, 0)
})

gate('bandwidth trim keeps static entities and counts only the rest toward the minimum', () => {
  const entities = payloadEntities(Array(8).fill(900), (i) => 100 - i * 10)
  const kept = trimEntitiesToBudget(entities, 2, [0, 0, 0], new Map())
  assert.equal(kept.trimmedCount, 6)
  assert.deepEqual(kept.entities.map((e) => e[0]), ['e0', 'e1'])
  const unprotected = trimEntitiesToBudget(entities, 0, [0, 0, 0], new Map())
  assert.equal(unprotected.trimmedCount, 8)
})

gate('estimated entity bytes count framing, strings, numbers, byte arrays and JSON', () => {
  assert.equal(estimateEntityBytes([1, 'ab', 3, new Uint8Array(5), { a: 1 }], new Map()), 8 + 3 + 2 + 5 + 7)
  assert.equal(estimateEntityBytes([1, 'ab', 3, new Uint8Array(6), { a: 1 }], new Map()), 8 + 3 + 2 + 6 + 7)
  assert.equal(estimateEntityBytes([1, null], new Map()), 8)
  assert.equal(estimateEntityBytes([1, true], new Map()), 9)
})

gate('priority returns the relevant set unchanged up to 64 entities', () => {
  const dyn = new Map()
  const ids = []
  for (let i = 0; i < 64; i++) {
    const id = `n${i}`
    ids.push(id)
    dyn.set(id, { enc: [id, 0, bin(1, 0, 0)] })
  }
  const scheduler = createPriorityScheduler()
  assert.equal(scheduler.priorityIds('p', ids, dyn, [0, 0, 0]), ids)
  dyn.set('far', { enc: ['far', 0, bin(1000, 0, 0)] })
  const overflow = scheduler.priorityIds('q', [...ids, 'far'], dyn, [0, 0, 0])
  assert.ok(overflow instanceof Set)
  assert.equal(overflow.size, 64)
  assert.ok(!overflow.has('far'))
})

gate('priority keeps the 64 nearest entities over one far entity and follows the viewer', () => {
  const dyn = new Map()
  const near = []
  for (let i = 0; i < 64; i++) {
    const id = `n${i}`
    near.push(id)
    dyn.set(id, { enc: [id, 0, bin(1, 0, 0)] })
  }
  dyn.set('far', { enc: ['far', 0, bin(1000, 0, 0)] })
  const scheduler = createPriorityScheduler()
  let chosen
  for (let tick = 0; tick < 3; tick++) chosen = scheduler.priorityIds('p', [...near, 'far'], dyn, [0, 0, 0])
  assert.equal(chosen.size, 64)
  assert.ok(!chosen.has('far'))
  assert.ok(near.every((id) => chosen.has(id)))
  const moved = createPriorityScheduler()
  const followed = moved.priorityIds('p', [...near, 'far'], dyn, [1000, 0, 0])
  assert.ok(followed.has('far'))
  assert.equal(followed.size, 64)
})

gate('priority accumulates distance, capped velocity and decay per call', () => {
  const dyn = new Map([['e', { enc: ['e', 0, bin(0, 0, 0, { vx: 5 })] }]])
  const scheduler = createPriorityScheduler()
  scheduler.priorityIds('p', ['e'], dyn, [0, 0, 0])
  scheduler.priorityIds('p', ['e'], dyn, [0, 0, 0])
  near(scheduler.scoreOf('p', 'e'), 2 * (1 + 0.5 + 0.02))
  const fast = new Map([['e', { enc: ['e', 0, bin(0, 0, 0, { vx: 12 })] }]])
  const capped = createPriorityScheduler()
  capped.priorityIds('p', ['e'], fast, [0, 0, 0])
  capped.priorityIds('p', ['e'], fast, [0, 0, 0])
  near(capped.scoreOf('p', 'e'), 2 * (1 + 1 + 0.02))
  assert.ok(Math.abs(scheduler.scoreOf('p', 'e') - 2 * (1 + 0.5 + 0.021)) > 1e-6)
})

gate('priority prunes entities that leave the cache and clears a player on request', () => {
  const dyn = new Map([['e', { enc: ['e', 0, bin(0, 0, 0)] }]])
  const scheduler = createPriorityScheduler()
  scheduler.priorityIds('p', ['e'], dyn, [0, 0, 0])
  assert.notEqual(scheduler.scoreOf('p', 'e'), undefined)
  dyn.delete('e')
  scheduler.priorityIds('p', [], dyn, [0, 0, 0])
  assert.equal(scheduler.scoreOf('p', 'e'), undefined)
  dyn.set('e', { enc: ['e', 0, bin(0, 0, 0)] })
  scheduler.priorityIds('p', ['e'], dyn, [0, 0, 0])
  scheduler.clearPlayer('p')
  assert.equal(scheduler.scoreOf('p', 'e'), undefined)
})

gate('record decode reads the 29-byte layout in metres, velocity and flags', () => {
  const record = bin(12.34, -3.5, 7, { vx: -5, vy: 2, flags: 3 })
  const out = unpackBinRecord(record, {})
  near(out.px, 12.34)
  near(out.py, -3.5)
  near(out.pz, 7)
  near(out.vx, -5)
  near(out.vy, 2)
  assert.equal(out.flags, 3)
  assert.notEqual(out.flags, 4)
  assert.notEqual(out.px, 12.35)
  near(unpackBinRecord(new DataView(record.buffer), {}).px, 12.34)
})

gate('primeEntryDecode memoises by record buffer identity and caps velocity at 10 m/s', () => {
  const entry = { enc: [1, 0, bin(12.34, -3.5, 7, { vx: -5 })] }
  primeEntryDecode(entry)
  near(entry._pX, 12.34)
  near(entry._pVelScore, 0.5, 1e-9)
  new DataView(entry.enc[2].buffer).setInt32(0, 2000, true)
  primeEntryDecode(entry)
  near(entry._pX, 12.34)
  entry.enc[2] = bin(20, 0, 0)
  primeEntryDecode(entry)
  near(entry._pX, 20)
  const fast = { enc: [2, 0, bin(0, 0, 0, { vx: 12 })] }
  primeEntryDecode(fast)
  near(fast._pVelScore, 1)
})

gate('resolveDeliveredIds returns the ring set unchanged when there are no unmanaged ids', () => {
  const ring = new Set(['r'])
  assert.equal(resolveDeliveredIds(ring, [], [0, 0, 0], 0, 200, unknownEntity), ring)
  const changed = resolveDeliveredIds(ring, ['x'], [0, 0, 0], 0, 200, unknownEntity)
  assert.notEqual(changed, ring)
  assert.ok(changed.has('x'))
})

gate('resolveDeliveredIds delivers every unmanaged id when fewer than three gate values are given', () => {
  const positionOf = (id) => (id === 'far' ? located([5000, 0, 0]) : unknownEntity())
  const delivered = resolveDeliveredIds(new Set(['r']), ['far'], [], 0, 200, positionOf)
  assert.ok(delivered.has('far'))
  const gated = resolveDeliveredIds(new Set(['r']), ['far'], [0, 0, 0], 0, 200, positionOf)
  assert.ok(!gated.has('far'))
  assert.ok(gated.has('r'))
})

gate('resolveDeliveredIds delivers an id inside any gate and drops one outside, inclusive at the radius', () => {
  const positions = { in: located([50, 0, 0]), out: located([5000, 0, 5000]), edge: located([200, 0, 0]), past: located([200.5, 0, 0]) }
  const positionOf = (id) => positions[id]
  const gates = [0, 0, 0, 10000, 0, 0, 0, 0, 10000]
  const delivered = resolveDeliveredIds(new Set(), ['in', 'out', 'edge', 'past'], gates, 0, 200, positionOf)
  assert.ok(delivered.has('in'))
  assert.ok(!delivered.has('out'))
  assert.ok(delivered.has('edge'))
  assert.ok(!delivered.has('past'))
})

gate('resolveDeliveredIds delivers unknown and unpositioned ids and drops a known far one', () => {
  const positionOf = (id) => (id === 'far' ? located([5000, 0, 0]) : unknownEntity())
  const delivered = resolveDeliveredIds(new Set(), ['ghost', 'far'], [0, 0, 0, 1, 0, 0, 0, 0, 1], 0, 200, positionOf)
  assert.ok(delivered.has('ghost'))
  assert.ok(!delivered.has('far'))
})

gate('resolveDeliveredIds reads height only in planet mode', () => {
  const positionOf = () => located([0, 500, 0])
  const flat = resolveDeliveredIds(new Set(), ['up'], [0, 0, 0], 0, 200, positionOf)
  assert.ok(flat.has('up'))
  const planet = resolveDeliveredIds(new Set(), ['up'], [0, 0, 0], 1000, 200, positionOf)
  assert.ok(!planet.has('up'))
})

gate('ring resolver gates a grown dynamic set to the cell viewer', () => {
  const positions = { near: located([100, 0, 150]), far: located([5000, 0, 0]) }
  const gated = createRingResolver({
    work: createAoiWork(),
    host: ringHost({
      baseRelevantIds: () => ['near'],
      dynamicRelevantIds: () => new Set(['near', 'far']),
      positionOf: (id) => positions[id] ?? unknownEntity(),
    }),
  })
  const ring = gated.computeRingRelevantIds('gated', -1, 0, 0, 0, 0, 200)
  assert.ok(ring.relevantIds.has('near'))
  assert.ok(!ring.relevantIds.has('far'))
  const ungated = createRingResolver({
    work: createAoiWork(),
    host: ringHost({
      baseRelevantIds: () => ['near', 'far'],
      dynamicRelevantIds: () => new Set(['near', 'far']),
      positionOf: (id) => positions[id] ?? unknownEntity(),
    }),
  })
  assert.ok(ungated.computeRingRelevantIds('ungated', -1, 0, 0, 0, 0, 200).relevantIds.has('far'))
})

gate('ring resolver caches rings and cells by key and counts hits', () => {
  const work = createAoiWork()
  const resolver = createRingResolver({ work, host: ringHost() })
  resolver.computeRingRelevantIds('k0', -1, 0, 0, 0, 0, 200)
  assert.equal(work.ringComputes, 1)
  assert.equal(work.cellComputes, 8)
  resolver.computeRingRelevantIds('k0', -1, 0, 0, 0, 0, 200)
  assert.equal(work.ringHits, 1)
  assert.equal(work.ringComputes, 1)
  assert.equal(work.cellComputes, 8)
  resolver.computeRingRelevantIds('k1', -1, 0, 0, 0, 0, 200)
  assert.equal(work.ringComputes, 2)
  assert.equal(work.cellHits, 8)
  assert.equal(resolver.ringCacheSize(), 2)
  assert.equal(resolver.spatialCacheSize(), 8)
})

gate('ring resolver uses the cell base cache under an active epoch', () => {
  const work = createAoiWork()
  const resolver = createRingResolver({ codeEpoch: EPOCH, work, host: ringHost() })
  resolver.cellBase.setEpoch(200, 0, { mutations: 0, relevanceRadius: 200 })
  resolver.computeRingRelevantIds('e0', -1, 0, 0, 0, 0, 200)
  assert.equal(work.cellBaseComputes, 8)
  assert.equal(resolver.cellBase.size(), 8)
  const cold = createAoiWork()
  const unset = createRingResolver({ work: cold, host: ringHost() })
  unset.computeRingRelevantIds('u0', -1, 0, 0, 0, 0, 200)
  assert.equal(cold.cellBaseUnusable, 8)
  assert.equal(unset.cellBase.size(), 0)
})

gate('work counters are twenty-one and all zero after a reset', () => {
  assert.equal(AOI_WORK_COUNTERS.length, 21)
  const work = createAoiWork()
  assert.ok(Object.values(work).every((v) => v === 0))
  work.evictions = 5
  assert.ok(!Object.values(work).every((v) => v === 0))
  resetAoiWork(work)
  assert.ok(Object.values(work).every((v) => v === 0))
  assert.equal(Object.keys(work).length, 21)
})

finish()
