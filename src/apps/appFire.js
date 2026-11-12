import { defineFire } from '../fire/behaviour/defineFire.js'
import { createFireLattice } from '../fire/lattice.js'
import { FIRE_WIRE_TYPE } from '../fire/wire.js'
import { createPlacementLattice } from '../terrain-pure/placementLattice.js'

export const FIRE_APP_NAME = 'fire'

export function createFireLatticeSource({ chunkM, cellsPerChunk }) {
  if (!(Number.isFinite(chunkM) && chunkM > 0)) throw new RangeError(`[fire] the placement chunk size must be a positive finite number, got ${String(chunkM)}`)
  if (!Number.isInteger(cellsPerChunk) || cellsPerChunk < 1) throw new RangeError(`[fire] cellsPerChunk must be a positive integer, got ${String(cellsPerChunk)}`)
  let radiusOf = NaN
  let cellsOf = NaN
  let lattice = null
  let placement = null
  return {
    latticeFor(radius, cellsPerFireCell) {
      if (radius !== radiusOf || cellsPerFireCell !== cellsOf) {
        placement = createPlacementLattice(radius, chunkM, cellsPerChunk)
        lattice = createFireLattice(placement, cellsPerFireCell)
        radiusOf = radius
        cellsOf = cellsPerFireCell
      }
      return lattice
    },
    get placement() { return placement },
  }
}

export function createAppFires({ hooks, tickOf, tickDt }) {
  if (!hooks || typeof hooks.add !== 'function' || typeof hooks.remove !== 'function' || typeof hooks.deliverInput !== 'function') throw new TypeError('[fire] createAppFires needs the app hook runner (add, remove, deliverInput)')
  if (typeof tickOf !== 'function') throw new TypeError('[fire] createAppFires needs tickOf, a function returning the tick the runtime is on')
  if (!(Number.isFinite(tickDt) && tickDt > 0)) throw new RangeError(`[fire] tickDt must be a positive finite number, got ${String(tickDt)}`)
  const fires = new Map()
  const stats = { registered: 0, removed: 0, routed: 0, unrouted: 0 }

  function register(id, spec, env) {
    if (fires.has(id)) throw new RangeError(`[fire] app object ${String(id)} already has a fire`)
    if (env === null || typeof env !== 'object') throw new TypeError('[fire] register needs its environment: { appCtx, frameOf, lattice or latticeFor, trunks }')
    const latticeFor = env.latticeFor ?? (env.lattice ? createFireLatticeSource(env.lattice).latticeFor : null)
    if (typeof latticeFor !== 'function') throw new TypeError('[fire] register needs env.latticeFor or env.lattice { chunkM, cellsPerChunk }')
    const fire = defineFire(spec, { appCtx: env.appCtx, frameOf: env.frameOf, latticeFor, trunks: env.trunks })
    const entry = { id, fire }
    hooks.add(id, {
      onSpawn: () => fire.start(tickOf()),
      onInput: (ctx, message) => { fire.receive(message) },
      update: () => fire.tick(tickOf(), tickDt),
      onDestroy: () => { fires.delete(id); stats.removed++ },
    }, { ctx: entry })
    fires.set(id, entry)
    stats.registered++
    return fire
  }

  function unregister(id) {
    if (!fires.has(id)) return false
    hooks.remove(id)
    return true
  }

  function route(message, id = null) {
    if (message === null || typeof message !== 'object' || message.type !== FIRE_WIRE_TYPE) return false
    let delivered = 0
    for (const entry of fires.values()) {
      if (id !== null && entry.id !== id) continue
      if (entry.fire.role === 'authority') continue
      hooks.deliverInput(entry.id, message)
      delivered++
    }
    if (delivered === 0) { stats.unrouted++; return false }
    stats.routed++
    return true
  }

  return {
    stats,
    register,
    unregister,
    route,
    get: (id) => fires.get(id)?.fire ?? null,
    get size() { return fires.size },
  }
}
