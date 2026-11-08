export const BRIDGE = Object.freeze({
  CONTROL_WORDS: 16,
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
  LAYOUT: Object.freeze({
    MAGIC: 0x31474e45,
    VERSION: 1,
    WORDS: Object.freeze({
      MAGIC: 0,
      VERSION: 1,
      PLAYERS: 2,
      BODIES: 3,
      WORKERS: 4,
      ARENA_BYTES: 5,
      USED_BYTES: 6,
      INPUT_SLOTS: 7,
      EVENT_SLOTS: 8,
      REGION_COUNT: 9,
      REGIONS: 10,
    }),
    REGION: Object.freeze({
      CONTROL: 0,
      INPUTS: 1,
      EVENTS: 2,
      TRANSFORMS: 3,
      POSITIONS: 4,
      VELOCITIES: 5,
      STAGE_ROWS: 6,
      STAGE_HANDLES: 7,
      PLANET_SCRATCH: 8,
      CODEC_BYTES: 9,
      CODEC_VALUES: 10,
      CODEC_COUNTS: 11,
    }),
  }),
})

export const readLayout = (module) => {
  const L = BRIDGE.LAYOUT
  const at = module._engine_layout() / 4
  const words = module.HEAPU32
  if (words[at + L.WORDS.MAGIC] !== L.MAGIC) throw new RangeError('engine layout header has the wrong magic')
  if (words[at + L.WORDS.VERSION] !== L.VERSION) throw new RangeError('engine layout header has version ' + words[at + L.WORDS.VERSION])
  const regionCount = words[at + L.WORDS.REGION_COUNT]
  const names = Object.keys(L.REGION)
  if (regionCount !== names.length) throw new RangeError('engine layout lists ' + regionCount + ' regions, expected ' + names.length)
  const regions = {}
  for (const name of names) {
    const key = name.toLowerCase().replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
    regions[key] = words[at + L.WORDS.REGIONS + L.REGION[name]]
  }
  return Object.freeze({
    players: words[at + L.WORDS.PLAYERS],
    bodies: words[at + L.WORDS.BODIES],
    workers: words[at + L.WORDS.WORKERS],
    arenaBytes: words[at + L.WORDS.ARENA_BYTES],
    usedBytes: words[at + L.WORDS.USED_BYTES],
    inputSlots: words[at + L.WORDS.INPUT_SLOTS],
    eventSlots: words[at + L.WORDS.EVENT_SLOTS],
    regions: Object.freeze(regions),
  })
}

export const createBridge = (module, layout = readLayout(module)) => {
  const buffer = module.HEAPU32.buffer
  const C = BRIDGE.CONTROL
  const control = new Uint32Array(buffer, layout.regions.control, BRIDGE.CONTROL_WORDS)
  const inputWords = new Uint32Array(buffer, layout.regions.inputs, layout.inputSlots * BRIDGE.INPUT_WORDS)
  const inputFloats = new Float32Array(buffer, layout.regions.inputs, layout.inputSlots * BRIDGE.INPUT_WORDS)
  const eventWords = new Uint32Array(buffer, layout.regions.events, layout.eventSlots * BRIDGE.EVENT_WORDS)
  const transformFloats = new Float32Array(buffer, layout.regions.transforms, layout.bodies * BRIDGE.TRANSFORM_WORDS)

  return Object.freeze({
    pushInput(body, velocity) {
      const head = control[C.INPUT_HEAD]
      const tail = control[C.INPUT_TAIL]
      if (head - tail >= layout.inputSlots) return -1
      const seq = head + 1
      const slot = (head % layout.inputSlots) * BRIDGE.INPUT_WORDS
      inputWords[slot] = seq
      inputWords[slot + 1] = body
      inputFloats[slot + 2] = velocity[0]
      inputFloats[slot + 3] = velocity[1]
      inputFloats[slot + 4] = velocity[2]
      control[C.INPUT_HEAD] = seq
      return seq
    },

    tick(steps) {
      module._engine_tick(steps)
    },

    epoch() {
      return control[C.EPOCH]
    },

    tickCount() {
      return control[C.TICK_HIGH] * 4294967296 + control[C.TICK_LOW]
    },

    bodyCount() {
      return control[C.BODY_COUNT]
    },

    droppedEvents() {
      return control[C.EVENT_DROPPED]
    },

    drainEvents() {
      const head = control[C.EVENT_HEAD]
      let tail = control[C.EVENT_TAIL]
      const drained = []
      while (tail !== head) {
        const slot = (tail % layout.eventSlots) * BRIDGE.EVENT_WORDS
        drained.push({ kind: eventWords[slot], a: eventWords[slot + 1], b: eventWords[slot + 2] })
        tail += 1
      }
      control[C.EVENT_TAIL] = tail
      return drained
    },

    transform(id) {
      const start = id * BRIDGE.TRANSFORM_WORDS
      return transformFloats.subarray(start, start + BRIDGE.TRANSFORM_WORDS)
    },
  })
}
