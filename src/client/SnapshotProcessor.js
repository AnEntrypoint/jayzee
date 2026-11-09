import { unpackGroundNormal } from '../wire/groundNormalWire.js'
import { inputDepthFromWire, NO_INPUT_DEPTH } from '../wire/inputDepthWire.js'
import { unpackWallPlanes } from '../wire/wallPlaneWire.js'
import { decodeEntityRecordInto, decodePlayerRecordInto, WIRE_UNITS_PER_METER } from '../wire/index.js'
import { PLAYER_TIER_FULL, PLAYER_TIER_REDUCED, unpackQuat } from '../snapshot-lod-pure/records.js'
import { reexpressPlayerRecord, reexpressEntityRecord } from './reexpressRecords.js'

const TAU = 2 * Math.PI

export const REDUCED_POSE_FIELDS = 5
export const REDUCED_HEIGHT_ABSENT = NaN
export const REDUCED_TIER_ABSENCE_GRACE_SNAPSHOTS = 40
export const SNAPSHOT_RELEASE_WINDOW = 96
export const DELTA_FAILURES_BEFORE_FULL_REQUEST = 10

export const FIELD_POS = 1 << 0
export const FIELD_ROT = 1 << 1
export const FIELD_VEL = 1 << 2
export const FIELD_SCALE = 1 << 3
export const FIELD_BODY = 1 << 4
export const FIELD_CUSTOM = 1 << 5
export const FIELD_SLEEP = 1 << 6
export const FIELD_MODEL = 1 << 7

const KINEMATIC_FIELDS = FIELD_POS | FIELD_ROT | FIELD_VEL | FIELD_SCALE

export const isReducedPlayerPose = (rec) => Array.isArray(rec) && rec.length === REDUCED_POSE_FIELDS && rec[4] === PLAYER_TIER_REDUCED

export const makeReducedPlayerPose = () => ({ id: 0, x: 0, z: 0, yawN: 0, tier: 0 })

export const unpackReducedPlayerPose = (rec, out) => {
  out.id = rec[0]
  out.x = rec[1] / WIRE_UNITS_PER_METER
  out.z = rec[2] / WIRE_UNITS_PER_METER
  out.yawN = rec[3] || 0
  out.tier = rec[4]
  return out
}

const copy3 = (dst, src) => {
  dst[0] = src[0]
  dst[1] = src[1]
  dst[2] = src[2]
}

const copy4 = (dst, src) => {
  copy3(dst, src)
  dst[3] = src[3]
}

const copyOr3 = (dst, src, x, y, z) => {
  if (src) copy3(dst, src)
  else {
    dst[0] = x
    dst[1] = y
    dst[2] = z
  }
}

const copyRotationOrIdentity = (dst, src) => {
  if (src) copy4(dst, src)
  else {
    dst[0] = 0
    dst[1] = 0
    dst[2] = 0
    dst[3] = 1
  }
}

const copyWallPlanes = (src, dst) => {
  dst.length = src.length
  for (let i = 0; i < src.length; i++) dst[i] = src[i]
}

const makePlayerSlot = () => ({
  id: 0,
  position: [0, REDUCED_HEIGHT_ABSENT, 0],
  heightAbsent: true,
  rotation: [0, 0, 0, 1],
  velocity: [0, 0, 0],
  onGround: false,
  health: 100,
  inputSequence: 0,
  crouch: 0,
  lookPitch: 0,
  lookYaw: 0,
  expr: 0,
  weapon: 0,
  inputBuffer: NO_INPUT_DEPTH,
  groundNormal: [0, 1, 0],
  tier: 0
})

const makeEntitySlot = () => ({
  id: 0,
  model: null,
  position: [0, 0, 0],
  rotation: [0, 0, 0, 1],
  velocity: [0, 0, 0],
  bodyType: 'static',
  custom: null,
  scale: [1, 1, 1],
  sleeping: false
})

const reducedPose = makeReducedPlayerPose()
const playerRecord = { position: [0, 0, 0], rotationWord: 0, velocity: [0, 0, 0] }
const entityRecord = { position: [0, 0, 0], rotationWord: 0, velocity: [0, 0, 0], scale: [0, 0, 0], flags: 0 }

