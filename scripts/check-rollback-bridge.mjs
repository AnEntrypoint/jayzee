import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { ROLLBACK_CTRL_PREFIX, encodeControlFrame } from '../src/control-frame-pure/controlFrame.js'
import { createRollbackBridgeTransport } from '../src/rollback-pure/rollbackInputTransport.js'

const frameOf = (body) => encodeControlFrame(ROLLBACK_CTRL_PREFIX, body)

const fakeBridge = ({ pubkey = 'ME', peers = [['A', 'open'], ['B', 'connecting']] } = {}) => {
  const data = new EventTarget()
  data.sent = []
  data.peers = new Map(peers.map(([pk, state]) => [pk, { dc: { readyState: state } }]))
  data.broadcast = (text) => { data.sent.push(text); return 2 }
  return { data, pubkey }
}

const emit = (data, type, detail) => data.dispatchEvent(new CustomEvent(type, { detail }))

const bind = (opts = {}) => {
  const bridge = fakeBridge(opts.bridge)
  const remote = []
  const checksums = []
  const transport = createRollbackBridgeTransport({
    bridge,
    onRemoteInput: (from, tick, input, adv) => remote.push({ from, tick, input, adv }),
    onRemoteChecksum: (from, tick, checksum) => checksums.push({ from, tick, checksum }),
    ...(opts.transport ?? {}),
  })
  return { bridge, transport, remote, checksums }
}

gate('bridge transport refuses a bridge with no event target as data', () => {
  assert.throws(() => createRollbackBridgeTransport({ bridge: { pubkey: 'ME' } }), /bridge\.data must be an event target/)
  assert.throws(() => createRollbackBridgeTransport({}), /bridge\.data must be an event target/)
})

gate('bridge transport refuses a bridge.data with no broadcast', () => {
  const bridge = fakeBridge()
  delete bridge.data.broadcast
  assert.throws(() => createRollbackBridgeTransport({ bridge }), /bridge\.data\.broadcast required/)
})

gate('bridge transport refuses a bridge.data with no peers map', () => {
  const bridge = fakeBridge()
  delete bridge.data.peers
  assert.throws(() => createRollbackBridgeTransport({ bridge }), /bridge\.data\.peers required/)
})

gate('constructor peer scan seeds the roster with open data channels only', () => {
  const { transport } = bind()
  assert.deepEqual(transport.getRoster(), ['A'])
})

gate('an empty peers map seeds an empty roster', () => {
  const { transport } = bind({ bridge: { peers: [] } })
  assert.deepEqual(transport.getRoster(), [])
})

gate('a data event dispatches a valid input frame to onRemoteInput with its sender', () => {
  const { bridge, transport, remote } = bind()
  emit(bridge.data, 'data', { data: frameOf({ type: 'input', tick: 5, input: { buttons: 3 }, adv: 2 }), peerPubkey: 'B' })
  assert.deepEqual(remote, [{ from: 'B', tick: 5, input: { buttons: 3 }, adv: 2 }])
  assert.ok(transport.getRoster().includes('B'))
  assert.equal(transport.getStats().received, 1)
})

gate('a data event dispatches a checksum frame to onRemoteChecksum', () => {
  const { bridge, transport, checksums } = bind()
  emit(bridge.data, 'data', { data: frameOf({ type: 'checksum', tick: 9, checksum: 'abc' }), peerPubkey: 'A' })
  assert.deepEqual(checksums, [{ from: 'A', tick: 9, checksum: 'abc' }])
  assert.equal(transport.getStats().checksumsReceived, 1)
})

gate('a data event with a foreign prefix is counted as a reject and dispatches nothing', () => {
  const { bridge, transport, remote } = bind()
  emit(bridge.data, 'data', { data: 'wwlockstep:{"type":"input","tick":1}', peerPubkey: 'A' })
  assert.deepEqual(remote, [])
  assert.equal(transport.getStats().rejects['foreign-prefix'], 1)
})

gate('a data event with a malformed payload is counted as a reject', () => {
  const { bridge, transport, remote } = bind()
  emit(bridge.data, 'data', { data: ROLLBACK_CTRL_PREFIX + '{not json', peerPubkey: 'A' })
  assert.deepEqual(remote, [])
  assert.equal(transport.getStats().rejects['malformed-payload'], 1)
})

