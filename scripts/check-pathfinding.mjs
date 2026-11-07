import { gate, finish } from './lib/gate.mjs'
import { findCostCorridor } from '../src/pathfinding/costCorridor.js'
import { findPathWithStatus, readPoint } from '../src/pathfinding/findPathStatus.js'
import { NavmeshQuery } from '../src/pathfinding/NavmeshQuery.js'
import { ChartNavmeshQuery } from '../src/pathfinding/ChartNavmeshQuery.js'
import { DEFAULT_AGENT, agentWith, assertBakeInput, recastConfigFor, ringTurning, polyMeshToJSON } from '../src/pathfinding/recastPolyMesh.js'
import * as pathfinding from '../src/pathfinding/index.js'

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const same = (actual, expected, label) => assert(JSON.stringify(actual) === JSON.stringify(expected), `${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`)

const near = (actual, expected, label) => assert(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} is not ${expected}`)

const errorOf = (run) => {
  try {
    run()
  } catch (error) {
    return error
  }
  return null
}

const settle = async (run) => {
  try {
    return { value: await run() }
  } catch (error) {
    return { error }
  }
}

const routes = {
  S: [{ node: 'A', cost: 1 }, { node: 'B', cost: 1.5 }],
  A: [{ node: 'G', cost: 1 }],
  B: [{ node: 'G', cost: 1.5 }],
  G: [],
}
const burningA = (node) => (node === 'A' ? 10 : 1)
const corridor = (overrides) => findCostCorridor({ start: 'S', goal: 'G', neighbors: routes, ...overrides })

gate('findCostCorridor routes around a node that costs more to enter', () => {
  const weighted = corridor({ costAt: burningA })
  same(weighted.points, ['S', 'B', 'G'], 'weighted points')
  near(weighted.cost, 3, 'weighted cost')
  const plain = corridor({})
  same(plain.points, ['S', 'A', 'G'], 'unweighted control points')
  near(plain.cost, 2, 'unweighted control cost')
})

gate('a budget refuses a corridor costing more and accepts one costing exactly the budget', () => {
  const exact = corridor({ costAt: burningA, budget: 3 })
  assert(exact.ok && exact.cost === 3, 'budget equal to the route cost was refused')
  const short = corridor({ costAt: burningA, budget: 2.999 })
  assert(!short.ok && short.reasonCode === 'budget-exhausted' && short.truncated === true, `budget below the route gave ${short.reasonCode}`)
  assert(short.cost === Infinity && short.points.length === 0, 'a refusal carried a path')
  assert(corridor({ budget: 2.999 }).ok, 'control: the unweighted route under the same budget was refused')
})

const longEdge = { S: [{ node: 'G', cost: 25000 }], G: [] }

gate('the default budget is unbounded, so a 20000 cap applies only when a caller passes one', () => {
  const unbounded = findCostCorridor({ start: 'S', goal: 'G', neighbors: longEdge })
  assert(unbounded.ok && unbounded.cost === 25000, `default budget gave ${unbounded.reasonCode}`)
  const capped = findCostCorridor({ start: 'S', goal: 'G', neighbors: longEdge, budget: 20000 })
  assert(!capped.ok && capped.reasonCode === 'budget-exhausted', `budget 20000 gave ${capped.reasonCode}`)
  assert(findCostCorridor({ start: 'S', goal: 'G', neighbors: longEdge, budget: 25000 }).ok, 'budget equal to the route was refused')
})

gate('a zero budget settles the start and cuts every step', () => {
  const atStart = findCostCorridor({ start: 'S', goal: 'S', neighbors: routes, budget: 0 })
  assert(atStart.ok && atStart.cost === 0 && atStart.points.length === 1, 'start equal to goal refused under zero budget')
  assert(corridor({ budget: 0 }).reasonCode === 'budget-exhausted', 'zero budget did not exhaust the search')
})

gate('ignored nodes are avoided, and an ignored start or goal is unreachable', () => {
  same(corridor({ ignore: ['A'] }).points, ['S', 'B', 'G'], 'ignoring A')
  assert(corridor({ ignore: ['A', 'B'] }).reasonCode === 'unreachable', 'both first steps ignored')
  assert(corridor({ ignore: ['S'] }).reasonCode === 'unreachable', 'ignored start')
  assert(corridor({ ignore: ['G'] }).reasonCode === 'unreachable', 'ignored goal')
  same(corridor({ ignore: [] }).points, ['S', 'A', 'G'], 'control: empty ignore list')
})

gate('an edgeCost map overrides the cost carried by each neighbor record', () => {
  const overridden = corridor({ edgeCost: new Map([['S', new Map([['A', 9]])]]) })
  same(overridden.points, ['S', 'B', 'G'], 'overridden S to A')
  near(overridden.cost, 3, 'overridden cost')
  same(corridor({ edgeCost: new Map([['S', new Map([['A', 0.25]])]]) }).points, ['S', 'A', 'G'], 'cheap S to A')
})

gate('malformed options are refused as invalid-input', () => {
  const malformed = [{ budget: NaN }, { budget: -1 }, { budget: '10' }, { start: undefined }, { goal: null }, { neighbors: 5 }, { ignore: 'AB' }, { costAt: 3 }, { edgeCost: 'x' }]
  for (const override of malformed) {
    assert(corridor(override).reasonCode === 'invalid-input', 'accepted ' + JSON.stringify(override))
  }
  assert(findCostCorridor(null).reasonCode === 'invalid-input', 'null options accepted')
  assert(corridor({ budget: 10 }).ok, 'control: a valid budget was refused')
})

gate('a finite budget with no route reports unreachable, not budget-exhausted', () => {
  const none = findCostCorridor({ start: 'S', goal: 'G', neighbors: { S: [], G: [] }, budget: 10 })
  assert(none.reasonCode === 'unreachable' && none.truncated === false, `got ${none.reasonCode}`)
  assert(findCostCorridor({ start: 'S', goal: 'G', neighbors: { S: [{ node: 'G', cost: 1 }], G: [] }, budget: 10 }).ok, 'control: a reachable route was refused')
})

gate('readPoint accepts three finite numbers only', () => {
  const point = [0, -0, 1e300]
  assert(readPoint(point, 'p') === point, 'valid point refused')
  for (const bad of [[1, 2], [1, NaN, 3], ['1', 2, 3], [1, Infinity, 3], 'abc']) {
    assert(errorOf(() => readPoint(bad, 'p'))?.reasonCode === 'path-point-invalid', 'accepted ' + JSON.stringify(bad))
  }
})

const from = [0, 0, 0]
const to = [10, 0, 0]
const mid = [5, 0, 0]
const nearPoint = [4, 0, 0]
const counted = { nearest: 0 }
const countedNearest = () => {
  counted.nearest += 1
  return nearPoint
}

const route = await settle(() => findPathWithStatus({ query: () => [from, mid, to], from, to }))
const singlePoint = await settle(() => findPathWithStatus({ query: () => [from], from, to }))
const queryMiss = await settle(() => findPathWithStatus({ query: () => null, from, to }))
const queryMissNearest = await settle(() => findPathWithStatus({ query: () => null, nearest: countedNearest, from, to }))
const queryMissNearestNull = await settle(() => findPathWithStatus({ query: () => null, nearest: () => null, from, to }))
const throwCase = { nearestCalls: 0 }
const queryThrows = await settle(() => findPathWithStatus({ query: () => { throw new Error('boom') }, nearest: () => { throwCase.nearestCalls += 1; return nearPoint }, from, to }))
const queryThrowsNearestCalls = throwCase.nearestCalls
const nearestThrows = await settle(() => findPathWithStatus({ query: () => null, nearest: () => { throw new Error('nope') }, from, to }))
const queryNotFunction = await settle(() => findPathWithStatus({ query: 5, from, to }))
const shortFrom = await settle(() => findPathWithStatus({ query: () => [from, to], from: [0, 0], to }))
const nanTo = await settle(() => findPathWithStatus({ query: () => [from, to], from, to: [NaN, 0, 0] }))
const nearestNotFunction = await settle(() => findPathWithStatus({ query: () => null, nearest: 5, from, to }))
const optionsNotObject = await settle(() => findPathWithStatus({ query: () => null, from, to, options: [] }))
const nanPointInRoute = await settle(() => findPathWithStatus({ query: () => [from, [NaN, 0, 0]], from, to }))
const stringResult = await settle(() => findPathWithStatus({ query: () => 'abc', from, to }))

gate('a query route of two or more points is reported ok without partial', () => {
  assert(route.value?.ok === true && route.value.partial === false && route.value.reasonCode === null, 'route status')
  same(route.value.points, [from, mid, to], 'route points')
  assert(singlePoint.error?.reasonCode === 'path-result-invalid', 'control: a one-point result was not refused')
})

gate('a query miss reports the nearest-reachable cutoff as partial, and unreachable without a nearest point', () => {
  same(queryMissNearest.value, { ok: false, points: [from, nearPoint], partial: true, reasonCode: 'path-partial' }, 'partial cutoff')
  same(queryMiss.value, { ok: false, points: [], partial: false, reasonCode: 'path-unreachable' }, 'miss without nearest')
  same(queryMissNearestNull.value, { ok: false, points: [], partial: false, reasonCode: 'path-unreachable' }, 'control: nearest returned null')
})

gate('a throwing query or nearest is a coded failure, and nearest is not called after a query failure', () => {
  assert(queryThrows.value?.reasonCode === 'path-query-failed' && queryThrows.value.message === 'boom', 'query failure')
  assert(queryThrowsNearestCalls === 0, 'nearest was called after the query threw')
  assert(nearestThrows.value?.reasonCode === 'path-nearest-failed' && nearestThrows.value.message === 'nope', 'nearest failure')
  assert(counted.nearest === 1 && queryMissNearest.value?.partial === true, 'control: a nearest that returns a point was not used')
})

gate('malformed endpoints and arguments are refused with coded errors', () => {
  assert(queryNotFunction.error?.reasonCode === 'path-query-invalid', 'query not a function')
  assert(shortFrom.error?.reasonCode === 'path-point-invalid', 'short from')
  assert(nanTo.error?.reasonCode === 'path-point-invalid', 'NaN to')
  assert(nearestNotFunction.error?.reasonCode === 'path-nearest-invalid', 'nearest not a function')
  assert(optionsNotObject.error?.reasonCode === 'path-options-invalid', 'options not an object')
  assert(nanPointInRoute.error?.reasonCode === 'path-point-invalid', 'NaN point in a route')
  assert(stringResult.error?.reasonCode === 'path-result-invalid', 'string route result')
  assert(route.value?.ok === true, 'control: valid endpoints were refused')
})

const LSHAPE = {
  vertices: [[0, 0, 0], [2, 0, 0], [2, 0, 2], [0, 0, 2], [4, 0, 0], [4, 0, 2], [4, 0, 4], [2, 0, 4]],
  polygons: [{ vertices: [0, 1, 2, 3] }, { vertices: [1, 4, 5, 2] }, { vertices: [2, 5, 6, 7] }],
  links: [{ polygon: 0, neighbors: [1] }, { polygon: 1, neighbors: [0, 2] }, { polygon: 2, neighbors: [1] }],
  bounds: { min: [0, 0, 0], max: [4, 0, 4] },
}

const navmesh = new NavmeshQuery(LSHAPE)

gate('findPath across one shared edge returns the start and goal, and an off-mesh point returns null', () => {
  same(navmesh.findPath([1, 0, 1], [3, 0, 1]), [[1, 0, 1], [3, 0, 1]], 'straight across the shared edge')
  assert(navmesh.findPath([99, 0, 99], [3, 0, 1]) === null, 'control: off-mesh start returned a path')
})

gate('the funnel bends at the shared corner of an L-shaped corridor', () => {
  same(navmesh.findPath([0.5, 0, 1.5], [3.5, 0, 3.5]), [[0.5, 0, 1.5], [2, 0, 2], [3.5, 0, 3.5]], 'bent path')
  assert(navmesh.findPath([0.5, 0, 1.5], [3.5, 0, 3.5]).length === 3, 'control: the corner was dropped')
})

gate('locate returns the containing polygon and -1 off the mesh', () => {
  assert(navmesh.locate([1, 0, 1]) === 0, 'poly 0')
  assert(navmesh.locate([3, 0, 1]) === 1, 'poly 1')
  assert(navmesh.locate([3.5, 0, 3.5]) === 2, 'poly 2')
  assert(navmesh.locate([99, 0, 99]) === -1, 'off mesh')
})

gate('findPath returns copies, so a caller cannot change the memo', () => {
  const first = navmesh.findPath([1, 0, 1], [3, 0, 1])
  first[0][0] = 77
  assert(first[0][0] === 77, 'control: the returned copy did not change')
  same(navmesh.findPath([1, 0, 1], [3, 0, 1]), [[1, 0, 1], [3, 0, 1]], 'memo after caller mutation')
})

gate('the path memo keeps at most 100 entries and clearCache empties it', () => {
  const memo = new NavmeshQuery(LSHAPE)
  for (let i = 0; i < 50; i++) memo.findPath([1, 0, 1], [3, 0, 0.5 + i * 0.01])
  assert(memo.pathCache.size === 50, `control: 50 queries left ${memo.pathCache.size} entries`)
  for (let i = 50; i < 101; i++) memo.findPath([1, 0, 1], [3, 0, 0.5 + i * 0.01])
  assert(memo.pathCache.size === 100, `101 queries left ${memo.pathCache.size} entries`)
  memo.clearCache()
  assert(memo.pathCache.size === 0, 'clearCache kept entries')
})

const CW_SQUARE = { vertices: [[0, 0, 0], [0, 0, 2], [2, 0, 2], [2, 0, 0]], polygons: [{ vertices: [0, 1, 2, 3] }], links: [] }
const CCW_SQUARE = { ...CW_SQUARE, polygons: [{ vertices: [0, 3, 2, 1] }] }

gate('a clockwise polygon is refused when the navmesh is built', () => {
  assert(/winds clockwise/.test(errorOf(() => new NavmeshQuery(CW_SQUARE))?.message ?? ''), 'clockwise polygon was accepted')
  assert(errorOf(() => new NavmeshQuery(CCW_SQUARE)) === null, 'control: counter-clockwise polygon was refused')
})

const bareLedger = {
  currentEpoch: 4,
  base: { chartEpoch: 4 },
  transferToBase: () => { throw new Error('unused') },
  transferFromBase: () => { throw new Error('unused') },
}

gate('without an active chart transfer the query delegates unchanged', () => {
  const aligned = new ChartNavmeshQuery(navmesh, () => bareLedger)
  same(aligned.findPath([1, 0, 1], [3, 0, 1]), [[1, 0, 1], [3, 0, 1]], 'aligned path')
  assert(aligned.locate([1, 0, 1]) === 0, 'aligned locate')
})

const shiftToBase = { point: (p) => [p[0] - 100, p[1], p[2]] }
const shiftFromBase = { point: (p) => [p[0] + 100, p[1], p[2]] }
const shiftedLedger = {
  currentEpoch: 2,
  base: { chartEpoch: 1 },
  transferToBase: () => shiftToBase,
  transferFromBase: () => shiftFromBase,
}

gate('with a chart transfer, points map to base and the path maps back', () => {
  const shifted = new ChartNavmeshQuery(navmesh, () => shiftedLedger)
  same(shifted.findPath([101, 0, 1], [103, 0, 1]), [[101, 0, 1], [103, 0, 1]], 'shifted path')
  assert(shifted.locate([101, 0, 1]) === 0, 'shifted locate')
  assert(navmesh.findPath([101, 0, 1], [103, 0, 1]) === null, 'control: the bare navmesh found a path in the shifted frame')
})

gate('chart transfers are fetched once per epoch', () => {
  const fetches = { toBase: 0 }
  const ledger = {
    currentEpoch: 2,
    base: { chartEpoch: 1 },
    transferToBase: () => {
      fetches.toBase += 1
      return shiftToBase
    },
    transferFromBase: () => shiftFromBase,
  }
  const chart = new ChartNavmeshQuery(navmesh, () => ledger)
  chart.findPath([101, 0, 1], [103, 0, 1])
  chart.findPath([101, 0, 1], [103, 0, 1])
  chart.locate([101, 0, 1])
  assert(fetches.toBase === 1, `three calls in one epoch fetched ${fetches.toBase} times`)
  ledger.currentEpoch = 3
  chart.findPath([101, 0, 1], [103, 0, 1])
  assert(fetches.toBase === 2, `control: a new epoch fetched ${fetches.toBase} times`)
})

gate('recastConfigFor derives walkable cell counts from the agent', () => {
  const config = recastConfigFor(DEFAULT_AGENT)
  assert(config.walkableHeight === 9 && config.walkableClimb === 2 && config.walkableRadius === 2, JSON.stringify(config))
  assert(config.cs === 0.3 && config.ch === 0.2 && config.walkableSlopeAngle === 45, 'cell sizes and slope')
  assert(recastConfigFor(agentWith({ agentRadius: 0.3 })).walkableRadius === 1, 'control: a smaller radius did not change the cell count')
  same(agentWith({}), DEFAULT_AGENT, 'agentWith without overrides')
})

const SQUARE_VERTICES = [[0, 0, 0], [2, 0, 0], [2, 0, 2], [0, 0, 2]]

gate('ringTurning is plus 2pi for counter-clockwise rings and minus 2pi for clockwise', () => {
  near(ringTurning(SQUARE_VERTICES, [0, 1, 2, 3]), 2 * Math.PI, 'counter-clockwise turning')
  near(ringTurning(SQUARE_VERTICES, [0, 3, 2, 1]), -2 * Math.PI, 'clockwise turning')
})

const stripMesh = (firstRing) => {
  const verts = [0, 0, 0, 0, 0, 1, 1, 0, 1, 1, 0, 0, 2, 0, 0, 2, 0, 1]
  const polys = [...firstRing, 0xffff, 0xffff, 1, 0xffff, 3, 2, 5, 4, 0, 0x8000, 0xffff, 0xffff]
  return {
    cs: () => 1,
    ch: () => 1,
    bmin: () => ({ x: 0, y: 0, z: 0 }),
    bmax: () => ({ x: 2, y: 0, z: 1 }),
    nvp: () => 4,
    nverts: () => 6,
    verts: (i) => verts[i],
    npolys: () => 2,
    polys: (i) => polys[i],
    flags: () => 0,
    areas: () => 1,
  }
}

const rc = recastConfigFor(DEFAULT_AGENT)

gate('polyMeshToJSON reverses recast order into counter-clockwise rings and drops portal links', () => {
  const strip = polyMeshToJSON(stripMesh([0, 1, 2, 3]), rc)
  same(strip.polygons.map((polygon) => polygon.vertices), [[3, 2, 1, 0], [4, 5, 2, 3]], 'reversed rings')
  same(strip.links, [{ polygon: 0, neighbors: [1] }, { polygon: 1, neighbors: [0] }], 'links without the portal flag')
  same(strip.vertices[1], [0, 0, 1], 'vertex coordinates')
  assert(strip.version === 1 && strip.config.agentRadius === rc.walkableRadius, 'version or config')
})

gate('a recast polygon that stays clockwise after reversal is refused', () => {
  assert(/winds clockwise/.test(errorOf(() => polyMeshToJSON(stripMesh([0, 3, 2, 1]), rc))?.message ?? ''), 'clockwise recast polygon was accepted')
})

gate('the converted strip is walkable through NavmeshQuery', () => {
  const walkable = new NavmeshQuery(polyMeshToJSON(stripMesh([0, 1, 2, 3]), rc))
  same(walkable.findPath([0.5, 0, 0.5], [1.5, 0, 0.5]), [[0.5, 0, 0.5], [1.5, 0, 0.5]], 'strip path')
  assert(walkable.findPath([5, 0, 5], [1.5, 0, 0.5]) === null, 'control: off-strip start returned a path')
})

gate('assertBakeInput refuses positions and indices that are not triangle lists', () => {
  assert(errorOf(() => assertBakeInput([0, 0, 0, 1, 0, 0, 0, 0, 1], [0, 1, 2])) === null, 'control: one triangle was refused')
  assert(errorOf(() => assertBakeInput([0, 0, 0, 1, 0, 0, 0, 0], [0, 1, 2])) instanceof TypeError, 'eight position values were accepted')
  assert(errorOf(() => assertBakeInput([0, 0, 0], [0, 1, 2])) instanceof TypeError, 'one position was accepted')
  assert(errorOf(() => assertBakeInput([0, 0, 0, 1, 0, 0, 0, 0, 1], [0, 1, 2, 3])) instanceof TypeError, 'four indices were accepted')
})

gate('the pathfinding barrel re-exports every public name by name', () => {
  const names = [
    'ChartNavmeshQuery', 'NavmeshQuery', 'findCostCorridor', 'findPathWithStatus',
    'NAVMESH_FORMAT_VERSION', 'DEFAULT_AGENT', 'agentWith', 'assertBakeInput', 'recastConfigFor', 'ringTurning', 'polyMeshToJSON'
  ]
  const missing = names.filter((name) => pathfinding[name] === undefined)
  assert(missing.length === 0, 'barrel misses ' + missing.join(', '))
  assert(pathfinding.findCostCorridor === findCostCorridor, 'barrel findCostCorridor is not the module export')
  assert(pathfinding.NavmeshQuery === NavmeshQuery, 'barrel NavmeshQuery is not the module export')
})

finish()
