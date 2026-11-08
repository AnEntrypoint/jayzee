export const RADIUS = 6371000
export const ANCHORS_PER_FACE = 32
export const TOKEN_A = '0123456789abcdef0123456789abcdef'
export const TOKEN_B = 'fedcba9876543210fedcba9876543210'
export const TOKEN_UNJOINED = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

export const surfaceDir = (metres, bearing) => {
  const t = metres / RADIUS
  return [Math.sin(t) * Math.cos(bearing), Math.cos(t), Math.sin(t) * Math.sin(bearing)]
}

export const assignmentSteps = () => [
  [{ id: 1, dir: surfaceDir(0, 0) }, { id: 2, dir: surfaceDir(600, 0) }, { id: 3, dir: surfaceDir(1500, 0) }, { id: 4, dir: surfaceDir(400000, 1) }, { id: 5, dir: [0, 0, 0] }, { id: 2, dir: surfaceDir(10, 2) }, { id: 6, dir: [NaN, 1, 0] }, { id: 7, dir: [1, 2] }],
  [{ id: 1, dir: surfaceDir(0, 0) }, { id: 2, dir: surfaceDir(600, 0) }, { id: 3, dir: surfaceDir(30000, 0) }, { id: 4, dir: surfaceDir(400500, 1) }],
  [{ id: 1, dir: surfaceDir(0, 0) }, { id: 2, dir: surfaceDir(600, 0) }, { id: 3, dir: surfaceDir(700, 0.1) }],
  [{ id: 1, dir: surfaceDir(0, 0) }],
  [],
]

const runAssigner = (createClusterAssigner, lattice) => {
  const assigner = createClusterAssigner({ radius: RADIUS, linkM: 1000, memberRadiusM: 5000, lattice })
  return assignmentSteps().map((players) => {
    const r = assigner.assign(players)
    return { clusters: r.clusters, clusterOf: [...r.clusterOf], rejected: r.rejected, events: r.events }
  })
}

const outcome = (fn) => {
  try {
    return { value: fn() }
  } catch (error) {
    return { threw: error.name, code: error.code ?? null, reason: error.reason ?? null }
  }
}

const decisionCases = (chartAnchorForDir, lattice) => {
  const snapped = chartAnchorForDir(lattice, [0, 1, 0])
  return [
    { lattice, frame: { up: [0, 1, 0] }, dirs: [] },
    { lattice, frame: { up: [0, 1, 0] }, dirs: [[0, 1, 0]] },
    { lattice, frame: { up: snapped }, dirs: [[0, 1, 0]] },
    { lattice, frame: { up: snapped }, dirs: [[0.3, 1, 0], [0.35, 1, 0.02]] },
    { lattice, frame: { up: snapped }, dirs: [[0.05, 1, 0]] },
    { lattice, frame: { up: [0, 1, 0] }, dirs: [[1, 0, 0], [-1, 0, 0]] },
    { lattice, frame: { up: [0, 1, 0] }, dirs: [[0, 0, 0]] },
    { lattice, frame: { up: [0, 1, 0] }, dirs: [[1, 0, 0], [0, 1, 0]] },
    { lattice: null, frame: { up: [0, 1, 0] }, dirs: [] },
    { lattice, frame: {}, dirs: [] },
    { lattice, frame: { up: [0, 1, 0] }, dirs: 'not-a-list' },
    { lattice, frame: { up: [0, 1, 0] }, dirs: [[1, 2]] },
  ]
}

const frameFor = (anchorBasis, dir, extra) => ({ radius: RADIUS, offsetY: 0, anchorHeight: 0, chartEpoch: 0, ...anchorBasis(dir), ...extra })