const fillPlayerArrReduced = (s, p) => {
  const pose = unpackReducedPlayerPose(p, reducedPose)
  s.id = pose.id
  s.position[0] = pose.x
  s.position[2] = pose.z
  s.lookYaw = pose.yawN / 256 * TAU
  s.tier = PLAYER_TIER_REDUCED
}

const fillPlayerArr = (s, p) => {
  s.id = p[0]
  const record = decodePlayerRecordInto(p[1], playerRecord)
  copy3(s.position, record.position)
  s.heightAbsent = false
  unpackQuat(record.rotationWord, s.rotation)
  copy3(s.velocity, record.velocity)
  s.onGround = p[2] === 1
  s.health = p[3]
  s.crouch = p[4] || 0
  s.lookPitch = (((p[5] || 0) >> 8) & 0xFF) / 255 * Math.PI - Math.PI / 2
  s.lookYaw = ((p[5] || 0) & 0xFF) / 256 * TAU
  s.expr = p[6] || 0
  s.weapon = p[7] || 0
}

const fillAnyPlayerArr = (s, p) => {
  if (isReducedPlayerPose(p)) fillPlayerArrReduced(s, p)
  else {
    fillPlayerArr(s, p)
    s.tier = PLAYER_TIER_FULL
  }
}

const applySelfBlock = (s, me) => {
  s.inputSequence = me[0] || 0
  s.inputBuffer = inputDepthFromWire(me[1])
  unpackGroundNormal(me[2] || 0, s.groundNormal)
  unpackWallPlanes(me[3], s.wallPlanes || (s.wallPlanes = []))
}

const fillPlayerObj = (s, p) => {
  s.id = p.id || p.i
  copyOr3(s.position, p.position, 0, 0, 0)
  s.heightAbsent = false
  copyRotationOrIdentity(s.rotation, p.rotation)
  copyOr3(s.velocity, p.velocity, 0, 0, 0)
  s.onGround = p.onGround ?? false
  s.health = p.health ?? 100
  s.inputSequence = p.inputSequence ?? 0
  s.crouch = p.crouch ?? 0
  s.lookPitch = p.lookPitch ?? 0
  s.lookYaw = p.lookYaw ?? 0
  s.expr = p.expr ?? 0
  s.weapon = p.weapon ?? 0
  s.inputBuffer = inputDepthFromWire(p.inputBuffer)
  s.tier = PLAYER_TIER_FULL
}

const fillPlayer = (s, p) => {
  if (Array.isArray(p)) fillAnyPlayerArr(s, p)
  else fillPlayerObj(s, p)
}

const applyFieldDelta = (s, mask, fields, start) => {
  let fi = start
  if (mask & FIELD_MODEL) s.model = fields[fi++]
  if (mask & KINEMATIC_FIELDS) {
    const record = decodeEntityRecordInto(fields[fi++], entityRecord)
    if (mask & FIELD_POS) copy3(s.position, record.position)
    if (mask & FIELD_ROT) unpackQuat(record.rotationWord, s.rotation)
    if (mask & FIELD_VEL) copy3(s.velocity, record.velocity)
    if (mask & FIELD_SCALE) copy3(s.scale, record.scale)
  }
  if (mask & FIELD_BODY) s.bodyType = fields[fi++]
  if (mask & FIELD_CUSTOM) s.custom = fields[fi++]
  if (mask & FIELD_SLEEP) s.sleeping = fields[fi++] === 1
}

const fillEntityArr = (s, e) => {
  if (typeof e[1] === 'number') {
    applyFieldDelta(s, e[1], e, 2)
    return
  }
  s.id = e[0]
  s.model = e[1]
  const record = decodeEntityRecordInto(e[2], entityRecord)
  copy3(s.position, record.position)
  unpackQuat(record.rotationWord, s.rotation)
  copy3(s.velocity, record.velocity)
  s.bodyType = e[3]
  s.custom = e[4]
  copy3(s.scale, record.scale)
  s.sleeping = e[5] === 1
}

