import { readFileSync } from 'node:fs'
import { gate, finish } from './lib/gate.mjs'
import { runAll, runHandoff, RADIUS, TOKEN_A, TOKEN_B, TOKEN_UNJOINED } from './lib/clusterHandoffScenarios.mjs'
import * as assignment from '../src/clusters-pure/clusterAssignment.js'
import * as chart from '../src/chart-pure/chartAnchor.js'
import * as policy from '../src/chart-pure/chartReanchorPolicy.js'
import * as flow from '../src/sharding/clusterHandoffFlow.js'
import { anchorBasis } from '../src/terrain-pure/planetFrame.js'
import { MSG } from '../src/protocol/messages.js'
import { CLUSTER_LOCAL_PLAYER_ID_MALFORMED, HANDOFF_UNKNOWN_CLUSTER_LOCAL_PLAYER, HANDOFF_SESSION_NOT_JOINED, SESSION_TOKEN_MALFORMED } from '../src/sharding/index.js'

const FIXTURE = 'scripts/fixtures/spoint/cluster-handoff.json'
const spoint = JSON.parse(readFileSync(new URL('./fixtures/spoint/cluster-handoff.json', import.meta.url), 'utf8')).result

const ok = (condition, what) => {
  if (!condition) throw new Error(what)
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const asJson = (v) => JSON.parse(JSON.stringify(v))
const near = (a, b, tol, what) => ok(Math.abs(a - b) <= tol, `${what}: expected ${b}, got ${a}`)

const modules = { assignment, chart, policy, flow, anchorBasis }
const jayzee = asJson(await runAll(modules))
const lattice = chart.createChartAnchorLattice(RADIUS, 32)

const skipClampFlow = { ...flow, admitPlayerHandoff: async (server, handoff) => flow.admitPlayerHandoff(server, { ...handoff, state: { ...handoff.state, onGround: false, groundNormal: handoff.state.groundNormal } }) }
const skippedClamp = asJson(await runHandoff(skipClampFlow, anchorBasis, chart.chartAnchorForDir, lattice))
const flatChart = (_lattice, _dir) => [0, 1, 0]
const flatDestination = asJson(await runHandoff(flow, anchorBasis, flatChart, lattice))

for (const key of Object.keys(spoint)) {
  gate(`${key} matches spoint's output in ${FIXTURE}`, () => {
    ok(key in jayzee, `jayzee produced no ${key}`)
    ok(same(jayzee[key], spoint[key]), `${key} differs from spoint`)
  })
}

gate('the fixture covers every section the scenarios produce', () => {
  ok(same(Object.keys(jayzee).sort(), Object.keys(spoint).sort()), `sections ${Object.keys(jayzee)} vs ${Object.keys(spoint)}`)
})

gate('negative control: a perturbed spoint value no longer matches', () => {
  const perturbed = asJson(spoint.handoff)
  perturbed.admitted.state.position[1] += 1e-9
  ok(!same(jayzee.handoff, perturbed), 'a 1e-9 m change in the admitted height still matched')
  const relabelled = asJson(spoint.assign)
  relabelled[1].events[0].to = 2
  ok(!same(jayzee.assign, relabelled), 'a relabelled handoff event still matched')
})

gate('policy constants are spoint values: hysteresis 0.75 deg, walkable limit 0.7854 rad in degrees, stay 1.25, join 0.8', () => {
  ok(policy.CHART_REANCHOR_HYSTERESIS_DEG === 0.75, 'hysteresis')
  ok(policy.WALKABLE_CHART_LIMIT_DEG === 0.7854 * 180 / Math.PI, 'walkable limit')
  near(policy.WALKABLE_CHART_LIMIT_DEG, 45.00010522957485, 0, 'walkable limit degrees')
  ok(assignment.CLUSTER_STAY_FACTOR === 1.25 && assignment.CLUSTER_JOIN_FACTOR === 0.8, 'factors')
})

gate('first assignment: players 0, 600 and 1500 m apart form cluster 1 with an 800 m radius, the far player forms cluster 2', () => {
  const [c1, c2] = jayzee.assign[0].clusters
  ok(same(c1.memberIds, [1, 2, 3]) && c1.created === true, 'cluster 1 members')
  near(c1.radiusM, 800, 1e-3, 'cluster 1 radius')
  ok(same(c2.memberIds, [4]) && c2.radiusM === 0 && c2.created, 'cluster 2')
  ok(jayzee.assign[0].events.length === 0, 'no events on the first pass')
})

gate('admission refuses a zero, NaN or two-component direction and a duplicate id, keeping the first', () => {
  const reasons = jayzee.assign[0].rejected.map((r) => `${r.id}:${r.reason}`)
  ok(same(reasons, ['5:direction-is-not-a-finite-nonzero-3-vector', '2:duplicate-player-id', '6:direction-is-not-a-finite-nonzero-3-vector', '7:direction-is-not-a-finite-nonzero-3-vector']), reasons.join(','))
  ok(same(jayzee.assign[0].clusterOf.map(([id]) => id), [1, 2, 3, 4]), 'only admitted players are assigned')
})

gate('a player 30 km out leaves its cluster past the 1.25 stay factor and is handed to a new cluster', () => {
  const second = jayzee.assign[1]
  ok(same(second.events, [{ type: 'handoff', playerId: 3, from: 1, to: 3 }]), JSON.stringify(second.events))
  ok(second.clusters.find((c) => c.id === 3).created === true, 'cluster 3 is created')
  ok(second.clusters.find((c) => c.id === 1).created === false, 'cluster 1 is retained')
})

gate('spoint quirk kept: a merged player reports both the merge and a handoff, and an emptied cluster is dropped', () => {
  ok(same(jayzee.assign[2].events, [{ type: 'merge', into: 1, from: 3 }, { type: 'handoff', playerId: 3, from: 3, to: 1 }, { type: 'drop', cluster: 2 }]), JSON.stringify(jayzee.assign[2].events))
  ok(same(jayzee.assign[4].events, [{ type: 'drop', cluster: 1 }]), 'last cluster dropped when nobody is left')
})

gate('anchors snap to the chart lattice, and without a lattice every anchor is null', () => {
  const c1 = jayzee.assign[0].clusters[0]
  ok(same(c1.anchorDir, chart.chartAnchorForDir(lattice, c1.centroidDir)), 'anchor is the lattice anchor of the centroid')
  ok(jayzee.assignNoLattice.every((s) => s.clusters.every((c) => c.anchorDir === null)), 'lattice-free anchors')
  ok(same(jayzee.assignNoLattice.map((s) => s.events), jayzee.assign.map((s) => s.events)), 'the lattice does not change membership')
})

gate('string ids sort as strings, so "10" precedes "9"', () => {
  const a = assignment.createClusterAssigner({ radius: RADIUS, linkM: 1000, memberRadiusM: 5000 })
  const r = a.assign([{ id: '9', dir: [0, 1, 0] }, { id: '10', dir: [0, 1, 0] }])
  ok(same(r.clusters[0].memberIds, ['10', '9']), JSON.stringify(r.clusters[0].memberIds))
})

gate('assigner config refuses zero or infinite radius, zero link, NaN member radius and factors that do not bracket one', () => {
  const codes = jayzee.assignerConfig.slice(0, 6).map((o) => o.code)
  ok(same(codes, [assignment.ASSIGNER_RADIUS_NOT_POSITIVE_FINITE, assignment.ASSIGNER_RADIUS_NOT_POSITIVE_FINITE, assignment.ASSIGNER_LINK_M_NOT_POSITIVE, assignment.ASSIGNER_MEMBER_RADIUS_M_NOT_POSITIVE, assignment.ASSIGNER_FACTORS_NOT_BRACKETING_ONE, assignment.ASSIGNER_FACTORS_NOT_BRACKETING_ONE]), codes.join(','))
})

gate('spoint quirk kept: numeric strings for linkM and memberRadiusM pass through JavaScript coercion', () => {
  ok(jayzee.assignerConfig[6].value === 'made', JSON.stringify(jayzee.assignerConfig[6]))
})

gate('chartAnchorDecision: stay, reanchor and refusal kinds in the order spoint returns them', () => {
  const kinds = jayzee.decisions.map((d) => d.value ? `${d.value.kind}:${d.value.reason ?? ''}` : `threw:${d.reason}`)
  ok(same(kinds, ['stay:no-players', 'stay:gain-below-hysteresis', 'stay:anchor-unchanged', 'reanchor:', 'stay:gain-below-hysteresis', 'refusal:players-straddle-the-planet', 'refusal:player-direction-has-no-length', 'refusal:party-spread-exceeds-walkable-chart', 'threw:decision-needs-a-lattice', 'threw:decision-needs-a-frame-up', 'threw:player-directions-not-a-list', 'threw:player-direction-not-a-vector']), kinds.join(','))
  ok(jayzee.decisions[4].value.gainDeg > 0 && jayzee.decisions[4].value.gainDeg < 0.75, 'a positive gain under the hysteresis stays')
})

gate('playerCentroidDir is independent of input order and null for no players', () => {
  ok(same(jayzee.centroids[0], jayzee.centroids[1]), 'order changed the centroid')
  const s = 1 / Math.hypot(Math.SQRT1_2, 1 + Math.SQRT2, Math.SQRT1_2)
  const expected = [Math.SQRT1_2 * s, (1 + Math.SQRT2) * s, Math.SQRT1_2 * s]
  jayzee.centroids[0].value.forEach((c, i) => near(c, expected[i], 1e-15, `component ${i}`))
  ok(jayzee.centroids[2].value === null, 'empty list')
})

gate('export carries chart, name, tick and the eight state fields only, as a copy', () => {
  const h = jayzee.handoff
  ok(same(Object.keys(h.exported), ['chart', 'name', 'tick', 'state', 'lastInput']), Object.keys(h.exported).join(','))
  ok(same(Object.keys(h.exported.state), ['position', 'velocity', 'rotation', 'lookYaw', 'lookPitch', 'onGround', 'groundNormal', 'health']), 'state keys')
  ok(h.exported.tick === 120 && h.exported.name === 'ann', 'tick and name')
  ok(h.exportIsCopy && h.handoffUntouched, 'export and admit leave the handoff and the source untouched')
})

gate('admit re-expresses position, velocity, ground normal, look and yaw through the chart transfer', () => {
  const { m, state } = jayzee.handoff.admitted
  const lift = RADIUS
  near(state.position[0], m[0] * 10 + m[1] * (2 + lift) + m[2] * -5, 1e-6, 'x')
  near(state.position[1], m[3] * 10 + m[4] * (2 + lift) + m[5] * -5 - lift, 1e-6, 'y')
  near(state.position[2], m[6] * 10 + m[7] * (2 + lift) + m[8] * -5, 1e-6, 'z')
  ok(same(state.groundNormal, [m[1], m[4], m[7]]), 'ground normal is the transferred up axis')
  ok(state.lookYaw === jayzee.handoff.admitted.lastInput.yaw && state.lookPitch === jayzee.handoff.admitted.lastInput.pitch, 'state look and input look agree')
  ok(state.lookYaw !== 0.6, 'look changed across a tilted chart')
})

gate('a grounded admit clamps the tilt-induced upward velocity, an airborne admit keeps it', () => {
  ok(jayzee.handoff.admitted.state.velocity[1] === 0, 'grounded vertical velocity')
  const m = jayzee.handoff.admitted.m
  near(jayzee.handoff.airborne.state.velocity[1], m[3] * 3 + m[4] * 0.05 + m[5] * 1, 1e-15, 'airborne vertical velocity')
  ok(skippedClamp.admitted.state.velocity[1] !== 0, 'negative control: skipping the grounded flag leaves the upward velocity')
})

gate('negative control: a destination on the same chart leaves the state as exported', () => {
  ok(same(flatDestination.admitted.state.position, [10, 2, -5]), JSON.stringify(flatDestination.admitted.state.position))
  ok(!same(flatDestination.admitted.state, jayzee.handoff.admitted.state), 'the tilted destination must differ')
})

gate('admit covers the terrain at the new x,z, mints a session with the name, and skips cover without a streamer', () => {
  const log = jayzee.handoff.destLog
  const p = jayzee.handoff.admitted.state.position
  ok(same(log.covered, [[[p[0], p[2]]]]), 'cover points')
  ok(log.created.length === 1 && log.created[0].owner === null && log.created[0].state.name === 'ann', 'session create')
  ok(jayzee.handoff.admitted.token === TOKEN_A, 'token')
  ok(jayzee.handoff.noStreamerLog.covered.length === 0 && jayzee.handoff.noStreamerLog.created.length === 1, 'no streamer')
})

gate('applyAdmittedInputs finds the joined player by token and sets its last input', () => {
  ok(jayzee.handoff.admittedId === 9, 'id')
  ok(same(jayzee.handoff.appliedInput, jayzee.handoff.admitted.lastInput), 'input')
})

gate('release with a destination sends CLUSTER_HANDOFF (0xc7) and destroys the source session without closing', () => {
  const r = jayzee.handoff.releases
  ok(MSG.CLUSTER_HANDOFF === 0xc7, 'message id')
  ok(same(r.toDestination.log.sent, [{ id: 3, type: 0xc7, payload: { url: 'wss://b.example/ws', sessionToken: TOKEN_B, clusterId: 7 } }]), 'send')
  ok(same(r.toDestination.log.destroyed, [TOKEN_UNJOINED]) && r.toDestination.log.closed.length === 0, 'destroy without close')
  ok(r.toDestinationNoCluster.log.sent[0].payload.clusterId === null, 'clusterId defaults to null')
})

gate('release without a full destination destroys the session and closes; with no client it does neither', () => {
  const r = jayzee.handoff.releases
  for (const k of ['destinationWithoutToken', 'noDestination']) ok(r[k].log.sent.length === 0 && same(r[k].log.closed, [3]) && same(r[k].log.destroyed, [TOKEN_UNJOINED]), k)
  ok(same(r.noClient.log, { created: [], destroyed: [], sent: [], closed: [], covered: [] }), 'no client')
  ok(same(r.clientWithoutToken.log.closed, [3]) && r.clientWithoutToken.log.destroyed.length === 0, 'client without a token')
})

gate('refusals carry spoint codes: malformed and unknown ids, a missing planet frame, and tokens that name no player', () => {
  const e = jayzee.handoff.errors
  const codes = Object.fromEntries(Object.entries(e).map(([k, v]) => [k, v && v.name === 'ClusterHandoffError' ? v.code : null]))
  ok(same(codes, {
    exportNegative: CLUSTER_LOCAL_PLAYER_ID_MALFORMED,
    exportFraction: CLUSTER_LOCAL_PLAYER_ID_MALFORMED,
    exportString: CLUSTER_LOCAL_PLAYER_ID_MALFORMED,
    exportUnknown: HANDOFF_UNKNOWN_CLUSTER_LOCAL_PLAYER,
    exportNoFrame: flow.HANDOFF_NEEDS_PLANET_FRAME,
    admitNoFrame: flow.HANDOFF_NEEDS_PLANET_FRAME,
    applyMalformed: SESSION_TOKEN_MALFORMED,
    applyNull: SESSION_TOKEN_MALFORMED,
    applyUnjoined: HANDOFF_SESSION_NOT_JOINED,
    releaseNegative: CLUSTER_LOCAL_PLAYER_ID_MALFORMED,
  }), JSON.stringify(codes))
})

gate('the ported modules carry no comments and read no host globals', () => {
  const files = ['src/clusters-pure/clusterAssignment.js', 'src/chart-pure/chartReanchorPolicy.js', 'src/sharding/clusterHandoffFlow.js']
  for (const file of files) {
    const text = readFileSync(new URL('../' + file, import.meta.url), 'utf8')
    ok(!/\/\/|\/\*/.test(text.replace(/'[^'\n]*'|`[^`]*`/g, '')), `${file} has a comment marker`)
    ok(!/\b(Date|performance|console|window|process|setTimeout|globalThis)\b|Math\.random|__spointHmr/.test(text), `${file} reads a host global`)
  }
})

finish()
