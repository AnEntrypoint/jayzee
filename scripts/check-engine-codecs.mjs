import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { loadEngineModule } from '../src/engine/EngineWorld.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cases = JSON.parse(readFileSync(join(root, 'scripts/fixtures/engine/codec-cases.json'), 'utf8'))
const module = await loadEngineModule()
const VALUES = module._engine_codec_values() / 8
const BYTES = module._engine_codec_bytes()

const num = (v) => (typeof v === 'string' ? Number(v) : v)
const numbers = (list) => list.map(num)
const writeValues = (list) => module.HEAPF64.set(numbers(list), VALUES)
const readValues = (count) => Array.from(module.HEAPF64.subarray(VALUES, VALUES + count))
const writeBytes = (bytes) => module.HEAPU8.set(bytes, BYTES)
const readBytes = (count) => Array.from(module.HEAPU8.subarray(BYTES, BYTES + count))
const fromHex = (text) => Uint8Array.from(text.match(/../g) ?? [], (h) => parseInt(h, 16))
const toHex = (bytes) => bytes.map((b) => b.toString(16).padStart(2, '0')).join('')
const same = (a, b) => a.length === b.length && a.every((v, i) => Object.is(v, numbers(b)[i]))

gate('entity records: C++ encode bytes equal the spoint encoder bytes for every accepted case', () => {
  for (const c of cases.entity.filter((x) => !x.refuse)) {
    writeValues(c.values)
    assert.equal(module._engine_codec_encode_entity(), 0, c.label)
    assert.equal(toHex(readBytes(29)), c.bytes, c.label)
  }
})

gate('entity records: C++ decode equals the spoint decoder value for value, bit for bit', () => {
  for (const c of cases.entity.filter((x) => !x.refuse)) {
    writeBytes(fromHex(c.bytes))
    assert.equal(module._engine_codec_decode_entity(29), 0, c.label)
    assert.ok(same(readValues(11), c.decoded), c.label)
  }
})

gate('player records: C++ encode bytes equal the spoint encoder bytes for every case', () => {
  for (const c of cases.player) {
    writeValues(c.values)
    assert.equal(module._engine_codec_encode_player(), 0, c.label)
    assert.equal(toHex(readBytes(22)), c.bytes, c.label)
  }
})

gate('player records: C++ decode equals the spoint decoder value for value, bit for bit', () => {
  for (const c of cases.player) {
    writeBytes(fromHex(c.bytes))
    assert.equal(module._engine_codec_decode_player(22), 0, c.label)
    assert.ok(same(readValues(7), c.decoded), c.label)
  }
})

gate('smallest-three encode: C++ word equals the spoint word for every accepted quaternion', () => {
  for (const c of cases.quat.filter((x) => !x.refuse)) {
    writeValues([...c.components, 0])
    assert.equal(module._engine_codec_encode_quat(), 0, c.label)
    assert.ok(Object.is(readValues(5)[4], c.word), c.label)
  }
})

gate('smallest-three decode: C++ components equal the spoint components bit for bit', () => {
  for (const c of [...cases.quat.filter((x) => !x.refuse), ...cases.quatDecode.filter((x) => !x.refuse)]) {
    writeValues([c.word])
    assert.equal(module._engine_codec_decode_quat(), 0, c.label)
    assert.ok(same(readValues(5).slice(1, 5), c.decoded), c.label)
  }
})

gate('input packets: C++ encode and decode equal encodeInputs and decodeInputs byte for byte', () => {
  for (const c of cases.inputs.filter((x) => !x.refuse)) {
    const count = c.records.length
    writeValues(c.records.flat())
    const length = module._engine_codec_encode_inputs(count)
    assert.equal(length, c.bytes.length / 2, c.label)
    assert.equal(toHex(readBytes(length)), c.bytes, c.label)
    writeBytes(fromHex(c.bytes))
    assert.equal(module._engine_codec_decode_inputs(length), count, c.label)
    assert.ok(same(readValues(count * 5), c.decoded.flat()), c.label)
  }
})

gate('refusals: every case the spoint codecs refuse, the C++ codecs refuse too', () => {
  for (const c of cases.entity.filter((x) => x.refuse)) {
    writeValues(c.values)
    assert.ok(module._engine_codec_encode_entity() < 0, c.label)
  }
  for (const c of cases.quat.filter((x) => x.refuse)) {
    writeValues([...c.components, 0])
    assert.ok(module._engine_codec_encode_quat() < 0, c.label)
  }
  for (const c of cases.quatDecode.filter((x) => x.refuse)) {
    writeValues([c.word])
    assert.ok(module._engine_codec_decode_quat() < 0, c.label)
  }
  for (const c of cases.inputs.filter((x) => x.refuse)) {
    writeValues(c.records.flat())
    assert.ok(module._engine_codec_encode_inputs(c.records.length) < 0, c.label)
  }
})

gate('schema input packets: C++ encode bytes and clamp, wrap and drop counts equal encodeInputPacket', () => {
  for (const c of cases.packet.encode) {
    const schema = cases.packet.schemas[c.schema]
    writeValues(c.entries.flat())
    const length = module._engine_codec_encode_packet(schema.buttons, schema.axes, num(c.epoch), c.entries.length)
    if (!c.accepted) {
      assert.equal(-1 - length, c.code, c.label)
      continue
    }
    assert.equal(length, c.bytes.length / 2, c.label)
    assert.equal(toHex(readBytes(length)), c.bytes, c.label)
    const counts = module._engine_codec_counts() / 4
    assert.deepEqual(Array.from(module.HEAP32.subarray(counts, counts + 3)), c.counts, c.label)
  }
})

gate('schema input packets: C++ decode equals decodeInputPacket value for value, bit for bit, and refuses what it refuses', () => {
  for (const c of cases.packet.decode) {
    const schema = cases.packet.schemas[c.schema]
    const bytes = fromHex(c.bytes)
    writeBytes(bytes)
    const kept = module._engine_codec_decode_packet(schema.buttons, schema.axes, bytes.length, c.drop === null ? 0 : 1, c.drop ?? 0)
    if (!c.accepted) {
      assert.equal(-1 - kept, c.code, c.label)
      continue
    }
    assert.equal(kept, c.entries.length, c.label)
    assert.ok(same(readValues(kept * 24), c.entries.flat()), c.label)
    assert.equal(module._engine_codec_packet_epoch() >>> 0, c.epoch, c.label)
  }
})

gate('a truncated record is refused: 28 entity bytes and 21 player bytes', () => {
  writeBytes(new Uint8Array(28))
  assert.ok(module._engine_codec_decode_entity(28) < 0)
  writeBytes(new Uint8Array(22))
  assert.ok(module._engine_codec_decode_player(21) < 0)
})

finish()
