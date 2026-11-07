import { deepStrictEqual, ok, strictEqual, throws, notStrictEqual } from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { gate, finish } from './lib/gate.mjs'
import { mintPlayerOwner, playerIdOf, isPlayerOwner, UNBOUND_OWNER } from '../src/sessions-pure/playerOwner.js'
import { SessionStore, randomHex16 } from '../src/sessions-pure/sessionStore.js'
import { spawnSurfaceY, columnSurfaces } from '../src/sessions-pure/spawnSurface.js'
import { resolveTarget, latLonToDir, dirToLatLon, parseDir3, angleFromAnchorDeg, dirToLocalXZ, DEFAULT_CLEARANCE_M, MAX_CLEARANCE_M, MAX_ABS_COORD_M } from '../src/sessions-pure/relocationTarget.js'
import { beginTeleportHold, stepTeleportHold, TELEPORT_HOLD_MAX_MS } from '../src/sessions-pure/teleportHold.js'
import {
  SPAWN_HOLD_REASON, SPAWN_CLEARANCE, SPAWN_HOLD_MAX_MS, SPAWN_HOLD_MOVED_EPS,
  snapToGround, probeSpawnHoldGround, probeSpawnGroundY, spawnClearanceM, rankSpawnPointsByWalkingRoom,
  groundSnapSpawnPoint, resolveSpawnPointOnGround, holdReasonText, movedDuringHold, probeGround,
  teleportTarget, teleportPosition,
} from '../src/sessions-pure/relocation.js'
import {
  admitFirstMessage, migratePeekGraceMs, isSessionTokenShape, smoothRtt, heartbeatAckPayload,
  reconnectRestore, isValidTrimeshPayload, isServerOnlyAppEvent, voiceIdentityPubkey, createWarnThrottle,
  SOCKET_ADMISSION, ADMISSION_REFUSAL, MAX_TRACKED_RTT_MS,
} from '../src/sessions-pure/connectionHandlers.js'
import { MSG } from '../src/protocol/messages.js'
import { pack } from '../src/protocol/msgpack.js'

const T0 = 10000

const fixedClock = (start = 0) => {
  let t = start
  return { now: () => t, set: (v) => { t = v } }
}

const deterministicFill = (bytes) => { for (let i = 0; i < bytes.length; i++) bytes[i] = i }

const sequenceFill = () => {
  let call = 0
  return (bytes) => {
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i + call) & 255
    call++
  }
}

const ground = (groundY, walls = () => null) => {
  const raycast = (origin, dir, length) => {
    if (dir[1] < 0) {
      const distance = origin[1] - groundY
      if (distance < 0 || distance > length) return { hit: false }
      return { hit: true, position: [origin[0], groundY, origin[2]], normal: [0, 1, 0], distance }
    }
    if (dir[1] === 0) {
      const d = walls(origin, dir)
      if (d !== null && d <= length) {
        return { hit: true, position: [origin[0] + dir[0] * d, origin[1], origin[2] + dir[2] * d], normal: [-dir[0], 0, -dir[2]], distance: d }
      }
    }
    return { hit: false }
  }
  return Object.assign(raycast, { raycast })
}

const noRay = { hit: false }
const integration = { standingCentreY: (y) => y + 1, config: { capsuleRadius: 0 } }
const groundCtx = (extra = {}) => ({ physics: { raycast: ground(0) }, physicsIntegration: integration, ...extra })
const emptyCtx = (extra = {}) => ({ physics: { raycast: () => noRay }, physicsIntegration: integration, ...extra })
const noPhysicsCtx = (extra = {}) => ({ physics: {}, physicsIntegration: integration, ...extra })

const stackedSurfaces = (ys) => ({
  raycast(origin, dir, length) {
    const y = ys.find(v => v <= origin[1] && origin[1] - v <= length)
    return y === undefined ? noRay : { hit: true, position: [origin[0], y, origin[2]], normal: [0, 1, 0] }
  },
})

const target = (overrides = {}) => ({ x: 0, y: null, z: 0, standNearY: null, clearance: 2, snap: 'terrain', ...overrides })

const makeStore = (clock, extra = {}) => new SessionStore({ ttl: 1000, now: clock.now, randomFill: sequenceFill(), ...extra })

gate('owner: minted owner is branded and reports its id', () => {
  const owner = mintPlayerOwner(3)
  ok(isPlayerOwner(owner))
  strictEqual(playerIdOf(owner), 3)
  ok(!isPlayerOwner({ id: 3 }), 'control: a plain object with an id is not an owner')
  ok(!isPlayerOwner(null), 'control: null is not an owner')
  ok(!isPlayerOwner(Object.freeze({ [Symbol('other')]: 'player-owner', id: 3 })), 'control: a foreign symbol does not brand')
})

gate('owner: mint refuses ids that are not non-negative integers', () => {
  for (const bad of [-1, 1.5, '2', NaN, null]) throws(() => mintPlayerOwner(bad), TypeError)
  ok(mintPlayerOwner(0) && playerIdOf(mintPlayerOwner(0)) === 0, 'control: zero is a valid id')
})

gate('owner: playerIdOf refuses a value that is not an owner', () => {
  throws(() => playerIdOf({ id: 3 }), TypeError)
  strictEqual(playerIdOf(UNBOUND_OWNER), null)
})

gate('SessionStore: token is 32 lowercase hex from the injected fill', () => {
  const store = makeStore(fixedClock(0))
  strictEqual(store.create(1), '000102030405060708090a0b0c0d0e0f')
  strictEqual(randomHex16(deterministicFill), '000102030405060708090a0b0c0d0e0f')
  const live = new SessionStore({ now: () => 0 })
  const a = live.create(null)
  const b = live.create(null)
  ok(/^[0-9a-f]{32}$/.test(a) && a !== b, 'control: the default source gives distinct 32-hex tokens')
})