gate('a data event with no detail is ignored without throwing', () => {
  const { bridge, transport, remote } = bind()
  emit(bridge.data, 'data', undefined)
  assert.deepEqual(remote, [])
  assert.equal(transport.getStats().rejects['foreign-prefix'], 1)
})

gate('peer-open adds the peer to the roster and a blank peer is ignored', () => {
  const { bridge, transport } = bind()
  emit(bridge.data, 'peer-open', { peerPubkey: 'C' })
  emit(bridge.data, 'peer-open', {})
  emit(bridge.data, 'peer-open', undefined)
  assert.deepEqual(transport.getRoster(), ['A', 'C'])
})

gate('peer-close drops the peer and a later input from it brings it back', () => {
  const { bridge, transport, remote } = bind()
  emit(bridge.data, 'peer-close', { peerPubkey: 'A' })
  assert.deepEqual(transport.getRoster(), [])
  emit(bridge.data, 'data', { data: frameOf({ type: 'input', tick: 1, input: null, adv: 0 }), peerPubkey: 'A' })
  assert.equal(remote.length, 1)
  assert.deepEqual(transport.getRoster(), ['A'])
})

gate('peer-closed is the same close event as peer-close', () => {
  const { bridge, transport } = bind()
  emit(bridge.data, 'peer-closed', { peerPubkey: 'A' })
  assert.deepEqual(transport.getRoster(), [])
  assert.deepEqual(transport.getStalledPeers(0), [])
})

gate('a close event without a peer key drops nothing', () => {
  const { bridge, transport } = bind()
  emit(bridge.data, 'peer-close', {})
  emit(bridge.data, 'peer-closed', undefined)
  assert.deepEqual(transport.getRoster(), ['A'])
})

gate('submitLocalInput broadcasts the encoded input through bridge.data', () => {
  const { bridge, transport } = bind()
  const n = transport.submitLocalInput(3, { buttons: 1 }, 4)
  assert.equal(n, 2)
  assert.deepEqual(bridge.data.sent, [frameOf({ type: 'input', tick: 3, input: { buttons: 1 }, adv: 4 })])
  assert.equal(transport.getStats().sent, 1)
})

gate('submitChecksum broadcasts the encoded checksum through bridge.data', () => {
  const { bridge, transport } = bind()
  transport.submitChecksum(7, 'ff')
  assert.deepEqual(bridge.data.sent, [frameOf({ type: 'checksum', tick: 7, checksum: 'ff' })])
  assert.equal(transport.getStats().checksumsSent, 1)
})

gate('submitLocalInput refuses before the bridge has a pubkey', () => {
  const { bridge, transport } = bind({ bridge: { pubkey: null } })
  assert.throws(() => transport.submitLocalInput(1, null), /bridge not connected|link not connected/)
  assert.deepEqual(bridge.data.sent, [])
})

gate('the bridge pubkey is read live, not copied at construction', () => {
  const { bridge, transport } = bind({ bridge: { pubkey: null } })
  bridge.pubkey = 'LATE'
  assert.equal(transport.myPubkey, 'LATE')
  transport.submitChecksum(1, 'aa')
  assert.equal(bridge.data.sent.length, 1)
})

gate('destroy removes every listener, so no later event reaches the transport', () => {
  const { bridge, transport, remote } = bind()
  transport.destroy()
  emit(bridge.data, 'data', { data: frameOf({ type: 'input', tick: 2, input: null, adv: 0 }), peerPubkey: 'B' })
  emit(bridge.data, 'peer-open', { peerPubkey: 'C' })
  emit(bridge.data, 'peer-close', { peerPubkey: 'A' })
  assert.deepEqual(remote, [])
  assert.deepEqual(transport.getRoster(), ['A'])
  assert.equal(transport.getStats().received, 0)
})

gate('destroy twice is harmless', () => {
  const { transport } = bind()
  transport.destroy()
  transport.destroy()
})

gate('two bridge transports on one data target each receive their own copy of an event', () => {
  const bridge = fakeBridge()
  const first = createRollbackBridgeTransport({ bridge })
  const second = createRollbackBridgeTransport({ bridge })
  emit(bridge.data, 'peer-open', { peerPubkey: 'D' })
  assert.ok(first.getRoster().includes('D'))
  assert.ok(second.getRoster().includes('D'))
  first.destroy()
  emit(bridge.data, 'peer-open', { peerPubkey: 'E' })
  assert.ok(!first.getRoster().includes('E'))
  assert.ok(second.getRoster().includes('E'))
})

finish()
