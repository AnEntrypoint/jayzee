import { decodeDelta } from '../protocol/delta.js'
import { encodeAck } from '../protocol/ack.js'

const DEFAULT_DEPTH = 64

export class StateReceiver {
  #depth
  #received = new Map()
  #latest = null

  constructor({ depth = DEFAULT_DEPTH } = {}) {
    if (!Number.isInteger(depth) || depth < 1) throw new RangeError('depth must be a positive integer')
    this.#depth = depth
  }

  get latest() {
    return this.#latest
  }

  receive(buffer) {
    const state = decodeDelta(buffer, (tick) => this.#received.get(tick) ?? null)
    this.#received.set(state.tick, state)
    if (this.#latest === null || state.tick > this.#latest) this.#latest = state.tick
    for (const tick of this.#received.keys()) {
      if (tick <= this.#latest - this.#depth) this.#received.delete(tick)
    }
    return state
  }

  ack() {
    if (this.#latest === null) throw new RangeError('nothing received to acknowledge')
    return encodeAck(this.#latest)
  }
}