gate('SessionStore: ttl defaults to 30000 and zero counts as unset', () => {
  strictEqual(new SessionStore().ttl, 30000)
  strictEqual(new SessionStore({ ttl: 0 }).ttl, 30000)
  strictEqual(new SessionStore({ ttl: 500 }).ttl, 500)
})

gate('SessionStore: session is alive at exactly ttl and dead one ms later', () => {
  const clock = fixedClock(0)
  const store = makeStore(clock)
  const atEdge = store.create(1)
  const past = store.create(2)
  clock.set(1000)
  ok(store.get(atEdge) !== null, 'alive when the idle time equals ttl')
  clock.set(1001)
  strictEqual(store.get(past), null, 'control: the untouched session is dead one ms after ttl')
})

gate('SessionStore: a pinned session outlives the ttl', () => {
  const clock = fixedClock(0)
  const store = makeStore(clock)
  const token = store.create(1)
  strictEqual(store.pin(token), true)
  clock.set(10000)
  ok(store.get(token) !== null, 'pinned session survives')
  const unpinned = store.create(2)
  clock.set(20000)
  strictEqual(store.get(unpinned), null)
})

gate('SessionStore: release restarts the ttl from the release time', () => {
  const clock = fixedClock(0)
  const store = makeStore(clock)
  const token = store.create(1)
  store.pin(token)
  clock.set(5000)
  strictEqual(store.release(token), true)
  clock.set(5999)
  ok(store.get(token) !== null, 'alive 999 ms after release')
  clock.set(7000)
  strictEqual(store.get(token), null)
  strictEqual(store.pin('missing'), false)
  strictEqual(store.release('missing'), false)
})

gate('SessionStore: update merges state and drops prototype-pollution keys', () => {
  const clock = fixedClock(0)
  const store = makeStore(clock)
  const token = store.create(1, { hp: 10 })
  const hostile = JSON.parse('{"hp":5,"__proto__":{"polluted":1},"constructor":"c","prototype":"p","name":"n"}')
  strictEqual(store.update(token, { state: hostile }), true)
  const session = store.get(token)
  strictEqual(session.state.hp, 5)
  strictEqual(session.state.name, 'n')
  ok(!Object.hasOwn(session.state, 'constructor') && !Object.hasOwn(session.state, 'prototype'))
  strictEqual(({}).polluted, undefined)
  strictEqual(Object.prototype.polluted, undefined)
  store.update(token, { state: [1, 2] })
  strictEqual(store.get(token).state.hp, 5)
  store.update(token, { state: { hp: 7 } })
  strictEqual(store.get(token).state.hp, 7, 'control: a benign update lands')
})

gate('SessionStore: update refreshes the ttl and an expired session refuses it', () => {
  const clock = fixedClock(0)
  const store = makeStore(clock)
  const token = store.create(1)
  clock.set(900)
  strictEqual(store.update(token, {}), true)
  clock.set(1800)
  ok(store.get(token) !== null, 'refreshed by update')
  clock.set(3000)
  strictEqual(store.update(token, {}), false)
  strictEqual(store.getActiveCount(), 0)
})

gate('SessionStore: rebindOwner requires a minted owner and moves the session', () => {
  const clock = fixedClock(0)
  const store = makeStore(clock)
  const token = store.create(null)
  strictEqual(store.get(token).playerId, null)
  strictEqual(store.rebindOwner(token, mintPlayerOwner(9)), true)
  strictEqual(store.get(token).playerId, 9)
  throws(() => store.rebindOwner(token, { id: 9 }), (e) => e instanceof TypeError && e.message.includes('rebindOwner requires a PlayerOwner'))
  strictEqual(store.rebindOwner('missing', { id: 9 }), false, 'control: an unknown token returns false before the owner check')
})

gate('SessionStore: create binds an owner and refuses a bad player id', () => {
  const store = makeStore(fixedClock(0))
  strictEqual(store.get(store.create(4)).playerId, 4)
  throws(() => store.create(-1), TypeError)
  throws(() => store.create('4'), TypeError)
  strictEqual(store.getActiveCount(), 1, 'control: the refused creates left no session behind')
})

gate('SessionStore: create copies the state it is given', () => {
  const store = makeStore(fixedClock(0))
  const source = { hp: 1 }
  const token = store.create(1, source)
  source.hp = 99
  strictEqual(store.get(token).state.hp, 1)
  deepStrictEqual(store.get(store.create(2)).state, {}, 'control: a session created without state starts empty')
})

gate('SessionStore: getActiveCount sweeps expired sessions and keeps pinned ones', () => {
  const clock = fixedClock(0)
  const store = makeStore(clock)
  const a = store.create(1)
  const b = store.create(2)
  store.create(3)
  strictEqual(store.getActiveCount(), 3)
  store.pin(b)
  clock.set(5000)
  strictEqual(store.getActiveCount(), 1)
  ok(store.get(a) === null && store.get(b) !== null, 'control: the pinned one is the survivor')
})

gate('SessionStore: destroy and destroyAll remove sessions', () => {
  const store = makeStore(fixedClock(0))
  const a = store.create(1)
  store.create(2)
  store.destroy(a)
  strictEqual(store.getActiveCount(), 1)
  store.destroyAll()
  strictEqual(store.getActiveCount(), 0)
})

gate('SessionStore: pin on an expired session returns false, on a fresh one true', () => {
  const clock = fixedClock(0)
  const store = makeStore(clock)
  const stale = store.create(1)
  clock.set(5000)
  strictEqual(store.pin(stale), false)
  const fresh = store.create(2)
  strictEqual(store.pin(fresh), true, 'control: a fresh session pins')
})

