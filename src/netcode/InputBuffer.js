import { canonicalInput } from './canonical.js'

const DEFAULT_WINDOW = 64
const DEFAULT_MAX_HOLD = 4

export class InputBuffer {
  #next = 1
  #window
  #maxHold
  #pending = new Map()
  #last = null
  #held = 0
  #stats = { accepted: 0, duplicate: 0, stale: 0, skipped: 0, input: 0, held: 0, neutral: 0 }

  constructor({ window = DEFAULT_WINDOW, maxHold = DEFAULT_MAX_HOLD } = {}) {
    if (!Number.isInteger(window) || window < 1) throw new RangeError('window must be a positive integer')
    if (!Number.isInteger(maxHold) || maxHold < 0) throw new RangeError('maxHold must be an integer at or above zero')
    this.#window = window
    this.#maxHold = maxHold
  }

  get next() {
    return this.#next
  }

  get pending() {
    return this.#pending.size
  }

  get stats() {
    return { ...this.#stats }
  }

  push(record) {
    const sequence = record.sequence
    if (sequence < this.#next) {
      this.#stats.stale += 1
      return 'stale'
    }
    if (this.#pending.has(sequence)) {
      this.#stats.duplicate += 1
      return 'duplicate'
    }
    if (sequence >= this.#next + this.#window) this.#skipTo(sequence - this.#window + 1)
    this.#pending.set(sequence, canonicalInput(record))
    this.#stats.accepted += 1
    return 'accepted'
  }

  take() {
    const sequence = this.#next
    this.#next += 1
    if (this.#pending.has(sequence)) {
      const input = this.#pending.get(sequence)
      this.#pending.delete(sequence)
      this.#last = input
      this.#held = 0
      this.#stats.input += 1
      return { source: 'input', input }
    }
    if (this.#last !== null && this.#held < this.#maxHold) {
      this.#held += 1
      this.#stats.held += 1
      return { source: 'held', input: { ...this.#last, sequence, buttons: 0 } }
    }
    this.#stats.neutral += 1
    return { source: 'neutral', input: { sequence, moveX: 0, moveZ: 0, yaw: this.#last === null ? 0 : this.#last.yaw, buttons: 0 } }
  }

  #skipTo(sequence) {
    this.#stats.skipped += sequence - this.#next
    for (const pending of this.#pending.keys()) {
      if (pending < sequence) this.#pending.delete(pending)
    }
    this.#next = sequence
  }
}
