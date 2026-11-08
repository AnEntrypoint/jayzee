export function vatBlendRates(opts) {
  return {
    blendLowSpeed: opts.blendLowSpeed ?? 0.3,
    blendHighSpeed: opts.blendHighSpeed ?? (opts.nominalSpeed || 4.0) * 0.5,
    blendRate: opts.blendRate ?? 3.5,
  }
}

export function advanceVatPhase(slot, moveData, idleData, opts, s, dt, setUniform) {
  if (moveData) {
    const { blendLowSpeed, blendHighSpeed, blendRate } = vatBlendRates(opts)
    const target = blendHighSpeed > blendLowSpeed
      ? Math.max(0, Math.min(1, (s - blendLowSpeed) / (blendHighSpeed - blendLowSpeed)))
      : (s > blendLowSpeed ? 1 : 0)
    const chase = Math.min(1, blendRate * dt)
    slot.blend += (target - slot.blend) * chase
    if (Math.abs(slot.blend - target) < 0.001) slot.blend = target
    setUniform('vatBlend', slot.blend)
    slot.idlePhase = (slot.idlePhase + dt / idleData.duration) % 1
    setUniform('vatIdlePhase', slot.idlePhase)
    const nominal = opts.nominalSpeed || 4.0
    const moveRate = Math.min(1.5, s / nominal)
    slot.phase = (slot.phase + moveRate * dt / moveData.duration) % 1
  } else {
    const nominal = opts.nominalSpeed || 4.0
    const rate = 0.15 + Math.min(1.5, s / nominal)
    slot.phase = (slot.phase + rate * dt / idleData.duration) % 1
  }
  setUniform('vatPhase', slot.phase)
}
