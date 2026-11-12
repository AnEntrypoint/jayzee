import { pack } from '../protocol/msgpack.js'

const ARENA_BYTES = 1 << 18
const COPY_LOOP_MAX = 32
const KIND_UNSHAREABLE = 0
const KIND_SCALARS = 1
const KIND_WITH_BINS = 2

export const snapshotPackCounts = { splices: 0, refusals: 0, recordPacks: 0, recordShares: 0 }

const PROBE_INSERT = Uint8Array.of(0x41, 0x00, 0x00, 0x00, 0x90)
const BUNDLE_MARKER_0 = 0xd6
const BUNDLE_MARKER_1 = 0x62
const BUNDLE_OFFSET_AT = 2
const TAIL_FIELDS = 7
const TAIL_HEADER = 0x90 | TAIL_FIELDS
const RECORD_ENVELOPE = 0x40
const RECORD_PAYLOAD = 0x41

const _heads = new Map()
const _numbers = [0, 0, 0]
const _fields = [undefined, undefined, undefined, undefined, undefined, undefined, undefined]
const _recs = []
let _arena = null
let _arenaUsed = 0

function readUint32(bytes, at) {
  return ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0
}

function writeUint32(bytes, at, value) {
  bytes[at] = (value >>> 24) & 0xff
  bytes[at + 1] = (value >>> 16) & 0xff
  bytes[at + 2] = (value >>> 8) & 0xff
  bytes[at + 3] = value & 0xff
}

function rangesEqual(a, aFrom, b, bFrom, length) {
  if (aFrom + length > a.length || bFrom + length > b.length) return false
  for (let i = 0; i < length; i++) if (a[aFrom + i] !== b[bFrom + i]) return false
  return true
}

function typeSpanHolds(probe, flat, span) {
  if (1 + span + PROBE_INSERT.length > probe.length) return null
  if (!rangesEqual(probe, 1 + span, PROBE_INSERT, 0, PROBE_INSERT.length)) return null
  const restLength = flat.length - 1 - span
  if (probe.length !== flat.length + PROBE_INSERT.length) return null
  if (!rangesEqual(probe, 1 + span + PROBE_INSERT.length, flat, 1 + span, restLength)) return null
  const bundled = span >= BUNDLE_OFFSET_AT + 4 && flat[1] === BUNDLE_MARKER_0 && flat[2] === BUNDLE_MARKER_1
  if (!bundled) return rangesEqual(probe, 1, flat, 1, span) ? { span, bundled: false } : null
  if (!rangesEqual(probe, 1, flat, 1, BUNDLE_OFFSET_AT)) return null
  if (!rangesEqual(probe, 1 + BUNDLE_OFFSET_AT + 4, flat, 1 + BUNDLE_OFFSET_AT + 4, span - BUNDLE_OFFSET_AT - 4)) return null
  if (readUint32(probe, 1 + BUNDLE_OFFSET_AT) !== readUint32(flat, 1 + BUNDLE_OFFSET_AT) + PROBE_INSERT.length) return null
  return { span, bundled: true }
}

function snapshotHead(type) {
  let head = _heads.get(type)
  if (head !== undefined) return head
  head = null
  const kind = typeof type
  if ((kind === 'number' && Number.isFinite(type)) || kind === 'string') {
    const probe = pack({ type, payload: { seq: 0, tick: 0, serverTime: 0, players: [], entities: [], removed: undefined, delta: 1, dots: undefined, me: undefined, chartEpoch: 0 } })
    const flat = pack([type, [], undefined, 1, undefined, undefined, 0])
    if (probe[0] === RECORD_ENVELOPE && flat[0] === TAIL_HEADER) {
      for (let span = 1; span < flat.length && head === null; span++) head = typeSpanHolds(probe, flat, span)
    }
  }
  _heads.set(type, head)
  return head
}

function arrayHeaderLength(n) {
  return n < 16 ? 1 : n < 0x10000 ? 3 : 5
}

function writeArrayHeader(out, offset, n) {
  if (n < 16) { out[offset] = 0x90 | n; return offset + 1 }
  if (n < 0x10000) { out[offset] = 0xdc; out[offset + 1] = n >> 8; out[offset + 2] = n & 0xff; return offset + 3 }
  out[offset] = 0xdd
  out[offset + 1] = (n >>> 24) & 0xff
  out[offset + 2] = (n >>> 16) & 0xff
  out[offset + 3] = (n >>> 8) & 0xff
  out[offset + 4] = n & 0xff
  return offset + 5
}