gate('spawnSurfaceY: flat ground under a pose returns the ground height', () => {
  strictEqual(spawnSurfaceY(ground(0).raycast, [0, 1, 0], { standingOffset: 1 }), 0)
  strictEqual(spawnSurfaceY(emptyCtx().physics.raycast, [0, 1, 0], { standingOffset: 1 }), null, 'control: an empty world has no surface')
})

gate('spawnSurfaceY: refuses bad arguments with a RangeError', () => {
  throws(() => spawnSurfaceY(null, [0, 1, 0], { standingOffset: 1 }), (e) => e instanceof RangeError && e.message.includes('raycast must be a function'))
  throws(() => spawnSurfaceY(ground(0).raycast, [0, 1, 0], { standingOffset: 0 }), RangeError)
  throws(() => spawnSurfaceY(ground(0).raycast, [0, 1, 0], { standingOffset: 1, headroom: 1, radius: 1 }), (e) => e instanceof RangeError && e.message.includes('headroom must exceed radius'))
  strictEqual(spawnSurfaceY(ground(0).raycast, [0, 1, 0], { standingOffset: 1, headroom: 2, radius: 1 }), 0, 'control: a valid radius passes')
})

gate('spawnSurfaceY: a hit without a finite position is a TypeError', () => {
  const bad = { raycast: () => ({ hit: true, position: [0, NaN, 0], normal: [0, 1, 0] }) }
  throws(() => spawnSurfaceY(bad.raycast, [0, 1, 0], { standingOffset: 1 }), TypeError)
})

gate('columnSurfaces: caps the walk at 24 walkable surfaces', () => {
  const forty = Array.from({ length: 40 }, (_, k) => 100 - 2 * k)
  const surfaces = columnSurfaces(stackedSurfaces(forty).raycast, 0, 101, 0)
  strictEqual(surfaces.length, 24)
  strictEqual(surfaces[0], 100)
  strictEqual(surfaces[23], 54)
  strictEqual(columnSurfaces(stackedSurfaces(forty.slice(0, 10)).raycast, 0, 101, 0).length, 10, 'control: under the cap every surface is kept')
})

gate('snapToGround: terrain snap uses the live height plus clearance', () => {
  const ctx = { physics: { terrainHeightAt: () => 4, raycast: () => ({ hit: true, position: [0, 9, 0] }) } }
  deepStrictEqual(snapToGround(ctx, 1, -Infinity, 2, 2, 'terrain'), [1, 6, 2])
  deepStrictEqual(snapToGround(ctx, 1, -Infinity, 2, 2, 'first'), [1, 11, 2], 'control: first snap takes the ray hit instead')
})

gate('snapToGround: falls back to the hint, then null when nothing is known', () => {
  deepStrictEqual(snapToGround({ physics: {} }, 1, 7, 2, 2), [1, 7, 2])
  strictEqual(snapToGround({ physics: {} }, 1, NaN, 2, 2), null, 'control: a NaN hint with no terrain gives no position')
})

gate('probeSpawnHoldGround: a heightfield that has not landed holds the spawn', () => {
  const ctx = groundCtx({ _terrainStreamer: { coversPosition: () => false, groundlessPlayers: [] } })
  deepStrictEqual(probeSpawnHoldGround(ctx, [0, 1, 0]), { y: null, reason: SPAWN_HOLD_REASON.HEIGHTFIELD_NOT_LANDED })
  const covered = groundCtx({ _terrainStreamer: { coversPosition: () => true, groundlessPlayers: [] } })
  deepStrictEqual(probeSpawnHoldGround(covered, [0, 1, 0]), { y: 0, reason: null }, 'control: a covered field passes the gate')
})

gate('probeSpawnHoldGround: static colliders pending within 256 m hold, beyond do not', () => {
  const near = groundCtx({ appRuntime: { _pendingTrimeshBuilds: new Set(), _pendingTrimeshEntities: new Map([[1, { position: [100, 0, 0] }]]) } })
  deepStrictEqual(probeSpawnHoldGround(near, [0, 1, 0]).reason, SPAWN_HOLD_REASON.STATIC_COLLIDERS_PENDING)
  const far = groundCtx({ appRuntime: { _pendingTrimeshBuilds: new Set(), _pendingTrimeshEntities: new Map([[1, { position: [300, 0, 0] }]]) } })
  deepStrictEqual(probeSpawnHoldGround(far, [0, 1, 0]), { y: 0, reason: null }, 'control: a collider 300 m away does not hold')
  const building = groundCtx({ appRuntime: { _pendingTrimeshBuilds: new Set([7]), _pendingTrimeshEntities: new Map() } })
  deepStrictEqual(probeSpawnHoldGround(building, [0, 1, 0]).reason, SPAWN_HOLD_REASON.STATIC_COLLIDERS_PENDING)
})

gate('probeSpawnHoldGround: names no-raycast and ray-missed reasons', () => {
  deepStrictEqual(probeSpawnHoldGround(noPhysicsCtx(), [0, 1, 0]), { y: null, reason: SPAWN_HOLD_REASON.NO_RAYCAST })
  deepStrictEqual(probeSpawnHoldGround(emptyCtx(), [0, 1, 0]), { y: null, reason: SPAWN_HOLD_REASON.RAY_MISSED_GROUND })
  deepStrictEqual(probeSpawnHoldGround(groundCtx(), [0, 1, 0]), { y: 0, reason: null }, 'control: a reachable floor carries no reason')
})

