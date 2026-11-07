import { gate, finish } from './lib/gate.mjs'
import {
  DEFAULT_CELL_SIZE, DEFAULT_GHOST_MARGIN,
  REGION_COORDS_NOT_FINITE, REGION_CELL_SIZE_NOT_POSITIVE, REGION_ID_MALFORMED,
  parseRegionCoords, regionIdFor, parseRegionId, regionBoundsWithGhost, authoritativeRegionFor,
  MESSAGE_TYPE_UNKNOWN, WORKER_REFUSED, CLIENT_CONNECT_REFUSED, HANDOFF_REFUSED, ROUTER_PLAYER_ID_MALFORMED,
  messageRefusal, messageTable, dispatchMessage, errorRefusal, refusalText, routerPlayerIdRefusal,
  ClientConnectRefusedError, RegionWorkerRefusedError, RegionSiblingRefusedError,
  parseRouterPlayerId, parseLocalPlayerId, parseSessionToken, LOCAL_PLAYER_ID_MALFORMED, SESSION_TOKEN_MALFORMED,
  playerIdentity, handoffTo, regionForSpawnPoint, HANDOFF_IDLE, PLAYER_IDENTITY_UNMINTED, HANDOFF_UNKNOWN_PLAYER,
  beginHandoff, acceptHandoff, refuseHandoff, abandonHandoffsTo, handoffAcceptanceRefusal,
  parseClusterLocalPlayerId, ClusterHandoffError, CLUSTER_LOCAL_PLAYER_ID_MALFORMED
} from '../src/sharding/index.js'

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const throwsWithCode = (fn, code) => {
  try {
    fn()
  } catch (error) {
    return error.code === code
  }
  return false
}

const refusedWith = (result, reason) => result.ok === false && result.reason === reason

