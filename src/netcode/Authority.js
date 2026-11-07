import { decodeInputs } from '../protocol/input.js'
import { InputBuffer } from './InputBuffer.js'
import { applyMovement } from './movement.js'

export class Authority {
  #world
  #speed
  #players = new Map()

  constructor({ world, speed }) {
    this.#world = world
    this.#speed = speed
  }

  get tick() {
    return this.#world.tick
  }

  addPlayer(id, body, options) {
    if (this.#players.has(id)) throw new RangeError('player ' + id + ' already exists')
    this.#players.set(id, { body, buffer: new InputBuffer(options) })
  }

  receive(id, packet) {
    const buffer = this.#player(id).buffer
    for (const record of decodeInputs(packet)) buffer.push(record)
  }

  stats(id) {
    return this.#player(id).buffer.stats
  }

  step() {
    for (const player of this.#players.values()) {
      const { input } = player.buffer.take()
      applyMovement(this.#world, player.body, input, this.#speed)
    }
    this.#world.step()
  }

  state() {
    return this.#world.exportState()
  }

  #player(id) {
    const player = this.#players.get(id)
    if (player === undefined) throw new RangeError('no player ' + id)
    return player
  }
}