gate('probeSpawnHoldGround: rejoin probes straight down from the pose and names a miss', () => {
  deepStrictEqual(probeSpawnHoldGround(groundCtx(), [0, 5, 0], { rejoin: true }), { y: 0, reason: null })
  deepStrictEqual(probeSpawnHoldGround(emptyCtx(), [0, 5, 0], { rejoin: true }).reason, SPAWN_HOLD_REASON.RAY_MISSED_GROUND)
  deepStrictEqual(probeSpawnHoldGround(noPhysicsCtx(), [0, 5, 0], { rejoin: true }).reason, SPAWN_HOLD_REASON.NO_RAYCAST, 'control: no raycast is named on the rejoin path too')
})

gate('probeSpawnGroundY drops the reason: returns a bare number or null, never the reason', () => {
  strictEqual(probeSpawnGroundY(noPhysicsCtx(), [0, 1, 0]), null)
  strictEqual(probeSpawnGroundY(emptyCtx(), [0, 1, 0]), null)
  strictEqual(typeof probeSpawnGroundY(groundCtx(), [0, 1, 0]), 'number')
  const named = probeSpawnHoldGround(noPhysicsCtx(), [0, 1, 0])
  strictEqual(named.reason, SPAWN_HOLD_REASON.NO_RAYCAST, 'the reason exists upstream in the hold probe')
  strictEqual(probeSpawnGroundY(noPhysicsCtx(), [0, 1, 0]), named.y, 'probeSpawnGroundY keeps only the y of that same outcome')
})

gate('probeSpawnGroundY keeps the y of probeSpawnHoldGround when no hold gate applies', () => {
  for (const [ctx, sp] of [[groundCtx(), [0, 1, 0]], [groundCtx(), [4, 5, 9]], [emptyCtx(), [0, 1, 0]], [noPhysicsCtx(), [0, 1, 0]]]) {
    strictEqual(probeSpawnGroundY(ctx, sp), probeSpawnHoldGround(ctx, sp).y)
  }
  strictEqual(probeSpawnGroundY(groundCtx(), [4, 5, 9]), 0, 'control: a higher pose still reads the floor')
})

gate('probeSpawnGroundY skips the heightfield and static gates that the hold probe applies', () => {
  const unlanded = groundCtx({ _terrainStreamer: { coversPosition: () => false, groundlessPlayers: [] } })
  strictEqual(probeSpawnHoldGround(unlanded, [0, 1, 0]).reason, SPAWN_HOLD_REASON.HEIGHTFIELD_NOT_LANDED)
  strictEqual(probeSpawnGroundY(unlanded, [0, 1, 0]), 0, 'the reason-less probe still returns a height under an unlanded field')
  const pending = groundCtx({ appRuntime: { _pendingTrimeshBuilds: new Set([1]), _pendingTrimeshEntities: new Map() } })
  strictEqual(probeSpawnHoldGround(pending, [0, 1, 0]).reason, SPAWN_HOLD_REASON.STATIC_COLLIDERS_PENDING)
  strictEqual(probeSpawnGroundY(pending, [0, 1, 0]), 0, 'control: the static gate is also skipped by probeSpawnGroundY')
})

gate('probeSpawnGroundY discard changes teleport output: no raycast takes standNearY raw, a floor lowers it to the standing centre', () => {
  const tgt = target({ x: 5, z: 6, standNearY: 2 })
  deepStrictEqual(teleportPosition(noPhysicsCtx(), tgt), [5, 2, 6])
  deepStrictEqual(teleportPosition(groundCtx(), tgt), [5, 1, 6], 'control: with a floor the standing centre is used')
})

gate('spawnClearanceM: no raycast gives 30 m and a wall gives its distance', () => {
  strictEqual(spawnClearanceM(noPhysicsCtx(), 0, 1, 0), 30)
  const walled = { physics: { raycast: ground(0, () => 4) }, physicsIntegration: integration }
  strictEqual(spawnClearanceM(walled, 0, 1, 0), 4)
  const far = { physics: { raycast: ground(0, () => 40) }, physicsIntegration: integration }
  strictEqual(spawnClearanceM(far, 0, 1, 0), 30, 'control: a wall beyond 30 m does not reduce the clearance')
})

gate('rankSpawnPointsByWalkingRoom: keeps walkable candidates in clearance order', () => {
  const walls = { 0: 3, 100: 20, 200: null }
  const ctx = { physics: { raycast: ground(0, (o) => walls[o[0]] ?? null) }, physicsIntegration: integration }
  const candidates = [[0, 1, 0], [100, 1, 0], [200, 1, 0]]
  deepStrictEqual(rankSpawnPointsByWalkingRoom(ctx, candidates), [[200, 1, 0], [100, 1, 0]])
  const single = [[0, 1, 0]]
  strictEqual(rankSpawnPointsByWalkingRoom(ctx, single), single, 'a single candidate is returned as the same array')
})

gate('rankSpawnPointsByWalkingRoom: with no walkable candidate keeps only the best one', () => {
  const walls = { 0: 3, 10: 4, 20: 5 }
  const ctx = { physics: { raycast: ground(0, (o) => walls[o[0]] ?? null) }, physicsIntegration: integration }
  deepStrictEqual(rankSpawnPointsByWalkingRoom(ctx, [[0, 1, 0], [10, 1, 0], [20, 1, 0]]), [[20, 1, 0]])
})

gate('groundSnapSpawnPoint and resolveSpawnPointOnGround place the point on the floor', () => {
  deepStrictEqual(groundSnapSpawnPoint(groundCtx(), [1, 5, 2]), [1, SPAWN_CLEARANCE, 2])
  const sp = [1, 5, 2]
  strictEqual(groundSnapSpawnPoint(noPhysicsCtx(), sp), sp, 'control: with no floor the point is returned unchanged')
  deepStrictEqual(resolveSpawnPointOnGround(groundCtx(), [1, 5, 2]), [1, 1, 2])
  const short = [1, 2]
  strictEqual(resolveSpawnPointOnGround(groundCtx(), short), short, 'control: a short point is returned as is')
  const floorless = [1, 5, 2]
  const copied = resolveSpawnPointOnGround(noPhysicsCtx(), floorless)
  deepStrictEqual(copied, [1, 5, 2])
  notStrictEqual(copied, floorless, 'control: without a floor the result is a copy, not the input')
})

