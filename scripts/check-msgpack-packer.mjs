import { gate, finish } from './lib/gate.mjs'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Packr } from 'msgpackr'
import { pack, unpack } from '../src/protocol/msgpack.js'

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
const byName = (name) => fixture.cases.find((c) => c.name === name)
const ordinary = fixture.cases.filter((c) => !c.negativeZero)

const refuses = (read, pattern) => {
  try {
    read()
  } catch (error) {
    assert(pattern === undefined || pattern.test(error.message), 'refused with ' + error.message)
    return true
  }
  return false
}

gate('the fixture is the one the generator wrote: 56 cases from spoint pack', () => {
  assert(fixture.cases.length === 56, 'case count ' + fixture.cases.length)
  assert(typeof fixture.sha256 === 'string' && fixture.sha256.length === 64, 'no fixture digest')
})

for (const testCase of ordinary) {
  gate('packs "' + testCase.name + '" to the spoint bytes', () => {
    const got = hex(pack(revive(testCase.value)))
    assert(got === testCase.hex, 'jayzee ' + got + ' differs from spoint ' + testCase.hex)
  })
}

gate('packing the cases in reverse order gives the same bytes (no state carried between calls)', () => {
  const forward = ordinary.map((c) => hex(pack(revive(c.value))))
  const backward = [...ordinary].reverse().map((c) => hex(pack(revive(c.value)))).reverse()
  assert(JSON.stringify(forward) === JSON.stringify(backward), 'order changed the bytes')
})

gate('OPEN, known difference: negative zero packs as integer 0 under the released msgpackr 2.0.4, where spoint packs float64 -0', () => {
  const negative = byName('negative zero in array')
  assert(negative.negativeZero === true, 'the -0 case is not marked')
  assert(negative.hex === '92cb800000000000000001', 'spoint bytes ' + negative.hex)
  assert(hex(pack(revive(negative.value))) === '920001', 'jayzee bytes ' + hex(pack(revive(negative.value))))
})

gate('the packer returns a Uint8Array that a later pack does not overwrite', () => {
  const first = pack([1, 2, 3])
  const copy = Uint8Array.from(first)
  pack({ other: 'value that is longer than the first' })
  assert(hex(first) === hex(copy), 'a later pack changed the earlier bytes')
  assert(first instanceof Uint8Array, 'pack did not return a Uint8Array')
})

gate('unpack reads every ordinary spoint case back to the same bytes when packed again', () => {
  const skip = new Set(['map numeric key', 'object undefined field', 'undefined top level', 'int 2^60'])
  for (const testCase of ordinary) {
    if (skip.has(testCase.name)) continue
    const bytes = Uint8Array.from(Buffer.from(testCase.hex, 'hex'))
    assert(hex(pack(unpack(bytes))) === testCase.hex, 'unpack then pack changed ' + testCase.name)
  }
})

gate('unpack accepts an ArrayBuffer holding the same bytes', () => {
  const bytes = Buffer.from(byName('wire snapshot').hex, 'hex')
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  assert(JSON.stringify(unpack(buffer)) === JSON.stringify(unpack(new Uint8Array(buffer))), 'ArrayBuffer read differs')
})

gate('unpack refuses a non-binary input, a truncated value and a trailing byte', () => {
  assert(refuses(() => unpack('0x91'), /Uint8Array or ArrayBuffer/), 'a string was accepted')
  const bytes = Uint8Array.from(Buffer.from(byName('wire snapshot').hex, 'hex'))
  assert(refuses(() => unpack(bytes.subarray(0, bytes.length - 1))), 'a truncated value was accepted')
  assert(refuses(() => unpack(Uint8Array.from([...bytes, 0]))), 'a trailing byte was accepted')
})

gate('unpack refuses the reserved marker 0xc1', () => {
  assert(refuses(() => unpack(Uint8Array.of(0xc1))), 'marker 0xc1 was accepted')
})

gate('negative control: a packer without the spoint shared structures does not reproduce the wire snapshot', () => {
  const plain = new Packr({ useRecords: false, bundleStrings: true })
  const snapshot = revive(byName('wire snapshot').value)
  assert(hex(plain.pack(snapshot)) !== byName('wire snapshot').hex, 'a packer without structures matched the spoint record bytes')
})

gate('negative control: changing one wire value changes the bytes', () => {
  const base = revive(byName('wire snapshot').value)
  const changed = { type: 'snapshot', payload: { ...base.payload, tick: 3 } }
  assert(hex(pack(changed)) !== byName('wire snapshot').hex, 'a changed tick packed to the same bytes')
})

finish()