const makeServer = ({ frame, players = [], clients = [], streamer = true }) => {
  const log = { created: [], destroyed: [], sent: [], closed: [], covered: [] }
  const playerMap = new Map(players.map((p) => [p.id, p]))
  const clientMap = new Map(clients.map((c) => [c.id, { ...c, transport: { close: () => log.closed.push(c.id) } }]))
  let minted = 0
  const server = {
    physics: frame ? { _planetFrame: frame, _terrainStreamer: streamer ? { cover: async (points) => { log.covered.push(points) } } : null } : {},
    playerManager: { players: playerMap, getPlayer: (id) => playerMap.get(id) },
    tickSystem: { currentTick: 120 },
    connections: { getClient: (id) => clientMap.get(id), send: (id, type, payload) => log.sent.push({ id, type, payload }) },
    sessions: {
      create: (owner, state) => {
        log.created.push({ owner, state: JSON.parse(JSON.stringify(state)) })
        minted++
        return minted === 1 ? TOKEN_A : TOKEN_B
      },
      destroy: (token) => log.destroyed.push(token),
    },
  }
  return { server, log }
}

const sourcePlayer = () => ({
  id: 3,
  name: 'ann',
  state: { position: [10, 2, -5], velocity: [3, 0.05, 1], rotation: [0, Math.sin(0.3), 0, Math.cos(0.3)], lookYaw: 0.6, lookPitch: -0.2, onGround: true, groundNormal: [0, 1, 0], health: 80, secret: 'kept-home' },
  lastInput: { yaw: 0.6, pitch: -0.2, buttons: 3 },
})

const errorOf = async (fn) => {
  try {
    await fn()
    return null
  } catch (error) {
    return { name: error.name, code: error.code ?? null }
  }
}

export async function runHandoff(flow, anchorBasis, chartAnchorForDir, lattice) {
  const source = makeServer({ frame: frameFor(anchorBasis, [0, 1, 0]), players: [sourcePlayer()], clients: [{ id: 3, sessionToken: TOKEN_UNJOINED }] })
  const handoff = flow.exportPlayerHandoff(source.server, 3)
  const exported = JSON.parse(JSON.stringify(handoff))
  source.server.playerManager.getPlayer(3).state.position[0] = 999
  const exportIsCopy = handoff.state.position[0] === 10
  const destFrame = frameFor(anchorBasis, chartAnchorForDir(lattice, surfaceDir(50000, 0.4)), { chartEpoch: 4 })
  const dest = makeServer({ frame: destFrame, players: [{ id: 9, name: 'ann', state: {}, lastInput: null }], clients: [{ id: 9, sessionToken: TOKEN_A }] })
  const admitted = await flow.admitPlayerHandoff(dest.server, handoff)
  const handoffUntouched = JSON.stringify(handoff) === JSON.stringify(exported)
  const admittedId = flow.applyAdmittedInputs(dest.server, admitted.token, admitted.lastInput)
  const flatGround = { ...handoff, state: { ...handoff.state, velocity: [3, 0.05, 1], onGround: false, groundNormal: null } }
  const airborne = await flow.admitPlayerHandoff(makeServer({ frame: destFrame }).server, flatGround)
  const noStreamer = makeServer({ frame: destFrame, streamer: false })
  await flow.admitPlayerHandoff(noStreamer.server, { ...handoff, lastInput: null })

  const release = (destination, clients = [{ id: 3, sessionToken: TOKEN_UNJOINED }]) => {
    const s = makeServer({ frame: frameFor(anchorBasis, [0, 1, 0]), players: [sourcePlayer()], clients })
    const ret = flow.releaseHandoffSource(s.server, 3, destination)
    return { ret: ret === undefined ? 'undefined' : ret, log: s.log }
  }

  const unjoined = makeServer({ frame: destFrame, players: [{ id: 9 }], clients: [{ id: 9, sessionToken: TOKEN_A }] })
  return {
    exported,
    exportIsCopy,
    handoffUntouched,
    admitted: { token: admitted.token, state: admitted.state, lastInput: admitted.lastInput, tiltRad: admitted.transfer.tiltRad, m: admitted.transfer.m },
    destLog: dest.log,
    admittedId,
    appliedInput: dest.server.playerManager.getPlayer(9).lastInput,
    airborne: { state: airborne.state, lastInput: airborne.lastInput },
    noStreamerLog: noStreamer.log,
    releases: {
      toDestination: release({ url: 'wss://b.example/ws', sessionToken: TOKEN_B, clusterId: 7 }),
      toDestinationNoCluster: release({ url: 'wss://b.example/ws', sessionToken: TOKEN_B }),
      destinationWithoutToken: release({ url: 'wss://b.example/ws' }),
      noDestination: release(null),
      noClient: release({ url: 'wss://b.example/ws', sessionToken: TOKEN_B }, []),
      clientWithoutToken: release(null, [{ id: 3 }]),
    },
    errors: {
      exportNegative: await errorOf(() => flow.exportPlayerHandoff(source.server, -1)),
      exportFraction: await errorOf(() => flow.exportPlayerHandoff(source.server, 1.5)),
      exportString: await errorOf(() => flow.exportPlayerHandoff(source.server, '3')),
      exportUnknown: await errorOf(() => flow.exportPlayerHandoff(source.server, 99)),
      exportNoFrame: await errorOf(() => flow.exportPlayerHandoff(makeServer({ frame: null, players: [sourcePlayer()] }).server, 3)),
      admitNoFrame: await errorOf(() => flow.admitPlayerHandoff(makeServer({ frame: null }).server, handoff)),
      applyMalformed: await errorOf(() => flow.applyAdmittedInputs(unjoined.server, 'XYZ', null)),
      applyNull: await errorOf(() => flow.applyAdmittedInputs(unjoined.server, null, null)),
      applyUnjoined: await errorOf(() => flow.applyAdmittedInputs(unjoined.server, TOKEN_UNJOINED, null)),
      releaseNegative: await errorOf(() => flow.releaseHandoffSource(unjoined.server, -2, null)),
    },
  }
}

