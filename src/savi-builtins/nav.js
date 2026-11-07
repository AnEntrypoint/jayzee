const DEG = Math.PI / 180
const DIRECTIONS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
const OPTION_NAMES = ['radius', 'step', 'slope', 'maxDrop', 'bodies', 'budget']

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value)
const isPositive = (value) => isFiniteNumber(value) && value > 0

const toPoint = (p) => {
  const arr = Array.isArray(p) ? p : p && typeof p === 'object' ? [p.x, p.y, p.z] : null
  if (!arr || arr.length !== 3 || !arr.every(isFiniteNumber)) throw new TypeError('a nav point is [x, y, z] or {x, y, z} with finite numbers')
  return [arr[0], arr[1], arr[2]]
}

const keyOf = (i, k) => i + ',' + k

export const createNav = ({ ground, body }) => {
  if (!ground || typeof ground.heightAt !== 'function') throw new TypeError('createNav needs ground.heightAt(x, z) returning a height or null')
  if (!body || typeof body !== 'object') throw new TypeError('createNav needs the caller body')
  if (!isPositive(body.radius)) throw new RangeError('body radius must be a positive number of metres')
  if (!isFiniteNumber(body.step) || body.step < 0) throw new RangeError('body step must be zero or above')
  if (!isFiniteNumber(body.slope) || body.slope <= 0 || body.slope >= 90) throw new RangeError('body slope must be degrees from 0 to 90')

  const searches = new Map()

  const heightAt = (cell, i, k) => {
    const h = ground.heightAt(i * cell, k * cell)
    return isFiniteNumber(h) ? h : null
  }

  const edgeCost = (cell, from, to, cfg) => {
    const hf = heightAt(cell, from[0], from[1])
    const ht = heightAt(cell, to[0], to[1])
    if (hf === null || ht === null) return -1
    const run = cell * Math.hypot(to[0] - from[0], to[1] - from[1])
    const rise = ht - hf
    if (rise > cfg.step || -rise > cfg.maxDrop) return -1
    if (Math.abs(rise) > run * Math.tan(cfg.slope * DEG)) return -1
    return run + Math.abs(rise)
  }

  const advance = (state, budget) => {
    const goalKey = keyOf(state.goal[0], state.goal[1])
    let spent = 0
    while (state.open.length > 0) {
      let best = 0
      for (let n = 1; n < state.open.length; n++) if (state.open[n].f < state.open[best].f) best = n
      const [node] = state.open.splice(best, 1)
      const key = keyOf(node.cell[0], node.cell[1])
      if (state.closed.has(key)) continue
      if (key === goalKey) {
        state.closed.set(key, node.cell)
        return 'found'
      }
      if (spent >= budget) {
        state.open.push(node)
        return 'partial'
      }
      spent++
      state.closed.set(key, node.cell)
      const g0 = state.g.get(key)
      for (const [di, dk] of DIRECTIONS) {
        const next = [node.cell[0] + di, node.cell[1] + dk]
        const cost = edgeCost(state.cell, node.cell, next, state.cfg)
        if (cost < 0) continue
        const nk = keyOf(next[0], next[1])
        const ng = g0 + cost
        if (state.closed.has(nk) || (state.g.has(nk) && ng >= state.g.get(nk))) continue
        state.g.set(nk, ng)
        state.parent.set(nk, key)
        const remaining = state.cell * Math.hypot(state.goal[0] - next[0], state.goal[1] - next[1])
        state.open.push({ cell: next, f: ng + remaining })
      }
    }
    return 'exhausted'
  }

  const pathTo = (state, endKey) => {
    const cells = []
    for (let key = endKey; key !== undefined; key = state.parent.get(key)) cells.push(state.closed.get(key))
    return cells.reverse().map(([i, k]) => [i * state.cell, heightAt(state.cell, i, k), k * state.cell])
  }

  const nearestClosed = (state) => {
    let bestKey = keyOf(state.start[0], state.start[1])
    let bestGap = Infinity
    for (const [key, cell] of state.closed) {
      const gap = Math.hypot(cell[0] - state.goal[0], cell[1] - state.goal[1])
      if (gap < bestGap) {
        bestGap = gap
        bestKey = key
      }
    }
    return bestKey
  }

  const findPath = (from, to, opts = {}) => {
    for (const name of Object.keys(opts)) {
      if (!OPTION_NAMES.includes(name)) throw new RangeError('option ' + name + ' has no documented behaviour in savi, or needs a host this model lacks; refused as a scoped negative')
    }
    if (opts.bodies !== undefined && opts.bodies !== 'all') throw new RangeError('bodies static needs a body list the ground model does not have; refused as a scoped negative')
    const cfg = {
      step: opts.step ?? body.step,
      slope: opts.slope ?? body.slope,
      maxDrop: opts.maxDrop ?? 3,
    }
    const cell = opts.radius ?? body.radius
    if (!isPositive(cell)) throw new RangeError('radius must be a positive number of metres')
    if (!isFiniteNumber(cfg.step) || cfg.step < 0) throw new RangeError('step must be zero or above')
    if (!isFiniteNumber(cfg.slope) || cfg.slope <= 0 || cfg.slope >= 90) throw new RangeError('slope must be degrees from 0 to 90')
    if (!isFiniteNumber(cfg.maxDrop) || cfg.maxDrop < 0) throw new RangeError('maxDrop must be zero or above, in metres')
    const budget = opts.budget === undefined ? Infinity : opts.budget
    if (budget !== Infinity && (!Number.isInteger(budget) || budget <= 0)) throw new RangeError('budget must be a positive whole number of expansions')

    const a = toPoint(from)
    const b = toPoint(to)
    const start = [Math.round(a[0] / cell), Math.round(a[2] / cell)]
    const goal = [Math.round(b[0] / cell), Math.round(b[2] / cell)]
    if (heightAt(cell, start[0], start[1]) === null) return { points: [], ok: false }

    const key = [cell, cfg.step, cfg.slope, cfg.maxDrop, keyOf(start[0], start[1]), keyOf(goal[0], goal[1])].join('|')
    let state = searches.get(key)
    if (!state) {
      state = {
        cell,
        cfg,
        start,
        goal,
        open: [{ cell: start, f: 0 }],
        g: new Map([[keyOf(start[0], start[1]), 0]]),
        parent: new Map(),
        closed: new Map(),
      }
    }
    const outcome = advance(state, budget)
    if (outcome === 'partial') {
      searches.set(key, state)
      return { points: [], ok: false, partial: true }
    }
    searches.delete(key)
    if (outcome === 'found') return { points: pathTo(state, keyOf(goal[0], goal[1])), ok: true }
    return { points: pathTo(state, nearestClosed(state)), ok: false }
  }

  return { findPath }
}

export const NAV_NAMES = Object.freeze(['findPath'])
