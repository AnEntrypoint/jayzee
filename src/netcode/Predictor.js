import { canonicalInput } from './canonical.js'
import { applyMovement } from './movement.js'

export class Predictor {
  #world
  #body
  #speed
  #pending = []
  #acked = 0

  constructor({ world, body, speed }) {
    this.#world = world
    this.#body = body
    this.#speed = speed
  }

  get pending() {
    return this.#pending.length
  }

  get acked() {
    return this.#acked
  }

  predict(intent) {
    const input = canonicalInput({ buttons: 0, ...intent, sequence: this.#world.tick + 1 })
    this.#pending.push(input)
    this.#advance(input)
    return input
  }

  reconcile(state) {
    if (state.tick > this.#world.tick) throw new RangeError('state is ahead of the predicted tick')
    if (state.tick <= this.#acked) return false
    this.#world.importState(state)
    this.#acked = state.tick
    this.#pending = this.#pending.filter((input) => input.sequence > state.tick)
    for (const input of this.#pending) this.#advance(input)
    return true
  }

  #advance(input) {
    applyMovement(this.#world, this.#body, input, this.#speed)
    this.#world.step()
  }
}
