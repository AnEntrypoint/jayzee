import { gate, finish } from './lib/gate.mjs'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Packr, Unpackr, NEVER, DECIMAL_ROUND } from 'msgpackr'
import { pack, unpack, WIRE_STRUCTURES } from '../src/protocol/msgpack.js'
import { encodeReplay, decodeReplay } from '../src/replay/index.js'

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const fixture = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'spoint', 'msgpack-cases.json'), 'utf8'))

const revive = (node) => {
  if (node === null || typeof node !== 'object') return node
  if (Array.isArray(node)) return node.map(revive)
  if ('$undef' in node) return undefined
  if ('$num' in node) return { NaN: NaN, Infinity: Infinity, '-Infinity': -Infinity, '-0': -0 }[node.$num]
  if ('$bin' in node) return Uint8Array.from(Buffer.from(node.$bin, 'hex'))
  if ('$map' in node) return new Map(node.$map.map(([k, v]) => [revive(k), revive(v)]))
  return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, revive(v)]))
}

const hex = (bytes) => Buffer.from(bytes).toString('hex')
const negativeZeroCases = fixture.cases.filter((c) => c.negativeZero)
const float64Hex = (number) => {
  const view = new DataView(new ArrayBuffer(8))
  view.setFloat64(0, number)
  return hex(new Uint8Array(view.buffer))
}
const NEG_ZERO = 'cb8000000000000000'
const SENTINEL = 0.8374615592187193

gate('spoint wrote at least one negative-zero case in its fixture', () => {
  assert(negativeZeroCases.length >= 1, 'no negative-zero case in the fixture')
})

for (const testCase of negativeZeroCases) {
  gate('packs "' + testCase.name + '" to the float64 -0 bytes spoint wrote', () => {
    const got = hex(pack(revive(testCase.value)))
    assert(got === testCase.hex, 'jayzee ' + got + ' differs from spoint ' + testCase.hex)
  })
}

gate('a -0 is written as cb 80 followed by seven zero bytes, the float64 sign bit alone', () => {
  assert(hex(pack(-0)) === NEG_ZERO, 'top-level -0 packed to ' + hex(pack(-0)))
  assert(hex(pack({ a: -0 })) === 'd4724291a161' + NEG_ZERO, 'object -0 packed to ' + hex(pack({ a: -0 })))
  assert(hex(pack(new Map([['k', -0]]))) === '81a16b' + NEG_ZERO, 'map -0 packed to ' + hex(pack(new Map([['k', -0]]))))
})

gate('a +0 still packs as the integer 0, so only the negative zero changes', () => {
  assert(hex(pack([0, -0, 0])) === '93' + '00' + NEG_ZERO + '00', 'mixed zeros packed to ' + hex(pack([0, -0, 0])))
})

gate('a real float equal to a sentinel next to a -0 keeps its own bytes', () => {
  const expected = '92' + NEG_ZERO + 'cb' + float64Hex(SENTINEL)
  assert(hex(pack([-0, SENTINEL])) === expected, 'collision packed to ' + hex(pack([-0, SENTINEL])))
})

gate('packing -0 leaves the caller value unchanged, so the -0 is still -0 afterwards', () => {
  const source = { a: -0, b: [-0, { c: -0 }] }
  pack(source)
  assert(Object.is(source.a, -0) && Object.is(source.b[0], -0) && Object.is(source.b[1].c, -0), 'the caller value changed')
})

gate('unpack reads the -0 bytes back as -0 at the top, in an array, in a map and in an object', () => {
  assert(Object.is(unpack(pack(-0)), -0), 'top-level -0 did not read back')
  assert(Object.is(unpack(pack([1, -0]))[1], -0), 'array -0 did not read back')
  assert(Object.is(unpack(pack(new Map([['k', -0]]))).get('k'), -0), 'map -0 did not read back')
  assert(Object.is(unpack(pack({ a: -0 })).a, -0), 'object -0 did not read back')
})

gate('a replay with a -0 header value writes the float64 -0 bytes and reads them back as -0', () => {
  const written = encodeReplay({ header: { x: -0 }, inputs: [] })
  assert(hex(written).includes(NEG_ZERO), 'replay bytes carry no float64 -0')
  assert(Object.is(decodeReplay(written).header.x, -0), 'replay -0 did not read back as -0')
})

gate('negative control: the released msgpackr writes the same -0 as integer 0, so the spoint bytes are a real change', () => {
  const plain = new Packr({ useFloat32: NEVER, bundleStrings: true, structures: WIRE_STRUCTURES.map((f) => f.slice()), saveStructures: false, maxSharedStructures: WIRE_STRUCTURES.length })
  assert(hex(plain.pack([-0, 1])) === '920001', 'released msgpackr packed -0 differently')
  assert(hex(pack([-0, 1])) !== hex(plain.pack([-0, 1])), 'jayzee still matches the released packer')
  const readBack = new Unpackr({ useFloat32: DECIMAL_ROUND, bundleStrings: true, structures: WIRE_STRUCTURES.map((f) => f.slice()), saveStructures: false, maxSharedStructures: WIRE_STRUCTURES.length })
  assert(Object.is(readBack.unpack(Buffer.from(NEG_ZERO, 'hex')), -0), 'the -0 bytes did not read back as -0')
})

finish()
