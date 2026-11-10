export const LAYER_VERY_STATIC = 'very-static'
export const LAYER_STATIC = 'static'
export const LAYER_DYNAMIC = 'dynamic'
export const LAYERS = Object.freeze([LAYER_VERY_STATIC, LAYER_STATIC, LAYER_DYNAMIC])

export const LAYER_CONFIG = Object.freeze({
  [LAYER_VERY_STATIC]: Object.freeze({ broadphase: 'very-static-tree', updateEverySteps: 0 }),
  [LAYER_STATIC]: Object.freeze({ broadphase: 'static-tree', updateEverySteps: 0 }),
  [LAYER_DYNAMIC]: Object.freeze({ broadphase: 'dynamic-tree', updateEverySteps: 1 }),
})

export const layerOf = (kind) => {
  if (kind === 'terrain' || kind === 'planet') return LAYER_VERY_STATIC
  if (kind === 'prop' || kind === 'box' || kind === 'tree' || kind === 'rock') return LAYER_STATIC
  if (kind === 'body' || kind === 'player' || kind === 'dynamic') return LAYER_DYNAMIC
  throw new RangeError('unknown collider kind: ' + kind)
}

export const createColliderSet = () => {
  const built = new Map()
  const dirty = new Set()
  const stats = { builds: 0, refits: 0, steps: 0 }
  const add = (id, kind) => {
    const layer = layerOf(kind)
    if (built.has(id)) throw new RangeError('collider already registered: ' + id)
    built.set(id, { layer, version: 0, builtVersion: -1 })
    if (layer !== LAYER_DYNAMIC) dirty.add(id)
    return layer
  }
  const change = (id) => {
    const entry = built.get(id)
    if (entry === undefined) throw new RangeError('unknown collider: ' + id)
    if (entry.layer === LAYER_DYNAMIC) throw new RangeError('dynamic colliders update every step, not on change: ' + id)
    if (entry.layer === LAYER_VERY_STATIC) throw new RangeError('very static colliders are built once and never change: ' + id)
    entry.version += 1
    dirty.add(id)
  }
  const flush = () => {
    const work = { build: [], refit: [] }
    for (const id of dirty) {
      const entry = built.get(id)
      if (entry.builtVersion === -1) {
        work.build.push(id)
        stats.builds += 1
      } else {
        work.refit.push(id)
        stats.refits += 1
      }
      entry.builtVersion = entry.version
    }
    dirty.clear()
    return work
  }
  const step = () => {
    stats.steps += 1
    const dynamic = []
    for (const [id, entry] of built) if (entry.layer === LAYER_DYNAMIC) dynamic.push(id)
    return dynamic
  }
  const stepCost = () => {
    const cost = { [LAYER_VERY_STATIC]: 0, [LAYER_STATIC]: 0, [LAYER_DYNAMIC]: 0 }
    for (const entry of built.values()) if (LAYER_CONFIG[entry.layer].updateEverySteps > 0) cost[entry.layer] += 1
    return cost
  }
  const counts = () => {
    const out = { [LAYER_VERY_STATIC]: 0, [LAYER_STATIC]: 0, [LAYER_DYNAMIC]: 0 }
    for (const entry of built.values()) out[entry.layer] += 1
    return out
  }
  return { add, change, flush, step, stepCost, counts, stats: () => ({ ...stats }), pending: () => dirty.size }
}
