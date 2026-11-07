import { decodeCustomFields, encodeCustomFields, getComponentSchema } from '../protocol/componentSchema.js'
import { primeEntryDecode, unpackBinRecord } from '../aoi-pure/binRecord.js'
import { HALF_PI, MIN_FULL_ENTITY_RECORD_LEN, PLAYER_RECORD_FIELDS, TAU } from './constants.js'
import { decodeSelfBlock } from './selfBlock.js'
import { packQuat, PLAYER_TIER_FULL, PLAYER_TIER_REDUCED, unpackQuat } from './records.js'
import {
  buildCrowdDots,
  classifyPlayerTiers,
  encodePlayer,
  encodePlayersOnce,
  filterEncodedPlayers,
  filterEncodedPlayersTiered,
  filterEncodedPlayersWithSelf,
  reducedTickModFor
} from './playerLod.js'
import {
  applyEntry,
  buildEntityKey,
  buildEntry,
  computeFieldDelta,
  encodeEntity,
  propTickMod,
  refreshEntryEnc,
  resolveCustKey,
  TombstoneLog,
  updateTombstones
} from './entityDelta.js'

export const encodeCustomBySchema = (schemaName, obj) => {
  const schema = getComponentSchema(schemaName)
  if (!schema) return null
  return encodeCustomFields(schema, obj)
}

export const decodeCustomBySchema = (schemaName, buf) => {
  const schema = getComponentSchema(schemaName)
  if (!schema) return null
  return decodeCustomFields(schema, buf)
}

export class SnapshotEncoder {
  static encodeCustomBySchema(schemaName, obj) { return encodeCustomBySchema(schemaName, obj) }

  static decodeCustomBySchema(schemaName, buf) { return decodeCustomBySchema(schemaName, buf) }

  static encodePlayersOnce(players, needed = null) { return encodePlayersOnce(players, needed) }

  static filterEncodedPlayers(encodedMap, nearbyIds) { return filterEncodedPlayers(encodedMap, nearbyIds) }

  static filterEncodedPlayersWithSelf(encodedMap, nearbyIds, selfId) { return filterEncodedPlayersWithSelf(encodedMap, nearbyIds, selfId) }

  static encodePlayers(players) { return (players || []).map(encodePlayer) }

  static filterEncodedPlayersTiered(encodedMap, playersById, nearbyIds, selfId, viewerPos, tick, reducedTickMod) {
    return filterEncodedPlayersTiered(encodedMap, playersById, nearbyIds, selfId, viewerPos, tick, reducedTickMod)
  }

  static updateTombstones(tombstoneLog, tick, dynCache, staticEntityIds, prevKnownIds) {
    return updateTombstones(tombstoneLog, tick, dynCache, staticEntityIds, prevKnownIds)
  }

  static encodeStaticEntities(entities, prevStaticMap) {
    const nextMap = new Map()
    const allEntries = []
    const changedEntries = []
    let changed = false
    for (const e of entities) {
      if (e.bodyType !== 'static') continue
      const enc = encodeEntity(e)
      const prev = prevStaticMap.get(e.id)
      const cust = enc[4]
      const custStr = resolveCustKey(e, cust, prev?.[1], prev?.[2])
      const k = buildEntityKey(enc, custStr)
      nextMap.set(e.id, [k, cust, custStr])
      allEntries.push({ enc, k, id: e.id })
      if (!prev || prev[0] !== k) {
        changedEntries.push({ enc, k, id: e.id })
        changed = true
      }
    }
    if (nextMap.size !== prevStaticMap.size) changed = true
    return { staticEntries: allEntries, changedEntries, staticMap: nextMap, staticChanged: changed }
  }

  static buildStaticIds(staticMap) { return new Set(staticMap.keys()) }