gate('movedDuringHold: a move beyond 0.01 m summed over axes counts, a smaller one does not', () => {
  strictEqual(SPAWN_HOLD_MOVED_EPS, 0.01)
  strictEqual(movedDuringHold([0, 0, 0], [0, 0, 0]), false, 'control: no move')
  strictEqual(movedDuringHold([0.004, 0, 0], [0, 0, 0]), false)
  strictEqual(movedDuringHold([0.02, 0, 0], [0, 0, 0]), true)
})

gate('holdReasonText: names the reason and the player for each hold outcome', () => {
  const sp = [2.6, 1, -3.7]
  const streamer = { groundlessPlayers: [[1.4, 2.2]] }
  const heightText = holdReasonText({ _terrainStreamer: streamer }, 7, sp, SPAWN_HOLD_REASON.HEIGHTFIELD_NOT_LANDED)
  ok(heightText.includes('holding player 7 at chart-local (3, -4)') && heightText.includes('groundless players now: [[1,2]]'))
  ok(holdReasonText({}, 7, sp, SPAWN_HOLD_REASON.STATIC_COLLIDERS_PENDING).includes('within 256 m'))
  ok(holdReasonText({}, 7, sp, SPAWN_HOLD_REASON.NO_RAYCAST).includes('physics exposes no raycast'))
  const rayText = holdReasonText({}, 7, sp, SPAWN_HOLD_REASON.RAY_MISSED_GROUND)
  ok(rayText.includes('the ground probe found no walkable surface under it'), 'control: a ray miss gets the walkable-surface text')
  ok(!rayText.includes('no raycast'), 'control: a ray miss does not claim no raycast')
})

gate('probeGround: no raycast is "physics not ready", a floor gives its y and terrainY', () => {
  deepStrictEqual(probeGround(noPhysicsCtx(), 0, 0, 1), { hit: false, error: 'physics not ready' })
  deepStrictEqual(probeGround(groundCtx(), 0, 0, 7), { hit: true, y: 0, terrainY: null })
  deepStrictEqual(probeGround(emptyCtx(), 0, 0, 7), { hit: false, y: null, terrainY: null }, 'control: a miss reports hit false')
})

gate('probeGround: a finite fromY is the ray origin, otherwise terrain plus 50 m', () => {
  const origins = []
  const spy = { raycast: (o, d, l) => { origins.push([o[1], l]); return noRay } }
  probeGround({ physics: spy }, 0, 0, 7)
  probeGround({ physics: spy }, 0, 0, undefined)
  deepStrictEqual(origins, [[7, 4000], [50, 4000]], 'control: the default origin is 50 m above the zero terrain')
})

gate('teleportTarget: resolves a [x,y,z] array and the plain spec with spoint defaults', () => {
  deepStrictEqual(resolveTarget([1, 2, 3]), { x: 1, y: 2, z: 3, clearance: 2, snap: 'terrain', standNearY: null })
  deepStrictEqual(teleportTarget({ physics: {} }, { x: 1, z: 2 }), { x: 1, y: null, z: 2, clearance: DEFAULT_CLEARANCE_M, snap: 'terrain', standNearY: null })
  strictEqual(DEFAULT_CLEARANCE_M, 2)
  strictEqual(MAX_CLEARANCE_M, 500)
  strictEqual(MAX_ABS_COORD_M, 1e7)
})

gate('resolveTarget: refuses non-finite and out-of-range inputs', () => {
  throws(() => resolveTarget({ x: NaN, z: 0 }), /finite x and z/)
  throws(() => resolveTarget({ x: 1, z: 1e7 + 1 }), /finite x and z/)
  throws(() => resolveTarget({ x: 1, z: 1, clearance: 501 }), /clearance must be within 0\.\.500/)
  throws(() => resolveTarget({ x: 1, y: 2, z: 2, standNearY: 3 }), /not both/)
  throws(() => resolveTarget({ x: 1, y: 1e7 + 1, z: 2 }), /y must be finite/)
  throws(() => resolveTarget('nope'), /object or \[x,y,z\]/)
  strictEqual(resolveTarget({ x: 1, z: 1, clearance: 500 }).clearance, 500, 'control: the upper clearance bound is inclusive')
})

gate('resolveTarget: alt sets clearance and snap is first only when asked', () => {
  const alt = resolveTarget({ x: 0, z: 0, alt: 12 })
  strictEqual(alt.clearance, 12)
  strictEqual(resolveTarget({ x: 0, z: 0, snap: 'first' }).snap, 'first')
  strictEqual(resolveTarget({ x: 0, z: 0, snap: 'anything' }).snap, 'terrain', 'control: any other snap is terrain')
  strictEqual(resolveTarget({ x: 0, z: 0, standNearY: 3 }).standNearY, 3)
})

gate('lat/lon and dir targets need a planet frame', () => {
  throws(() => resolveTarget({ lat: 1, lon: 2 }), /needs a planet frame/)
  throws(() => resolveTarget({ dir: [0, 1, 0] }), /needs a planet frame/)
  throws(() => resolveTarget({ lat: 91, lon: 0 }, { frame: {} }), /\|lat\| <= 90/, 'control: an out-of-range latitude is refused first')
})

