import { gate, finish } from './lib/gate.mjs'
import { EventLog, EVENT_LOG_KINDS, parseEventKind } from '../src/anticheat/EventLog.js'

const is = (a, b, what) => {
  if (!Object.is(a, b)) throw new Error(`${what}: expected ${b}, got ${a}`)
}
const sameJson = (a, b, what) => {
  const x = JSON.stringify(a), y = JSON.stringify(b)
  if (x !== y) throw new Error(`${what}: expected ${y}, got ${x}`)
}
const ticking = (start = 1000) => {
  let t = start
  return () => t++
}
const refuses = (fn, Kind, what) => {
  try {
    fn()
  } catch (error) {
    if (!(error instanceof Kind)) throw new Error(`${what}: ${error && error.constructor && error.constructor.name}`)
    return
  }
  throw new Error(`${what}: accepted`)
}

gate('the replay kinds are the three spoint handles, and an unknown type has no replay arm', () => {
  sameJson(EVENT_LOG_KINDS, ['entity_spawn', 'entity_destroy', 'bus_event'], 'kinds')
  is(parseEventKind('entity_spawn').status, 'replayable', 'spawn status')
  is(parseEventKind('chat').status, 'no-replay-arm', 'unknown status')
})

gate('a missing clock is refused, so timestamps never read wall time by default', () => {
  refuses(() => new EventLog({}), TypeError, 'no clock')
  refuses(() => new EventLog({ clock: 5 }), TypeError, 'non-function clock')
})

gate('a clock that returns a non-finite value is refused at record time', () => {
  const log = new EventLog({ clock: () => NaN })
  refuses(() => log.record('chat', {}), RangeError, 'NaN clock')
})

gate('record assigns ids from 1, stamps the tick and the injected clock, and derives the replay status', () => {
  const log = new EventLog({ clock: ticking(500) })
  const a = log.record('entity_spawn', { id: 7 }, { tick: 3, actor: 'p1' })
  const b = log.record('chat', 'hi')
  is(a.id, 1, 'first id')
  is(b.id, 2, 'second id')
  is(a.tick, 3, 'tick from meta')
  is(b.tick, 0, 'tick defaults to 0')
  is(a.timestamp, 500, 'timestamp from the clock')
  is(b.timestamp, 501, 'timestamp advances with the clock')
  is(a.kindStatus, 'replayable', 'replayable status')
  is(b.kindStatus, 'no-replay-arm', 'unreplayable status')
  is(a.meta.actor, 'p1', 'actor kept')
  is(a.meta.reason, null, 'missing reason is null')
})

gate('a ring of 3 keeps the newest three events, oldest first, and reports the last tick', () => {
  const log = new EventLog({ clock: ticking(), maxSize: 3 })
  for (let i = 1; i <= 5; i++) log.record('chat', i, { tick: i * 10 })
  is(log.size, 3, 'size')
  sameJson(log._toArray().map(e => e.id), [3, 4, 5], 'ids oldest first')
  is(log.lastTick, 50, 'lastTick')
})

gate('query filters by type, tick, tick range, actor, entity and app, and getRange is inclusive', () => {
  const log = new EventLog({ clock: ticking() })
  log.record('entity_spawn', 1, { tick: 1, actor: 'a', sourceEntity: 'e1', sourceApp: 'x' })
  log.record('bus_event', 2, { tick: 2, actor: 'b', sourceEntity: 'e2', sourceApp: 'y' })
  log.record('entity_spawn', 3, { tick: 3, actor: 'a', sourceEntity: 'e2', sourceApp: 'y' })
  is(log.query({ type: 'entity_spawn' }).length, 2, 'type')
  is(log.query({ tick: 2 }).length, 1, 'tick')
  is(log.query({ tickRange: [2, 3] }).length, 2, 'tickRange')
  is(log.query({ actor: 'a' }).length, 2, 'actor')
  is(log.query({ entity: 'e2' }).length, 2, 'entity')
  is(log.query({ app: 'y' }).length, 2, 'app')
  is(log.query({ app: 'y', actor: 'a' }).length, 1, 'filters combine')
  is(log.getRange(1, 2).length, 2, 'getRange inclusive')
})

gate('pause stops recording and returns null, and resume starts it again', () => {
  const log = new EventLog({ clock: ticking() })
  log.pause()
  is(log.record('chat', 1), null, 'paused record')
  is(log.size, 0, 'size while paused')
  log.resume()
  is(log.record('chat', 2).id, 1, 'first id after resume')
})

gate('a remote event is taken once per origin and id, and its meta records the origin', () => {
  const log = new EventLog({ clock: ticking() })
  const remote = { id: 9, tick: 4, timestamp: 77, type: 'chat', data: 'x', meta: {} }
  const local = log.ingestRemote(remote, 'eu')
  is(local.meta.originRegion, 'eu', 'originRegion')
  is(local.meta.originId, 9, 'originId')
  is(local.meta.crossShard, false, 'crossShard')
  is(log.ingestRemote(remote, 'eu'), null, 'duplicate from the same origin')
  is(log.ingestRemote(remote, 'us') !== null, true, 'same id from another origin is taken')
})

gate('replay applies the replayable events in the tick range in order and reports the others and any handler error', () => {
  const log = new EventLog({ clock: ticking() })
  log.record('entity_spawn', { id: 'a', config: 1 }, { tick: 1 })
  log.record('mystery', {}, { tick: 2 })
  log.record('entity_destroy', { id: 'a' }, { tick: 3 })
  log.record('entity_spawn', { id: 'b', config: 2 }, { tick: 9 })
  const calls = []
  const runtime = {
    spawnEntity: (id, config) => calls.push(['spawn', id, config]),
    destroyEntity: (id) => calls.push(['destroy', id]),
  }
  const result = log.replay(runtime, { startTick: 0, endTick: 5 })
  is(result.eventsReplayed, 2, 'replayed')
  sameJson(calls, [['spawn', 'a', 1], ['destroy', 'a']], 'replay order')
  is(result.errors.length, 1, 'one unknown kind')
  is(result.errors[0].eventId, 2, 'unknown kind id')
  const failing = new EventLog({ clock: ticking() })
  failing.record('entity_destroy', { id: 'z' }, { tick: 1 })
  const failed = failing.replay({ destroyEntity: () => { throw new Error('gone') } })
  is(failed.errors[0].error, 'gone', 'handler error captured')
})

gate('serialize and deserialize keep the events, their ids and the next id', () => {
  const log = new EventLog({ clock: ticking() })
  log.record('entity_spawn', { id: 'a' }, { tick: 1 })
  log.record('chat', 'hello', { tick: 2, actor: 'p' })
  const back = EventLog.deserialize(log.serialize(), { clock: ticking(9000) })
  sameJson(back._toArray(), log._toArray(), 'events')
  is(back.size, 2, 'size')
  is(back.record('chat', 'next').id, 3, 'next id continues')
})

gate('clear empties the log and restarts ids from 1', () => {
  const log = new EventLog({ clock: ticking() })
  log.record('chat', 1)
  log.clear()
  is(log.size, 0, 'size after clear')
  is(log.record('chat', 2).id, 1, 'id after clear')
})

finish()
