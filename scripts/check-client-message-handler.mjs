import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { gate, finish } from './lib/gate.mjs'
import { MessageHandler } from '../src/client/MessageHandler.js'
import { MSG, WIRE_PROTOCOL_VERSION } from '../src/protocol/messages.js'
import { WIRE_STRUCT_HASH } from '../src/protocol/msgpack.js'

const fx = JSON.parse(readFileSync(new URL('./fixtures/spoint/client-message-handler.json', import.meta.url), 'utf8'))
const plain = (x) => (x === undefined ? null : JSON.parse(JSON.stringify(x)))
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const tileSummary = (p) => ({ tx: p.tx, tz: p.tz, h: p.h, bytes: p.v.byteLength, sha256: sha(p.v) })
const revive = (payload) => (payload && payload.v ? { ...payload, v: Uint8Array.from(payload.v) } : payload)
const same = (got, want, what) => {
  const a = JSON.stringify(got), b = JSON.stringify(want)
  if (a !== b) throw new Error(what + ' differs from spoint (got ' + a.length + ' bytes, spoint ' + b.length + ' bytes)')
}

function recordingMirror(log) {
  let key = null
  return {
    get ready() { return key !== null },
    configure(payload) { log.push({ mirror: 'configure', args: [plain(payload)] }); key = JSON.stringify(payload); return Promise.resolve() },
    sameConfig(payload) { log.push({ mirror: 'sameConfig', args: [plain(payload)] }); return key !== null && key === JSON.stringify(payload) },
    onTile(payload, nearPos) { log.push({ mirror: 'onTile', args: [tileSummary(payload), plain(nearPos)] }) },
  }
}

function run(scenario) {
  const log = []
  const callbacks = {}
  for (const name of fx.callbackNames) callbacks[name] = (...args) => log.push({ cb: name, args: args.map(plain) })
  const config = { tickRate: 20, callbacks, now: () => 0, renderNow: () => 0 }
  if (scenario.collisionMirror === false) config.collisionMirror = false
  else config.createCollisionMirror = () => recordingMirror(log)
  const handler = new MessageHandler(config)
  const snapProc = { removePlayer: (id) => log.push({ snap: 'removePlayer', args: [id] }), clear: () => log.push({ snap: 'clear', args: [] }) }
  const steps = []
  for (const m of scenario.messages) {
    const type = m.type ? MSG[m.type] : m.id
    const returns = handler.handleMessage(type, revive(m.payload), snapProc)
    steps.push({ type: m.type ?? null, id: type, returns: plain(returns), playerId: plain(handler.getPlayerId()), events: log.splice(0) })
  }
  return { steps, final: { hasMirror: handler.getCollisionMirror() !== null, playerId: plain(handler.getPlayerId()), structMismatch: plain(handler.getStructMismatch()) } }
}

const on = run(fx.scenarios.mirrorOn)
const off = run(fx.scenarios.mirrorOff)

const refusals = {}
try { new MessageHandler({ createCollisionMirror: () => null }); refusals.clock = 'accepted' } catch (e) { refusals.clock = e instanceof TypeError ? 'TypeError' : String(e) }
try { new MessageHandler({ now: () => 0, renderNow: () => 0 }); refusals.factory = 'accepted' } catch (e) { refusals.factory = e instanceof TypeError ? 'TypeError' : String(e) }

const onTileEvents = on.steps.flatMap((s) => s.events).filter((e) => e.mirror === 'onTile')

gate('the wire protocol version and struct hash match spoint', () => {
  if (WIRE_PROTOCOL_VERSION !== fx.wireProtocolVersion) throw new Error('protocol ' + WIRE_PROTOCOL_VERSION + ' vs ' + fx.wireProtocolVersion)
  if (WIRE_STRUCT_HASH !== fx.wireStructHash) throw new Error('struct hash ' + WIRE_STRUCT_HASH + ' vs ' + fx.wireStructHash)
})
gate('mirror-on dispatch matches spoint step for step (returns, callbacks, collision calls)', () => same(on.steps, fx.scenarios.mirrorOn.steps, 'mirror-on steps'))
gate('mirror-on final state matches spoint', () => same(on.final, fx.scenarios.mirrorOn.final, 'mirror-on final'))
gate('the injected collision received every tile payload, including the malformed one', () => {
  if (onTileEvents.length !== 4) throw new Error(onTileEvents.length + ' onTile calls, want 4')
})
gate('mirror-off dispatch matches spoint step for step', () => same(off.steps, fx.scenarios.mirrorOff.steps, 'mirror-off steps'))
gate('mirror-off never creates a collision mirror', () => {
  if (off.final.hasMirror) throw new Error('a mirror was created')
  if (off.steps.some((s) => s.events.some((e) => e.mirror))) throw new Error('a collision call was recorded')
})
gate('a handler without now and renderNow clocks is refused with TypeError', () => {
  if (refusals.clock !== 'TypeError') throw new Error('clock case: ' + refusals.clock)
})
gate('collisionMirror on without createCollisionMirror is refused with TypeError', () => {
  if (refusals.factory !== 'TypeError') throw new Error('factory case: ' + refusals.factory)
})
finish()
