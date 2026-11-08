import { gate, finish } from './lib/gate.mjs'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Packr } from 'msgpackr'
import { SPOINTREPLAY_MAGIC, SPOINTREPLAY_VERSION, encodeReplay, decodeReplay } from '../src/replay/index.js'

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'spoint')
const bytes = readFileSync(join(fixtureDir, 'replay-sample.bin'))
const meta = JSON.parse(readFileSync(join(fixtureDir, 'replay-sample.json'), 'utf8'))
const variants = JSON.parse(readFileSync(join(fixtureDir, 'replay-variants.json'), 'utf8')).variants

const sameBytes = (a, b) => Buffer.from(a).equals(Buffer.from(b))
const asJson = (value) => JSON.stringify(value)

gate('the replay sample fixture matches the sha256 recorded when spoint wrote it', () => {
  const digest = createHash('sha256').update(bytes).digest('hex')
  assert(digest === meta.sha256, 'fixture digest ' + digest + ' differs from ' + meta.sha256)
  assert(meta.byteLength === bytes.length, 'fixture length ' + bytes.length)
})

gate('the shipped constants are the spoint magic and version 2', () => {
  assert(SPOINTREPLAY_MAGIC === 'spointreplay', 'magic ' + SPOINTREPLAY_MAGIC)
  assert(SPOINTREPLAY_VERSION === 2, 'version ' + SPOINTREPLAY_VERSION)
})

gate('encodeReplay writes the spoint replay sample byte for byte', () => {
  const written = encodeReplay(meta.sample)
  assert(sameBytes(written, bytes), 'jayzee wrote ' + Buffer.from(written).toString('hex').slice(0, 96) + '... and spoint wrote ' + bytes.toString('hex').slice(0, 96) + '...')
})

gate('decodeReplay reads the spoint replay sample back to the sample it was written from', () => {
  const envelope = decodeReplay(bytes)
  assert(envelope.magic === 'spointreplay' && envelope.version === 2, 'magic or version read as ' + envelope.magic + ' ' + envelope.version)
  assert(asJson(envelope.header) === asJson(meta.sample.header), 'header differs')
  assert(asJson(envelope.inputs) === asJson(meta.sample.inputs), 'inputs differ')
  assert(asJson(envelope.ticks) === asJson(meta.sample.ticks), 'ticks differ')
  assert(asJson(envelope.events) === asJson(meta.sample.events), 'events differ')
})

for (const variant of variants) {
  if (variant.version === 2) {
    gate('variant ' + variant.name + ' is written by jayzee as spoint wrote it', () => {
      assert(sameBytes(encodeReplay(variant.sample), Buffer.from(variant.hex, 'hex')), 'jayzee bytes differ from spoint bytes')
    })
  }
  gate('variant ' + variant.name + ' is read by jayzee to the records spoint wrote', () => {
    const envelope = decodeReplay(Buffer.from(variant.hex, 'hex'))
    assert(envelope.version === variant.version, 'version ' + envelope.version)
    assert(asJson(envelope.header) === asJson(variant.sample.header), 'header differs')
    assert(asJson(envelope.inputs) === asJson(variant.sample.inputs), 'inputs differ')
    assert(asJson(envelope.ticks) === asJson(variant.sample.ticks), 'ticks differ')
    assert(asJson(envelope.events) === asJson(variant.sample.events), 'events differ')
  })
}

gate('a write then read returns the same records, and reading twice gives the same result', () => {
  const sample = variants.find((v) => v.name === 'rich-v2').sample
  const first = decodeReplay(encodeReplay(sample))
  const second = decodeReplay(encodeReplay(sample))
  assert(asJson(first) === asJson(second), 'two reads of the same write differ')
  assert(asJson(first.header) === asJson(sample.header) && asJson(first.inputs) === asJson(sample.inputs), 'write then read changed the records')
})

gate('reads do not depend on earlier reads: the spoint fixture decodes the same after a version 1 file', () => {
  const before = asJson(decodeReplay(bytes))
  decodeReplay(Buffer.from(variants.find((v) => v.name === 'rich-v1').hex, 'hex'))
  decodeReplay(encodeReplay(variants.find((v) => v.name === 'empty-header-v2').sample))
  assert(asJson(decodeReplay(bytes)) === before, 'the fixture decoded differently after other reads')
})

gate('negative control: a packer without the record dialect does not reproduce the spoint bytes', () => {
  const plain = new Packr({ useRecords: false, bundleStrings: true })
  const envelope = { magic: 'spointreplay', version: 2, header: meta.sample.header, inputs: meta.sample.inputs, ticks: [], events: [] }
  assert(!sameBytes(plain.pack(envelope), bytes), 'a plain packer matched the record dialect')
})

gate('negative control: a changed input changes the written bytes and the read value', () => {
  const changed = { ...meta.sample, inputs: [{ ...meta.sample.inputs[0], buttons: 4 }, meta.sample.inputs[1]] }
  const written = encodeReplay(changed)
  assert(!sameBytes(written, bytes), 'a changed input produced the same bytes')
  assert(decodeReplay(written).inputs[0].buttons === 4, 'the changed input did not read back')
})

gate('a negative zero in a replay is written as the float64 -0 bytes and reads back as -0', () => {
  const written = encodeReplay({ header: { x: -0 }, inputs: [] })
  assert(Buffer.from(written).includes(Buffer.from('cb8000000000000000', 'hex')), 'no float64 -0 in the replay bytes')
  const read = decodeReplay(written)
  assert(Object.is(read.header.x, -0), 'the -0 read back as ' + read.header.x)
})

finish()