const fillEntityObj = (s, e) => {
  s.id = e.id
  s.model = e.model
  copyOr3(s.position, e.position, 0, 0, 0)
  copyRotationOrIdentity(s.rotation, e.rotation)
  copyOr3(s.velocity, e.velocity, 0, 0, 0)
  s.bodyType = e.bodyType || 'static'
  s.custom = e.custom || null
  copyOr3(s.scale, e.scale, 1, 1, 1)
}

const fillEntity = (s, e) => {
  if (Array.isArray(e)) fillEntityArr(s, e)
  else fillEntityObj(s, e)
}

const copyPlayerStateInto = (dst, s) => {
  dst.id = s.id
  if (!dst.position) dst.position = [0, 0, 0]
  if (!dst.rotation) dst.rotation = [0, 0, 0, 1]
  if (!dst.velocity) dst.velocity = [0, 0, 0]
  copy3(dst.position, s.position)
  dst.heightAbsent = s.heightAbsent === true
  copy4(dst.rotation, s.rotation)
  copy3(dst.velocity, s.velocity)
  dst.onGround = s.onGround
  dst.health = s.health
  dst.inputSequence = s.inputSequence
  dst.crouch = s.crouch
  dst.lookPitch = s.lookPitch
  dst.lookYaw = s.lookYaw
  dst.tier = s.tier || 0
  dst.expr = s.expr || 0
  dst.weapon = s.weapon || 0
  dst.inputBuffer = inputDepthFromWire(s.inputBuffer)
  if (s.groundNormal) copy3(dst.groundNormal || (dst.groundNormal = [0, 1, 0]), s.groundNormal)
  if (s.wallPlanes) copyWallPlanes(s.wallPlanes, dst.wallPlanes || (dst.wallPlanes = []))
  else if (dst.wallPlanes) dst.wallPlanes.length = 0
  return dst
}

const copyEntityStateInto = (dst, s) => {
  dst.id = s.id
  dst.model = s.model
  copy3(dst.position, s.position)
  copy4(dst.rotation, s.rotation)
  copy3(dst.velocity, s.velocity)
  dst.bodyType = s.bodyType
  dst.custom = s.custom
  copy3(dst.scale, s.scale)
  dst.sleeping = s.sleeping
  return dst
}

class SlotPool {
  #make
  #free = []

  constructor(makeSlot) {
    this.#make = makeSlot
  }

  acquire() {
    return this.#free.length ? this.#free.pop() : this.#make()
  }

  release(slot) {
    this.#free.push(slot)
  }
}

export class SnapshotProcessor {
  #playerStates = new Map()
  #entityStates = new Map()
  #callbacks
  #now
  #seenEntities = new Set()
  #deltaFailures = 0
  #deltaFailureIds = new Set()
  #lastSeenCall = new Map()
  #callCount = 0
  #playerSlotPool = new SlotPool(makePlayerSlot)
  #entitySlotPool = new SlotPool(makeEntitySlot)
  #releaseQueue = []

  constructor({ callbacks = {}, now = null } = {}) {
    if (now !== null && typeof now !== 'function') throw new TypeError('SnapshotProcessor now must be a function returning milliseconds')
    this.lastSnapshotTick = 0
    this.#callbacks = callbacks
    this.#now = now
  }

  get deltaFailures() {
    return this.#deltaFailures
  }

  get deltaFailureIds() {
    return this.#deltaFailureIds
  }

  #timestampOf(data) {
    if (data.timestamp) return data.timestamp
    if (this.#now === null) throw new TypeError('snapshot at tick ' + String(data.tick) + ' carries no timestamp and the SnapshotProcessor was given no now clock')
    return this.#now()
  }

  #maybeReleaseOldest() {
    if (this.#releaseQueue.length <= SNAPSHOT_RELEASE_WINDOW) return
    const oldest = this.#releaseQueue.shift()
    for (const slot of oldest.players) this.#playerSlotPool.release(slot)
    for (const slot of oldest.entities) this.#entitySlotPool.release(slot)
  }

