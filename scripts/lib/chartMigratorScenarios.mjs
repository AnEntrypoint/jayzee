export const FROM = { radius: 1000, anchorHeight: 2, offsetY: 0.5, east: [-0.9950371902099893, 0.09950371902099893, 0], up: [0.09938079899999067, 0.9938079899999066, 0.04969039949999533], north: [0.004944379549888721, 0.049443795498887215, -0.9987646690775217] }

export const TO = { radius: 1000, anchorHeight: 2, offsetY: 1.5, east: [-0.9486832980505138, 0.31622776601683794, 0], up: [0.30942637387763805, 0.9282791216329142, -0.2062842492517587], north: [-0.06523280730534423, -0.19569842191603268, -0.9784921095801634] }

const yawQuat = (yaw) => [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)]

export const PLAYERS = [
  {
    id: 'a', charId: 7,
    state: { position: [221.72323323781205, -54.636467313148614, -251.38662529204004], velocity: [1, 0.22855, 0], onGround: true, groundNormal: [0.1, 0.99, 0.05], wallNormals: [[1, 0, 0], [0, 0, 1]], lookYaw: 0.4, lookPitch: 0.1, rotation: [0, 0.1536190469857083, 0, 0.9881301475024445] },
    lastInput: { yaw: 0.3, pitch: -0.2 },
    inputs: [{ yaw: 0.1, pitch: 0 }, { yaw: 0.2, pitch: 0.05 }],
  },
  {
    id: 'b', charId: 8,
    state: { position: [230.12789380785793, -56.9415009323767, -244.67480730310857], velocity: [0, 1, 0], onGround: false, wallNormals: [[0, 0, 1]], lookYaw: -1.2, lookPitch: 0.05, rotation: [0, 0.21308098869480774, 0, 0.9770345399507856] },
    lastInput: null,
    inputs: [],
  },
  {
    id: 'c', charId: null,
    state: { position: [1, 2, 3], velocity: [0.5, 0.2, -0.3], onGround: true, groundNormal: [0, 1, 0], wallNormals: [], rotation: [0, 0, 0, 1] },
    lastInput: {},
    inputs: [{}],
  },
]

export const NETWORK = [
  { id: 'n', position: [5, -6, 7], velocity: [0, 0.3, 0.1], onGround: true, groundNormal: [0, 1, 0], wallNormals: [[1, 0, 0]], lookYaw: 0.7, lookPitch: -0.3, rotation: [0, 0.5, 0, 0.866] },
]

export const LAG = [
  { id: 'a', samples: [1, 2, 3, 4].map((k) => ({ tick: k, position: [k, 2 * k, -k], rotation: yawQuat(0.3 * k), velocity: [0.5 * k, 0.1, -0.2 * k] })) },
  { id: 'b', samples: [{ tick: 2, position: [10, 0, 5], rotation: [0.1, 0.2, 0.3, 0.927], velocity: [1, 2, 3] }] },
]

export const PHYSICS = { returns: { characters: 2, groundedUpwardClamped: 1 }, grounded: [7] }

export const ANCHOR_SCENARIOS = [
  {
    name: 'spawn list, singular point ignored, rejoin states and stages',
    ctx: {
      worldSpawnPoints: [[1, 2, 3], [4, 5, 6]],
      worldSpawnPoint: [9, 9, 9],
      pendingRejoin: [['p1', { position: [10, 1, 10], rotation: [0, 0.3, 0, 0.954] }], ['p2', { position: [-3, 0, 2], rotation: null }]],
      localRejoinState: { position: [0, 0, 0], rotation: [0, -0.6, 0, 0.825] },
    },
    stages: [{ spawnPoint: [1, 0, 1] }, { spawnPoint: null }, { spawnPoint: [-2, 0, 4] }, {}],
  },
  {
    name: 'empty spawn list takes the singular point',
    ctx: { worldSpawnPoints: [], worldSpawnPoint: [7, 0, 7] },
    stages: [],
  },
  {
    name: 'no spawn list leaves the singular point alone',
    ctx: { worldSpawnPoint: [3, 3, 3] },
    stages: [{ spawnPoint: [0, 0, 0] }],
  },
]

