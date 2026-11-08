export const RANDOM_COUNT = 36
export const EXACT_INDEX = 36
export const COINCIDENT_INDEX = 37

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

function makeScenario(rnd, index) {
  const count = 2 + Math.floor(rnd() * 39)
  const spread = [2, 6, 14, 3][index % 4]
  const minDist = pick(rnd, [0.8, 1.2, 0.5])
  const cellSz = pick(rnd, [minDist, 1, 2.5])
  const dt = pick(rnd, [1 / 60, 0.05, 1, 1 / 120])
  const players = Array.from({ length: count }, (_, i) => ({
    id: 1 + i * 3 + Math.floor(rnd() * 2),
    position: [range(rnd, -spread, spread), range(rnd, 0, 1.5), range(rnd, -spread, spread)],
    velocity: [range(rnd, -2, 2), 0, range(rnd, -2, 2)],
  }))
  if (index % 6 === 5) {
    players.push(
      { id: 1000, position: [0, 0, 0], velocity: [0.5, 0, 0] },
      { id: 1001, position: [minDist, 0, 0], velocity: [-0.5, 0, 0] },
      { id: 1002, position: [-3, 0, 4], velocity: [0, 0, 0] },
      { id: 1003, position: [-3, 0, 4], velocity: [0, 0, 0] },
    )
  }
  return { index, minDist, cellSz, dt, frames: 1 + Math.floor(rnd() * 5), players }
}

function targetedScenarios() {
  const still = (id, position) => ({ id, position, velocity: [0, 0, 0] })
  return [
    { index: EXACT_INDEX, minDist: 0.8, cellSz: 0.8, dt: 1 / 60, frames: 1, players: [still(1, [0, 0, 0]), still(2, [0.8, 0, 0])] },
    { index: COINCIDENT_INDEX, minDist: 0.8, cellSz: 0.8, dt: 1 / 60, frames: 1, players: [still(1, [0, 0, 0]), still(2, [0, 0, 0])] },
  ]
}

export function makeScenarios() {
  const rnd = mulberry32(0x46)
  const random = Array.from({ length: RANDOM_COUNT }, (_, i) => makeScenario(rnd, i))
  return random.concat(targetedScenarios())
}

export function runScenario(apply, scenario) {
  const grid = new Map()
  const gridCells = new Map()
  const calls = []
  const physicsIntegration = { setPlayerPosition: (id, pos) => calls.push([id, [...pos]]) }
  const players = scenario.players.map((p) => ({ id: p.id, state: { position: [...p.position], velocity: [...p.velocity] } }))
  const frames = []
  for (let f = 0; f < scenario.frames; f++) {
    calls.length = 0
    apply(players, grid, gridCells, scenario.cellSz, scenario.minDist * scenario.minDist, scenario.minDist, scenario.dt, physicsIntegration)
    frames.push({
      calls: calls.map((c) => [c[0], c[1]]),
      state: players.map((p) => [p.id, [...p.state.position], [...p.state.velocity]]),
    })
    for (const p of players) {
      for (let k = 0; k < 3; k++) p.state.position[k] += p.state.velocity[k] * scenario.dt
    }
  }
  return frames
}

export function runAll(apply) {
  return makeScenarios().map((s) => ({ index: s.index, frames: runScenario(apply, s) }))
}
