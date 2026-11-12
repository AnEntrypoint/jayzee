import { LEVEL_UNSET, createDisplayGovernor, lodOf } from './displayGovernor.js'

export const VEG_DETAIL_LEVELS = 8
export const VEG_HIDDEN = 31

export const createVegetationDetail = ({ pool, instanceBudget, fullDetailM, levels = VEG_DETAIL_LEVELS, hysteresis, biasStep }) => {
  if (!pool || typeof pool.setDetail !== 'function') throw new TypeError('createVegetationDetail needs a vegetation pool')
  if (!(fullDetailM > 0) || !Number.isFinite(fullDetailM)) throw new RangeError('fullDetailM must be a positive finite distance in metres')
  const memory = pool.memory()
  const slots = memory.slots
  const origins = memory.origins
  const radius = memory.radius
  const lod = new Float32Array(slots)
  const weight = new Uint32Array(slots)
  const governor = createDisplayGovernor({ capacity: slots, levels, budget: instanceBudget, hysteresis, biasStep })
  const chosen = governor.levels
  const last = governor.lastLevel

  const update = (ex, ey, ez) => {
    for (let slot = 0; slot < slots; slot++) {
      weight[slot] = pool.generatedAt(slot)
      const dx = origins[slot * 3] - ex
      const dy = origins[slot * 3 + 1] - ey
      const dz = origins[slot * 3 + 2] - ez
      lod[slot] = lodOf(Math.sqrt(dx * dx + dy * dy + dz * dz) - radius, fullDetailM)
    }
    const stats = governor.select(slots, lod, weight)
    for (let slot = 0; slot < slots; slot++) {
      const l = chosen[slot]
      pool.setDetail(slot, l === LEVEL_UNSET ? 0 : l >= last ? VEG_HIDDEN : l)
    }
    return stats
  }

  return { update, governor, setBudget: governor.setBudget }
}
