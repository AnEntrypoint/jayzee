import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { startLoopbackRelay } from './lib/loopbackNostrRelay.mjs'
import { createWireweaveRelay } from '../src/transport/wireweaveRelay.js'
import { fragment, MTU_DEFAULT, maxPayloadBytes } from '../src/transport/wireweaveFrame.js'
import { generateSecretKey, getPublicKey, finalizeEvent, verifyEvent } from 'nostr-tools'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const waitFor = async (test, label, timeoutMs = 8000) => {
  const started = Date.now()
  while (!test()) {
    if (Date.now() - started > timeoutMs) throw new Error('timed out waiting for ' + label)
    await sleep(10)
  }
}
const frameOf = (text) => Buffer.from(fragment(new TextEncoder().encode(text), { messageId: 9 })[0]).toString('base64')

const relay = await startLoopbackRelay()
const keys = [generateSecretKey(), generateSecretKey()]
const pubkeys = keys.map((sk) => getPublicKey(sk))
const signer = (index) => (template) => finalizeEvent(template, keys[index])
const make = (index, options = {}) => createWireweaveRelay({
  relays: [relay.url], WebSocketImpl: WebSocket, verifyEvent, sign: signer(index), pubkey: pubkeys[index], room: 'lobby', ...options,
})

const ran = { error: null }
try {
  const alice = make(0)
  const bob = make(1)
  const aliceInbox = []
  const bobInbox = []
  alice.onMessage((payload, from) => aliceInbox.push({ payload: Uint8Array.from(payload), from }))
  bob.onMessage((payload, from) => bobInbox.push({ payload: Uint8Array.from(payload), from }))
  alice.connect()
  bob.connect()
  await waitFor(() => alice.isConnected() && bob.isConnected(), 'both relay sockets')

  const bigPayload = Uint8Array.from({ length: 3 * MTU_DEFAULT + 17 }, (_, i) => (i * 37 + 11) & 255)
  ran.bigSend = alice.send(bigPayload)
  await waitFor(() => bobInbox.length >= 1, 'the large payload')
  ran.bigPayload = bigPayload
  ran.bobInbox = bobInbox.map((m) => ({ hex: Buffer.from(m.payload).toString('hex'), from: m.from }))

  ran.shortSend = bob.send(new TextEncoder().encode('hi'))
  await waitFor(() => aliceInbox.length >= 1, 'the short reply')
  ran.aliceInbox = aliceInbox.map((m) => ({ text: new TextDecoder().decode(m.payload), from: m.from }))

  const before = bobInbox.length
  const genuine = finalizeEvent({ kind: 20001, created_at: Math.floor(Date.now() / 1000), tags: [['r', 'lobby']], content: frameOf('one') }, keys[0])
  alice.pool.publish({ ...genuine, content: frameOf('two') })
  await sleep(400)
  ran.forgedDelivered = bobInbox.length - before

  const small = make(0, { mtu: 64 })
  const limit = maxPayloadBytes(64)
  const storedBefore = relay.events.length
  ran.refused = small.send(new Uint8Array(limit + 1))
  await sleep(100)
  ran.refusedPending = small.pool.pending.length
  ran.refusedStored = relay.events.length - storedBefore

  ran.construction = [
    () => createWireweaveRelay({ relays: [], WebSocketImpl: WebSocket, verifyEvent, sign: () => null, pubkey: pubkeys[0], room: 'lobby' }),
    () => createWireweaveRelay({ relays: [relay.url], WebSocketImpl: WebSocket, sign: () => null, pubkey: pubkeys[0], room: 'lobby' }),
  ].map((build) => { try { build(); return 'accepted' } catch (error) { return error.name } })

  ran.ownEchoCount = aliceInbox.filter((m) => m.from === pubkeys[0]).length
  ran.limit = limit
  alice.close()
  bob.close()
  small.close()
} catch (error) {
  ran.error = error.message
}
await relay.close()

gate('a payload of three MTUs and a tail reaches the other peer byte for byte, in four wireweave fragments', () => {
  assert.equal(ran.error, null, ran.error)
  assert.equal(ran.bigSend.ok, true)
  assert.equal(ran.bigSend.fragments, 4)
  assert.equal(ran.bobInbox.length, 1)
  assert.equal(ran.bobInbox[0].hex, Buffer.from(ran.bigPayload).toString('hex'))
  assert.equal(ran.bobInbox[0].from, pubkeys[0])
})

gate('a short reply travels back over the same room and arrives from its sender', () => {
  assert.equal(ran.shortSend.ok, true)
  assert.deepEqual(ran.aliceInbox, [{ text: 'hi', from: pubkeys[1] }])
})

gate('a peer does not deliver its own published frames back to itself', () => {
  assert.equal(ran.ownEchoCount, 0)
})

gate('an event that fails verifyEvent is not delivered, even when its content is a valid frame', () => {
  assert.equal(ran.forgedDelivered, 0)
})

gate('a payload above maxPayloadBytes is refused with the limit as the reason, and no frame is queued or stored', () => {
  assert.deepEqual(ran.refused, { ok: false, reason: 'payload-too-large', maxBytes: ran.limit, byteLength: ran.limit + 1 })
  assert.equal(ran.refusedPending, 0)
  assert.equal(ran.refusedStored, 0)
})

gate('the adapter refuses construction without a relay list or a verifier', () => {
  assert.deepEqual(ran.construction, ['TypeError', 'TypeError'])
})

finish()
