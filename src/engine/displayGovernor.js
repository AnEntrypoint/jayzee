export const LEVEL_UNSET = 255
export const MAX_LEVELS = 16

const whole = (v, name, min) => {
  if (!Number.isInteger(v) || v < min) throw new RangeError(name + ' must be a whole number at least ' + min)
}

export const lodOf = (distance, fullDetailDistance) => {
  if (!(distance > fullDetailDistance)) return 0
  return Math.log2(distance / fullDetailDistance)
}

export const createDisplayGovernor = ({ capacity, levels, budget, hysteresis = 0.25, biasStep = 0.25, maxBias = levels, relax = 0.85, admit = 0.95 }) => {
  whole(capacity, 'capacity', 1)
  whole(levels, 'levels', 2)
  if (levels > MAX_LEVELS) throw new RangeError('levels must be at most ' + MAX_LEVELS)
  whole(budget, 'budget', 0)
  if (!(hysteresis >= 0 && hysteresis < 0.5)) throw new RangeError('hysteresis must be in [0, 0.5)')
  if (!(biasStep > 0 && biasStep <= 1)) throw new RangeError('biasStep must be in (0, 1]')
  if (!(maxBias >= biasStep) || !Number.isFinite(maxBias)) throw new RangeError('maxBias must be a finite number at least biasStep')
  if (!(relax > 0 && relax < admit && admit <= 1)) throw new RangeError('relax and admit must satisfy 0 < relax < admit <= 1')
  const last = levels - 1
  const level = new Uint8Array(capacity).fill(LEVEL_UNSET)
  const first = new Uint8Array(capacity)
  const second = new Uint8Array(capacity)
  const stats = { cost: 0, demand: 0, bias: 0, passes: 0, shed: 0, changed: 0, budget }
  let limit = budget
  let bias = 0

  const evaluate = (count, lod, weight, b, out) => {
    let cost = 0
    for (let i = 0; i < count; i++) {
      const w = weight[i]
      if (w === 0) {
        out[i] = LEVEL_UNSET
        continue
      }
      const t = lod[i] + b
      const prev = level[i]
      let l = last
      if (t === t) {
        if (prev === LEVEL_UNSET) l = Math.floor(t)
        else {
          const up = Math.floor(t - hysteresis)
          if (up > prev) l = up
          else {
            const down = Math.floor(t + hysteresis)
            l = down < prev ? down : prev
          }
        }
        if (l < 0) l = 0
        else if (l > last) l = last
      }
      out[i] = l
      if (l < last) cost += w >>> l
    }
    return cost
  }

  const select = (count, lod, weight) => {
    if (!Number.isInteger(count) || count < 0 || count > capacity) throw new RangeError('count must be a whole number from 0 to the capacity, ' + capacity)
    let chosen = first
    let passes = 1
    let shed = 0
    let demand = 0
    for (let i = 0; i < count; i++) demand += weight[i]
    let cost = evaluate(count, lod, weight, bias, chosen)
    while (cost > limit && bias < maxBias) {
      bias = Math.min(maxBias, bias + biasStep)
      cost = evaluate(count, lod, weight, bias, chosen)
      passes += 1
    }
    if (cost > limit) {
      let running = 0
      for (let i = 0; i < count; i++) {
        let l = chosen[i]
        if (l === LEVEL_UNSET || l >= last) continue
        const w = weight[i]
        let c = w >>> l
        if (running + c > limit) {
          while (l < last && running + c > limit) {
            l += 1
            c = l < last ? w >>> l : 0
          }
          chosen[i] = l
          shed += 1
        }
        running += c
      }
      cost = running
    } else if (bias > 0 && cost <= limit * relax) {
      const lower = Math.max(0, bias - biasStep)
      const lowerCost = evaluate(count, lod, weight, lower, second)
      passes += 1
      if (lowerCost <= limit * admit) {
        chosen = second
        bias = lower
        cost = lowerCost
      }
    }
    let changed = 0
    for (let i = 0; i < count; i++) {
      const l = chosen[i]
      if (l !== level[i]) {
        level[i] = l
        changed += 1
      }
    }
    stats.cost = cost
    stats.demand = demand
    stats.bias = bias
    stats.passes = passes
    stats.shed = shed
    stats.changed = changed
    return stats
  }

  const setBudget = (next) => {
    whole(next, 'budget', 0)
    limit = next
    stats.budget = next
  }

  return { select, setBudget, levels: level, lastLevel: last, stats }
}
