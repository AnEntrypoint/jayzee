export const CELL_SIZE_M = 32

const NONE = -1
const HASH_X = 73856093
const HASH_Y = 19349663
const HASH_Z = 83492791

function refuse(what) {
  throw new TypeError('[CellIndex3D] ' + what)
}

function tableSizeFor(capacity) {
  let size = 2
  while (size < capacity * 2) size *= 2
  return size
}

export function createCellIndex3D(config) {
  const capacity = config ? config.capacity : undefined
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 0x3fffffff) refuse('capacity ' + String(capacity) + ' is not a positive integer: the index sizes every array once from its budget, so the budget is stated at construction')
  const cellSize = config.cellSize === undefined ? CELL_SIZE_M : config.cellSize
  if (typeof cellSize !== 'number' || !Number.isFinite(cellSize) || !(cellSize > 0)) refuse('cellSize ' + String(cellSize) + ' is not a positive finite length in metres')

  const tableSize = tableSizeFor(capacity)
  const mask = tableSize - 1
  const heads = new Int32Array(tableSize).fill(NONE)
  const next = new Int32Array(capacity).fill(NONE)
  const prev = new Int32Array(capacity).fill(NONE)
  const bucketOf = new Int32Array(capacity).fill(NONE)
  const cellX = new Int32Array(capacity)
  const cellY = new Int32Array(capacity)
  const cellZ = new Int32Array(capacity)
  const position = new Float64Array(capacity * 3)
  const live = new Uint8Array(capacity)
  const stats = { visited: 0, cellsProbed: 0, scans: 0, overflow: 0 }
  let count = 0
  let mutations = 0
  let upZ = 0

  const coord = (v) => Math.floor(v / cellSize)
  const bucket = (cx, cy, cz) => (Math.imul(cx, HASH_X) ^ Math.imul(cy, HASH_Y) ^ Math.imul(cz, HASH_Z)) & mask

  const slotOk = (slot) => Number.isInteger(slot) && slot >= 0 && slot < capacity

  function unlink(slot) {
    const b = bucketOf[slot]
    const n = next[slot], p = prev[slot]
    if (p === NONE) heads[b] = n
    else next[p] = n
    if (n !== NONE) prev[n] = p
    next[slot] = NONE
    prev[slot] = NONE
    bucketOf[slot] = NONE
  }

  function link(slot, cx, cy, cz) {
    const b = bucket(cx, cy, cz)
    const head = heads[b]
    next[slot] = head
    prev[slot] = NONE
    if (head !== NONE) prev[head] = slot
    heads[b] = slot
    bucketOf[slot] = b
    cellX[slot] = cx
    cellY[slot] = cy
    cellZ[slot] = cz
  }

  function set(slot, x, y, z) {
    if (!slotOk(slot)) refuse('slot ' + String(slot) + ' is outside the budget of ' + capacity + ': a slot is an integer from 0 to capacity - 1')
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      remove(slot)
      return false
    }
    const cx = coord(x), cy = coord(y), cz = coord(z)
    if (live[slot] === 1) {
      if (cellX[slot] !== cx || cellY[slot] !== cy || cellZ[slot] !== cz) {
        unlink(slot)
        link(slot, cx, cy, cz)
        mutations++
      }
    } else {
      live[slot] = 1
      count++
      link(slot, cx, cy, cz)
      mutations++
    }
    const o = slot * 3
    position[o] = x
    position[o + 1] = y
    position[o + 2] = z
    return true
  }

  function remove(slot) {
    if (!slotOk(slot) || live[slot] === 0) return false
    unlink(slot)
    live[slot] = 0
    count--
    mutations++
    return true
  }

  function clear() {
    heads.fill(NONE)
    next.fill(NONE)
    prev.fill(NONE)
    bucketOf.fill(NONE)
    live.fill(0)
    count = 0
    mutations++
  }

  function has(slot) {
    return slotOk(slot) && live[slot] === 1
  }

  function readPosition(slot, out) {
    if (!has(slot)) return false
    const o = slot * 3
    out[0] = position[o]
    out[1] = position[o + 1]
    out[2] = position[o + 2]
    return true
  }

  function checkQuery(label, x, y, z, radius, out) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) refuse(label + ' got centre (' + x + ', ' + y + ', ' + z + '): a query centre is three finite numbers')
    if (typeof radius !== 'number' || !Number.isFinite(radius) || radius < 0) refuse(label + ' got radius ' + String(radius) + ': a query radius is a finite non-negative length')
    if (!(out instanceof Int32Array) && !(out instanceof Uint32Array)) refuse(label + ' got no result array: the caller owns a fixed integer array and the query fills it, so no result list is allocated per query')
  }

  function sortSlots(out, n) {
    for (let i = 1; i < n; i++) {
      const v = out[i]
      let j = i - 1
      while (j >= 0 && out[j] > v) { out[j + 1] = out[j]; j-- }
      out[j + 1] = v
    }
  }

  function gather(x, y, z, radius, out, accept, a, b, c, d) {
    const limit = out.length
    let n = 0
    let dropped = 0
    const x0 = coord(x - radius), x1 = coord(x + radius)
    const y0 = coord(y - radius), y1 = coord(y + radius)
    const z0 = coord(z - radius), z1 = coord(z + radius)
    const cells = (x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1)
    if (cells > count) {
      stats.scans++
      for (let slot = 0; slot < capacity; slot++) {
        if (live[slot] === 0) continue
        stats.visited++
        if (!accept(position, slot * 3, x, y, z, a, b, c, d)) continue
        if (n < limit) out[n++] = slot
        else dropped++
      }
      stats.overflow += dropped
      return dropped > 0 ? -n - 1 : n
    }
    for (let gx = x0; gx <= x1; gx++) {
      for (let gy = y0; gy <= y1; gy++) {
        for (let gz = z0; gz <= z1; gz++) {
          stats.cellsProbed++
          let slot = heads[bucket(gx, gy, gz)]
          while (slot !== NONE) {
            if (cellX[slot] === gx && cellY[slot] === gy && cellZ[slot] === gz) {
              stats.visited++
              if (accept(position, slot * 3, x, y, z, a, b, c, d)) {
                if (n < limit) out[n++] = slot
                else dropped++
              }
            }
            slot = next[slot]
          }
        }
      }
    }
    sortSlots(out, n)
    stats.overflow += dropped
    return dropped > 0 ? -n - 1 : n
  }

  function insideSphere(p, o, x, y, z, r2) {
    const dx = p[o] - x, dy = p[o + 1] - y, dz = p[o + 2] - z
    return dx * dx + dy * dy + dz * dz <= r2
  }

  function insideRadialCylinder(p, o, x, y, z, r2, halfHeight, ux, uy) {
    const dx = p[o] - x, dy = p[o + 1] - y, dz = p[o + 2] - z
    const along = dx * ux + dy * uy + dz * upZ
    if (along > halfHeight || along < -halfHeight) return false
    return dx * dx + dy * dy + dz * dz - along * along <= r2
  }

  function querySphere(x, y, z, radius, out) {
    checkQuery('querySphere', x, y, z, radius, out)
    return gather(x, y, z, radius, out, insideSphere, radius * radius, 0, 0, 0)
  }

  function queryRadialCylinder(x, y, z, radius, halfHeight, out) {
    checkQuery('queryRadialCylinder', x, y, z, radius, out)
    if (typeof halfHeight !== 'number' || !Number.isFinite(halfHeight) || halfHeight < 0) refuse('queryRadialCylinder got halfHeight ' + String(halfHeight) + ': the extent along the local up is a finite non-negative length')
    const len = Math.sqrt(x * x + y * y + z * z)
    if (!(len > 0)) refuse('queryRadialCylinder got a centre at the planet centre: the local up is the direction from the planet centre to the query centre, so the centre itself has no up')
    upZ = z / len
    const reach = Math.sqrt(radius * radius + halfHeight * halfHeight)
    return gather(x, y, z, reach, out, insideRadialCylinder, radius * radius, halfHeight, x / len, y / len)
  }

  function nearest(x, y, z, radius) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) refuse('nearest got centre (' + x + ', ' + y + ', ' + z + '): a query centre is three finite numbers')
    if (typeof radius !== 'number' || !Number.isFinite(radius) || radius < 0) refuse('nearest got radius ' + String(radius) + ': a query radius is a finite non-negative length')
    let best = NONE
    let bestD2 = radius * radius
    const x0 = coord(x - radius), x1 = coord(x + radius)
    const y0 = coord(y - radius), y1 = coord(y + radius)
    const z0 = coord(z - radius), z1 = coord(z + radius)
    const cells = (x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1)
    if (cells > count) {
      stats.scans++
      for (let slot = 0; slot < capacity; slot++) {
        if (live[slot] === 0) continue
        const o = slot * 3
        const dx = position[o] - x, dy = position[o + 1] - y, dz = position[o + 2] - z
        const d2 = dx * dx + dy * dy + dz * dz
        if (d2 < bestD2 || (d2 === bestD2 && best === NONE)) { bestD2 = d2; best = slot }
      }
      return best
    }
    for (let gx = x0; gx <= x1; gx++) {
      for (let gy = y0; gy <= y1; gy++) {
        for (let gz = z0; gz <= z1; gz++) {
          let slot = heads[bucket(gx, gy, gz)]
          while (slot !== NONE) {
            if (cellX[slot] === gx && cellY[slot] === gy && cellZ[slot] === gz) {
              const o = slot * 3
              const dx = position[o] - x, dy = position[o + 1] - y, dz = position[o + 2] - z
              const d2 = dx * dx + dy * dy + dz * dz
              if (d2 < bestD2 || (d2 === bestD2 && (best === NONE || slot < best))) { bestD2 = d2; best = slot }
            }
            slot = next[slot]
          }
        }
      }
    }
    return best
  }

  function resetStats() {
    stats.visited = 0
    stats.cellsProbed = 0
    stats.scans = 0
    stats.overflow = 0
  }

  return {
    capacity,
    cellSize,
    tableSize,
    stats,
    buffers: Object.freeze({ heads, next, prev, bucketOf, cellX, cellY, cellZ, position, live }),
    set,
    remove,
    clear,
    has,
    readPosition,
    querySphere,
    queryRadialCylinder,
    nearest,
    resetStats,
    get size() { return count },
    get mutations() { return mutations },
  }
}

export function resultCount(returned) {
  return returned < 0 ? -returned - 1 : returned
}

export function resultTruncated(returned) {
  return returned < 0
}
