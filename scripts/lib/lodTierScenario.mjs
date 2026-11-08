import { createHash } from 'node:crypto'

export const SCENARIO_COUNT = 40
export const POSE_CASES = 200
const BOUNDARY_INDEX = 4
const HZ_CHOICES = [1, 5, 10, 12, 15, 20, 24, 30, 60]
const CELL_CHOICES = [undefined, 10, 25, 25, 40]
const UNKNOWN_ID = 9999

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const pick = (rnd, list) => list[Math.floor(rnd() * list.length)]
const range = (rnd, lo, hi) => lo + rnd() * (hi - lo)
const roundTo = (v, step) => Math.round(v / step) * step

function shuffled(rnd, list) {
  const out = list.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    const held = out[i]
    out[i] = out[j]
    out[j] = held
  }
  return out
}

function makePlayers(rnd, index, count, spreadOverride) {
  const spread = spreadOverride ?? (index % 3 === 0 ? 150 : 420)
  const players = []
  for (let i = 0; i < count; i++) {
    let x = range(rnd, -spread, spread)
    let z = range(rnd, -spread, spread)
    if (index % 5 === 0) {
      x = roundTo(x, 10)
      z = roundTo(z, 10)
    }
    const position = i % 11 === 10 ? null : [x, range(rnd, 0, 2), z]
    players.push({ id: 100 + i * 7, position, lookYaw: range(rnd, -12, 12), lookPitch: range(rnd, -1, 1) })
  }
  return players
}

function makeScenario(rnd, index) {
  const dense = index % 6 === 2
  const count = index < BOUNDARY_INDEX ? 36 + index * 3 : dense ? 40 + Math.floor(rnd() * 36) : 4 + Math.floor(rnd() * 70)
  const players = makePlayers(rnd, index, count, dense ? 90 : undefined)
  const viewer = [range(rnd, -60, 60), range(rnd, 0, 2), range(rnd, -60, 60)]
  const ids = players.map((p) => p.id)
  const extra = index % 4 === 1 ? [ids[0], UNKNOWN_ID] : [UNKNOWN_ID]
  const nearby = shuffled(rnd, ids.concat(extra))
  const selfId = index % 2 === 0 ? ids[Math.floor(rnd() * ids.length)] : UNKNOWN_ID
  return { index, players, viewer, nearby, selfId, tick: Math.floor(rnd() * 40), hz: pick(rnd, HZ_CHOICES), cell: pick(rnd, CELL_CHOICES) }
}

function boundaryScenario(index) {
  const near = Array.from({ length: 31 }, (_, i) => ({ id: 500 + i, position: [i * 0.5, 0, 0], lookYaw: 0, lookPitch: 0 }))
  const edge = [
    { id: 600, position: [120, 0, 0], lookYaw: 0, lookPitch: 0 },
    { id: 601, position: [119.5, 0, 0], lookYaw: 0, lookPitch: 0 },
    { id: 602, position: [0, 0, -120.0000001], lookYaw: 0, lookPitch: 0 },
  ]
  const players = near.concat(edge)
  return {
    index,
    players,
    viewer: [0, 0, 0],
    nearby: players.map((p) => p.id),
    selfId: UNKNOWN_ID,
    tick: 0,
    hz: 60,
    cell: undefined,
  }
}

function makePoses(rnd) {
  const random = Array.from({ length: POSE_CASES }, () => ({
    id: Math.floor(rnd() * 70000),
    x: range(rnd, -3000, 3000),
    z: range(rnd, -3000, 3000),
    yawN: Math.floor(rnd() * 256),
  }))
  const edges = [
    { id: 1, x: 0.5, z: -0.5, yawN: 255 },
    { id: 2, x: 1e6, z: -1e6, yawN: 0 },
    { id: 3, x: NaN, z: 0, yawN: 0 },
  ]
  return random.concat(edges)
}

export function makeScenarios() {
  const rnd = mulberry32(0x10d7a)
  const scenarios = []
  for (let i = 0; i < SCENARIO_COUNT; i++) {
    scenarios.push(i === BOUNDARY_INDEX ? boundaryScenario(i) : makeScenario(rnd, i))
  }
  return { scenarios, poses: makePoses(rnd) }
}

export function inputsDigest() {
  return createHash('sha256').update(JSON.stringify(makeScenarios())).digest('hex')
}

const normalise = (x) => (x !== null && typeof x === 'object' && typeof x.length === 'number' ? Array.from(x) : x)

export function runScenario(lib, s, mod) {
  const playersById = new Map(s.players.map((p) => [p.id, p]))
  const encodedMap = new Map(s.players.map((p) => [p.id, { enc: p.id }]))
  const tiers = lib.classifyPlayerTiers(playersById, s.nearby, s.viewer, s.selfId)
  const filtered = lib.filterEncodedPlayersTiered(encodedMap, playersById, s.nearby, s.selfId, s.viewer, s.tick, mod)
  return {
    mod,
    classify: { full: tiers.full, reduced: tiers.reduced, dotIds: tiers.dotPlayers.map((p) => p.id) },
    players: filtered.players.map(normalise),
    dots: filtered.dots,
    dotsAll: lib.buildCrowdDots(s.players, s.viewer, s.cell),
  }
}

export function runPoses(pack, poses) {
  return poses.map((p) => {
    try {
      return normalise(pack(p.id, p.x, p.z, p.yawN))
    } catch (err) {
      return { refused: err.name }
    }
  })
}
