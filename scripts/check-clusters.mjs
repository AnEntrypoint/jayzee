import { readFileSync } from 'node:fs'
import { gate, finish } from './lib/gate.mjs'
import * as clusterConfig from '../src/clusters-pure/clusterConfig.js'
import { parsePlayerIdOfSession } from '../src/clusters-pure/clusterSession.js'
import * as sharding from '../src/sharding/index.js'
import { DEFAULT_COMBAT } from '../src/behaviours/combat.js'

const {
  ClusterConfigError, CLUSTER_DEFAULT_LINK_M, CLUSTER_DEFAULT_HZ, CLUSTER_DEFAULT_IDLE_GRACE_MS,
  CLUSTER_RELEVANCE_RING_CELLS, heapWorldCeiling, resolveClusterConfig, declaredWeaponRangeM,
} = clusterConfig

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const near = (actual, expected, label) => assert(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} is not ${expected}`)

const RADIUS = 6371000

const jolt = {
  heapBytes: 134217728,
  residentBytes: 1157976,
  mirrorReserve: 2,
  mirrorMarginalBytes: 11278387,
  worldMarginalBytes: 20238432,
  reserveFraction: 0.1,
}

const policy = {
  anchorsPerFace: 8,
  createLattice: (radius, anchorsPerFace) => ({ radius, anchorsPerFace }),
  cellWorstAngleDeg: (lattice) => 45 / lattice.anchorsPerFace,
  hysteresisDeg: 2.5,
  stayFactor: 1,
  joinFactor: 0.5,
  walkableLimitDeg: 60,
  jolt,
}

const resolve = (spec, geometry = { radius: RADIUS }) => resolveClusterConfig({ enabled: true, ...spec }, geometry, policy)

const refusedAs = (fn, code) => {
  try {
    fn()
  } catch (error) {
    return error instanceof ClusterConfigError && error.code === code
  }
  return false
}

const refusesEach = (code, geometries, specOf = () => [{}]) => {
  for (const value of geometries) {
    assert(refusedAs(() => resolve(...specOf(value)), code), `value ${String(value)} was not refused as ${code}`)
  }
}

const sourceOf = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const importsOf = (source) => [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1])
const hasComment = (source) => /\/\/|\/\*/.test(source)

const CONFIG_SOURCE = '../src/clusters-pure/clusterConfig.js'
const SESSION_SOURCE = '../src/clusters-pure/clusterSession.js'

const ALLOWED_CONFIG_IMPORTS = ['../behaviours/combat.js']
const ALLOWED_SESSION_IMPORTS = ['../sharding/index.js']

const TOKEN_A = 'a'.repeat(32)
const TOKEN_B = '0123456789abcdef0123456789abcdef'
const TOKEN_C = 'f'.repeat(32)

function serverWith(players, sessions) {
  const calls = []
  return {
    calls,
    playerManager: { players: new Map(players.map((player) => [player.id, player])) },
    connections: { getClient: (id) => { calls.push(id); return sessions.get(id) } },
  }
}

gate('a disabled, absent or non-true spec resolves to null and an enabled spec does not', () => {
  assert(resolveClusterConfig(undefined, { radius: RADIUS }, policy) === null, 'absent spec did not resolve to null')
  assert(resolveClusterConfig({ enabled: false }, { radius: RADIUS }, policy) === null, 'disabled spec did not resolve to null')
  assert(resolveClusterConfig({ enabled: 'true' }, { radius: RADIUS }, policy) === null, 'string enabled was accepted')
  assert(resolveClusterConfig({ enabled: 1 }, { radius: RADIUS }, policy) === null, 'numeric enabled was accepted')
  assert(resolve({}) !== null, 'control: an enabled spec resolved to null')
})

gate('a radius that is not a positive finite number is refused before any limit is checked', () => {
  refusesEach('cluster-needs-planet-radius', [0, -1, NaN, Infinity, '6371000', undefined, null], (radius) => [{}, { radius }])
  assert(resolve({}, { radius: RADIUS }).radius === RADIUS, 'control: the planet radius was refused')
})

gate('a relevance radius that is not a positive finite number is refused', () => {
  refusesEach('cluster-relevance-radius-not-positive-finite', [0, -5, NaN, Infinity, '200'], (relevanceRadius) => [{}, { radius: RADIUS, relevanceRadius }])
  assert(resolve({}, { radius: RADIUS, relevanceRadius: 200 }).linkM === CLUSTER_DEFAULT_LINK_M, 'control: relevance radius 200 was refused')
})

gate('a weapon range that is not a finite non-negative number is refused and zero is accepted', () => {
  refusesEach('cluster-weapon-range-not-finite', [-1, NaN, Infinity, '0'], (maxWeaponRangeM) => [{}, { radius: RADIUS, maxWeaponRangeM }])
  assert(resolve({}, { radius: RADIUS, maxWeaponRangeM: 0 }) !== null, 'control: weapon range 0 was refused')
})

gate('anchorsPerFace must be an integer of at least one, and the policy supplies the default', () => {
  refusesEach('cluster-anchors-per-face-below-one', [0, -1, 1.5, '8', NaN, Infinity], (anchorsPerFace) => [{ anchorsPerFace }])
  assert(resolve({ anchorsPerFace: 1, memberRadiusM: 1000 }).anchorsPerFace === 1, 'control: anchorsPerFace 1 was refused')
  assert(resolve({}).anchorsPerFace === policy.anchorsPerFace, 'default anchorsPerFace did not come from the policy')
})

gate('a member radius that is set must be a positive finite number, and an unset one takes the lattice default', () => {
  refusesEach('cluster-member-radius-not-positive-finite', [0, -1, NaN, '5', Infinity], (memberRadiusM) => [{ memberRadiusM }])
  assert(resolve({ memberRadiusM: null }).memberRadiusM !== null, 'control: a null member radius was refused instead of defaulting')
  assert(resolve({ memberRadiusM: 1000 }).memberRadiusM === 1000, 'control: member radius 1000 was not kept')
})

gate('a link shorter than the relevance ring reach is refused at the exact boundary', () => {
  const ring = 200 * CLUSTER_RELEVANCE_RING_CELLS
  assert(ring === 600, 'the ring reach for relevance radius 200 is not 600')
  assert(refusedAs(() => resolve({ linkM: 599 }), 'cluster-link-below-relevance-ring'), 'link 599 under a 600 m ring was accepted')
  assert(resolve({ linkM: 600 }).linkM === 600, 'control: link 600 at a 600 m ring was refused')
  assert(resolve({}, { radius: RADIUS, relevanceRadius: 300 }).linkM === CLUSTER_DEFAULT_LINK_M, 'control: default link 1000 under a 900 m ring was refused')
  assert(refusedAs(() => resolve({}, { radius: RADIUS, relevanceRadius: 340 }), 'cluster-link-below-relevance-ring'), 'default link 1000 under a 1020 m ring was accepted')
})

gate('a link shorter than the longest weapon range is refused at the exact boundary', () => {
  assert(resolve({}, { radius: RADIUS, maxWeaponRangeM: 1000 }).linkM === 1000, 'control: weapon range equal to the link was refused')
  assert(refusedAs(() => resolve({}, { radius: RADIUS, maxWeaponRangeM: 1001 }), 'cluster-link-below-weapon-range'), 'weapon range 1001 over a 1000 m link was accepted')
})

gate('a stay radius plus the anchor error at or past the walkable limit is refused', () => {
  assert(refusedAs(() => resolve({ memberRadiusM: 0.9 * RADIUS }), 'cluster-radius-exceeds-walkable-chart'), 'a 0.9 R stay radius was accepted')
  assert(resolve({ memberRadiusM: 0.5 * RADIUS }).memberRadiusM === 0.5 * RADIUS, 'control: a 0.5 R stay radius was refused')
  assert(resolve({}) !== null, 'control: the default member radius was refused')
})

gate('the cadence hz must lie in 0.5 to 10 inclusive and defaults to 2.05', () => {
  refusesEach('cluster-cadence-out-of-range', [0.49, 10.01, NaN], (hz) => [{ hz }])
  assert(resolve({ hz: 0.5 }).hz === 0.5, 'control: hz 0.5 was refused')
  assert(resolve({ hz: 10 }).hz === 10, 'control: hz 10 was refused')
  assert(resolve({}).hz === CLUSTER_DEFAULT_HZ, 'default hz is not 2.05')
})

gate('maxWorldsPerProcess is bounded by the heap ceiling that the injected Jolt limits give', () => {
  assert(heapWorldCeiling(jolt) === 4, `the heap ceiling for the injected limits is ${heapWorldCeiling(jolt)}, not 4`)
  assert(resolve({}).maxWorlds === 4, 'the default maxWorlds is not the injected heap ceiling')
  refusesEach('cluster-worlds-exceed-wasm-heap-budget', [0, 5, 1.5, '2', NaN], (maxWorldsPerProcess) => [{ maxWorldsPerProcess }])
  assert(resolve({ maxWorldsPerProcess: 1 }).maxWorlds === 1, 'control: maxWorldsPerProcess 1 was refused')
  assert(resolve({ maxWorldsPerProcess: 4 }).maxWorlds === 4, 'control: maxWorldsPerProcess at the ceiling was refused')
})

gate('the heap ceiling formula responds to each injected limit and floors the quotient', () => {
  assert(heapWorldCeiling({ ...jolt, residentBytes: 0 }) === 5, 'dropping the resident bytes did not raise the ceiling to 5')
  assert(heapWorldCeiling({ ...jolt, mirrorReserve: 0 }) === 5, 'dropping the mirror reserve did not raise the ceiling to 5')
  assert(heapWorldCeiling({ ...jolt, reserveFraction: 0 }) === 5, 'a zero reserve fraction did not raise the ceiling to 5')
  assert(Number.isInteger(heapWorldCeiling(jolt)), 'the heap ceiling is not an integer')
})

gate('a resolved config carries the lattice, the worst cell angle, the policy factors and the defaults', () => {
  const cfg = resolve({})
  assert(cfg.radius === RADIUS && cfg.anchorsPerFace === 8, 'radius or anchorsPerFace not kept')
  assert(JSON.stringify(cfg.lattice) === JSON.stringify({ radius: RADIUS, anchorsPerFace: 8 }), 'the lattice was not built from the policy')
  near(cfg.cellWorstDeg, 5.625, 'cellWorstDeg')
  near(cfg.memberRadiusM, RADIUS * Math.sin(5.625 * Math.PI / 180), 'default memberRadiusM')
  assert(cfg.linkM === 1000 && cfg.hz === 2.05 && cfg.maxWorlds === 4, 'linkM, hz or maxWorlds defaults are wrong')
  assert(cfg.hysteresisDeg === 2.5 && cfg.stayFactor === 1 && cfg.joinFactor === 0.5, 'policy hysteresis or factors not kept')
  assert(cfg.idleGraceMs === CLUSTER_DEFAULT_IDLE_GRACE_MS, 'idleGraceMs default is not 5000')
})

gate('spec fields override every default they name', () => {
  const cfg = resolve({ hysteresisDeg: 3, idleGraceMs: 250, hz: 4, linkM: 1500, anchorsPerFace: 4, maxWorldsPerProcess: 2 })
  assert(cfg.hysteresisDeg === 3 && cfg.idleGraceMs === 250, 'hysteresisDeg or idleGraceMs override did not win')
  assert(cfg.hz === 4 && cfg.linkM === 1500 && cfg.maxWorlds === 2, 'hz, linkM or maxWorlds override did not win')
  assert(cfg.anchorsPerFace === 4, 'anchorsPerFace override did not win')
  near(cfg.cellWorstDeg, 11.25, 'cellWorstDeg at 4 anchors per face')
})

gate('the exported defaults keep the spoint values 1000 m, 2.05 Hz, 5000 ms and a 3-cell ring', () => {
  assert(CLUSTER_DEFAULT_LINK_M === 1000, 'CLUSTER_DEFAULT_LINK_M is not 1000')
  assert(CLUSTER_DEFAULT_HZ === 2.05, 'CLUSTER_DEFAULT_HZ is not 2.05')
  assert(CLUSTER_DEFAULT_IDLE_GRACE_MS === 5000, 'CLUSTER_DEFAULT_IDLE_GRACE_MS is not 5000')
  assert(CLUSTER_RELEVANCE_RING_CELLS === 3, 'CLUSTER_RELEVANCE_RING_CELLS is not 3')
  assert(CLUSTER_DEFAULT_LINK_M !== 1001, 'control: the link default is not pinned')
})

gate('ClusterConfigError carries its name, its code, and a message that leads with the code', () => {
  const err = new ClusterConfigError('cluster-link-below-relevance-ring', 'short')
  assert(err instanceof Error && err.name === 'ClusterConfigError', 'the error is not a named Error')
  assert(err.code === 'cluster-link-below-relevance-ring', 'the code was not kept')
  assert(err.message === 'cluster-link-below-relevance-ring: short', 'the message does not lead with the code')
  assert(err.code !== 'cluster-cadence-out-of-range', 'control: two codes compare equal')
})

gate('declaredWeaponRangeM takes the longest of the world, the combat config and the entity ranges', () => {
  assert(declaredWeaponRangeM({ maxWeaponRangeM: 500 }) === 500, 'a world maxWeaponRangeM was not returned')
  assert(declaredWeaponRangeM({}) === 0, 'an empty world did not declare zero range')
  assert(declaredWeaponRangeM({ maxWeaponRangeM: 2000, players: { behaviours: { combat: { config: { range: 1200 } } } } }) === 2000, 'a longer world range did not win over combat')
  assert(declaredWeaponRangeM({ players: { behaviours: { combat: { config: { range: 1200 } } } } }) === 1200, 'a combat config range was not used')
  assert(declaredWeaponRangeM({ players: { behaviours: { combat: {} } } }) === DEFAULT_COMBAT.range, 'a combat behaviour with no config did not use the default range')
  assert(declaredWeaponRangeM({ players: { behaviours: { combat: { config: { range: 'far' } } } } }) === DEFAULT_COMBAT.range, 'a non-number combat range was used')
})

gate('declaredWeaponRangeM reads an entity range from its app editorProps, the entity config, or the app default', () => {
  const appDefs = new Map([
    ['gun', { server: { editorProps: [{ key: 'range', default: 1500 }] } }],
    ['bow', { editorProps: [{ key: 'range', default: 300 }] }],
  ])
  assert(declaredWeaponRangeM({ entities: [{ app: 'gun' }] }, appDefs) === 1500, 'a server editorProps default was not read')
  assert(declaredWeaponRangeM({ entities: [{ app: 'bow' }] }, appDefs) === 300, 'a top-level editorProps default was not read')
  assert(declaredWeaponRangeM({ entities: [{ app: 'gun', config: { range: 1800 } }] }, appDefs) === 1800, 'an entity config range did not win')
  assert(declaredWeaponRangeM({ entities: [{ app: 'gun', config: { range: 'x' } }] }, appDefs) === 1500, 'a non-number entity range was used')
  assert(declaredWeaponRangeM({ entities: [{ app: 'gun' }] }) === 0, 'an entity with no appDefs contributed a range')
})

gate('the cluster config module imports only the combat defaults and no Jolt or chart module', () => {
  assert(JSON.stringify(importsOf(sourceOf(CONFIG_SOURCE))) === JSON.stringify(ALLOWED_CONFIG_IMPORTS), 'clusterConfig.js imports something other than the combat defaults')
  const probe = "import { DEFAULT_JOLT_LIMITS } from '../physics/joltLimits.js'\n"
  assert(JSON.stringify(importsOf(probe)) !== JSON.stringify(ALLOWED_CONFIG_IMPORTS), 'control: a Jolt import was not seen by the import scan')
})

gate('the cluster config exports no Jolt constant and no heap-ceiling constant', () => {
  const names = Object.keys(clusterConfig)
  const joltCoupled = /JOLT|CLUSTER_HEAP|CLUSTER_SERVER/
  assert(!names.some((name) => joltCoupled.test(name)), `a Jolt-coupled export is present: ${names.join(', ')}`)
  assert(joltCoupled.test('JOLT_WASM_HEAP_BYTES'), 'control: the Jolt name pattern does not match a Jolt constant')
  assert(names.includes('heapWorldCeiling'), 'control: the injected ceiling function is not exported')
})

gate('the port sources carry no comment markers', () => {
  for (const path of [CONFIG_SOURCE, SESSION_SOURCE]) {
    assert(!hasComment(sourceOf(path)), `${path} contains a comment marker`)
  }
  assert(hasComment('const a = 1 // note'), 'control: a line comment was not detected')
})

gate('parsePlayerIdOfSession returns the player whose client holds the session token', () => {
  const server = serverWith([{ id: 3 }, { id: 7 }], new Map([
    [3, { sessionToken: TOKEN_A }],
    [7, { sessionToken: TOKEN_B }],
  ]))
  assert(JSON.stringify(parsePlayerIdOfSession(server, TOKEN_A)) === JSON.stringify({ ok: true, clusterLocalPlayerId: 3, sessionToken: TOKEN_A }), 'token A did not resolve to player 3')
  assert(parsePlayerIdOfSession(server, TOKEN_B).clusterLocalPlayerId === 7, 'control: token B did not resolve to player 7')
})

gate('a well-formed token that no connected client holds is refused as not joined', () => {
  const server = serverWith([{ id: 3 }], new Map([[3, { sessionToken: TOKEN_A }]]))
  const result = parsePlayerIdOfSession(server, TOKEN_C)
  assert(result.ok === false && result.reason === 'handoff-session-not-joined', 'an unjoined token was not refused as not joined')
  assert(result.sessionToken === TOKEN_C, 'the refusal did not echo the parsed token')
  assert(parsePlayerIdOfSession(server, TOKEN_A).ok === true, 'control: a joined token was refused')
})

gate('a malformed string token is refused with the token echoed, and a non-string token echoes null', () => {
  const server = serverWith([{ id: 3 }], new Map([[3, { sessionToken: TOKEN_A }]]))
  const upper = parsePlayerIdOfSession(server, TOKEN_A.toUpperCase())
  assert(upper.ok === false && upper.reason === 'session-token-malformed', 'an uppercase token was accepted')
  assert(upper.sessionToken === TOKEN_A.toUpperCase(), 'the malformed string was not echoed')
  const numeric = parsePlayerIdOfSession(server, 42)
  assert(numeric.reason === 'session-token-malformed' && numeric.sessionToken === null, 'a numeric token did not refuse with a null echo')
  assert(parsePlayerIdOfSession(server, TOKEN_A).ok === true, 'control: a lowercase 32-hex token was refused')
})

gate('a null or missing token is refused as malformed without consulting any client', () => {
  const server = serverWith([{ id: 3 }], new Map([[3, { sessionToken: TOKEN_A }]]))
  for (const token of [null, undefined]) {
    const result = parsePlayerIdOfSession(server, token)
    assert(result.reason === 'session-token-malformed' && result.sessionToken === null, `token ${String(token)} was not refused as malformed`)
  }
  assert(server.calls.length === 0, 'a null token still consulted the connections')
  parsePlayerIdOfSession(server, TOKEN_A)
  assert(server.calls.length > 0, 'control: a valid token did not consult the connections')
})

gate('parsePlayerIdOfSession only reads the server and leaves its players and connections unchanged', () => {
  const players = [{ id: 3 }, { id: 7 }]
  const server = serverWith(players, new Map([[3, { sessionToken: TOKEN_A }], [7, { sessionToken: TOKEN_B }]]))
  const before = JSON.stringify(players)
  parsePlayerIdOfSession(server, TOKEN_B)
  assert(JSON.stringify(players) === before, 'the players were changed by the lookup')
  assert(JSON.stringify(server.calls) === JSON.stringify([3, 7]), 'the lookup did not scan both players in order before the match')
  assert(server.calls.length === 2, 'control: the scan visited a player count other than the two present')
})

gate('the session parser imports only the sharding barrel and no chart or protocol module', () => {
  assert(JSON.stringify(importsOf(sourceOf(SESSION_SOURCE))) === JSON.stringify(ALLOWED_SESSION_IMPORTS), 'clusterSession.js imports something other than the sharding barrel')
  assert(JSON.stringify(importsOf("import { MSG } from '../protocol/MessageTypes.js'\n")) !== JSON.stringify(ALLOWED_SESSION_IMPORTS), 'control: a protocol import was not seen by the import scan')
})

gate('the session codes equal the sharding constants they reuse', () => {
  assert(sharding.HANDOFF_SESSION_NOT_JOINED === 'handoff-session-not-joined', 'sharding HANDOFF_SESSION_NOT_JOINED changed')
  assert(sharding.SESSION_TOKEN_MALFORMED === 'session-token-malformed', 'sharding SESSION_TOKEN_MALFORMED changed')
  assert(!('parsePlayerIdOfSession' in sharding), 'the sharding barrel already exports parsePlayerIdOfSession, so this port duplicates it')
  assert('parseSessionToken' in sharding, 'control: the sharding barrel no longer exports parseSessionToken')
})

gate('the sharding barrel already exports the cluster-local id parser and handoff error that this port does not copy', () => {
  assert(typeof sharding.parseClusterLocalPlayerId === 'function', 'parseClusterLocalPlayerId is not exported by sharding')
  assert(typeof sharding.ClusterHandoffError === 'function', 'ClusterHandoffError is not exported by sharding')
  assert(!('parseClusterLocalPlayerId' in clusterConfig) && !('ClusterHandoffError' in clusterConfig), 'the cluster config port re-exports a sharding handoff name')
  assert('parseClusterLocalPlayerId' in sharding, 'control: the sharding parser is not reachable from the barrel')
})

finish()
