import { gate, finish } from './lib/gate.mjs'
import {
  createInputSchema, encodeInputPacket, decodeInputPacket, tryEncodeInputPacket, quantizeInput, INPUT_CASE,
  defineComponentSchema, registerComponentSchema, validateSchema, encodeCustomFields, decodeCustomFields,
  pack, unpack, WIRE_STRUCT_HASH, parseWireStructHash,
  EventEmitter,
  CursorEventStream, backoffDelay
} from '../src/protocol/codecs.js'

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const deepEqual = (a, b) => {
  if (a instanceof Uint8Array || b instanceof Uint8Array) {
    return a instanceof Uint8Array && b instanceof Uint8Array && a.length === b.length && a.every((v, i) => v === b[i])
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => deepEqual(v, b[i]))
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keysA = Object.keys(a)
    const keysB = Object.keys(b)
    return keysA.length === keysB.length && keysA.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k]))
  }
  return Object.is(a, b)
}

const refusedWith = (fn, pattern) => {
  try {
    fn()
  } catch (error) {
    assert(pattern.test(error.message), 'refused with the wrong message: ' + error.message)
    return error
  }
  throw new Error('accepted a value it must refuse')
}

const hex = (bytes) => Buffer.from(bytes).toString('hex')
const concat = (...parts) => Uint8Array.from(parts.flatMap((p) => [...p]))

const inputSchema = createInputSchema({ inputAxes: ['throttle'] })
const sentEntries = [
  { sequence: 41, data: { forward: true, sprint: true, shoot: true, yaw: 1.25, pitch: -0.5, expr: 9, analogForward: 0.5, analogRight: -1, throttle: 0.25 } },
  { sequence: 42, data: { backward: false, yaw: 0, pitch: 0, expr: 0, throttle: -1 } },
]

gate('input packet round trip returns the quantized fields of every record', () => {
  const bytes = encodeInputPacket(inputSchema, sentEntries, 5)
  const decoded = decodeInputPacket(inputSchema, bytes)
  assert(decoded.accepted && decoded.code === INPUT_CASE.ACCEPTED, 'packet refused: ' + decoded.code)
  assert(decoded.chartEpoch === 5, 'chart epoch ' + decoded.chartEpoch + ' was not 5')
  assert(decoded.entries.length === 2, 'decoded ' + decoded.entries.length + ' records')
  decoded.entries.forEach((entry, i) => {
    assert(entry.sequence === sentEntries[i].sequence, 'sequence ' + entry.sequence + ' at record ' + i)
    assert(deepEqual(entry.data, quantizeInput(inputSchema, sentEntries[i].data)), 'record ' + i + ' differs from its quantized form')
  })
  const first = decoded.entries[0].data
  assert(first.forward === true && first.sprint === true && first.shoot === true && first.jump === false, 'button bits lost')
  assert(first.expr === 9 && first.throttle === 0.25, 'expr or axis lost')
  assert(Math.abs(first.yaw - 1.25) < 1e-4 && Math.abs(first.pitch + 0.5) < 1e-4, 'yaw or pitch moved more than a quantum')
  assert(Math.abs(first.analogForward - 0.5) < 1 / 127 && first.analogRight === -1, 'analog axes moved more than a quantum')
})

gate('input codec clamps an out-of-range pitch and reports it', () => {
  const result = tryEncodeInputPacket(inputSchema, [{ sequence: 1, data: { pitch: 2 } }])
  assert(result.accepted, 'clamped packet was refused')
  const clamp = result.cases.find((c) => c.code === INPUT_CASE.CLAMPED)
  assert(clamp && clamp.field === 'pitch', 'no clamp case for pitch')
  assert(decodeInputPacket(inputSchema, result.bytes).entries[0].data.pitch <= Math.PI / 2 + 1e-4, 'sent pitch exceeds pi/2')
})

gate('negative control: one mutated button changes the encoding and the decoded field', () => {
  const pressed = encodeInputPacket(inputSchema, [{ sequence: 1, data: { forward: true } }])
  const released = encodeInputPacket(inputSchema, [{ sequence: 1, data: { forward: false } }])
  assert(!deepEqual(pressed, released), 'a changed button produced the same bytes')
  assert(decodeInputPacket(inputSchema, released).entries[0].data.forward === false, 'released button decoded as pressed')
})