function copyRange(out, src, from, offset) {
  const length = src.length - from
  if (length < COPY_LOOP_MAX) {
    for (let i = 0; i < length; i++) out[offset + i] = src[from + i]
  } else {
    out.set(from === 0 ? src : src.subarray(from), offset)
  }
  return offset + length
}

function carve(length) {
  if (_arena === null || _arenaUsed + length > _arena.length) {
    const size = Math.max(ARENA_BYTES, length)
    _arena = typeof Buffer !== 'undefined' ? Buffer.allocUnsafeSlow(size) : new Uint8Array(size)
    _arenaUsed = 0
  }
  const out = _arena.subarray(_arenaUsed, _arenaUsed + length)
  _arenaUsed += length
  return out
}

function recordKind(rec) {
  if (!Array.isArray(rec)) return KIND_UNSHAREABLE
  let kind = KIND_SCALARS
  for (let i = 0; i < rec.length; i++) {
    const v = rec[i]
    if (v instanceof Uint8Array) { kind = KIND_WITH_BINS; continue }
    const t = typeof v
    if (t === 'number' || t === 'boolean' || t === 'undefined' || v === null) continue
    return KIND_UNSHAREABLE
  }
  return kind
}

function sameScalars(values, rec) {
  if (values.length !== rec.length) return false
  for (let i = 0; i < rec.length; i++) if (values[i] !== rec[i]) return false
  return true
}

function copyScalars(values, rec) {
  values.length = rec.length
  for (let i = 0; i < rec.length; i++) values[i] = rec[i]
  return values
}

function recordBytes(rec, memo) {
  const known = memo.byRef.get(rec)
  if (known !== undefined) { if (known !== null) snapshotPackCounts.recordShares++; return known }
  const kind = recordKind(rec)
  if (kind === KIND_UNSHAREABLE) { memo.byRef.set(rec, null); return null }
  if (kind === KIND_WITH_BINS) {
    const bytes = pack(rec)
    memo.byRef.set(rec, bytes)
    snapshotPackCounts.recordPacks++
    return bytes
  }
  const cached = memo.byId.get(rec[0])
  if (cached !== undefined && sameScalars(cached.values, rec)) { snapshotPackCounts.recordShares++; return cached.bytes }
  const bytes = pack(rec)
  if (cached === undefined) memo.byId.set(rec[0], { values: rec.slice(), bytes })
  else { copyScalars(cached.values, rec); cached.bytes = bytes }
  snapshotPackCounts.recordPacks++
  return bytes
}

export function newRecordMemo() {
  return { byRef: new WeakMap(), byId: new Map() }
}

export function packSnapshotBytes(type, seq, encoded, me, chartEpoch, memo) {
  const head = snapshotHead(type)
  const players = encoded.players
  if (head === null || !Array.isArray(players)) { snapshotPackCounts.refusals++; return null }
  const n = players.length
  _numbers[0] = seq; _numbers[1] = encoded.tick; _numbers[2] = encoded.serverTime
  const numbers = pack(_numbers)
  let inserted = 1 + (numbers.length - 1) + arrayHeaderLength(n)
  for (let i = 0; i < n; i++) {
    const bytes = recordBytes(players[i], memo)
    if (bytes === null) { snapshotPackCounts.refusals++; return null }
    _recs[i] = bytes
    inserted += bytes.length
  }
  _fields[0] = type
  _fields[1] = encoded.entities; _fields[2] = encoded.removed; _fields[3] = encoded.delta
  _fields[4] = encoded.dots; _fields[5] = me; _fields[6] = chartEpoch
  const flat = pack(_fields)
  _fields[1] = undefined; _fields[4] = undefined; _fields[5] = undefined
  const span = head.span
  if (flat[0] !== TAIL_HEADER || flat.length < 1 + span) { snapshotPackCounts.refusals++; return null }
  const out = carve(flat.length + inserted)
  snapshotPackCounts.splices++
  out[0] = RECORD_ENVELOPE
  for (let i = 0; i < span; i++) out[1 + i] = flat[1 + i]
  if (head.bundled) writeUint32(out, 1 + BUNDLE_OFFSET_AT, readUint32(flat, 1 + BUNDLE_OFFSET_AT) + inserted)
  let offset = 1 + span
  out[offset++] = RECORD_PAYLOAD
  offset = copyRange(out, numbers, 1, offset)
  offset = writeArrayHeader(out, offset, n)
  for (let i = 0; i < n; i++) offset = copyRange(out, _recs[i], 0, offset)
  copyRange(out, flat, 1 + span, offset)
  return out
}
