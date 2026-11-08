import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const wireweaveRoot = resolve(process.argv[2] ?? '/workspace/spoint/node_modules/wireweave')
const frameFile = join(wireweaveRoot, 'src/frame.js')
const outFile = join(here, 'fixtures', 'spoint', 'wireweave-frame.json')
const frame = await import(pathToFileURL(frameFile).href)
const pkg = JSON.parse(readFileSync(join(wireweaveRoot, 'package.json'), 'utf8'))

const hex = (bytes) => Buffer.from(bytes).toString('hex')
const payloadOf = (length) => Uint8Array.from({ length }, (_, i) => (i * 73 + 29) & 255)
const MTU = frame.MTU_DEFAULT
const messageId = 4242
const HEADER_BYTES = 11
const sizes = { empty: 0, one: 1, mtuMinus1: MTU - 1, mtu: MTU, mtuPlus1: MTU + 1, fragmentBody: MTU - HEADER_BYTES, fragmentBodyPlus1: MTU - HEADER_BYTES + 1, threeMtu: 3 * MTU }

const cases = {}
for (const [name, length] of Object.entries(sizes)) {
  const payload = payloadOf(length)
  const frames = frame.fragment(payload, { messageId })
  const reassembler = new frame.Reassembler()
  let rebuilt = null
  for (const piece of [...frames].reverse()) rebuilt = reassembler.feed(new Uint8Array(piece)) ?? rebuilt
  cases[name] = {
    length,
    fragmentCount: frames.length,
    fragments: frames.map((piece) => hex(new Uint8Array(piece))),
    rebuiltHex: rebuilt === null ? null : hex(rebuilt),
  }
}

const headerInputs = [
  { messageId: 0, fragmentIndex: 0, fragmentCount: 1, totalPayloadLength: 0 },
  { messageId: 65535, fragmentIndex: 2, fragmentCount: 3, totalPayloadLength: 4294967295 },
  { messageId: 258, fragmentIndex: 65534, fragmentCount: 65535, totalPayloadLength: 1000000 },
]
const headers = headerInputs.map((input) => {
  const bytes = new Uint8Array(frame.encodeHeader(input))
  return { input, hex: hex(bytes), decoded: frame.decodeHeader(bytes) }
})

const errors = {}
try { frame.fragment(new Uint8Array(1), { messageId: 1, mtu: 11 }) } catch (error) { errors.mtuAtHeader = error.message }
try { frame.fragment(new Uint8Array(frame.maxPayloadBytes(64) + 1), { messageId: 1, mtu: 64 }) } catch (error) { errors.beyondCeiling = error.message }

const fixture = {
  messageId,
  source: {
    package: 'wireweave',
    version: pkg.version,
    commit: 'a71f179cc5352964bc014deea166969938705e61',
    file: 'src/frame.js',
    sha256: createHash('sha256').update(readFileSync(frameFile)).digest('hex'),
    note: 'frame.js imports nothing; the generator loads it directly from the installed spoint checkout',
  },
  MTU: frame.MTU_DEFAULT,
  MAX_FRAGMENTS: frame.MAX_FRAGMENTS,
  maxPayloadBytes: { default: frame.maxPayloadBytes(), mtu64: frame.maxPayloadBytes(64) },
  cases,
  headers,
  decodeRefusals: {
    shortBuffer: frame.decodeHeader(new Uint8Array(10)),
    wrongMagic: frame.decodeHeader(new Uint8Array(11)),
  },
  errors,
}
writeFileSync(outFile, JSON.stringify(fixture) + '\n')
console.log('wrote wireweave-frame.json: cases', Object.keys(cases).length, 'headers', headers.length, 'sha256', fixture.source.sha256.slice(0, 12))
