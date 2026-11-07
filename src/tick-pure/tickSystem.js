export const DILATION_WINDOW = 60
export const DILATION_THRESHOLD = 0.85
export const DILATION_RECOVERY_THRESHOLD = DILATION_THRESHOLD * 0.7
export const DILATION_MIN = 0.1
export const DILATION_MIN_STEP = 0.01
export const DILATION_MAX_STEP = 0.25
export const DILATION_GAIN = 0.5

export const dilationStep = (ratio) => Math.min(DILATION_MAX_STEP, Math.max(DILATION_MIN_STEP, ratio * DILATION_GAIN))

export const isShedding = (dilationFactor, load) => load > DILATION_THRESHOLD && dilationFactor > DILATION_MIN

export const isRecovering = (dilationFactor, load) => load < DILATION_RECOVERY_THRESHOLD && dilationFactor < 1.0

export const shedDilation = (dilationFactor, load) => {
  const overloadRatio = (load - DILATION_THRESHOLD) / DILATION_THRESHOLD
  return Math.max(DILATION_MIN, +(dilationFactor - dilationStep(overloadRatio)).toFixed(3))
}

export const recoverDilation = (dilationFactor, load) => {
  const recoveryRatio = (DILATION_RECOVERY_THRESHOLD - load) / DILATION_RECOVERY_THRESHOLD
  return Math.min(1.0, +(dilationFactor + dilationStep(recoveryRatio)).toFixed(3))
}

export class TickGovernor {
  constructor(tickRate = 60) {
    this.tickRate = tickRate
    this.tickDuration = 1000 / tickRate
    this.dilationFactor = 1.0
    this._dilationCallbacks = []
    this._tickBudgetMs = []
    this._tickBudgetSum = 0
  }

  onDilation(callback) {
    this._dilationCallbacks.push(callback)
  }

  computeDt() {
    return (this.tickDuration * this.dilationFactor) / 1000
  }

  getTickDuration() {
    return this.computeDt()
  }

  onTickMeasured(budgetMs) {
    this._tickBudgetMs.push(budgetMs)
    this._tickBudgetSum += budgetMs
    if (this._tickBudgetMs.length > DILATION_WINDOW) {
      this._tickBudgetSum -= this._tickBudgetMs.shift()
    }
    if (this._tickBudgetMs.length < DILATION_WINDOW) return
    const averageMs = this._tickBudgetSum / DILATION_WINDOW
    const load = averageMs / (this.tickDuration * this.dilationFactor)
    if (isShedding(this.dilationFactor, load)) {
      this._applyDilation(shedDilation(this.dilationFactor, load))
    } else if (isRecovering(this.dilationFactor, load)) {
      this._applyDilation(recoverDilation(this.dilationFactor, load))
    }
  }

  _applyDilation(dilationFactor) {
    this.dilationFactor = dilationFactor
    for (const callback of this._dilationCallbacks) {
      try { callback(this.dilationFactor) } catch (_) {}
    }
  }
}