  static refreshDynamicCache(cache, activeIds, entities, sleepingIds, suspendedIds, unmanagedIds) {
    const envIds = cache._envIds || []
    envIds.length = 0
    for (const id of activeIds) {
      const e = entities.get(id)
      if (!e || e.bodyType === 'static') continue
      let entry = cache.get(id)
      if (entry) {
        if (refreshEntryEnc(e, entry)) entry._dirty = true
        entry.sleeping = false
        entry.simulated = e.bodyType === 'dynamic'
        entry.srcEntity = e
      } else {
        entry = buildEntry(e, id, null, false, e.bodyType === 'dynamic')
        cache.set(id, entry)
      }
      if (entry.isEnv) envIds.push(id)
    }
    if (unmanagedIds) {
      for (const id of unmanagedIds) {
        const e = entities.get(id)
        if (!e) continue
        let entry = cache.get(id)
        if (entry) {
          if (refreshEntryEnc(e, entry)) entry._dirty = true
          entry.sleeping = false
          entry.simulated = false
          entry.srcEntity = e
        } else {
          entry = buildEntry(e, id, null, false, false)
          cache.set(id, entry)
        }
        if (entry.isEnv) envIds.push(id)
      }
    }
    for (const idSet of [sleepingIds, suspendedIds]) {
      if (!idSet) continue
      for (const id of idSet) {
        const entry = cache.get(id)
        if (!entry) continue
        const e = entities.get(id)
        if (!e || e.bodyType === 'static') continue
        if (entry.sleeping) {
          const cv = typeof e._customV === 'number' ? e._customV : null
          const customChangedWhileAsleep = cv !== null && cv !== entry._lastCustomV
          if (customChangedWhileAsleep) {
            entry._lastCustomV = cv
            entry._dirty = true
            entry.srcEntity = e
          }
          continue
        }
        refreshEntryEnc(e, entry)
        entry._dirty = true
        entry.sleeping = true
        entry._sleepJustSet = true
        entry.srcEntity = e
        if (entry.isEnv) envIds.push(id)
      }
    }
    cache._envIds = envIds
    return cache
  }

  static buildDynamicCache(activeIds, sleepingIds, suspendedIds, entities, prevCache, unmanagedIds) {
    const cache = new Map(), envIds = []
    for (const id of activeIds) {
      const e = entities.get(id)
      if (!e || e.bodyType === 'static') continue
      const entry = buildEntry(e, id, prevCache, false, e.bodyType === 'dynamic')
      cache.set(id, entry)
      if (entry.isEnv) envIds.push(id)
    }
    if (unmanagedIds) {
      for (const id of unmanagedIds) {
        const e = entities.get(id)
        if (!e) continue
        const entry = buildEntry(e, id, prevCache, false, false)
        cache.set(id, entry)
        if (entry.isEnv) envIds.push(id)
      }
    }
    for (const idSet of [sleepingIds, suspendedIds]) {
      for (const id of idSet) {
        if (prevCache?.has(id)) {
          const entry = prevCache.get(id)
          cache.set(id, entry)
          if (entry.isEnv) envIds.push(id)
          continue
        }
        const e = entities.get(id)
        if (!e || e.bodyType === 'static') continue
        const entry = buildEntry(e, id, prevCache, true)
        cache.set(id, entry)
        if (entry.isEnv) envIds.push(id)
      }
    }
    cache._envIds = envIds
    return cache
  }

  static encodeDeltaFromCache(tick, serverTime, dynCache, relevantIds, prevEntityMap, preEncodedPlayers, staticEntries, staticEntityMap, staticEntityIds, seqNum, viewerPos, scratch, tombstoneLog, clientLastTick, snapHz) {
    const entities = scratch ? scratch.entities : []
    const nextMap = scratch ? scratch.spareMap : new Map()
    if (scratch) {
      entities.length = 0
      nextMap.clear()
    }
    if (staticEntries) for (const { enc } of staticEntries) entities.push(enc)
    const viewers = (seqNum !== undefined && viewerPos && viewerPos.length >= 3) ? viewerPos : null
    const seq = seqNum || 0
    const propModCap = propTickMod(snapHz)
    const relevantCount = Array.isArray(relevantIds) ? relevantIds.length : (relevantIds ? relevantIds.size : 0)
    const iterIds = (relevantIds && dynCache.size > relevantCount) ? relevantIds : null
    const relevantLookup = (!iterIds && Array.isArray(relevantIds)) ? new Set(relevantIds) : null
    if (iterIds) {
      for (const id of iterIds) {
        const entry = dynCache.get(id)
        if (entry) applyEntry(id, entry, nextMap, entities, prevEntityMap, viewers, seq, propModCap)
      }
      for (const id of (dynCache._envIds || [])) {
        const entry = dynCache.get(id)
        if (entry) applyEntry(id, entry, nextMap, entities, prevEntityMap, null, seq, propModCap)
      }
    } else {
      for (const [id, entry] of dynCache) {
        if (!entry.isEnv && relevantIds && (relevantLookup ? !relevantLookup.has(id) : !relevantIds.has(id))) continue
        applyEntry(id, entry, nextMap, entities, prevEntityMap, viewers, seq, propModCap)
      }
    }
    const removed = scratch ? scratch.removed : []
    if (scratch) removed.length = 0
    if (tombstoneLog) {
      tombstoneLog.forClient(clientLastTick || 0, prevEntityMap, removed)
    } else {
      for (const id of prevEntityMap.keys()) {
        if (!dynCache.has(id) && !(staticEntityIds && staticEntityIds.has(id))) removed.push(id)
      }
    }
    return {
      encoded: { tick: tick || 0, serverTime, players: preEncodedPlayers || [], entities, removed: removed.length ? removed : undefined, delta: 1 },
      entityMap: nextMap
    }
  }