gate('direction helpers: unit vectors and lat/lon round trip', () => {
  deepStrictEqual(latLonToDir(0, 0).map(v => Math.round(v * 1e9) / 1e9), [1, 0, 0])
  ok(Math.abs(dirToLatLon([0, 1, 0]).lat - 90) < 1e-9)
  throws(() => parseDir3([0, 0, 0]), /zero vector/)
  throws(() => parseDir3([1, 2]), /finite/)
  strictEqual(angleFromAnchorDeg({ up: [0, 1, 0] }, [0, 5, 0]), 0)
  ok(Math.abs(angleFromAnchorDeg({ up: [0, 1, 0] }, [1, 0, 0]) - 90) < 1e-9, 'control: a horizontal direction is 90 degrees from the anchor')
})

gate('dirToLocalXZ: refuses a missing heightAt and returns null beyond ~87 degrees', () => {
  const frame = { up: [0, 1, 0], east: [1, 0, 0], north: [0, 0, 1], radius: 1000, anchorHeight: 0, localToDir: () => [0, 0, 0] }
  throws(() => dirToLocalXZ(frame, [1, 0, 0]), (e) => e instanceof TypeError && e.message.includes('heightAt sampler'))
  strictEqual(dirToLocalXZ(frame, [1, 0, 0], () => 0), null)
  notStrictEqual(dirToLocalXZ(frame, [0, 1, 0], () => 0), null, 'control: a direction at the anchor is not refused')
})

gate('teleportPosition: an explicit y is used as given', () => {
  deepStrictEqual(teleportPosition(noPhysicsCtx(), target({ x: 1, y: 7, z: 2 })), [1, 7, 2])
})

gate('teleportPosition: standNearY over ground takes the standing centre', () => {
  deepStrictEqual(teleportPosition(groundCtx(), target({ x: 1, z: 2, standNearY: 3 })), [1, 1, 2])
  deepStrictEqual(teleportPosition(noPhysicsCtx(), target({ x: 1, z: 2, standNearY: 3 })), [1, 3, 2], 'control: no floor keeps the raw hint')
})

gate('teleportPosition: with neither y nor a hint it snaps to terrain, or throws with no terrain', () => {
  const withTerrain = { physics: { terrainHeightAt: () => 4 }, physicsIntegration: integration }
  deepStrictEqual(teleportPosition(withTerrain, target({ x: 1, z: 2, clearance: 2 })), [1, 6, 2])
  throws(() => teleportPosition(noPhysicsCtx(), target({ x: 1, z: 2 })), /no terrain height at target and no explicit y/)
})

gate('beginTeleportHold: deadline is start plus the default 8000 ms', () => {
  strictEqual(TELEPORT_HOLD_MAX_MS, 8000)
  const clock = fixedClock(1000)
  const player = { state: { position: [0, 5, 0], velocity: [0, 0, 0], onGround: false } }
  beginTeleportHold(player, { onRelease: () => {} }, clock.now)
  strictEqual(player.teleportHold.startedAt, 1000)
  strictEqual(player.teleportHold.deadline, 9000)
  beginTeleportHold(player, { maxMs: 50, onRelease: () => {} }, clock.now)
  strictEqual(player.teleportHold.deadline, 1050, 'control: an explicit maxMs overrides the default')
})

gate('stepTeleportHold: a floor under the hold releases with the measured hold time', () => {
  const clock = fixedClock(1000)
  const released = []
  const player = { state: { position: [0, 5, 0], velocity: [1, 1, 1], onGround: false } }
  beginTeleportHold(player, { onRelease: (r) => released.push(r) }, clock.now)
  clock.set(1500)
  strictEqual(stepTeleportHold(player, ground(0), clock.now), false)
  deepStrictEqual(released, [{ groundHit: true, groundY: 0, heldMs: 500 }])
  strictEqual(player.teleportHold, null)
  strictEqual(player.state.onGround, false)
})

gate('stepTeleportHold: no floor before the deadline keeps holding and zeroes velocity', () => {
  const clock = fixedClock(1000)
  const released = []
  const player = { state: { position: [0, 5, 0], velocity: [1, 1, 1], onGround: false } }
  beginTeleportHold(player, { onRelease: (r) => released.push(r) }, clock.now)
  clock.set(1500)
  strictEqual(stepTeleportHold(player, ground(-1000), clock.now), true)
  deepStrictEqual(player.state.velocity, [0, 0, 0])
  strictEqual(player.state.onGround, true)
  deepStrictEqual(released, [], 'control: no release while the hold is open')
})

gate('stepTeleportHold: past the deadline releases with no ground, and no world releases at once', () => {
  const clock = fixedClock(1000)
  const released = []
  const player = { state: { position: [0, 5, 0], velocity: [0, 0, 0], onGround: false } }
  beginTeleportHold(player, { onRelease: (r) => released.push(r) }, clock.now)
  clock.set(9000)
  strictEqual(stepTeleportHold(player, ground(-1000), clock.now), false)
  deepStrictEqual(released, [{ groundHit: false, groundY: null, heldMs: 8000 }])
  const noWorld = { state: { position: [0, 5, 0], velocity: [0, 0, 0], onGround: false } }
  beginTeleportHold(noWorld, { onRelease: (r) => released.push(r) }, clock.now)
  strictEqual(stepTeleportHold(noWorld, null, clock.now), false)
  strictEqual(released[1].groundY, null, 'control: with no world the hold releases without a ground')
  strictEqual(stepTeleportHold({}, ground(0), clock.now), false)
})

gate('admitFirstMessage: an auth response is taken only while auth is pending', () => {
  const response = pack({ type: MSG.NOSTR_AUTH_RESPONSE, payload: {} })
  const result = admitFirstMessage(response, true)
  strictEqual(result.way, SOCKET_ADMISSION.AUTH_RESPONSE)
  strictEqual(result.message.type, MSG.NOSTR_AUTH_RESPONSE)
  strictEqual(admitFirstMessage(response, false).way, SOCKET_ADMISSION.NEW_PLAYER, 'control: with no auth pending it is a new player')
})

