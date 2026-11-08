import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const spointRoot = resolve(process.argv[2] ?? '/workspace/spoint')
const outDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'spoint')
const load = (relative) => import(pathToFileURL(join(spointRoot, relative)).href)

const inputCodec = await load('src/protocol/InputCodec.js')
const componentSchema = await load('src/protocol/ComponentSchema.js')

const hex = (bytes) => Buffer.from(bytes).toString('hex')

const inputSchemaOf = { plain: inputCodec.createInputSchema(), axes: inputCodec.createInputSchema({ inputAxes: ['throttle'] }) }

const sentEntries = [
  { sequence: 41, data: { forward: true, sprint: true, shoot: true, yaw: 1.25, pitch: -0.5, expr: 9, analogForward: 0.5, analogRight: -1, throttle: 0.25 } },
  { sequence: 42, data: { backward: false, yaw: 0, pitch: 0, expr: 0, throttle: -1 } }
]
const manyEntries = Array.from({ length: 9 }, (_, i) => ({ sequence: 100 + i, data: { jump: i % 2 === 0, yaw: i * 0.5, pitch: i * 0.1, expr: i, throttle: i / 10 - 0.4 } }))
const singleEntry = [{ sequence: 1, data: { forward: true } }]

const packets = [
  { name: 'two records with analog and an axis, epoch 5', schema: 'axes', entries: sentEntries, epoch: 5 },
  { name: 'one record, epoch 0 (untagged)', schema: 'plain', entries: singleEntry, epoch: 0 },
  { name: 'nine records: the oldest is dropped', schema: 'axes', entries: manyEntries, epoch: 7 }
]

const inputCases = packets.map((packet) => {
  const result = inputCodec.tryEncodeInputPacket(inputSchemaOf[packet.schema], packet.entries, packet.epoch)
  if (!result.accepted) throw new Error('spoint refused ' + packet.name + ': ' + result.code)
  const decoded = inputCodec.decodeInputPacket(inputSchemaOf[packet.schema], result.bytes)
  return { name: packet.name, schema: packet.schema, epoch: packet.epoch, entries: packet.entries, hex: hex(result.bytes), decoded: JSON.stringify(decoded.entries), chartEpoch: decoded.chartEpoch }
})

const vitals = { hp: { type: 'u16' }, kind: { type: 'enum', enum: ['idle', 'run', 'dead'] }, alive: { type: 'bool' }, label: { type: 'string' }, speed: { type: 'f32' } }
const vitalsSchema = componentSchema.defineComponentSchema(vitals)
const fieldCases = [
  { name: 'every field set', value: { hp: 120, kind: 'run', alive: true, label: 'scout', speed: 2.5 } },
  { name: 'one field set', value: { hp: 3 } },
  { name: 'empty object', value: {} }
].map((c) => {
  const bytes = componentSchema.encodeCustomFields(vitalsSchema, c.value)
  return { name: c.name, value: c.value, hex: hex(bytes), decoded: JSON.stringify(componentSchema.decodeCustomFields(vitalsSchema, bytes)) }
})

mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'codec-bytes.json'), JSON.stringify({
  generatedFrom: 'spoint src/protocol/InputCodec.js tryEncodeInputPacket and decodeInputPacket; spoint src/protocol/ComponentSchema.js encodeCustomFields and decodeCustomFields',
  componentSchema: { hp: 'u16', kind: 'enum idle run dead', alive: 'bool', label: 'string', speed: 'f32' },
  inputPackets: inputCases,
  componentFields: fieldCases
}, null, 2) + '\n')
console.log('wrote ' + inputCases.length + ' input packets and ' + fieldCases.length + ' component field sets')
