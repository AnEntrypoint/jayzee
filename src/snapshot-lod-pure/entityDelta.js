import { ENTITY_RECORD_BYTES, encodeEntityRecord } from '../wire/index.js'
import { primeEntryDecode, unpackBinRecord } from '../aoi-pure/binRecord.js'
import {
  FIELD_BODY,
  FIELD_CUSTOM,
  FIELD_MODEL,
  FIELD_POS,
  FIELD_ROT,
  FIELD_SCALE,
  FIELD_SLEEP,
  FIELD_VEL,
  MID2,
  NEAR2,
  PROP_MAX_HZ,
  PROP_SLEEP_TICKMOD,
  SNAPSHOT_ENTITY_ENC_CODE_VERSION
} from './constants.js'
import { FNV1A_32_OFFSET_BASIS, fnv1aStepBytes, fnv1aStepFloat32, fnv1aStepString } from './fnv1a.js'
import { packRotationWord } from './records.js'

const VEL_ZERO = [0, 0, 0]
const SCALE_ONE = [1, 1, 1]
const distScratch = {}
const binA = {}
const binB = {}

const packEntityBin = (e, into) => {
  const pos = e.position, rot = e.rotation, v = e.velocity || VEL_ZERO, s = e.scale || SCALE_ONE
  return encodeEntityRecord({
    position: [pos[0], pos[1], pos[2]],
    rotationWord: packRotationWord(rot[0], rot[1], rot[2], rot[3]),
    velocity: [v[0] || 0, v[1] || 0, v[2] || 0],
    scale: [s[0] || 1, s[1] || 1, s[2] || 1],
    flags: 0
  }, into)
}

const writeEntityEncFields = (e, enc) => {
  enc[0] = e.id
  enc[1] = e.model || ''
  enc[3] = e.bodyType || 'static'
  enc[4] = e.custom || null
  enc[5] = e._dynSleeping ? 1 : 0
  return enc
}

const fillEntityEnc = (e, enc) => {
  enc[2] = packEntityBin(e)
  return writeEntityEncFields(e, enc)
}

export const encodeEntity = (e) => fillEntityEnc(e, new Array(6))

const binBytesEqual = (a, b) => {
  for (let i = 0; i < ENTITY_RECORD_BYTES; i++) if (a[i] !== b[i]) return false
  return true
}

const refreshEntryEnc = (e, entry) => {
  const enc = entry.enc
  let changed = entry.binVersion !== SNAPSHOT_ENTITY_ENC_CODE_VERSION
  entry.binVersion = SNAPSHOT_ENTITY_ENC_CODE_VERSION
  const cv = typeof e._customV === 'number' ? e._customV : null
  if (cv !== null && cv !== entry._lastCustomV) changed = true
  entry._lastCustomV = cv
  if (enc[0] !== e.id) {
    enc[0] = e.id
    changed = true
  }
  const model = e.model || ''
  if (enc[1] !== model) {
    enc[1] = model
    changed = true
  }
  const bodyType = e.bodyType || 'static'
  if (enc[3] !== bodyType) {
    enc[3] = bodyType
    changed = true
  }
  const custom = e.custom || null
  if (enc[4] !== custom) {
    enc[4] = custom
    changed = true
  }
  const sleeping = e._dynSleeping ? 1 : 0
  if (enc[5] !== sleeping) {
    enc[5] = sleeping
    changed = true
  }
  const scratch = entry.bins[entry.flip ^ 1]
  packEntityBin(e, scratch)
  const live = enc[2]
  if (!live || !binBytesEqual(live, scratch)) {
    enc[2] = scratch
    entry.flip ^= 1
    changed = true
  }
  return changed
}

export class TombstoneLog {
  constructor() {
    this._list = []
    this._minTick = 0
  }

  push(id, tick) {
    this._list.push({ id, tick })
  }

  pruneBefore(minTick) {
    if (this._list.length === 0) return
    let i = 0
    while (i < this._list.length && this._list[i].tick < minTick) i++
    if (i > 0) this._list = this._list.slice(i)
    this._minTick = minTick
  }

  forClient(sinceTick, prevEntityMap, out) {
    out.length = 0
    for (let i = 0; i < this._list.length; i++) {
      const t = this._list[i]
      if (t.tick > sinceTick && prevEntityMap.has(t.id)) out.push(t.id)
    }
    return out
  }
}