const mulberry32 = (state) => () => {
  state = (state + 0x6d2b79f5) | 0
  let t = Math.imul(state ^ (state >>> 15), 1 | state)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const regionTable = (cellSize, extent) => {
  const reach = Math.ceil(extent / cellSize) + 1
  const table = []
  for (let rx = -reach; rx < reach; rx++) {
    for (let rz = -reach; rz < reach; rz++) {
      const id = `${rx},${rz}`
      table.push({ id, bounds: regionBoundsWithGhost(id, cellSize, 0) })
    }
  }
  return table
}

const containingRegions = (table, x, z) =>
  table
    .filter(({ bounds }) => x >= bounds.minX && x < bounds.maxX && z >= bounds.minZ && z < bounds.maxZ)
    .map(({ id }) => id)

const TOKEN = 'a'.repeat(32)
const OTHER_TOKEN = 'b'.repeat(32)

const FIXED_CELLS = [
  [0, 0, 512, '0,0'],
  [511.5, 0, 512, '0,0'],
  [512, 0, 512, '1,0'],
  [-0.5, -0.5, 512, '-1,-1'],
  [-512, -512, 512, '-1,-1'],
  [-512.000001, 0, 512, '-2,0'],
  [1000, -1000, 512, '1,-2'],
  [250, 350, 100, '2,3'],
  [3, 7, 1, '3,7'],
  [-0, 0, 512, '0,0'],
  [0.3, 0, 0.1, '2,0']
]

gate('grid cell index matches the spoint floor arithmetic on fixed points', () => {
  for (const [x, z, cellSize, expected] of FIXED_CELLS) {
    const floorIndex = `${Math.floor(x / cellSize)},${Math.floor(z / cellSize)}`
    assert(floorIndex === expected, 'oracle disagrees for ' + [x, z, cellSize] + ': ' + floorIndex)
    assert(regionIdFor(x, z, cellSize) === expected, 'regionIdFor(' + [x, z, cellSize] + ') is not ' + expected)
    assert(authoritativeRegionFor(x, z, cellSize) === expected, 'authoritativeRegionFor(' + [x, z, cellSize] + ') is not ' + expected)
  }
})

gate('the cell bounds of a fixed point contain that point', () => {
  for (const [x, z, cellSize, expected] of FIXED_CELLS) {
    const b = regionBoundsWithGhost(expected, cellSize, 0)
    assert(x >= b.minX && x < b.maxX && z >= b.minZ && z < b.maxZ, 'bounds of ' + expected + ' do not contain ' + [x, z])
  }
})

gate('spoint constants and ghost margin widen the cell bounds', () => {
  assert(DEFAULT_CELL_SIZE === 512 && DEFAULT_GHOST_MARGIN === 32, 'default cell size or ghost margin differs from spoint')
  const widened = regionBoundsWithGhost('1,-2')
  assert(widened.minX === 480 && widened.maxX === 1056 && widened.minZ === -1056 && widened.maxZ === -480, 'widened bounds ' + JSON.stringify(widened))
  const bare = regionBoundsWithGhost('1,-2', 512, 0)
  assert(bare.minX === 512 && bare.maxX === 1024 && bare.minZ === -1024 && bare.maxZ === -512, 'bare bounds ' + JSON.stringify(bare))
})

gate('the router picks the region a brute-force containment scan picks on a seeded set', () => {
  const random = mulberry32(49)
  const extent = 3000
  for (const cellSize of [512, 100, 64]) {
    const table = regionTable(cellSize, extent)
    for (let i = 0; i < 1500; i++) {
      const x = (random() * 2 - 1) * extent
      const z = (random() * 2 - 1) * extent
      const routed = regionForSpawnPoint([x, 5, z], cellSize)
      assert(routed.ok === true, 'finite spawn point refused at ' + [x, z])
      const hits = containingRegions(table, x, z)
      assert(hits.length === 1, 'brute force found ' + hits.length + ' regions for ' + [x, z, cellSize])
      assert(routed.regionId === hits[0], 'router chose ' + routed.regionId + ' but scan chose ' + hits[0] + ' for ' + [x, z, cellSize])
    }
  }
})

gate('a point on a cell border lands in the upper cell, as the spoint rule says', () => {
  const table = regionTable(512, 2048)
  const border = [
    [512, 0, '1,0'],
    [-512, 0, '-1,0'],
    [0, 1024, '0,2'],
    [0, 0, '0,0']
  ]
  for (const [x, z, expected] of border) {
    const hits = containingRegions(table, x, z)
    assert(hits.length === 1 && hits[0] === expected, 'scan puts ' + [x, z] + ' in ' + hits.join(' ') + ', expected ' + expected)
    assert(regionForSpawnPoint([x, 5, z]).regionId === expected, 'router puts ' + [x, z] + ' outside ' + expected)
  }
  const justBelow = regionForSpawnPoint([511.999999, 5, 0])
  assert(justBelow.regionId === '0,0', 'a point just below the border left the lower cell')
  assert(regionForSpawnPoint([512, 5, 0]).regionId !== '0,0', 'the border point was kept in the lower cell')
})

gate('non-finite coordinates and non-positive cell sizes are refused with their reason', () => {
  assert(refusedWith(parseRegionCoords(NaN, 0), REGION_COORDS_NOT_FINITE), 'NaN x was accepted')
  assert(refusedWith(parseRegionCoords(0, Infinity), REGION_COORDS_NOT_FINITE), 'infinite z was accepted')
  assert(refusedWith(parseRegionCoords(0, 0, 0), REGION_CELL_SIZE_NOT_POSITIVE), 'zero cell size was accepted')
  assert(refusedWith(parseRegionCoords(0, 0, -512), REGION_CELL_SIZE_NOT_POSITIVE), 'negative cell size was accepted')
  assert(refusedWith(parseRegionCoords(0, 0, NaN), REGION_CELL_SIZE_NOT_POSITIVE), 'NaN cell size was accepted')
  assert(parseRegionCoords(0, 0).ok === true, 'control point was refused')
})

gate('a spawn point that mints no region is refused by the router', () => {
  for (const point of [undefined, null, [NaN, 5, 0], [0, 5, NaN], [Infinity, 5, 0]]) {
    assert(regionForSpawnPoint(point).ok === false, 'spawn point ' + JSON.stringify(point) + ' minted a region')
  }
  assert(regionForSpawnPoint([0, 5, 0]).ok === true, 'control spawn point was refused')
})

gate('a malformed region id is refused with its reason', () => {
  for (const id of ['1.5,2', '1,2,3', 'a,b', '', '7', 7, null, ' 1,2']) {
    assert(refusedWith(parseRegionId(id), REGION_ID_MALFORMED), 'region id ' + JSON.stringify(id) + ' was accepted')
  }
  const parsed = parseRegionId('-3,12')
  assert(parsed.ok === true && parsed.rx === -3 && parsed.rz === 12, 'control region id was refused')
  assert(throwsWithCode(() => regionBoundsWithGhost('x'), REGION_ID_MALFORMED), 'bounds of a malformed id did not carry its code')
})

gate('every refusal carries its code', () => {
  assert(throwsWithCode(() => regionIdFor(NaN, 0), REGION_COORDS_NOT_FINITE), 'regionIdFor did not carry the coords code')
  const cellErr = (() => {
    try {
      regionIdFor(0, 0, 0)
    } catch (error) {
      return error
    }
    return null
  })()
  assert(cellErr && cellErr.code === REGION_CELL_SIZE_NOT_POSITIVE, 'regionIdFor did not carry the cell size code')
  assert(cellErr.code !== REGION_COORDS_NOT_FINITE, 'cell size refusal carries the coords code')

  const refusal = messageRefusal('SOME_CODE', { a: 1 })
  assert(refusal.ok === false && refusal.code === 'SOME_CODE' && refusal.detail.a === 1, 'messageRefusal dropped its code')

  const table = messageTable([['known', (msg, arg) => arg + 1]])
  const unknown = dispatchMessage(table, { type: 'nope' }, 0)
  assert(unknown.ok === false && unknown.code === MESSAGE_TYPE_UNKNOWN && unknown.detail.type === 'nope', 'unknown type not refused with its code')
  const known = dispatchMessage(table, { type: 'known' }, 41)
  assert(known.ok === true && known.value === 42, 'known type was not dispatched')

  const plain = errorRefusal(cellErr)
  assert(plain.code === REGION_CELL_SIZE_NOT_POSITIVE && plain.name === 'Error', 'errorRefusal dropped the code')
  assert(errorRefusal(new Error('x')).code === null, 'errorRefusal invented a code')
  assert(refusalText({ name: 'X', code: 'Y', error: 'z' }) === 'X Y: z', 'refusalText format changed')

  const worker = new RegionWorkerRefusedError('1,0', { code: 'c' })
  assert(worker.code === 'region-worker-refused' && worker.spointRefused === true && worker.regionId === '1,0', 'worker refusal fields')
  const sibling = new RegionSiblingRefusedError('1,0', '0,0')
  assert(sibling.code === 'region-sibling-refused' && sibling.spointRefused === false && sibling.refusedRegionId === '0,0', 'sibling refusal fields')
  const connect = new ClientConnectRefusedError(CLIENT_CONNECT_REFUSED, 'boom')
  assert(connect.code === 'CLIENT_CONNECT_REFUSED' && connect.spointRefused === true && connect.error === 'boom', 'connect refusal fields')

  assert(routerPlayerIdRefusal(0).code === ROUTER_PLAYER_ID_MALFORMED, 'router player id refusal default code')
  assert(routerPlayerIdRefusal(0, 'X').code === 'X', 'router player id refusal custom code')
  assert(WORKER_REFUSED === 'WORKER_REFUSED' && HANDOFF_REFUSED === 'HANDOFF_REFUSED', 'refusal constants differ from spoint')
})

gate('ids and session tokens parse only in their spoint shape', () => {
  for (const value of [0, 1.5, '1', -1, null]) {
    assert(refusedWith(parseRouterPlayerId(value), ROUTER_PLAYER_ID_MALFORMED), 'router player id ' + JSON.stringify(value) + ' was accepted')
  }
  assert(parseRouterPlayerId(1).routerPlayerId === 1, 'control router player id was refused')
  for (const value of [-1, 2.5, '0']) {
    assert(refusedWith(parseLocalPlayerId(value), LOCAL_PLAYER_ID_MALFORMED), 'local player id ' + JSON.stringify(value) + ' was accepted')
  }
  assert(parseLocalPlayerId(0).localPlayerId === 0, 'control local player id was refused')
  for (const value of ['A'.repeat(32), 'a'.repeat(31), 'a'.repeat(33), 'g'.repeat(32), 5]) {
    assert(refusedWith(parseSessionToken(value), SESSION_TOKEN_MALFORMED), 'session token ' + JSON.stringify(value) + ' was accepted')
  }
  assert(parseSessionToken(TOKEN).sessionToken === TOKEN, 'control session token was refused')
  assert(parseSessionToken(null).sessionToken === null && parseSessionToken(undefined).sessionToken === null, 'absent session token was not null')
})

gate('handoff targets and identities are refused when malformed', () => {
  assert(handoffTo('bad', '0,0', 1) === null, 'malformed target region was accepted')
  assert(handoffTo('1,0', 'bad', 1) === null, 'malformed source region was accepted')
  assert(handoffTo('1,0', '0,0', -1) === null, 'negative local id was accepted')
  assert(handoffTo('1,0', '0,0', 1.5) === null, 'fractional local id was accepted')
  assert(handoffTo('1,0', '0,0', 3) !== null, 'control handoff was refused')
  assert(playerIdentity('x', 7) === null && playerIdentity('1,0', -2) === null, 'malformed identity was accepted')
  assert(playerIdentity('1,0', 2).localPlayerId === 2, 'control identity was refused')
})

gate('a handoff moves idle, in flight, then idle again through accept, refuse and abandon', () => {
  const player = { handoff: HANDOFF_IDLE, region: '0,0', localPlayerId: 3, sessionToken: null }
  assert(player.handoff === HANDOFF_IDLE, 'a new player is not idle')

  const outbound = handoffTo('1,0', '0,0', 3)
  assert(beginHandoff(player, outbound) === true && player.handoff === outbound, 'begin did not put the player in flight')
  const identity = playerIdentity('1,0', 7)
  const token = parseSessionToken(TOKEN)
  assert(handoffAcceptanceRefusal({ player }, identity, token) === null, 'a valid acceptance was refused')
  acceptHandoff(player, identity, token.sessionToken)
  assert(player.handoff === HANDOFF_IDLE, 'accept did not return the player to idle')
  assert(player.region === '1,0' && player.localPlayerId === 7 && player.sessionToken === TOKEN, 'accept did not record the new identity')

  const second = handoffTo('2,0', '1,0', 7)
  assert(beginHandoff(player, second) === true, 'a second handoff was refused after the first completed')
  refuseHandoff(player)
  assert(player.handoff === HANDOFF_IDLE && player.region === '1,0', 'refuse did not return to idle or changed the region')

  const third = handoffTo('2,0', '1,0', 7)
  const other = { handoff: null, region: '0,0', localPlayerId: 1, sessionToken: null }
  beginHandoff(player, third)
  beginHandoff(other, handoffTo('3,0', '0,0', 1))
  const abandoned = abandonHandoffsTo([player, other], '2,0')
  assert(abandoned.length === 1 && abandoned[0] === player, 'abandon did not pick the player bound for the lost region')
  assert(player.handoff === HANDOFF_IDLE, 'abandoned player is not idle')
  assert(other.handoff !== null && other.handoff.toRegion === '3,0', 'abandon touched a player bound elsewhere')
})

gate('an out-of-order handoff step is refused and leaves the first handoff in place', () => {
  const player = { handoff: HANDOFF_IDLE, region: '0,0', localPlayerId: 3, sessionToken: null }
  const first = handoffTo('1,0', '0,0', 3)
  const second = handoffTo('0,1', '0,0', 3)
  assert(beginHandoff(player, first) === true, 'first begin was refused')
  assert(beginHandoff(player, second) === false, 'a begin while a handoff is in flight was accepted')
  assert(player.handoff === first, 'the refused begin replaced the handoff in flight')

  const identity = playerIdentity('1,0', 7)
  assert(handoffAcceptanceRefusal(null, identity, parseSessionToken(TOKEN)) === HANDOFF_UNKNOWN_PLAYER, 'acceptance for an unknown player was not refused with its code')
  assert(handoffAcceptanceRefusal({ player }, null, parseSessionToken(TOKEN)) === PLAYER_IDENTITY_UNMINTED, 'acceptance without an identity was not refused with its code')
  assert(handoffAcceptanceRefusal({ player }, identity, parseSessionToken('XYZ')) === SESSION_TOKEN_MALFORMED, 'acceptance with a bad token was not refused with its code')
  assert(handoffAcceptanceRefusal(null, null, parseSessionToken('XYZ')) === SESSION_TOKEN_MALFORMED, 'a bad token did not take precedence over an unknown player')
  assert(handoffAcceptanceRefusal({ player }, identity, parseSessionToken(OTHER_TOKEN)) === null, 'control acceptance was refused')
})

gate('cluster-local player ids are refused unless they are non-negative integers', () => {
  for (const value of [-1, 1.5, '3', undefined]) {
    assert(refusedWith(parseClusterLocalPlayerId(value), CLUSTER_LOCAL_PLAYER_ID_MALFORMED), 'cluster-local id ' + String(value) + ' was accepted')
  }
  assert(parseClusterLocalPlayerId(4).clusterLocalPlayerId === 4, 'control cluster-local id was refused')
  assert(parseClusterLocalPlayerId(undefined).value === null, 'refusal did not record a null value')
})

gate('a cluster handoff error carries its code and its code leads its message', () => {
  const err = new ClusterHandoffError('handoff-session-not-joined', 'no player')
  assert(err.code === 'handoff-session-not-joined' && err.name === 'ClusterHandoffError', 'cluster handoff error fields')
  assert(err.message === 'handoff-session-not-joined: no player', 'cluster handoff error message')
})

finish()