  processSnapshot(data, tick, selfId = null) {
    this.lastSnapshotTick = tick
    this.#callCount++
    const snapshotForBuffer = { tick: data.tick || 0, timestamp: this.#timestampOf(data), players: [], entities: [] }
    if (data.dots) snapshotForBuffer.dots = data.dots

    for (const p of data.players || []) {
      const pid = Array.isArray(p) ? p[0] : (p.id || p.i)
      this.#lastSeenCall.set(pid, this.#callCount)
      let track = this.#playerStates.get(pid)
      if (track) fillPlayer(track, p)
      else {
        track = makePlayerSlot()
        fillPlayer(track, p)
        this.#playerStates.set(pid, track)
        this.#callbacks.onPlayerJoined?.(pid, track)
      }
      if (!track.position) track.position = [0, 0, 0]
      if (!track.rotation) track.rotation = [0, 0, 0, 1]
      if (!track.velocity) track.velocity = [0, 0, 0]
      if (pid === selfId && Array.isArray(data.me)) applySelfBlock(track, data.me)
      snapshotForBuffer.players.push(copyPlayerStateInto(this.#playerSlotPool.acquire(), track))
    }
    for (const pid of this.#playerStates.keys()) {
      if (this.#lastSeenCall.get(pid) === this.#callCount) continue
      const track = this.#playerStates.get(pid)
      if (track.tier === PLAYER_TIER_REDUCED) {
        const lastSeen = this.#lastSeenCall.get(pid) || 0
        if (this.#callCount - lastSeen < REDUCED_TIER_ABSENCE_GRACE_SNAPSHOTS) {
          snapshotForBuffer.players.push(copyPlayerStateInto(this.#playerSlotPool.acquire(), track))
          continue
        }
      }
      this.#playerStates.delete(pid)
      this.#lastSeenCall.delete(pid)
      this.#callbacks.onPlayerLeft?.(pid)
    }

    this.#processEntities(data, snapshotForBuffer)
    this.#releaseQueue.push(snapshotForBuffer)
    this.#maybeReleaseOldest()
    return snapshotForBuffer
  }

  #handleEntity(e, snapshotForBuffer) {
    const eid = Array.isArray(e) ? e[0] : e.id
    let track = this.#entityStates.get(eid)
    const isFieldDelta = Array.isArray(e) && typeof e[1] === 'number'
    if (isFieldDelta && !track) {
      this.#deltaFailures++
      this.#deltaFailureIds.add(eid)
      if (this.#deltaFailures < DELTA_FAILURES_BEFORE_FULL_REQUEST) this.#callbacks.onDeltaCorruption?.(eid)
      else this.#callbacks.onFullSnapshotRequested?.()
      return eid
    }
    if (track) fillEntity(track, e)
    else {
      track = makeEntitySlot()
      fillEntity(track, e)
      this.#entityStates.set(eid, track)
      this.#callbacks.onEntityAdded?.(eid, track)
    }
    snapshotForBuffer.entities.push(copyEntityStateInto(this.#entitySlotPool.acquire(), track))
    return eid
  }

  #processEntities(data, snapshotForBuffer) {
    if (data.delta) {
      for (const e of data.entities || []) this.#handleEntity(e, snapshotForBuffer)
      if (data.removed) {
        for (const eid of data.removed) {
          if (this.#entityStates.has(eid)) {
            this.#entityStates.delete(eid)
            this.#callbacks.onEntityRemoved?.(eid)
          }
        }
      }
      return
    }
    this.#seenEntities.clear()
    for (const e of data.entities || []) this.#seenEntities.add(this.#handleEntity(e, snapshotForBuffer))
    for (const eid of this.#entityStates.keys()) {
      if (!this.#seenEntities.has(eid)) {
        this.#entityStates.delete(eid)
        this.#callbacks.onEntityRemoved?.(eid)
      }
    }
  }

  getPlayerState(pid) {
    return this.#playerStates.get(pid)
  }

  getAllPlayerStates() {
    return this.#playerStates
  }

  getEntity(eid) {
    return this.#entityStates.get(eid)
  }

  getAllEntities() {
    return this.#entityStates
  }

  removePlayer(pid) {
    this.#playerStates.delete(pid)
    this.#lastSeenCall.delete(pid)
  }

  applyChartTransfer(pass) {
    for (const track of this.#playerStates.values()) reexpressPlayerRecord(pass, track)
    for (const track of this.#entityStates.values()) reexpressEntityRecord(pass, track)
  }

  clear() {
    this.#playerStates.clear()
    this.#entityStates.clear()
    this.#lastSeenCall.clear()
  }
}