const computeFieldDelta = (prevEnc, enc) => {
  if (!prevEnc) return null
  let mask = 0
  const a = prevEnc[2], b = enc[2]
  let binChanged = a !== b
  if (binChanged) {
    binChanged = false
    for (let i = 0; i < ENTITY_RECORD_BYTES; i++) {
      if (a[i] !== b[i]) {
        binChanged = true
        break
      }
    }
  }
  if (binChanged) {
    unpackBinRecord(a, binA)
    unpackBinRecord(b, binB)
    if (binA.px !== binB.px || binA.py !== binB.py || binA.pz !== binB.pz) mask |= FIELD_POS
    if (binA.qrot !== binB.qrot) mask |= FIELD_ROT
    if (binA.vx !== binB.vx || binA.vy !== binB.vy || binA.vz !== binB.vz) mask |= FIELD_VEL
    if (binA.sx !== binB.sx || binA.sy !== binB.sy || binA.sz !== binB.sz) mask |= FIELD_SCALE
  }
  if (enc[3] !== prevEnc[3]) mask |= FIELD_BODY
  if (enc[4] !== prevEnc[4]) mask |= FIELD_CUSTOM
  if (enc[5] !== prevEnc[5]) mask |= FIELD_SLEEP
  if (enc[1] !== prevEnc[1]) mask |= FIELD_MODEL
  if (mask === 0) return null
  const out = [enc[0], mask]
  if (mask & FIELD_MODEL) out.push(enc[1])
  if (mask & (FIELD_POS | FIELD_ROT | FIELD_VEL | FIELD_SCALE)) out.push(enc[2])
  if (mask & FIELD_BODY) out.push(enc[3])
  if (mask & FIELD_CUSTOM) out.push(enc[4])
  if (mask & FIELD_SLEEP) out.push(enc[5])
  return out
}

const buildEntityKey = (enc, custKey) => {
  let hash = FNV1A_32_OFFSET_BASIS
  hash = fnv1aStepString(hash, enc[1])
  hash = fnv1aStepBytes(hash, enc[2])
  hash = fnv1aStepString(hash, enc[3])
  hash = fnv1aStepString(hash, '' + custKey)
  hash = fnv1aStepFloat32(hash, enc[5])
  return hash >>> 0
}

const custToStr = (cust) => (cust != null ? JSON.stringify(cust) : '')

const resolveCustKey = (e, cust, prevCust, prevKey) => {
  if (e && typeof e._customV === 'number') return e._customV
  return (prevCust === cust) ? prevKey : custToStr(cust)
}

const resolveKey = (entry) => {
  if (!entry._dirty) return entry.k
  const cust = entry.enc[4]
  entry.custStr = resolveCustKey(entry.srcEntity, cust, entry.cust, entry.custStr)
  entry.cust = cust
  entry.k = buildEntityKey(entry.enc, entry.custStr)
  entry._dirty = false
  return entry.k
}

const buildEntry = (e, id, prevCache, sleeping, simulated) => {
  const bins = [new Uint8Array(ENTITY_RECORD_BYTES), new Uint8Array(ENTITY_RECORD_BYTES)]
  const enc = new Array(6)
  enc[2] = packEntityBin(e, bins[0])
  writeEntityEncFields(e, enc)
  const cust = enc[4]
  const prev = prevCache?.get(id)
  const custStr = resolveCustKey(e, cust, prev?.cust, prev?.custStr)
  return {
    enc,
    k: buildEntityKey(enc, custStr),
    cust,
    custStr,
    isEnv: !!e.custom?._interior,
    sleeping: !!sleeping,
    _sleepJustSet: !!sleeping,
    simulated: !!simulated,
    _dirty: false,
    srcEntity: e,
    _lastCustomV: typeof e._customV === 'number' ? e._customV : null,
    _pBin: null,
    _pX: 0,
    _pY: 0,
    _pZ: 0,
    _pVelScore: 0,
    bins,
    flip: 0,
    binVersion: SNAPSHOT_ENTITY_ENC_CODE_VERSION
  }
}

const stripVelocityForFar = (enc) => {
  unpackBinRecord(enc[2], distScratch)
  const noVelBin = encodeEntityRecord({
    position: [distScratch.px, distScratch.py, distScratch.pz],
    rotationWord: distScratch.qrot,
    velocity: [0, 0, 0],
    scale: [distScratch.sx, distScratch.sy, distScratch.sz],
    flags: distScratch.flags
  })
  return [enc[0], enc[1], noVelBin, enc[3], enc[4], enc[5]]
}

