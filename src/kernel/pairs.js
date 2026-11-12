import { pos as statePos, vel as stateVel, head as stateHead, next as stateNext, cells as stateCells, occupied as stateOccupied, grid as stateGrid } from './state.js'
import { bounceFor } from './respond.js'

const HASH_X = 73856093
const HASH_Y = 19349663
const HASH_Z = 83492791

export const resolvePairs = (count, radius, restitution) => {
  const pos = statePos
  const vel = stateVel
  const head = stateHead
  const next = stateNext
  const cells = stateCells
  const occupied = stateOccupied
  const reach = 2 * radius
  const reach2 = reach * reach
  const buckets = head.length
  const mask = buckets - 1
  const slots = occupied.length
  const wordMask = slots - 1
  const words = (count * 3) | 0
  const grid = stateGrid
  let stale = grid[0] === count ? 0 : 1
  for (let o = 0; o < words; o += 3) {
    const cx = Math.floor(pos[o] / reach) | 0
    const cy = Math.floor(pos[o + 1] / reach) | 0
    const cz = Math.floor(pos[o + 2] / reach) | 0
    if (cells[o] !== cx || cells[o + 1] !== cy || cells[o + 2] !== cz) stale = 1
    cells[o] = cx
    cells[o + 1] = cy
    cells[o + 2] = cz
  }
  if (stale === 1) {
    for (let c = 0; c < buckets; c++) head[c] = -1
    for (let w = 0; w < slots; w++) occupied[w] = 0
    for (let o = 0, i = 0; o < words; o += 3, i++) {
      const h = Math.imul(cells[o] | 0, HASH_X) ^ Math.imul(cells[o + 1] | 0, HASH_Y) ^ Math.imul(cells[o + 2] | 0, HASH_Z)
      const b = h & mask
      const w = (h >>> 5) & wordMask
      occupied[w] = occupied[w] | (1 << (h & 31))
      next[i] = head[b] | 0
      head[b] = i
    }
    grid[0] = count
  }
  for (let oi = 0, i = 0; oi < words; oi += 3, i++) {
    const cx = cells[oi] | 0
    const cy = cells[oi + 1] | 0
    const cz = cells[oi + 2] | 0
    for (let ax = -1; ax <= 1; ax++) {
      const nx = (cx + ax) | 0
      const hx = Math.imul(nx, HASH_X)
      for (let ay = -1; ay <= 1; ay++) {
        const ny = (cy + ay) | 0
        const hxy = hx ^ Math.imul(ny, HASH_Y)
        for (let az = -1; az <= 1; az++) {
          const nz = (cz + az) | 0
          const h = hxy ^ Math.imul(nz, HASH_Z)
          if (((occupied[(h >>> 5) & wordMask] >>> (h & 31)) & 1) === 0) continue
          for (let j = head[h & mask] | 0; j > i; j = next[j] | 0) {
            const oj = (j * 3) | 0
            if (cells[oj] !== nx || cells[oj + 1] !== ny || cells[oj + 2] !== nz) continue
            const dx = pos[oj] - pos[oi]
            const dy = pos[oj + 1] - pos[oi + 1]
            const dz = pos[oj + 2] - pos[oi + 2]
            const d2 = dx * dx + dy * dy + dz * dz
            if (d2 >= reach2) continue
            let ux = 0
            let uy = 1
            let uz = 0
            const d = Math.sqrt(d2)
            if (d > 0) {
              ux = dx / d
              uy = dy / d
              uz = dz / d
            }
            const half = (reach - d) / 2
            pos[oi] = pos[oi] - ux * half
            pos[oi + 1] = pos[oi + 1] - uy * half
            pos[oi + 2] = pos[oi + 2] - uz * half
            pos[oj] = pos[oj] + ux * half
            pos[oj + 1] = pos[oj + 1] + uy * half
            pos[oj + 2] = pos[oj + 2] + uz * half
            const vn = (vel[oj] - vel[oi]) * ux + (vel[oj + 1] - vel[oi + 1]) * uy + (vel[oj + 2] - vel[oi + 2]) * uz
            if (vn < 0) {
              const impulse = (-(1 + bounceFor(vn, restitution)) * vn) / 2
              vel[oi] = vel[oi] - impulse * ux
              vel[oi + 1] = vel[oi + 1] - impulse * uy
              vel[oi + 2] = vel[oi + 2] - impulse * uz
              vel[oj] = vel[oj] + impulse * ux
              vel[oj + 1] = vel[oj + 1] + impulse * uy
              vel[oj + 2] = vel[oj + 2] + impulse * uz
            }
          }
        }
      }
    }
  }
}
