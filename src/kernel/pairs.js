import { bounceFor } from './respond.js'

const cellCoord = (v, cellSize, dim) => {
  const c = Math.floor(v / cellSize) + Math.floor(dim / 2)
  return c < 0 ? 0 : c >= dim ? dim - 1 : c
}

export const resolvePairs = (pos, vel, count, radius, restitution, cellSize, dim) => {
  const cells = dim * dim * dim
  const head = new Int32Array(cells)
  const next = new Int32Array(count)
  for (let c = 0; c < cells; c++) head[c] = -1
  for (let i = 0; i < count; i++) {
    const o = i * 3
    const cx = cellCoord(pos[o], cellSize, dim)
    const cy = cellCoord(pos[o + 1], cellSize, dim)
    const cz = cellCoord(pos[o + 2], cellSize, dim)
    const c = (cx * dim + cy) * dim + cz
    next[i] = head[c]
    head[c] = i
  }
  const reach = 2 * radius
  const reach2 = reach * reach
  for (let i = 0; i < count; i++) {
    const oi = i * 3
    const cx = cellCoord(pos[oi], cellSize, dim)
    const cy = cellCoord(pos[oi + 1], cellSize, dim)
    const cz = cellCoord(pos[oi + 2], cellSize, dim)
    for (let ax = -1; ax <= 1; ax++) {
      const nx = cx + ax
      if (nx < 0 || nx >= dim) continue
      for (let ay = -1; ay <= 1; ay++) {
        const ny = cy + ay
        if (ny < 0 || ny >= dim) continue
        for (let az = -1; az <= 1; az++) {
          const nz = cz + az
          if (nz < 0 || nz >= dim) continue
          for (let j = head[(nx * dim + ny) * dim + nz]; j !== -1; j = next[j]) {
            if (j <= i) continue
            const oj = j * 3
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