const nearestViewerDist2 = (entry, viewers) => {
  primeEntryDecode(entry)
  let best = Infinity
  for (let i = 0; i + 2 < viewers.length; i += 3) {
    const dx = entry._pX - viewers[i], dy = entry._pY - viewers[i + 1], dz = entry._pZ - viewers[i + 2]
    const d2 = dx * dx + dy * dy + dz * dz
    if (d2 < best) best = d2
  }
  return best
}

const BASELINE_LENGTH = 7

const copyBaseline = (enc, pool) => {
  let base = pool !== null && pool.length > 0 ? pool.pop() : null
  if (base === null) {
    base = [0, '', new Uint8Array(ENTITY_RECORD_BYTES), '', null, 0]
    if (pool !== null) base.push(true)
  }
  base[0] = enc[0]
  base[1] = enc[1]
  base[2].set(enc[2])
  base[3] = enc[3]
  base[4] = enc[4]
  base[5] = enc[5]
  return base
}

const releaseBaseline = (prev, pool) => {
  if (pool === null || !prev) return
  const base = prev[3]
  if (base && base.length === BASELINE_LENGTH) pool.push(base)
}

const applyEntry = (id, entry, nextMap, entities, prevEntityMap, viewers, snapshotSeq, propModCap, pool = null) => {
  const k = resolveKey(entry)
  let enc = entry.enc
  let farTier = false
  let extraMod = 1
  if (!entry.isEnv) {
    if (entry.sleeping) {
      if (entry._sleepJustSet) entry._sleepJustSet = false
      else extraMod = PROP_SLEEP_TICKMOD
    } else if (propModCap > 1 && entry.simulated) {
      extraMod = propModCap
    }
  }
  const prev = prevEntityMap.get(id)
  const prevCustStr = prev?.[2]
  const viewerMissedCustomChange = prevCustStr !== entry.custStr
  if (extraMod !== 1 && viewerMissedCustomChange) extraMod = 1
  let tickMod = extraMod
  if (viewers && !entry.isEnv) {
    const d2 = nearestViewerDist2(entry, viewers)
    const distTickMod = d2 < NEAR2 ? 1 : d2 < MID2 ? 4 : 16
    farTier = distTickMod === 16
    if (distTickMod > tickMod) tickMod = distTickMod
  }
  const viewerHasBaseline = !!prev
  if (viewerHasBaseline && tickMod !== 1 && (snapshotSeq % tickMod) !== 0) {
    nextMap.set(id, prev)
    return
  }
  if (prev && prev[0] === k) {
    nextMap.set(id, prev)
    return
  }
  if (farTier) enc = stripVelocityForFar(enc)
  const fd = prev && prev[3] ? computeFieldDelta(prev[3], enc) : null
  if (fd !== null && farTier && fd[1] === FIELD_ROT) {
    nextMap.set(id, prev)
    return
  }
  nextMap.set(id, [k, entry.cust, entry.custStr, copyBaseline(enc, pool)])
  releaseBaseline(prev, pool)
  entities.push(fd !== null ? fd : enc)
}

export const propTickMod = (snapHz) => {
  if (!snapHz || snapHz <= PROP_MAX_HZ) return 1
  return Math.max(1, Math.ceil(snapHz / PROP_MAX_HZ))
}

export const updateTombstones = (tombstoneLog, tick, dynCache, staticEntityIds, prevKnownIds) => {
  const staticSize = staticEntityIds ? staticEntityIds.size : 0
  if (prevKnownIds && prevKnownIds._dyn === dynCache && prevKnownIds._dynSize === dynCache.size && prevKnownIds._static === staticEntityIds && prevKnownIds._staticSize === staticSize) return prevKnownIds
  const known = new Set(dynCache.keys())
  if (staticEntityIds) for (const id of staticEntityIds) known.add(id)
  if (prevKnownIds) {
    for (const id of prevKnownIds) {
      if (!known.has(id)) tombstoneLog.push(id, tick)
    }
  }
  known._dyn = dynCache
  known._dynSize = dynCache.size
  known._static = staticEntityIds
  known._staticSize = staticSize
  return known
}

export {
  applyEntry,
  buildEntry,
  buildEntityKey,
  computeFieldDelta,
  refreshEntryEnc,
  resolveCustKey
}