gate('admitFirstMessage: a message other than an auth response is refused while auth is pending', () => {
  const migrate = pack({ type: MSG.MIGRATE, payload: { sessionToken: 'abcdefgh' } })
  deepStrictEqual(admitFirstMessage(migrate, true).refusal, ADMISSION_REFUSAL.AUTH_REQUIRED)
  deepStrictEqual(admitFirstMessage(pack({ type: MSG.INPUT, payload: {} }), true).refusal, ADMISSION_REFUSAL.AUTH_REQUIRED)
})

gate('admitFirstMessage: a migrate or new message routes by type, undecodable bytes are refused', () => {
  strictEqual(admitFirstMessage(pack({ type: MSG.MIGRATE, payload: { sessionToken: 'abcdefgh' } }), false).way, SOCKET_ADMISSION.MIGRATE)
  strictEqual(admitFirstMessage(pack({ type: MSG.INPUT, payload: {} }), false).way, SOCKET_ADMISSION.NEW_PLAYER)
  deepStrictEqual(admitFirstMessage(new Uint8Array([0xc1]), false).refusal, ADMISSION_REFUSAL.UNDECODABLE)
  deepStrictEqual(admitFirstMessage(new Uint8Array([]), true).refusal, ADMISSION_REFUSAL.UNDECODABLE, 'control: an empty payload is undecodable even while auth is pending')
})

gate('migratePeekGraceMs: 50 ms floor, scaled by dilation below 1, capped at 1500 ms', () => {
  strictEqual(migratePeekGraceMs(undefined), 50)
  strictEqual(migratePeekGraceMs(1), 50)
  strictEqual(migratePeekGraceMs(0), 50)
  strictEqual(migratePeekGraceMs(NaN), 50)
  strictEqual(migratePeekGraceMs(0.5), 100)
  strictEqual(migratePeekGraceMs(0.01), 1500)
  notStrictEqual(migratePeekGraceMs(0.5), 50, 'control: a slowed tick widens the grace')
})

gate('isSessionTokenShape: a string of at least 8 characters', () => {
  ok(isSessionTokenShape('abcdefgh'))
  ok(!isSessionTokenShape('abcdefg'))
  ok(!isSessionTokenShape(12345678))
  ok(!isSessionTokenShape(null), 'control: a non-string is refused')
})

gate('smoothRtt: first sample is taken raw, later samples blend 70/30 and clamp to 0..10000', () => {
  strictEqual(MAX_TRACKED_RTT_MS, 10000)
  strictEqual(smoothRtt(undefined, 0, 40), 40)
  strictEqual(smoothRtt(null, 0, 40), 40)
  strictEqual(smoothRtt(40, 0, 100), 58)
  strictEqual(smoothRtt(undefined, 50000, 0), 0)
  strictEqual(smoothRtt(undefined, 0, 20000), 10000)
  notStrictEqual(smoothRtt(40, 0, 100), 100, 'control: a later sample is not taken raw')
})

gate('heartbeatAckPayload: echoes a finite timestamp, otherwise an empty payload', () => {
  deepStrictEqual(heartbeatAckPayload(5, 9), { timestamp: 5, serverTime: 9 })
  deepStrictEqual(heartbeatAckPayload('5', 9), {})
  deepStrictEqual(heartbeatAckPayload(NaN, 9), {})
  deepStrictEqual(heartbeatAckPayload(Infinity, 9), {}, 'control: an infinite timestamp is not echoed')
})

gate('reconnectRestore: keeps valid saved fields and clamps health to the player maximum', () => {
  const saved = { position: [1, 2, 3], health: 500, velocity: [1, 2, 3], rotation: [0, 0, 0, 1], name: 'ann' }
  deepStrictEqual(reconnectRestore(saved, {}, () => { throw new Error('not called') }), { position: [1, 2, 3], health: 100, velocity: [1, 2, 3], rotation: [0, 0, 0, 1], name: 'ann' })
  deepStrictEqual(reconnectRestore({ health: 40 }, {}, () => [9, 9, 9]).health, 40, 'control: a health under the maximum is kept')
  deepStrictEqual(reconnectRestore({ health: 500 }, { health: 250 }, () => [9, 9, 9]).health, 250)
  deepStrictEqual(reconnectRestore({ health: -1 }, {}, () => [9, 9, 9]).health, 100)
})

gate('reconnectRestore: snaps a bad position through the injected spawn, drops bad vectors and name', () => {
  const restored = reconnectRestore({ position: [1, 2], velocity: [1, 2], rotation: [1, 2, 3], name: 5 }, {}, () => [9, 9, 9])
  deepStrictEqual(restored.position, [9, 9, 9])
  strictEqual(restored.velocity, undefined)
  strictEqual(restored.rotation, undefined)
  strictEqual(restored.name, undefined, 'control: a non-string name is dropped')
})

gate('isValidTrimeshPayload: accepts a finite triangle and refuses bad vertices and indices', () => {
  const vertices = [0, 0, 0, 1, 0, 0, 0, 1, 0]
  ok(isValidTrimeshPayload(vertices, [0, 1, 2]))
  ok(!isValidTrimeshPayload([0, NaN, 0, 1, 0, 0, 0, 1, 0], [0, 1, 2]))
  ok(!isValidTrimeshPayload(vertices, [0, 1, 3]))
  ok(!isValidTrimeshPayload(vertices, [0, 1]))
  ok(!isValidTrimeshPayload([0, 0, 0, 1], [0, 1, 2]))
  ok(!isValidTrimeshPayload(new Float32Array(vertices), [0, 1, 2]), 'typed arrays are refused, spoint requires plain arrays')
  ok(!isValidTrimeshPayload(null, [0, 1, 2]))
  ok(isValidTrimeshPayload(vertices, [0, 1, 2]), 'control: the valid triangle still passes')
})

