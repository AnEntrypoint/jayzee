const findRoot = (parent, a) => {
  let root = a
  while (parent[root] !== root) root = parent[root]
  let node = a
  while (parent[node] !== root) {
    const next = parent[node]
    parent[node] = root
    node = next
  }
  return root
}

export const createIslands = ({ count, linearThreshold = 0.05, timeToSleep = 0.25 }) => {
  if (!Number.isInteger(count) || count < 0) throw new RangeError('count must be an integer at or above zero')
  if (!(linearThreshold > 0) || !(timeToSleep > 0)) throw new RangeError('thresholds must be positive')
  const timers = new Float64Array(count)
  const asleep = new Uint8Array(count)
  const parent = new Int32Array(count)
  let sleeping = 0

  const update = (vel, contacts, dt) => {
    for (let i = 0; i < count; i++) {
      const o = i * 3
      const speed = Math.sqrt(vel[o] * vel[o] + vel[o + 1] * vel[o + 1] + vel[o + 2] * vel[o + 2])
      timers[i] = speed < linearThreshold ? timers[i] + dt : 0
      parent[i] = i
    }
    for (const c of contacts) {
      const a = findRoot(parent, c.i)
      const b = findRoot(parent, c.j)
      if (a !== b) parent[b] = a
    }
    const ready = new Uint8Array(count).fill(1)
    for (let i = 0; i < count; i++) {
      if (timers[i] < timeToSleep) ready[findRoot(parent, i)] = 0
    }
    sleeping = 0
    for (let i = 0; i < count; i++) {
      asleep[i] = ready[findRoot(parent, i)]
      sleeping += asleep[i]
    }
    return sleeping
  }

  return {
    update,
    isAsleep: (id) => asleep[id] === 1,
    get sleeping() {
      return sleeping
    },
  }
}