  static encodeDelta(snapshot, prevEntityMap, preEncodedPlayers, staticEntries, staticMap, staticIds) {
    const players = preEncodedPlayers || (snapshot.players || []).map(encodePlayer)
    const dynIds = new Set(), entities = [], nextMap = new Map()
    if (staticEntries) for (const { enc } of staticEntries) entities.push(enc)
    for (const e of snapshot.entities || []) {
      if (e.bodyType === 'static' && staticEntries) continue
      const encoded = encodeEntity(e)
      dynIds.add(e.id)
      const prev = prevEntityMap.get(e.id)
      const cust = encoded[4]
      const custStr = resolveCustKey(e, cust, prev?.[1], prev?.[2])
      const k = buildEntityKey(encoded, custStr)
      nextMap.set(e.id, [k, cust, custStr, encoded])
      if (!prev || prev[0] !== k) {
        if (prev && prev[3]) {
          const fd = computeFieldDelta(prev[3], encoded)
          if (fd) {
            entities.push(fd)
            continue
          }
        }
        entities.push(encoded)
      }
    }
    const removed = []
    for (const id of prevEntityMap.keys()) {
      if (!dynIds.has(id) && !(staticIds && staticIds.has(id))) removed.push(id)
    }
    return {
      encoded: { tick: snapshot.tick || 0, serverTime: snapshot.serverTime, players, entities, removed: removed.length ? removed : undefined, delta: 1 },
      entityMap: nextMap
    }
  }

  static encodeDeltaAcked(snapshot, ackedBaseline, preEncodedPlayers, staticEntries, staticMap, staticIds) {
    const prevEntityMap = ackedBaseline.baseline()
    const r = SnapshotEncoder.encodeDelta(snapshot, prevEntityMap, preEncodedPlayers, staticEntries, staticMap, staticIds)
    ackedBaseline.recordSent(snapshot.tick || 0, r.entityMap)
    return r
  }

  static encode(snapshot) {
    const players = (snapshot.players || []).map(encodePlayer)
    const entities = (snapshot.entities || []).map(encodeEntity)
    return { tick: snapshot.tick || 0, serverTime: snapshot.serverTime, players, entities }
  }

  static decode(data) {
    if (!data.players || !Array.isArray(data.players)) return data
    const bin = {}
    const players = data.players.map((p) => {
      if (!Array.isArray(p)) return p
      if (p.length < PLAYER_RECORD_FIELDS) return null
      unpackBinRecord(p[1], bin)
      const rot = unpackQuat(bin.qrot, [0, 0, 0, 0])
      return {
        id: p[0],
        position: [bin.px, bin.py, bin.pz],
        rotation: rot,
        velocity: [bin.vx, bin.vy, bin.vz],
        onGround: p[2] === 1,
        health: p[3],
        crouch: p[4],
        lookPitch: ((p[5] >> 8) & 0xFF) / 255 * Math.PI - HALF_PI,
        lookYaw: (p[5] & 0xFF) / 256 * TAU,
        expr: p[6],
        weapon: p[7]
      }
    }).filter((p) => p !== null)
    const entities = (data.entities || []).map((e) => {
      if (!Array.isArray(e)) return e
      if (e.length < MIN_FULL_ENTITY_RECORD_LEN) return null
      unpackBinRecord(e[2], bin)
      const rot = unpackQuat(bin.qrot, [0, 0, 0, 0])
      return {
        id: e[0],
        model: e[1],
        position: [bin.px, bin.py, bin.pz],
        rotation: rot,
        velocity: [bin.vx, bin.vy, bin.vz],
        bodyType: e[3],
        custom: e[4],
        scale: [bin.sx, bin.sy, bin.sz],
        sleeping: e[5] === 1
      }
    }).filter((e) => e !== null)
    return {
      tick: data.tick,
      serverTime: data.serverTime,
      players,
      entities,
      delta: data.delta,
      removed: data.removed,
      me: data.me ? decodeSelfBlock(data.me, {}) : undefined
    }
  }
}

export {
  PLAYER_TIER_FULL,
  PLAYER_TIER_REDUCED,
  packQuat,
  unpackBinRecord,
  unpackQuat,
  decodeSelfBlock,
  encodePlayer,
  buildCrowdDots,
  classifyPlayerTiers,
  filterEncodedPlayersTiered,
  reducedTickModFor,
  encodeEntity,
  propTickMod,
  primeEntryDecode,
  updateTombstones,
  TombstoneLog
}
export { encodeSelfBlock } from './selfBlock.js'
export {
  PLAYER_LOD_FULL_COUNT,
  PLAYER_LOD_REDUCED2,
  PLAYER_LOD_REDUCED_HZ,
  PROP_MAX_HZ,
  PROP_SLEEP_TICKMOD
} from './constants.js'
