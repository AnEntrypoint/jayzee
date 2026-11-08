import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { encodeEntityRecord, decodeEntityRecord, encodePlayerRecord, decodePlayerRecord, encodeSmallestThree, decodeSmallestThree } from '../src/wire/binSnapshot.js'
import { encodeInputs, decodeInputs } from '../src/protocol/input.js'
import { createInputSchema, tryEncodeInputPacket, decodeInputPacket, INPUT_CASE, INPUT_CASE_CODES } from '../src/protocol/inputCodec.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'scripts/fixtures/engine')
const outFile = join(outDir, 'codec-cases.json')

let seed = 5
const random = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff
  return seed / 0x7fffffff
}
const between = (lo, hi) => lo + random() * (hi - lo)
const uint32 = () => Math.floor(random() * 4294967296)
const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
const enc = (x) => (Number.isFinite(x) && !Object.is(x, -0) ? x : String(Object.is(x, -0) ? '-0' : x))
const encList = (list) => list.map(enc)
const attempt = (fn) => {
  try {
    return { ok: true, value: fn() }
  } catch (error) {
    return { ok: false, message: String(error.message) }
  }
}

const entityCases = []
const entityRecord = (position, velocity, rotationWord, scale, flags) => ({ position, velocity, rotationWord, scale, flags })
for (let i = 0; i < 300; i++) {
  const record = entityRecord(
    [between(-5000, 5000), between(-5000, 5000), between(-5000, 5000)],
    [between(-300, 300), between(-300, 300), between(-300, 300)],
    uint32(),
    [between(0, 655), between(0, 655), between(0, 655)],
    Math.floor(random() * 256),
  )
  const encoded = attempt(() => hex(encodeEntityRecord(record)))
  const values = [...record.position, ...record.velocity, record.rotationWord, ...record.scale, record.flags]
  if (!encoded.ok) {
    entityCases.push({ label: 'random entity ' + i, values: encList(values), refuse: true })
    continue
  }
  const decoded = decodeEntityRecord(Uint8Array.from(encoded.value.match(/../g), (h) => parseInt(h, 16)))
  entityCases.push({
    label: 'random entity ' + i,
    values: encList(values),
    refuse: false,
    bytes: encoded.value,
    decoded: encList([...decoded.position, ...decoded.velocity, decoded.rotationWord, ...decoded.scale, decoded.flags]),
  })
}
for (const [label, values] of [
  ['negative zero position', [-0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  ['position at the wire limit', [21474836.47, -21474836.47, 0, 0, 0, 0, 0, 1, 1, 1, 255]],
  ['velocity over the limit', [0, 0, 0, 400, 0, 0, 0, 1, 1, 1, 0]],
  ['scale below zero', [0, 0, 0, 0, 0, 0, 0, -1, 1, 1, 0]],
  ['rotation not an integer', [0, 0, 0, 0, 0, 0, 1.5, 1, 1, 1, 0]],
  ['flags over a byte', [0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 256]],
  ['position not finite', [NaN, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0]],
]) {
  const record = entityRecord(values.slice(0, 3), values.slice(3, 6), values[6], values.slice(7, 10), values[10])
  const encoded = attempt(() => hex(encodeEntityRecord(record)))
  if (!encoded.ok) {
    entityCases.push({ label, values: encList(values), refuse: true })
    continue
  }
  const decoded = decodeEntityRecord(Uint8Array.from(encoded.value.match(/../g), (h) => parseInt(h, 16)))
  entityCases.push({ label, values: encList(values), refuse: false, bytes: encoded.value, decoded: encList([...decoded.position, ...decoded.velocity, decoded.rotationWord, ...decoded.scale, decoded.flags]) })
}

const playerCases = []
for (let i = 0; i < 200; i++) {
  const record = {
    position: [between(-5000, 5000), between(-5000, 5000), between(-5000, 5000)],
    velocity: [between(-300, 300), between(-300, 300), between(-300, 300)],
    rotationWord: uint32(),
  }
  const bytes = hex(encodePlayerRecord(record))
  const decoded = decodePlayerRecord(Uint8Array.from(bytes.match(/../g), (h) => parseInt(h, 16)))
  playerCases.push({
    label: 'random player ' + i,
    values: encList([...record.position, ...record.velocity, record.rotationWord]),
    refuse: false,
    bytes,
    decoded: encList([...decoded.position, ...decoded.velocity, decoded.rotationWord]),
  })
}

const quatCases = []
for (let i = 0; i < 300; i++) {
  const raw = [between(-1, 1), between(-1, 1), between(-1, 1), between(-1, 1)]
  const length = Math.hypot(...raw)
  const components = raw.map((v) => v / length)
  const word = encodeSmallestThree(components)
  const decoded = decodeSmallestThree(word)
  quatCases.push({ label: 'random quaternion ' + i, components: encList(components), word, decoded: encList(decoded) })
}
for (const [label, components] of [['not a unit quaternion', [1, 1, 0, 0]], ['not finite', [NaN, 0, 0, 1]]]) {
  quatCases.push({ label, components: encList(components), refuse: true })
}
const decodeCases = []
for (let i = 0; i < 300; i++) {
  const word = uint32()
  const decoded = attempt(() => decodeSmallestThree(word))
  decodeCases.push({ label: 'random word ' + i, word, refuse: !decoded.ok, decoded: decoded.ok ? encList(decoded.value) : undefined })
}

const inputCases = []
for (let i = 0; i < 100; i++) {
  const count = 1 + Math.floor(random() * 8)
  const records = Array.from({ length: count }, () => ({
    sequence: uint32(),
    moveX: between(-1, 1),
    moveZ: between(-1, 1),
    yaw: between(-10, 10),
    buttons: uint32(),
  }))
  const bytes = hex(new Uint8Array(encodeInputs(records)))
  const decoded = decodeInputs(Uint8Array.from(bytes.match(/../g), (h) => parseInt(h, 16)).buffer)
  inputCases.push({
    label: 'random input packet ' + i,
    records: records.map((r) => encList([r.sequence, r.moveX, r.moveZ, r.yaw, r.buttons])),
    refuse: false,
    bytes,
    decoded: decoded.map((r) => encList([r.sequence, r.moveX, r.moveZ, r.yaw, r.buttons])),
  })
}
for (const [label, records] of [
  ['no records', []],
  ['axis over one', [{ sequence: 1, moveX: 1.5, moveZ: 0, yaw: 0, buttons: 0 }]],
  ['negative sequence', [{ sequence: -1, moveX: 0, moveZ: 0, yaw: 0, buttons: 0 }]],
]) {
  const refused = attempt(() => encodeInputs(records))
  inputCases.push({ label, records: records.map((r) => encList([r.sequence, r.moveX, r.moveZ, r.yaw, r.buttons])), refuse: !refused.ok })
}

const PACKET_SCHEMAS = [
  createInputSchema(),
  createInputSchema({ inputButtons: ['extra1', 'extra2'], inputAxes: ['throttle', 'brake'] }),
  createInputSchema({ inputButtons: Array.from({ length: 16 }, (_, i) => 'b' + i), inputAxes: ['a0', 'a1', 'a2'] }),
]
const PACKET_FIELDS = 16
const packetValue = (x) => (x === undefined ? 0 : x)
const packetLayout = (schema, entry) => {
  const d = entry.data
  let bits = 0
  schema.buttons.forEach((name, i) => { if (d[name]) bits |= 1 << i })
  const hasAnalog = d.analogForward !== undefined || d.analogRight !== undefined
  const row = [entry.sequence, bits >>> 0, packetValue(d.yaw), packetValue(d.pitch), packetValue(d.expr), hasAnalog ? 1 : 0, packetValue(d.analogForward), packetValue(d.analogRight)]
  for (let a = 0; a < PACKET_FIELDS; a++) row.push(a < schema.axes.length ? packetValue(d[schema.axes[a]]) : 0)
  return row.map(enc)
}
const randomPacketData = (schema) => {
  const d = {}
  for (const name of schema.buttons) d[name] = random() < 0.5
  const yawRoll = random()
  d.yaw = yawRoll < 0.7 ? between(0, 2 * Math.PI) : yawRoll < 0.85 ? between(-8, 8) : yawRoll < 0.9 ? undefined : yawRoll < 0.95 ? 400 : NaN
  const pitchRoll = random()
  d.pitch = pitchRoll < 0.7 ? between(-1.2, 1.2) : pitchRoll < 0.85 ? between(-3, 3) : pitchRoll < 0.9 ? undefined : pitchRoll < 0.95 ? -0 : Infinity
  const exprRoll = random()
  d.expr = exprRoll < 0.7 ? between(0, 255) : exprRoll < 0.85 ? between(-20, 300) : exprRoll < 0.9 ? undefined : exprRoll < 0.95 ? 3 : 255.5
  const analogRoll = random()
  if (analogRoll < 0.6) {
    d.analogForward = between(-1.5, 1.5)
    d.analogRight = between(-1, 1)
  } else if (analogRoll < 0.8) {
    d.analogForward = between(-1, 1)
  }
  for (const name of schema.axes) {
    const r = random()
    d[name] = r < 0.8 ? between(-1000, 1000) : r < 0.9 ? undefined : r < 0.95 ? NaN : between(-1e39, 1e39)
  }
  return d
}
const randomPacketSequence = () => {
  const r = random()
  return r < 0.9 ? Math.floor(random() * 4294967296) : r < 0.95 ? -1 : 1.5
}
const packetEncode = []
for (let i = 0; i < 200; i++) {
  const index = i % PACKET_SCHEMAS.length
  const schema = PACKET_SCHEMAS[index]
  const count = 1 + Math.floor(random() * 12)
  const entries = Array.from({ length: count }, () => ({ sequence: randomPacketSequence(), data: randomPacketData(schema) }))
  const epochRoll = random()
  const epoch = epochRoll < 0.4 ? 0 : epochRoll < 0.95 ? Math.floor(random() * 4294967296) : random() < 0.5 ? -1 : 2.5
  const result = tryEncodeInputPacket(schema, entries, epoch)
  const row = { label: 'packet encode ' + i, schema: index, epoch: enc(epoch), entries: entries.map((entry) => packetLayout(schema, entry)), accepted: result.accepted }
  if (result.accepted) {
    row.bytes = hex(result.bytes)
    row.counts = [result.cases.filter((c) => c.code === INPUT_CASE.CLAMPED).length, result.cases.filter((c) => c.code === INPUT_CASE.WRAPPED).length, result.dropped]
  } else {
    row.code = INPUT_CASE_CODES.indexOf(result.code)
  }
  packetEncode.push(row)
}
const packetDecode = []
const decodeRow = (index, bytes, drop, label) => {
  const schema = PACKET_SCHEMAS[index]
  const result = decodeInputPacket(schema, bytes, drop)
  const row = { label, schema: index, bytes: hex(bytes), drop, accepted: result.accepted }
  if (result.accepted) {
    row.entries = result.entries.map((entry) => packetLayout(schema, entry))
    row.epoch = result.chartEpoch
  } else {
    row.code = INPUT_CASE_CODES.indexOf(result.code)
  }
  packetDecode.push(row)
}
decodeRow(0, Uint8Array.of(), null, 'empty payload')
decodeRow(0, Uint8Array.of(0x00), null, 'zero records')
decodeRow(0, Uint8Array.of(0x09), null, 'nine records')
decodeRow(0, Uint8Array.of(0x81, 0, 0, 0), null, 'truncated epoch')
decodeRow(0, Uint8Array.of(0x01), null, 'truncated record')
decodeRow(0, Uint8Array.from([1, ...new Array(14).fill(0)]), null, 'one empty record')
decodeRow(0, Uint8Array.from([1, ...new Array(14).fill(0), 0xaa]), null, 'trailing byte')
const flaggedRecord = Uint8Array.from([1, ...new Array(14).fill(0)])
flaggedRecord[14] = 0x02
decodeRow(0, flaggedRecord, null, 'unknown flag bit')
const analogCut = Uint8Array.from([1, ...new Array(13).fill(0), 0x01])
decodeRow(0, analogCut, null, 'analog bytes missing')
const nanAxis = Uint8Array.from([1, ...new Array(14).fill(0), 0x00, 0x00, 0xc0, 0x7f, ...new Array(4).fill(0)])
decodeRow(1, nanAxis, null, 'NaN axis value')
for (const row of packetEncode.filter((r) => r.accepted)) {
  const bytes = Uint8Array.from(row.bytes.match(/../g), (h) => parseInt(h, 16))
  const schema = PACKET_SCHEMAS[row.schema]
  const recordAt = bytes[0] & 0x80 ? 5 : 1
  const analog = (bytes[recordAt + 13] & 1) !== 0
  decodeRow(row.schema, bytes, null, 'decode of ' + row.label)
  decodeRow(row.schema, bytes, row.entries[0][0], 'decode dropping through the first sequence of ' + row.label)
  decodeRow(row.schema, bytes.slice(0, Math.floor(random() * bytes.length)), null, 'truncated ' + row.label)
  decodeRow(row.schema, Uint8Array.from([...bytes, 0xaa]), null, 'trailing byte of ' + row.label)
  const flagged = Uint8Array.from(bytes)
  flagged[recordAt + 13] = Math.floor(random() * 256)
  decodeRow(row.schema, flagged, null, 'flags of ' + row.label)
  if (schema.axes.length > 0) {
    const nan = Uint8Array.from(bytes)
    nan.set([0x00, 0x00, 0xc0, 0x7f], recordAt + 14 + (analog ? 2 : 0))
    decodeRow(row.schema, nan, null, 'NaN axis of ' + row.label)
  }
  const counted = Uint8Array.from(bytes)
  counted[0] = (bytes[0] & 0x80) | Math.floor(random() * 128)
  decodeRow(row.schema, counted, null, 'record count of ' + row.label)
}
const packetSection = { schemas: PACKET_SCHEMAS.map((s) => ({ buttons: s.buttons.length, axes: s.axes.length })), encode: packetEncode, decode: packetDecode }

mkdirSync(outDir, { recursive: true })
writeFileSync(outFile, JSON.stringify({ entity: entityCases, player: playerCases, quat: quatCases, quatDecode: decodeCases, inputs: inputCases, packet: packetSection }, null, 1) + '\n')
console.log('wrote ' + outFile + ' with ' + entityCases.length + ' entity, ' + playerCases.length + ' player, ' + quatCases.length + ' quaternion, ' + decodeCases.length + ' word, ' + inputCases.length + ' input cases')
