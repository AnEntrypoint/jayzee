export const BRIDGE = Object.freeze({
  INPUT_SLOTS: 256,
  EVENT_SLOTS: 256,
  INPUT_WORDS: 5,
  EVENT_WORDS: 4,
  TRANSFORM_WORDS: 7,
  CONTROL: Object.freeze({
    INPUT_HEAD: 0,
    INPUT_TAIL: 1,
    EPOCH: 2,
    EVENT_HEAD: 3,
    EVENT_TAIL: 4,
    EVENT_DROPPED: 5,
    BODY_COUNT: 6,
    TICK_LOW: 7,
    TICK_HIGH: 8,
  }),
  EVENT: Object.freeze({
    INPUT_APPLIED: 1,
    INPUT_REJECTED: 2,
    TICKED: 3,
  }),
})

export const createBridge = (module) => {
  const control = module._engine_control() / 4
  const inputs = module._engine_inputs() / 4
  const events = module._engine_events() / 4
  const transforms = module._engine_transforms() / 4
  const C = BRIDGE.CONTROL

  return Object.freeze({
    pushInput(body, velocity) {
      const words = module.HEAPU32
      const head = words[control + C.INPUT_HEAD]
      const tail = words[control + C.INPUT_TAIL]
      if (head - tail >= BRIDGE.INPUT_SLOTS) return -1
      const seq = head + 1
      const slot = inputs + (head % BRIDGE.INPUT_SLOTS) * BRIDGE.INPUT_WORDS
      words[slot] = seq
      words[slot + 1] = body
      module.HEAPF32[slot + 2] = velocity[0]
      module.HEAPF32[slot + 3] = velocity[1]
      module.HEAPF32[slot + 4] = velocity[2]
      words[control + C.INPUT_HEAD] = seq
      return seq
    },

    tick(steps) {
      module._engine_tick(steps)
    },

    epoch() {
      return module.HEAPU32[control + C.EPOCH]
    },

    tickCount() {
      const words = module.HEAPU32
      return words[control + C.TICK_HIGH] * 4294967296 + words[control + C.TICK_LOW]
    },

    bodyCount() {
      return module.HEAPU32[control + C.BODY_COUNT]
    },

    droppedEvents() {
      return module.HEAPU32[control + C.EVENT_DROPPED]
    },

    drainEvents() {
      const words = module.HEAPU32
      const head = words[control + C.EVENT_HEAD]
      let tail = words[control + C.EVENT_TAIL]
      const drained = []
      while (tail !== head) {
        const slot = events + (tail % BRIDGE.EVENT_SLOTS) * BRIDGE.EVENT_WORDS
        drained.push({ kind: words[slot], a: words[slot + 1], b: words[slot + 2] })
        tail += 1
      }
      words[control + C.EVENT_TAIL] = tail
      return drained
    },

    transform(id) {
      const start = transforms + id * BRIDGE.TRANSFORM_WORDS
      return module.HEAPF32.subarray(start, start + BRIDGE.TRANSFORM_WORDS)
    },
  })
}
