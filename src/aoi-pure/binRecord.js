import { WIRE_UNITS_PER_METER } from './constants.js'

const getI32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) / WIRE_UNITS_PER_METER
const getI16 = (b, o) => (((b[o] | (b[o + 1] << 8)) << 16) >> 16) / WIRE_UNITS_PER_METER

export function unpackBinRecord(buf, out) {
  const b = buf instanceof DataView ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) : buf
  out.px = getI32(b, 0); out.py = getI32(b, 4); out.pz = getI32(b, 8)
  out.vx = getI16(b, 12); out.vy = getI16(b, 14); out.vz = getI16(b, 16)
  out.qrot = (b[18] | (b[19] << 8) | (b[20] << 16)) + b[21] * 16777216
  out.sx = (b[22] | (b[23] << 8)) / WIRE_UNITS_PER_METER
  out.sy = (b[24] | (b[25] << 8)) / WIRE_UNITS_PER_METER
  out.sz = (b[26] | (b[27] << 8)) / WIRE_UNITS_PER_METER
  out.flags = b[28]
  return out
}

const decodeScratch = {}

export function primeEntryDecode(entry) {
  if (entry._pBin === entry.enc[2]) return entry
  unpackBinRecord(entry.enc[2], decodeScratch)
  entry._pBin = entry.enc[2]
  entry._pX = decodeScratch.px
  entry._pY = decodeScratch.py
  entry._pZ = decodeScratch.pz
  const velSq = decodeScratch.vx * decodeScratch.vx + decodeScratch.vy * decodeScratch.vy + decodeScratch.vz * decodeScratch.vz
  entry._pVelScore = velSq >= 100 ? 1 : Math.sqrt(velSq) * 0.1
  return entry
}