gate('input decoder refuses a truncated, trailing, unflagged or non-binary packet', () => {
  const bytes = encodeInputPacket(inputSchema, sentEntries, 5)
  const truncated = decodeInputPacket(inputSchema, bytes.subarray(0, bytes.length - 1))
  assert(!truncated.accepted && truncated.code === INPUT_CASE.TRUNCATED_AXES, 'truncated packet code ' + truncated.code)
  const trailing = decodeInputPacket(inputSchema, concat(bytes, [0]))
  assert(!trailing.accepted && trailing.code === INPUT_CASE.TRAILING, 'trailing byte code ' + trailing.code)
  const single = encodeInputPacket(inputSchema, [{ sequence: 1, data: { forward: true } }])
  const unknownFlags = single.slice()
  unknownFlags[1 + 13] = 0x02
  assert(decodeInputPacket(inputSchema, unknownFlags).code === INPUT_CASE.FLAGS, 'unknown flag bit was accepted')
  assert(decodeInputPacket(inputSchema, [1, 2]).code === INPUT_CASE.PAYLOAD, 'plain array was accepted as a payload')
})

gate('input encoder refuses an out-of-domain sequence and a non-finite field', () => {
  const badSequence = tryEncodeInputPacket(inputSchema, [{ sequence: -1, data: {} }])
  assert(!badSequence.accepted && badSequence.code === INPUT_CASE.SEQUENCE, 'negative sequence code ' + badSequence.code)
  const badYaw = tryEncodeInputPacket(inputSchema, [{ sequence: 1, data: { yaw: NaN } }])
  assert(!badYaw.accepted && badYaw.code === INPUT_CASE.FIELD, 'NaN yaw code ' + badYaw.code)
  refusedWith(() => encodeInputPacket(inputSchema, [{ sequence: 1.5, data: {} }]), /sequence/)
})

const vitals = defineComponentSchema({
  hp: { type: 'u16' },
  kind: { type: 'enum', enum: ['idle', 'run', 'dead'] },
  alive: { type: 'bool' },
  label: { type: 'string' },
  speed: { type: 'f32' },
})

gate('component schema accepts a matching value and round trips it', () => {
  validateSchema(vitals)
  const value = { hp: 120, kind: 'run', alive: true, label: 'scout', speed: 2.5 }
  const decoded = decodeCustomFields(vitals, encodeCustomFields(vitals, value))
  assert(deepEqual(decoded, value), 'decoded ' + JSON.stringify(decoded))
  const partial = decodeCustomFields(vitals, encodeCustomFields(vitals, { hp: 3 }))
  assert(deepEqual(partial, { hp: 3 }), 'absent fields were not omitted: ' + JSON.stringify(partial))
})

gate('component schema refuses a value that does not match its declaration', () => {
  refusedWith(() => encodeCustomFields(vitals, { hp: 70000 }), /outside the declared 0\.\.65535/)
  refusedWith(() => encodeCustomFields(vitals, { kind: 'flying' }), /outside \[idle, run, dead\]/)
  refusedWith(() => encodeCustomFields(vitals, { alive: 'false' }), /string/)
  refusedWith(() => encodeCustomFields(vitals, { speed: NaN }), /not a finite number/)
  refusedWith(() => encodeCustomFields(vitals, { label: 7 }), /not string/)
  refusedWith(() => defineComponentSchema({ kind: { type: 'enum', enum: ['a', 'a'] } }), /twice/)
  refusedWith(() => defineComponentSchema({ x: { type: 'u32' } }), /unknown type/)
})

gate('component schema refuses a truncated, trailing or out-of-range presence buffer', () => {
  const bytes = encodeCustomFields(vitals, { hp: 120, kind: 'run', alive: true, label: 'scout', speed: 2.5 })
  refusedWith(() => decodeCustomFields(vitals, bytes.subarray(0, bytes.length - 2)), /needs|declares/)
  refusedWith(() => decodeCustomFields(vitals, concat(bytes, [0])), /trailing/)
  const badPresence = bytes.slice()
  badPresence[0] = 2
  refusedWith(() => decodeCustomFields(vitals, badPresence), /presence flag 2/)
})

gate('component schema registry refuses a second shape under one name', () => {
  registerComponentSchema('vitals', vitals)
  registerComponentSchema('vitals', defineComponentSchema({ hp: { type: 'u16' }, kind: { type: 'enum', enum: ['idle', 'run', 'dead'] }, alive: { type: 'bool' }, label: { type: 'string' }, speed: { type: 'f32' } }))
  refusedWith(() => registerComponentSchema('vitals', defineComponentSchema({ hp: { type: 'u8' } })), /already bound/)
})

