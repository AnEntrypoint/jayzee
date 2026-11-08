import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const spointRoot = resolve(process.argv[2] ?? '/workspace/spoint')
const outDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'spoint')

const msgpack = await import(pathToFileURL(join(spointRoot, 'src/protocol/msgpack.js')).href)
await msgpack.ensurePacked

const hex = (bytes) => Buffer.from(bytes).toString('hex')

const tag = (value) => {
  if (value === undefined) return { $undef: true }
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return { $num: 'NaN' }
    if (value === Infinity) return { $num: 'Infinity' }
    if (value === -Infinity) return { $num: '-Infinity' }
    if (Object.is(value, -0)) return { $num: '-0' }
    return value
  }
  if (value instanceof Uint8Array) return { $bin: hex(value) }
  if (value instanceof Map) return { $map: [...value.entries()].map(([k, v]) => [tag(k), tag(v)]) }
  if (Array.isArray(value)) return value.map(tag)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, tag(v)]))
  }
  return value
}

const bytes256 = Uint8Array.from({ length: 256 }, (_, i) => i)
const sixteenKeys = Object.fromEntries(Array.from({ length: 16 }, (_, i) => ['k' + i, i]))
const sixteenItems = Array.from({ length: 16 }, (_, i) => i - 8)

const snapshotPayload = (overrides = {}) => ({
  seq: 1,
  tick: 2,
  serverTime: 3,
  players: [[1, 2, 3, 4, 0]],
  entities: [],
  removed: undefined,
  delta: 1,
  dots: undefined,
  me: undefined,
  chartEpoch: 0,
  ...overrides
})

const cases = [
  ['int 0', 0], ['int 127', 127], ['int 128', 128], ['int 255', 255], ['int 256', 256],
  ['int 65535', 65535], ['int 65536', 65536], ['int 2^32-1', 4294967295], ['int 2^32', 4294967296],
  ['int 2^53-1', 2 ** 53 - 1], ['int -1', -1], ['int -32', -32], ['int -33', -33], ['int -128', -128],
  ['int -129', -129], ['int -32768', -32768], ['int -32769', -32769], ['int -2^31', -2147483648],
  ['int -2^31-1', -2147483649], ['int -(2^53-1)', -(2 ** 53 - 1)], ['int 2^60', 2 ** 60],
  ['float 0.5', 0.5], ['float -1.25', -1.25], ['float 1e-300', 1e-300], ['float 1e300', 1e300],
  ['float Infinity', Infinity], ['float -Infinity', -Infinity], ['float NaN', NaN],
  ['string empty', ''], ['string a', 'a'], ['string 31 bytes', 'x'.repeat(31)], ['string 32 bytes', 'x'.repeat(32)],
  ['string 256 bytes', 'x'.repeat(256)], ['string utf8', 'héllo ✓'], ['string 300 bytes', 'y'.repeat(300)],
  ['binary empty', new Uint8Array(0)], ['binary 3', Uint8Array.of(1, 2, 3)], ['binary 256', bytes256],
  ['array empty', []], ['array mixed', [1, 'a', null]], ['array 16', sixteenItems],
  ['array nested', [[1, [2, [3]]], { a: [true, false] }]],
  ['object empty', {}], ['object a', { a: 1 }], ['object 16 keys', sixteenKeys],
  ['object nested', { id: 7, name: 'héllo', pos: { x: 1.5, y: -2, z: 0 }, blob: Uint8Array.of(9, 8, 7), flags: [true, false, null], big: 4294967296, neg: -129 }],
  ['object undefined field', { a: undefined, b: 1 }],
  ['undefined top level', undefined],
  ['map a', new Map([['a', 1]])], ['map a b', new Map([['a', 1], ['b', 'x']])],
  ['map numeric key', new Map([[1, 'x']])],
  ['negative zero in array', [-0, 1]],
  ['wire snapshot', { type: 'snapshot', payload: snapshotPayload() }],
  ['wire snapshot with removed', { type: 'snapshot', payload: snapshotPayload({ removed: [4, 5], dots: [1.5], me: { id: 2 }, chartEpoch: 9 }) }],
  ['wire snapshot with binary player', { type: 'snapshot', payload: snapshotPayload({ players: [[9, Uint8Array.of(1, 2, 3), 1], [5, -6, 7, 8, 1]] }) }],
  ['wire type only', { type: 'ping' }]
]

const out = cases.map(([name, value]) => {
  const bytes = msgpack.pack(value)
  return { name, value: tag(value), hex: hex(bytes), negativeZero: JSON.stringify(tag(value)).includes('"$num":"-0"') }
})

const sha256 = createHash('sha256').update(JSON.stringify(out)).digest('hex')
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'msgpack-cases.json'), JSON.stringify({ generatedFrom: 'spoint src/protocol/msgpack.js pack, with the spoint Packr settings', sha256, cases: out }, null, 2) + '\n')
console.log('wrote ' + out.length + ' msgpack cases')
