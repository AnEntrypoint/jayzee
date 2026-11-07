import { encodeDelta } from '../protocol/delta.js'

const DEFAULT_DEPTH = 64

export class StateSender {
  #depth
  #history = new Map()
  #acked = null

  constructor({ depth = DEFAULT_DEPTH } = {}) {
    if (!Number.isInteger(depth) || depth < 1) throw new RangeError('depth must be a positive integer')
    this.#depth = depth
  }

  get acked() {
    return this.#acked
  }

  send(state) {
    const base = this.#acked === null ? null : this.#history.get(this.#acked) ?? null
    this.#history.set(state.tick, state)
    for (const tick of this.#history.keys()) {
      if (tick <= state.tick - this.#depth) this.#history.delete(tick)
    }
    return encodeDelta(state, base)
  }

  acknowledge(tick) {
    if (!this.#history.has(tick)) return false
    if (this.#acked !== null && tick <= this.#acked) return false
    this.#acked = tick
    return true
  }
}
