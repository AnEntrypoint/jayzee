export const LSHAPE = {
  vertices: [[0, 0, 0], [2, 0, 0], [2, 0, 2], [0, 0, 2], [4, 0, 0], [4, 0, 2], [4, 0, 4], [2, 0, 4]],
  polygons: [{ vertices: [0, 1, 2, 3] }, { vertices: [1, 4, 5, 2] }, { vertices: [2, 5, 6, 7] }],
  links: [{ polygon: 0, neighbors: [1] }, { polygon: 1, neighbors: [0, 2] }, { polygon: 2, neighbors: [1] }],
  bounds: { min: [0, 0, 0], max: [4, 0, 4] },
}

const CW_SQUARE = { vertices: [[0, 0, 0], [0, 0, 2], [2, 0, 2], [2, 0, 0]], polygons: [{ vertices: [0, 1, 2, 3] }], links: [] }

const NQ = 'NavmeshQuery'
const CQ = 'ChartNavmeshQuery'

const callOn = (obj, publicName, privateName, ...args) => obj[typeof obj[publicName] === 'function' ? publicName : privateName](...args)

const errorText = (fn) => {
  try {
    fn()
  } catch (error) {
    return error.message
  }
  return null
}

const ROUTES = [
  ['path straight across the shared edge', [1, 0, 1], [3, 0, 1]],
  ['path bent around the corner', [0.5, 0, 1.5], [3.5, 0, 3.5]],
  ['path inside one polygon', [0.5, 0, 0.5], [1.5, 0, 1.5]],
  ['path to the same point', [1, 0, 1], [1, 0, 1]],
  ['path from off the mesh (failed)', [99, 0, 99], [3, 0, 1]],
  ['path into the gap (failed)', [1, 0, 3], [3, 0, 1]],
  ['path along the far legs', [0.5, 0, 0.5], [3.5, 0, 3.5]],
]

const POINTS = [[1, 0, 1], [3, 0, 1], [3.5, 0, 3.5], [99, 0, 99], [2, 0, 1], [2, 0, 2], [1, 0, 3]]

export function runNavmeshQueries(lib) {
  const log = []
  const record = (cls, step, value) => log.push({ class: cls, step, value })

  const nav = new lib.NavmeshQuery(LSHAPE)
  record(NQ, 'polygon count', nav.polygons.length)
  record(NQ, 'neighbors', nav.neighbors)
  record(NQ, 'bounds', nav.bounds)
  for (const [step, start, goal] of ROUTES) record(NQ, step, nav.findPath(start, goal))
  for (const point of POINTS) record(NQ, 'locate ' + JSON.stringify(point), nav.locate(point))
  for (const point of [[1, 0, 1], [2, 0, 1], [99, 0, 99]]) {
    for (let i = 0; i < 3; i++) record(NQ, `contains ${JSON.stringify(point)} in ${i}`, callOn(nav, 'contains', '_contains', point, i))
  }
  for (const [a, b] of [[0, 1], [1, 2], [0, 2]]) record(NQ, `distance ${a} ${b}`, callOn(nav, 'distance', '_dist', a, b))
  for (const [s, g] of [[0, 0], [0, 2], [2, 0]]) record(NQ, `corridor ${s} ${g}`, callOn(nav, 'corridor', '_corridor', s, g))
  for (const [a, b] of [[0, 1], [1, 2]]) record(NQ, `portal ${a} ${b}`, callOn(nav, 'portal', '_portal', a, b))
  record(NQ, 'portal 0 2 (no shared edge)', errorText(() => callOn(nav, 'portal', '_portal', 0, 2)))
  record(NQ, 'funnel bent', callOn(nav, 'funnel', '_funnel', [0.5, 0, 1.5], [3.5, 0, 3.5], [0, 1, 2]))
  record(NQ, 'funnel straight', callOn(nav, 'funnel', '_funnel', [1, 0, 1], [3, 0, 1], [0, 1]))

  const spy = new lib.NavmeshQuery(LSHAPE)
  const solveName = typeof spy.solve === 'function' ? 'solve' : '_solve'
  const solveOriginal = spy[solveName].bind(spy)
  let solveCalls = 0
  spy[solveName] = (...args) => {
    solveCalls++
    return solveOriginal(...args)
  }
  const first = spy.findPath([1, 0, 1], [3, 0, 1])
  spy.findPath([1, 0, 1], [3, 0, 1])
  record(NQ, 'cache solve calls after two identical queries', solveCalls)
  first[0][0] = 99
  record(NQ, 'cache returns a copy the caller cannot corrupt', spy.findPath([1, 0, 1], [3, 0, 1]))
  for (let i = 0; i < 101; i++) spy.findPath([0.5 + i * 0.001, 0, 0.5], [3.5, 0, 3.5])
  record(NQ, 'cache entries after 101 distinct queries', spy.pathCache.size)
  spy.clearCache()
  record(NQ, 'cache entries after clearCache', spy.pathCache.size)

  record(NQ, 'clockwise square refused', errorText(() => new lib.NavmeshQuery(CW_SQUARE)))

  const bareLedger = {
    currentEpoch: 4,
    base: { chartEpoch: 4 },
    transferToBase: () => { throw new Error('unused') },
    transferFromBase: () => { throw new Error('unused') },
  }
  const aligned = new lib.ChartNavmeshQuery(nav, () => bareLedger)
  record(CQ, 'aligned findPath', aligned.findPath([1, 0, 1], [3, 0, 1]))
  record(CQ, 'aligned locate', aligned.locate([1, 0, 1]))

  const shiftToBase = { point: (p) => [p[0] - 100, p[1], p[2]] }
  const shiftFromBase = { point: (p) => [p[0] + 100, p[1], p[2]] }
  const shiftedLedger = {
    currentEpoch: 2,
    base: { chartEpoch: 1 },
    transferToBase: () => shiftToBase,
    transferFromBase: () => shiftFromBase,
  }
  const shifted = new lib.ChartNavmeshQuery(nav, () => shiftedLedger)
  record(CQ, 'chart transfer findPath', shifted.findPath([101, 0, 1], [103, 0, 1]))
  record(CQ, 'chart transfer locate', shifted.locate([101, 0, 1]))
  record(CQ, 'chart transfer failed findPath', shifted.findPath([1, 0, 1], [3, 0, 1]))
  record(NQ, 'bare navmesh in the shifted frame', nav.findPath([101, 0, 1], [103, 0, 1]))

  const detached = new lib.ChartNavmeshQuery(nav, () => null)
  record(CQ, 'null ledger delegates findPath', detached.findPath([1, 0, 1], [3, 0, 1]))

  let toBaseFetches = 0
  const countingLedger = {
    currentEpoch: 2,
    base: { chartEpoch: 1 },
    transferToBase: () => {
      toBaseFetches++
      return shiftToBase
    },
    transferFromBase: () => shiftFromBase,
  }
  const counted = new lib.ChartNavmeshQuery(nav, () => countingLedger)
  counted.findPath([101, 0, 1], [103, 0, 1])
  counted.findPath([101, 0, 1], [103, 0, 1])
  counted.locate([101, 0, 1])
  record(CQ, 'chart fetches within one epoch', toBaseFetches)
  countingLedger.currentEpoch = 3
  counted.findPath([101, 0, 1], [103, 0, 1])
  record(CQ, 'chart fetches after an epoch change', toBaseFetches)

  record(CQ, 'getters share the navmesh', [counted.data === nav.data, counted.bounds === nav.bounds, counted.config === nav.config])
  counted.clearCache()
  record(CQ, 'chart clearCache delegates', nav.pathCache.size)

  return log
}
