import { encodePlayerRecord, PLAYER_RECORD_BYTES } from '../wire/index.js'
import {
  CROWD_DOT_CELL_M,
  HALF_PI,
  PLAYER_LOD_FULL_COUNT,
  PLAYER_LOD_REDUCED2,
  PLAYER_LOD_REDUCED_HZ,
  PLAYER_RECORD_FIELDS,
  TAU
} from './constants.js'
import { packQuat, packReducedPlayerPose } from './records.js'

const pitchNOf = (lookPitch) => Math.max(0, Math.min(255, Math.round(((lookPitch || 0) + HALF_PI) / Math.PI * 255)))

const yawNOf = (lookYaw) => Math.round(((((lookYaw || 0) % TAU) + TAU) % TAU) / TAU * 256) & 0xFF

export const encodePlayer = (p) => {
  const [px, py, pz] = p.position, [rx, ry, rz, rw] = p.rotation, [vx, vy, vz] = p.velocity
  const bin = encodePlayerRecord({
    position: [px, py, pz],
    rotationWord: packQuat(rx, ry, rz, rw),
    velocity: [vx, vy, vz]
  })
  return [p.id, bin, p.onGround ? 1 : 0, Math.round(p.health || 0), p.crouch || 0, (pitchNOf(p.lookPitch) << 8) | yawNOf(p.lookYaw), p.expr || 0, p.weapon || 0]
}

export const encodePlayerInto = (p, rec) => {
  const [px, py, pz] = p.position, [rx, ry, rz, rw] = p.rotation, [vx, vy, vz] = p.velocity
  const pitchN = pitchNOf(p.lookPitch)
  const yawN = yawNOf(p.lookYaw)
  rec.flip ^= 1
  const bin = encodePlayerRecord({
    position: [px, py, pz],
    rotationWord: packQuat(rx, ry, rz, rw),
    velocity: [vx, vy, vz]
  }, rec.bins[rec.flip])
  const a = rec.arr
  a[0] = p.id
  a[1] = bin
  a[2] = p.onGround ? 1 : 0
  a[3] = Math.round(p.health || 0)
  a[4] = p.crouch || 0
  a[5] = (pitchN << 8) | yawN
  a[6] = p.expr || 0
  a[7] = p.weapon || 0
  return a
}

const playerEncPool = new Map()
const playerEncMap = new Map()
let playerEncGen = 0

export const encodePlayersOnce = (players, needed = null) => {
  const m = playerEncMap
  m.clear()
  const gen = ++playerEncGen
  for (const p of (players || [])) {
    if (needed !== null && !needed.has(p.id)) continue
    let rec = playerEncPool.get(p.id)
    if (!rec) {
      rec = { arr: new Array(PLAYER_RECORD_FIELDS), bins: [new Uint8Array(PLAYER_RECORD_BYTES), new Uint8Array(PLAYER_RECORD_BYTES)], flip: 0, gen }
      playerEncPool.set(p.id, rec)
    }
    rec.gen = gen
    m.set(p.id, encodePlayerInto(p, rec))
  }
  if ((gen & 255) === 0 && playerEncPool.size > m.size) {
    for (const [id, rec] of playerEncPool) if (rec.gen !== gen) playerEncPool.delete(id)
  }
  return m
}

export const encodeReducedPlayer = (p) => {
  const [px, , pz] = p.position
  return packReducedPlayerPose(p.id, px, pz, yawNOf(p.lookYaw))
}

export const filterEncodedPlayers = (encodedMap, nearbyIds) => {
  const out = []
  for (const id of nearbyIds) {
    const enc = encodedMap.get(id)
    if (enc) out.push(enc)
  }
  return out
}

export const filterEncodedPlayersWithSelf = (encodedMap, nearbyIds, selfId) => {
  const out = []
  let hasSelf = false
  for (let i = 0; i < nearbyIds.length; i++) {
    const id = nearbyIds[i]
    if (id === selfId) hasSelf = true
    const enc = encodedMap.get(id)
    if (enc) out.push(enc)
  }
  if (!hasSelf) {
    const self = encodedMap.get(selfId)
    if (self) out.push(self)
  }
  return out
}

const dist2 = (ax, ay, az, bx, by, bz) => {
  const dx = ax - bx, dy = ay - by, dz = az - bz
  return dx * dx + dy * dy + dz * dz
}

export const buildCrowdDots = (players, viewerPos, dotCellM) => {
  if (!players || players.length === 0) return []
  const cell = dotCellM || CROWD_DOT_CELL_M
  const buckets = new Map()
  for (const p of players) {
    const pos = p.position
    if (!pos) continue
    const cx = Math.floor(pos[0] / cell), cz = Math.floor(pos[2] / cell)
    const key = `${cx},${cz}`
    const bucket = buckets.get(key)
    if (bucket) bucket[2]++
    else buckets.set(key, [cx, cz, 1])
  }
  return [...buckets.values()]
}

const tierIds = []
const tierD2 = []
const tierOrder = []
const compareTierD2 = (a, b) => tierD2[a] - tierD2[b]

export const classifyPlayerTiers = (playersById, nearbyIds, viewerPos, selfId) => {
  const vx = viewerPos[0], vy = viewerPos[1], vz = viewerPos[2]
  const ids = tierIds, d2 = tierD2, order = tierOrder
  ids.length = 0
  d2.length = 0
  order.length = 0
  for (const id of nearbyIds) {
    if (id === selfId) continue
    const p = playersById.get(id)
    if (!p || !p.position) continue
    order.push(ids.length)
    ids.push(id)
    d2.push(dist2(p.position[0], p.position[1], p.position[2], vx, vy, vz))
  }
  order.sort(compareTierD2)
  const full = [], reduced = [], dotPlayers = []
  for (let i = 0; i < order.length; i++) {
    const k = order[i]
    const id = ids[k]
    if (i < PLAYER_LOD_FULL_COUNT) full.push(id)
    else if (d2[k] < PLAYER_LOD_REDUCED2) reduced.push(id)
    else dotPlayers.push(playersById.get(id))
  }
  return { full, reduced, dotPlayers }
}

export const reducedTickModFor = (snapshotHz) => Math.max(1, Math.round(snapshotHz / PLAYER_LOD_REDUCED_HZ))

export const filterEncodedPlayersTiered = (encodedMap, playersById, nearbyIds, selfId, viewerPos, tick, reducedTickMod) => {
  const { full, reduced, dotPlayers } = classifyPlayerTiers(playersById, nearbyIds, viewerPos, selfId)
  const out = []
  const selfEnc = encodedMap.get(selfId)
  if (selfEnc) out.push(selfEnc)
  for (const id of full) {
    const enc = encodedMap.get(id)
    if (enc) out.push(enc)
  }
  const mod = Math.max(1, reducedTickMod || 1)
  for (const id of reduced) {
    if (mod > 1 && (tick % mod) !== 0) continue
    const p = playersById.get(id)
    if (p) out.push(encodeReducedPlayer(p))
  }
  return { players: out, dots: buildCrowdDots(dotPlayers, viewerPos) }
}