export const EMPTY_SPAWN_NO_SINGULAR = { ctx: { worldSpawnPoints: [] }, stages: [] }

const normalize = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)))

export function playerScenario(m, { spoint = false, defaultPass = false, fromChart = FROM, toChart = TO } = {}) {
  const transfer = m.createChartTransfer(fromChart, toChart)
  const players = new Map(PLAYERS.map((p) => [p.id, { id: p.id, state: normalize(p.state), lastInput: normalize(p.lastInput) }]))
  const inputs = new Map(PLAYERS.map((p) => [p.id, normalize(p.inputs).map((data) => ({ data }))]))
  const network = new Map(NETWORK.map((n) => [n.id, normalize(n)]))
  const lagCompensator = new m.LagCompensator(1000, 60)
  for (const { id, samples } of LAG) {
    for (const s of samples) lagCompensator.recordPlayerPosition(id, s.position, s.rotation, s.velocity, s.tick)
  }
  const base = {
    playerManager: { players, getInputs: (id) => inputs.get(id) ?? [] },
    networkState: { players: network },
    lagCompensator,
  }
  const deps = spoint
    ? {
      ...base,
      physicsIntegration: {
        physicsWorld: { _charMgr: { applyChartTransfer: () => ({ ...PHYSICS.returns }) }, getCharacterGroundState: (id) => PHYSICS.grounded.includes(id) },
        playerBodies: new Map(PLAYERS.filter((p) => p.charId != null).map((p) => [p.id, { charId: p.charId }])),
      },
    }
    : {
      ...base,
      physics: {
        applyChartTransfer: () => ({ ...PHYSICS.returns }),
        charIdOf: (id) => PLAYERS.find((p) => p.id === id)?.charId ?? null,
        isGrounded: (id) => PHYSICS.grounded.includes(id),
      },
    }
  const migrate = m.createPlayerMigrator(deps)
  const counts = defaultPass ? migrate({ transfer }) : migrate({ transfer }, m.createReexpressPass(transfer))
  return normalize({
    counts,
    players: [...players.values()].map((p) => ({ id: p.id, state: p.state, lastInput: p.lastInput })),
    network: [...network.values()],
    lag: [...lagCompensator.playerHistory].map(([id, ring]) => ({
      id,
      samples: Array.from({ length: ring.len }, (_, i) => {
        const s = ring.buf[(ring.head + i) % ring.buf.length]
        return { tick: s.tick, position: s.position, velocity: s.velocity, rotation: s.rotation }
      }),
    })),
  })
}

export function anchorScenario(m, desc, { defaultPass = false, fromChart = FROM, toChart = TO } = {}) {
  const transfer = m.createChartTransfer(fromChart, toChart)
  const ctx = {
    worldSpawnPoints: normalize(desc.ctx.worldSpawnPoints),
    worldSpawnPoint: normalize(desc.ctx.worldSpawnPoint),
    pendingRejoinState: desc.ctx.pendingRejoin ? new Map(normalize(desc.ctx.pendingRejoin)) : undefined,
    localRejoinState: normalize(desc.ctx.localRejoinState),
  }
  const stages = normalize(desc.stages)
  const migrate = m.createWorldAnchorMigrator({ ctx, stageLoader: { allStages: () => stages } })
  const counts = defaultPass ? migrate({ transfer }) : migrate({ transfer }, m.createReexpressPass(transfer))
  return normalize({
    counts,
    worldSpawnPoints: ctx.worldSpawnPoints,
    worldSpawnPoint: ctx.worldSpawnPoint,
    pendingRejoin: ctx.pendingRejoinState ? [...ctx.pendingRejoinState] : null,
    localRejoinState: ctx.localRejoinState,
    stages: stages.map((s) => s.spawnPoint),
  })
}

export function runAll(m, { spoint = false } = {}) {
  return {
    players: playerScenario(m, { spoint }),
    anchors: ANCHOR_SCENARIOS.map((desc) => ({ name: desc.name, result: anchorScenario(m, desc) })),
  }
}
