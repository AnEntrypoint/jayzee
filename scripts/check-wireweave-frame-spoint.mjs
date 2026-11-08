import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gate, finish } from './lib/gate.mjs'
import { MTU_DEFAULT, MAX_FRAGMENTS, maxPayloadBytes, encodeHeader, decodeHeader, fragment, Reassembler } from '../src/transport/wireweaveFrame.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/spoint/wireweave-frame.json', import.meta.url), 'utf8'))
const hex = (bytes) => Buffer.from(bytes).toString('hex')
const bytesOf = (text) => Uint8Array.from(Buffer.from(text, 'hex'))
const payloadOf = (length) => Uint8Array.from({ length }, (_, i) => (i * 73 + 29) & 255)
const attempt = (run) => { try { run(); return null } catch (error) { return error.message } }

const jayFragments = {}
for (const [name, c] of Object.entries(fixture.cases)) {
  jayFragments[name] = fragment(payloadOf(c.length), { messageId: fixture.messageId }).map((piece) => hex(new Uint8Array(piece)))
}

gate('the constants match spoint frame.js: the default MTU and the 16-bit fragment ceiling', () => {
  assert.equal(MTU_DEFAULT, fixture.MTU)
  assert.equal(MAX_FRAGMENTS, fixture.MAX_FRAGMENTS)
})

gate('fragment matches spoint frame.js byte for byte at every payload size, including empty and both sides of the MTU', () => {
  for (const [name, c] of Object.entries(fixture.cases)) assert.deepEqual(jayFragments[name], c.fragments, name)
})

gate('the reassembler rebuilds every payload from its fragments fed in reverse order, as spoint does', () => {
  for (const [name, c] of Object.entries(fixture.cases)) {
    const reassembler = new Reassembler()
    let rebuilt = null
    for (const piece of [...jayFragments[name]].reverse()) rebuilt = reassembler.feed(bytesOf(piece)) ?? rebuilt
    assert.equal(rebuilt === null ? null : hex(rebuilt), c.rebuiltHex, name)
    assert.equal(c.rebuiltHex, hex(payloadOf(c.length)), name + ' spoint rebuild')
  }
})

gate('encodeHeader writes the same bytes as spoint for the 16-bit ids and the 32-bit length', () => {
  for (const h of fixture.headers) assert.equal(hex(new Uint8Array(encodeHeader(h.input))), h.hex, JSON.stringify(h.input))
})

gate('decodeHeader reads the same fields back and refuses a short buffer and a wrong magic byte, as spoint does', () => {
  for (const h of fixture.headers) assert.deepEqual(decodeHeader(bytesOf(h.hex)), h.decoded, JSON.stringify(h.input))
  assert.equal(decodeHeader(new Uint8Array(10)), fixture.decodeRefusals.shortBuffer)
  assert.equal(decodeHeader(new Uint8Array(11)), fixture.decodeRefusals.wrongMagic)
})

gate('maxPayloadBytes matches spoint at the default MTU and at mtu 64', () => {
  assert.equal(maxPayloadBytes(), fixture.maxPayloadBytes.default)
  assert.equal(maxPayloadBytes(64), fixture.maxPayloadBytes.mtu64)
})

gate('fragment refuses an mtu at the header size and a payload beyond the fragment ceiling, with spoint messages', () => {
  assert.equal(attempt(() => fragment(new Uint8Array(1), { messageId: 1, mtu: 11 })), fixture.errors.mtuAtHeader)
  assert.equal(attempt(() => fragment(new Uint8Array(maxPayloadBytes(64) + 1), { messageId: 1, mtu: 64 })), fixture.errors.beyondCeiling)
})

gate('the fixture covers the fragment boundary: one fragment holds MTU minus the 11-byte header, and one byte more needs two', () => {
  assert.equal(fixture.cases.fragmentBody.fragmentCount, 1)
  assert.equal(fixture.cases.fragmentBodyPlus1.fragmentCount, 2)
  assert.equal(fixture.cases.threeMtu.fragmentCount, 4)
})

finish()
