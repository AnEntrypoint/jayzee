import { bounceFor } from './respond.js'

const bucketOf = (cx, cy, cz, buckets) => {
  const h = cx * 73856093 + cy * 19349663 + cz * 83492791
  return h - Math.floor(h / buckets) * buckets
}

export const resolvePairs = (pos, vel, count, radius, restitution, head, next, cells) => {
  const reach = 2 * radius
  const reach2 = reach * reach
  const buckets = head.length
  for (let c = 0; c < buckets; c++) head[c] = -1
  for (let i = 0; i < count; i++) {
    const o = i * 3
    const cx = Math.floor(pos[o] / reach)
    const cy = Math.floor(pos[o + 1] / reach)
    const cz = Math.floor(pos[o + 2] / reach)
    cells[o] = cx
    cells[o + 1] = cy
    cells[o + 2] = cz
    const b = bucketOf(cx, cy, cz, buckets)
    next[i] = head[b]
    head[b] = i
  }
  for (let i = 0; i < count; i++) {
    const oi = i * 3
    const cx = cells[oi]
    const cy = cells[oi + 1]
    const cz = cells[oi + 2]
    for (let ax = -1; ax <= 1; ax++) {
      for (let ay = -1; ay <= 1; ay++) {
        for (let az = -1; az <= 1; az++) {
          const nx = cx + ax
          const ny = cy + ay
          const nz = cz + az
          for (let j = head[bucketOf(nx, ny, nz, buckets)]; j !== -1; j = next[j]) {
            if (j <= i) continue
            const oj = j * 3
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