gate('negative control: one mutated field changes the custom-field encoding', () => {
  const base = encodeCustomFields(vitals, { hp: 120, kind: 'run', alive: true, label: 'scout', speed: 2.5 })
  const mutated = encodeCustomFields(vitals, { hp: 121, kind: 'run', alive: true, label: 'scout', speed: 2.5 })
  assert(!deepEqual(base, mutated), 'a changed hp produced the same bytes')
  assert(decodeCustomFields(vitals, mutated).hp === 121, 'mutated hp did not decode')
})

const nested = {
  id: 7,
  name: 'héllo',
  tags: ['a', 'bb', 'ccc'],
  pos: { x: 1.5, y: -2, z: 0 },
  blob: Uint8Array.of(9, 8, 7),
  flags: [true, false, null],
  big: 4294967296,
  neg: -129,
}

gate('msgpack round trips a nested value with binary, text and wide integers', () => {
  assert(deepEqual(unpack(pack(nested)), nested), 'nested value changed in the round trip')
})

gate('msgpack packs a Map to the same bytes as the object with the same entries', () => {
  assert(hex(pack(new Map([['a', 1]]))) === hex(pack({ a: 1 })), 'Map bytes ' + hex(pack(new Map([['a', 1]]))))
  assert(deepEqual(unpack(pack(new Map([['a', 1], ['b', 'x']]))), { a: 1, b: 'x' }), 'Map entries changed in the round trip')
})

gate('msgpack refuses a Map with a non-string key instead of dropping it', () => {
  refusedWith(() => pack(new Map([[1, 'x']])), /map keys must be strings/)
})

gate('msgpack writes the specification bytes for two small values', () => {
  assert(hex(pack([1, 'a', null])) === '9301a161c0', 'array bytes ' + hex(pack([1, 'a', null])))
  assert(hex(pack({ a: 1 })) === '81a16101', 'map bytes ' + hex(pack({ a: 1 })))
})

gate('msgpack refuses a truncated, trailing, unsupported or unencodable input', () => {
  const bytes = pack(nested)
  refusedWith(() => unpack(bytes.subarray(0, bytes.length - 1)), /truncated input/)
  refusedWith(() => unpack(concat(pack(1), [0])), /trailing byte/)
  refusedWith(() => unpack(Uint8Array.of(0xc1)), /unsupported marker 0xc1/)
  refusedWith(() => pack(() => 1), /cannot encode a value of type function/)
})

gate('negative control: a changed nested value packs to different bytes', () => {
  assert(hex(pack({ a: 1 })) !== hex(pack({ a: 2 })), 'different values packed to the same bytes')
  assert(unpack(pack({ a: 2 })).a === 2, 'changed value did not unpack')
})

gate('wire structure hash matches the spoint value at d5e3860', () => {
  assert(WIRE_STRUCT_HASH === '732d5755', 'hash ' + WIRE_STRUCT_HASH)
  assert(parseWireStructHash(WIRE_STRUCT_HASH).kind === 'hash', 'valid hash refused')
  assert(parseWireStructHash(undefined).kind === 'absent', 'absent hash not reported')
  assert(parseWireStructHash('732d575g').kind === 'malformed', 'non-hex hash accepted')
  assert(parseWireStructHash(12).kind === 'malformed', 'numeric hash accepted')
})

gate('event emitter delivers each event once to each listener', () => {
  const emitter = new EventEmitter()
  let first = 0
  let second = 0
  emitter.on('tick', () => first++)
  emitter.on('tick', () => second++)
  assert(emitter.emit('tick') === true, 'emit reported no delivery')
  assert(first === 1 && second === 1, 'listeners called ' + first + ' and ' + second + ' times')
  assert(emitter.emit('unknown') === false, 'unknown event reported delivery')
})

gate('event emitter removes a listener on off and once fires a single time', () => {
  const emitter = new EventEmitter()
  let calls = 0
  const listener = () => calls++
  emitter.on('tick', listener)
  emitter.off('tick', listener)
  emitter.emit('tick')
  assert(calls === 0 && emitter.listenerCount('tick') === 0, 'off left the listener in place')
  emitter.once('tick', () => calls++)
  emitter.emit('tick')
  emitter.emit('tick')
  assert(calls === 1, 'once fired ' + calls + ' times')
})