export async function runAll({ assignment, chart, policy, flow, anchorBasis }) {
  const lattice = chart.createChartAnchorLattice(RADIUS, ANCHORS_PER_FACE)
  return {
    assign: runAssigner(assignment.createClusterAssigner, lattice),
    assignNoLattice: runAssigner(assignment.createClusterAssigner, null),
    assignerConfig: [
      { radius: 0, linkM: 1, memberRadiusM: 1 },
      { radius: Infinity, linkM: 1, memberRadiusM: 1 },
      { radius: RADIUS, linkM: 0, memberRadiusM: 1 },
      { radius: RADIUS, linkM: 1, memberRadiusM: NaN },
      { radius: RADIUS, linkM: 1, memberRadiusM: 1, joinFactor: 1 },
      { radius: RADIUS, linkM: 1, memberRadiusM: 1, stayFactor: 1 },
      { radius: RADIUS, linkM: '5', memberRadiusM: '5' },
    ].map((spec) => outcome(() => assignment.createClusterAssigner(spec) && 'made')),
    factors: { stay: assignment.CLUSTER_STAY_FACTOR, join: assignment.CLUSTER_JOIN_FACTOR },
    decisions: decisionCases(chart.chartAnchorForDir, lattice).map((args) => outcome(() => policy.chartAnchorDecision(args))),
    policyConstants: { hysteresisDeg: policy.CHART_REANCHOR_HYSTERESIS_DEG, walkableLimitDeg: policy.WALKABLE_CHART_LIMIT_DEG },
    centroids: [
      outcome(() => policy.playerCentroidDir([[0, 2, 0], [1, 1, 0], [0, 1, 1]])),
      outcome(() => policy.playerCentroidDir([[0, 1, 1], [1, 1, 0], [0, 2, 0]])),
      outcome(() => policy.playerCentroidDir([])),
    ],
    handoff: await runHandoff(flow, anchorBasis, chart.chartAnchorForDir, lattice),
  }
}
