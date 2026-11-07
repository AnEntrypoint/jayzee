export const pairKey = (i, j) => i + ':' + j

export const findContacts = (pos, count, radius, skin = 0) => {
  const reach = 2 * radius + skin
  const reach2 = reach * reach
  const contacts = []
  for (let i = 0; i < count; i++) {
    const oi = i * 3
    for (let j = i + 1; j < count; j++) {
      const oj = j * 3
      const dx = pos[oj] - pos[oi]
      const dy = pos[oj + 1] - pos[oi + 1]
      const dz = pos[oj + 2] - pos[oi + 2]
      const d2 = dx * dx + dy * dy + dz * dz
      if (d2 >= reach2) continue
      const d = Math.sqrt(d2)
      if (d > 0) contacts.push({ i, j, nx: dx / d, ny: dy / d, nz: dz / d, depth: reach - d })
      else contacts.push({ i, j, nx: 0, ny: 1, nz: 0, depth: reach })
    }
  }
  return contacts
}

const relativeNormal = (vel, c) => {
  const oi = c.i * 3
  const oj = c.j * 3
  return (vel[oj] - vel[oi]) * c.nx + (vel[oj + 1] - vel[oi + 1]) * c.ny + (vel[oj + 2] - vel[oi + 2]) * c.nz
}

export const createContactCache = () => {
  let impulses = new Map()
  let persistent = 0

  const seed = (contacts, vel) => {
    let seeded = 0
    for (const c of contacts) {
      const lambda = impulses.get(pairKey(c.i, c.j))
      if (!lambda) continue
      const oi = c.i * 3
      const oj = c.j * 3
      vel[oi] = vel[oi] - lambda * c.nx
      vel[oi + 1] = vel[oi + 1] - lambda * c.ny
      vel[oi + 2] = vel[oi + 2] - lambda * c.nz
      vel[oj] = vel[oj] + lambda * c.nx
      vel[oj + 1] = vel[oj + 1] + lambda * c.ny
      vel[oj + 2] = vel[oj + 2] + lambda * c.nz
      seeded += 1
    }
    return seeded
  }

  const record = (contacts, before, after) => {
    const next = new Map()
    let kept = 0
    for (const c of contacts) {
      const key = pairKey(c.i, c.j)
      next.set(key, Math.max(0, (relativeNormal(after, c) - relativeNormal(before, c)) / 2))
      if (impulses.has(key)) kept += 1
    }
    impulses = next
    persistent = kept
    return kept
  }

  return {
    seed,
    record,
    get persistent() {
      return persistent
    },
    get size() {
      return impulses.size
    },
    impulseOf(i, j) {
      return impulses.get(pairKey(i, j)) ?? 0
    },
  }
}