gate('isValidTrimeshPayload: refuses more than 300000 vertices or 200000 triangles', () => {
  const manyVerts = new Array(900003).fill(0)
  ok(!isValidTrimeshPayload(manyVerts, [0, 1, 2]))
  const manyTris = new Array(600003).fill(0)
  ok(!isValidTrimeshPayload([0, 0, 0, 1, 0, 0, 0, 1, 0], manyTris))
  ok(isValidTrimeshPayload([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 2]), 'control: a small payload passes')
})

gate('isServerOnlyAppEvent: the four server-owned types are refused from clients', () => {
  for (const type of ['player_join', 'player_leave', 'player_teleport', 'damage']) ok(isServerOnlyAppEvent(type))
  ok(!isServerOnlyAppEvent('pick'), 'control: a client pick is allowed')
})

gate('voiceIdentityPubkey: keeps at most 128 characters of a voice identity key', () => {
  strictEqual(voiceIdentityPubkey({ type: 'voice_identity', pubkey: 'x'.repeat(200) }).length, 128)
  strictEqual(voiceIdentityPubkey({ type: 'voice_identity', pubkey: 'abc' }), 'abc')
  strictEqual(voiceIdentityPubkey({ type: 'voice_identity', pubkey: '' }), null)
  strictEqual(voiceIdentityPubkey({ type: 'voice_identity', pubkey: 5 }), null)
  strictEqual(voiceIdentityPubkey({ type: 'pick', pubkey: 'abc' }), null, 'control: another event type yields nothing')
})

gate('createWarnThrottle: one warning per client per second, boundary at exactly 1000 ms', () => {
  const clock = fixedClock(T0)
  const sent = []
  const warn = createWarnThrottle({ now: clock.now, warn: (m) => sent.push(m) })
  strictEqual(warn('a', 'm1'), true)
  clock.set(T0 + 999)
  strictEqual(warn('a', 'm2'), false)
  clock.set(T0 + 1000)
  strictEqual(warn('a', 'm3'), true)
  strictEqual(warn('b', 'other'), true, 'control: another client is throttled independently')
  deepStrictEqual(sent, ['m1', 'm3', 'other'])
})

gate('createWarnThrottle: forgets its history once more than 1024 clients are tracked', () => {
  const clock = fixedClock(T0)
  const warn = createWarnThrottle({ now: clock.now, warn: () => {} })
  strictEqual(warn('a', 'x'), true)
  strictEqual(warn('a', 'x'), false, 'control: an immediate repeat is throttled')
  for (let i = 0; i < 1025; i++) warn(`c${i}`, 'x')
  strictEqual(warn('a', 'x'), true)
})

gate('exported constants match the spoint values read from source', () => {
  deepStrictEqual(SPAWN_HOLD_REASON, {
    HEIGHTFIELD_NOT_LANDED: 'heightfield-collider-not-landed',
    STATIC_COLLIDERS_PENDING: 'static-colliders-pending-near',
    NO_RAYCAST: 'no-raycast-capability',
    RAY_MISSED_GROUND: 'ray-missed-ground',
  })
  strictEqual(SPAWN_HOLD_MAX_MS, 20000)
  strictEqual(SPAWN_CLEARANCE, 2)
  strictEqual(SPAWN_HOLD_MOVED_EPS, 0.01)
  strictEqual(SOCKET_ADMISSION.AUTH_RESPONSE, 'auth-response')
  strictEqual(ADMISSION_REFUSAL.UNDECODABLE, 'undecodable-first-message', 'control: the refusal string is the one spoint uses')
})

gate('sessions-pure source carries no comments, no timers, no fs or socket calls, and no direct wall-clock reads', () => {
  const dir = new URL('../src/sessions-pure/', import.meta.url)
  const files = readdirSync(dir).filter(f => f.endsWith('.js'))
  strictEqual(files.length, 7)
  const violations = []
  const rules = [
    [/\/\/|\/\*/, 'comment'],
    [/setTimeout|setInterval|clearTimeout/, 'timer'],
    [/from 'node:|require\(|process\.|fs\.|net\.|WebSocket/, 'host-io'],
    [/Date\.now\(\)/, 'wall-clock read'],
  ]
  for (const f of files) {
    const text = readFileSync(new URL(f, dir), 'utf8')
    for (const [pattern, label] of rules) if (pattern.test(text)) violations.push(`${f}: ${label}`)
    for (const m of text.matchAll(/from '([^']+)'/g)) if (!m[1].startsWith('.')) violations.push(`${f}: bare import ${m[1]}`)
  }
  deepStrictEqual(violations, [], 'every module is free of comments, timers, host io and direct clock reads')
})

gate('control: the source scanner flags a comment, a timer, a host import and a direct clock read', () => {
  const rules = [
    [/\/\/|\/\*/, 'comment'],
    [/setTimeout|setInterval|clearTimeout/, 'timer'],
    [/from 'node:|require\(|process\.|fs\.|net\.|WebSocket/, 'host-io'],
    [/Date\.now\(\)/, 'wall-clock read'],
  ]
  const hostile = "const t = Date.now()\n// note\nsetTimeout(f, 1)\nimport x from 'node:fs'"
  const hits = rules.filter(([p]) => p.test(hostile)).map(([, l]) => l)
  deepStrictEqual(hits, ['comment', 'timer', 'host-io', 'wall-clock read'])
})

finish()
