import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { encodeEntityRecord, decodeEntityRecord, encodePlayerRecord, decodePlayerRecord, encodeSmallestThree, decodeSmallestThree } from '../src/wire/binSnapshot.js'
import { encodeInputs, decodeInputs } from '../src/protocol/input.js'

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

mkdirSync(outDir, { recursive: true })
writeFileSync(outFile, JSON.stringify({ entity: entityCases, player: playerCases, quat: quatCases, quatDecode: decodeCases, inputs: inputCases }, null, 1) + '\n')
console.log('wrote ' + outFile + ' with ' + entityCases.length + ' entity, ' + playerCases.length + ' player, ' + quatCases.length + ' quaternion, ' + decodeCases.length + ' word, ' + inputCases.length + ' input cases')
