import { CROWD_DOT_CELL_M } from './constants.js'

export const CROWD_DOT_CELL_LIMIT = 32767
const CELL_SPAN = 65536

const zigzag = (n) => (n < 0 ? -2 * n - 1 : 2 * n)
const unzigzag = (n) => (n % 2 === 1 ? -(n + 1) / 2 : n / 2)

const checkCell = (name, c) => {
  if (!Number.isInteger(c) || c < -CROWD_DOT_CELL_LIMIT || c > CROWD_DOT_CELL_LIMIT) {
    throw new RangeError(name + ' must be a whole cell index within ' + CROWD_DOT_CELL_LIMIT + ' cells of the origin, got ' + c)
  }
}

export const packCrowdDotCell = (cx, cz) => {
  checkCell('cx', cx)
  checkCell('cz', cz)
  return zigzag(cx) * CELL_SPAN + zigzag(cz)
}

export const unpackCrowdDotCell = (key, out = [0, 0]) => {
  if (!Number.isInteger(key) || key < 0 || key >= CELL_SPAN * CELL_SPAN) throw new RangeError('a crowd dot key must be a whole number below 2^32, got ' + key)
  const low = key % CELL_SPAN
  out[0] = unzigzag((key - low) / CELL_SPAN)
  out[1] = unzigzag(low)
  return out
}

export const crowdDotCellOf = (x, z, dotCellM = CROWD_DOT_CELL_M) => {
  if (!(dotCellM > 0)) throw new RangeError('dotCellM must be above zero')
  if (!Number.isFinite(x) || !Number.isFinite(z)) throw new RangeError('a crowd dot position must be finite')
  return packCrowdDotCell(Math.floor(x / dotCellM), Math.floor(z / dotCellM))
}

export const createCrowdDotBuckets = () => {
  const counts = new Map()
  const add = (x, z, dotCellM) => {
    const key = crowdDotCellOf(x, z, dotCellM)
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  const build = (players, dotCellM = CROWD_DOT_CELL_M, out = []) => {
    counts.clear()
    out.length = 0
    if (!players) return out
    for (const p of players) {
      const pos = p && p.position
      if (pos) add(pos[0], pos[2], dotCellM)
    }
    for (const [key, count] of counts) out.push(key, count)
    return out
  }
  return { build }
}

export const encodeCrowdDotKeys = (dots, out = []) => {
  out.length = 0
  if (!dots) return out
  for (const dot of dots) {
    if (!(Number.isInteger(dot[2]) && dot[2] > 0)) throw new RangeError('a crowd dot count must be a whole number above zero')
    out.push(packCrowdDotCell(dot[0], dot[1]), dot[2])
  }
  return out
}

export const decodeCrowdDotKeys = (keys, out = []) => {
  if (!Array.isArray(keys) || keys.length % 2 !== 0) throw new TypeError('crowd dot keys must be a flat list of key and count pairs')
  const count = keys.length / 2
  out.length = count
  for (let i = 0; i < count; i++) {
    const n = keys[i * 2 + 1]
    if (!(Number.isInteger(n) && n > 0)) throw new RangeError('a crowd dot count must be a whole number above zero')
    const record = out[i] || (out[i] = [0, 0, 0])
    unpackCrowdDotCell(keys[i * 2], record)
    record[2] = n
  }
  return out
}