gate('negative control: off with an unregistered function leaves the listeners in place', () => {
  const emitter = new EventEmitter()
  emitter.on('tick', () => {})
  emitter.off('tick', () => {})
  assert(emitter.listenerCount('tick') === 1, 'an unregistered function removed a listener')
  const originalError = console.error
  let reported = 0
  console.error = () => reported++
  let secondRan = false
  emitter.on('tick', () => { throw new Error('listener failure') })
  emitter.on('tick', () => { secondRan = true })
  try {
    emitter.emit('tick')
  } finally {
    console.error = originalError
  }
  assert(secondRan && reported === 1, 'a throwing listener stopped the others')
})

const createStreamHarness = (options = {}) => {
  const opened = []
  const timers = []
  const closes = []
  const events = []
  const gaps = []
  const stream = new CursorEventStream({
    open: (cursor, sink) => {
      opened.push({ cursor, sink })
      return () => closes.push(cursor)
    },
    onEvent: (evt) => events.push(evt.seq),
    onGap: (from, to) => gaps.push([from, to]),
    baseMs: 100,
    maxMs: 1000,
    factor: 2,
    timers: {
      setTimeout: (fn, ms) => {
        timers.push({ fn, ms })
        return timers.length
      },
      clearTimeout: () => {},
    },
    ...options,
  })
  return { stream, opened, timers, closes, events, gaps }
}

gate('cursor stream yields its events in order and ignores a repeated sequence', () => {
  const { stream, opened, events } = createStreamHarness()
  stream.start()
  const sink = opened[0].sink
  sink.event({ seq: 1 })
  sink.event({ seq: 2 })
  sink.event({ seq: 3 })
  sink.event({ seq: 3 })
  assert(deepEqual(events, [1, 2, 3]), 'yielded ' + JSON.stringify(events))
  assert(stream.cursor === 3, 'cursor ' + stream.cursor)
})

gate('cursor stream reports a gap and keeps the later event', () => {
  const { stream, opened, events, gaps } = createStreamHarness()
  stream.start()
  opened[0].sink.event({ seq: 1 })
  opened[0].sink.event({ seq: 4 })
  assert(deepEqual(gaps, [[1, 4]]), 'gaps ' + JSON.stringify(gaps))
  assert(deepEqual(events, [1, 4]), 'events ' + JSON.stringify(events))
})

gate('negative control: an event behind the cursor is refused', () => {
  const { stream, opened, events } = createStreamHarness()
  stream.start()
  opened[0].sink.event({ seq: 2 })
  opened[0].sink.event({ seq: 1 })
  assert(deepEqual(events, [2]), 'out-of-order event was delivered: ' + JSON.stringify(events))
})

gate('cursor stream refuses a bad constructor cursor, open or event sequence', () => {
  const noop = () => {}
  refusedWith(() => new CursorEventStream({ open: noop, onEvent: noop, cursor: -1 }), /cursor must be a non-negative/)
  refusedWith(() => new CursorEventStream({ open: 'x', onEvent: noop }), /open must be a function/)
  refusedWith(() => new CursorEventStream({ open: noop, onEvent: noop, baseMs: 2000, maxMs: 1000 }), /baseMs <= maxMs/)
  const { stream, opened } = createStreamHarness()
  stream.start()
  refusedWith(() => opened[0].sink.event({ seq: -1 }), /event seq must be a non-negative/)
})

gate('cursor stream reconnects from its cursor with backoff and drops a stale sink', () => {
  const { stream, opened, timers, events } = createStreamHarness()
  stream.start()
  opened[0].sink.event({ seq: 3 })
  opened[0].sink.closed()
  assert(timers.length === 1 && timers[0].ms === 100, 'first backoff ' + timers.map((t) => t.ms).join(','))
  timers[0].fn()
  assert(opened.length === 2 && opened[1].cursor === 3, 'reopened at ' + opened[1].cursor)
  opened[0].sink.event({ seq: 99 })
  opened[1].sink.event({ seq: 4 })
  assert(deepEqual(events, [3, 4]), 'events ' + JSON.stringify(events))
  assert(backoffDelay(3, { baseMs: 100, maxMs: 1000, factor: 2 }) === 800, 'backoff at attempt 3')
  assert(backoffDelay(5, { baseMs: 100, maxMs: 1000, factor: 2 }) === 1000, 'backoff is not capped')
})

gate('cursor stream stop closes the connection once and ignores later events', () => {
  const { stream, opened, closes, events } = createStreamHarness()
  stream.start()
  stream.stop()
  opened[0].sink.event({ seq: 1 })
  assert(closes.length === 1 && events.length === 0, 'closes ' + closes.length + ' events ' + events.length)
  assert(stream.running === false, 'still running after stop')
})

finish()
