import { gate, finish } from './lib/gate.mjs'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Packr, Unpackr, NEVER, DECIMAL_ROUND } from 'msgpackr'
import { encodeReplay } from '../src/replay/file.js'

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'spoint')
const bytes = readFileSync(join(fixtureDir, 'replay-sample.bin'))
const meta = JSON.parse(readFileSync(join(fixtureDir, 'replay-sample.json'), 'utf8'))

const WIRE_STRUCTURES = [
  ['type', 'payload'],
  ['seq', 'tick', 'serverTime', 'players', 'entities', 'removed', 'delta', 'dots', 'me', 'chartEpoch']
]

const spointWireOptions = (useFloat32) => ({
  useFloat32,
  bundleStrings: true,
  structures: WIRE_STRUCTURES.map((fields) => fields.slice()),
  saveStructures: false,
  maxSharedStructures: WIRE_STRUCTURES.length
})

const spointPacker = new Packr(spointWireOptions(NEVER))
const spointUnpacker = new Unpackr(spointWireOptions(DECIMAL_ROUND))

const envelopeOf = ({ header, inputs, ticks, events }) => ({
  magic: 'spointreplay',
  version: 2,
  header,
  inputs,
  ticks,
  events
})

const sameBytes = (a, b) => Buffer.from(a).equals(Buffer.from(b))

gate('the fixture bytes match the sha256 recorded when spoint wrote them', () => {
  const digest = createHash('sha256').update(bytes).digest('hex')
  if (digest !== meta.sha256) throw new Error(`fixture sha256 ${digest} differs from recorded ${meta.sha256}`)
})

gate('pinned msgpackr decodes the spoint fixture to the same envelope', () => {
  const decoded = spointUnpacker.unpack(bytes)
  if (decoded.magic !== 'spointreplay' || decoded.version !== 2) throw new Error('magic or version differs')
  if (JSON.stringify(decoded.inputs) !== JSON.stringify(meta.sample.inputs)) throw new Error('inputs differ after decode')
  if (JSON.stringify(decoded.header) !== JSON.stringify(meta.sample.header)) throw new Error('header differs after decode')
})

gate('msgpackr with spoint packer settings reproduces the spoint fixture byte for byte', () => {
  const packed = spointPacker.pack(envelopeOf(meta.sample))
  if (!sameBytes(packed, bytes)) throw new Error(`packed ${Buffer.from(packed).toString('hex')} differs from fixture`)
})

gate('a packer without the record dialect does not reproduce the fixture (control)', () => {
  const plain = new Packr({ useRecords: false, bundleStrings: true })
  if (sameBytes(plain.pack(envelopeOf(meta.sample)), bytes)) throw new Error('plain packer matched the record dialect bytes')
})

gate('OPEN, known difference: the shipped encodeReplay bytes differ from spoint, so the replay file is not byte-compatible yet', () => {
  if (sameBytes(encodeReplay(meta.sample), bytes)) throw new Error('shipped encodeReplay now matches spoint: update row 42 and this claim')
})

finish()
