import { gate, finish } from './lib/gate.mjs'
import { HotReloadQueue, createCoalescer, decideUpdate, findBoundaries, nothingLive, createLoadedPaths } from '../src/hot/index.js'

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

class FakeAppContext {
  constructor(ent, runtime) {
    this.ent = ent
    this.runtime = runtime
  }
}

const fakeRuntime = (entities = new Map()) => ({
  entities,
  apps: new Map(),
  contexts: new Map(),
  _appDefs: new Map(),
  _appVersions: new Map(),
  _pendingSetupIds: new Set(),
  _connections: null,
  _placedModelStorage: null,
  _staticVersion: 0,
  _safeCall: () => Promise.resolve(),
  _deferOrRun: (run) => run(),
  _releaseAppContext() {},
  _markDirty() {},
  _logAppError() {},
  _flushPendingEvents() {},
  _scheduleRebuild() {},
  _rebuildUpdateList() {},
  _rebuildCollisionList() {},
})

const recordingLogger = () => {
  const errors = []
  return { errors, error: (...args) => errors.push(args.map(String).join(' ')) }
}

const queueWith = (runtime, logger = recordingLogger(), AppContext = FakeAppContext) => new HotReloadQueue(runtime, { AppContext, logger })

const drainOrder = (names, runtime = fakeRuntime()) => {
  const queue = queueWith(runtime)
  const ran = []
  for (const name of names) queue.enqueue(name, {}, (done) => ran.push(done))
  const before = queue.pending
  queue.drain()
  return { ran, before, after: queue.pending }
}

const { ran: orderRan, before: orderBefore, after: orderAfter } = drainOrder(['alpha', 'beta', 'gamma'])

gate('distinct apps drain in enqueue order and the queue empties', () => {
  assert(orderBefore === 3, 'pending before drain was ' + orderBefore)
  assert(orderRan.join(',') === 'alpha,beta,gamma', 'order was ' + orderRan.join(','))
  assert(orderAfter === 0, 'pending after drain was ' + orderAfter)
})

gate('an empty queue drains to nothing and a second drain runs nothing', () => {
  const runtime = fakeRuntime()
  const queue = queueWith(runtime)
  queue.drain()
  assert(queue.pending === 0, 'empty queue reports pending')
  assert(runtime._appDefs.size === 0 && runtime._appVersions.size === 0, 'empty drain touched the runtime')
  const ran = []
  queue.enqueue('solo', {}, (name) => ran.push(name))
  queue.drain()
  queue.drain()
  assert(ran.join(',') === 'solo', 'second drain re-ran the entry: ' + ran.join(','))
})

gate('a reload touches only the entities of the app it names', () => {
  const entities = new Map([
    ['e1', { _appName: 'alpha' }],
    ['e2', { _appName: 'beta' }],
  ])
  const runtime = fakeRuntime(entities)
  const queue = queueWith(runtime)
  queue.enqueue('alpha', {}, null)
  queue.drain()
  assert(runtime.contexts.size === 1 && runtime.contexts.has('e1'), 'contexts were ' + [...runtime.contexts.keys()].join(','))
  assert(runtime._appVersions.get('alpha') === 2, 'alpha version was ' + runtime._appVersions.get('alpha'))
  assert(!runtime._appVersions.has('beta'), 'beta was versioned')
})

gate('the queue does not collapse a duplicate entry, each one is run', () => {
  const runtime = fakeRuntime()
  const queue = queueWith(runtime)
  const ran = []
  queue.enqueue('dup', {}, (name) => ran.push(name))
  queue.enqueue('dup', {}, (name) => ran.push(name))
  queue.drain()
  assert(ran.length === 2, 'duplicate ran ' + ran.length + ' times, expected 2')
  assert(runtime._appVersions.get('dup') === 3, 'version was ' + runtime._appVersions.get('dup') + ', expected 3')
})

gate('negative control: a queue without an injected AppContext refuses the reload', () => {
  const runtime = fakeRuntime(new Map([['e1', { _appName: 'alpha' }]]))
  const logger = recordingLogger()
  const queue = new HotReloadQueue(runtime, { logger })
  let called = false
  queue.enqueue('alpha', {}, () => { called = true })
  queue.drain()
  assert(!called, 'callback ran for a reload that could not build a context')
  assert(logger.errors.some((line) => line.includes('hotReload(alpha) error')), 'no error was logged')
})

const coalesceRun = async (events, { coalesced = true } = {}) => {
  const applied = []
  const coalescer = createCoalescer({ apply: async (ev) => { applied.push(ev) }, coalesced })
  for (const ev of events) coalescer.enqueue(ev)
  const pendingBeforeSettle = coalescer.pendingCount()
  await coalescer.settled()
  return { applied, pendingBeforeSettle, pendingAfter: coalescer.pendingCount() }
}

const appEvent = (url, path, seq) => ({ kind: 'app', url, path, seq })
const appA1 = appEvent('/apps/a.js', 'a', 1)
const appA2 = appEvent('/apps/a.js', 'a', 2)
const appA3 = appEvent('/apps/a.js', 'a', 3)
const appB = appEvent('/apps/b.js', 'b', 4)

const repeated = await coalesceRun([appA1, appA2, appA3])
const distinct = await coalesceRun([appA1, appB, appA2])
const uncoalesced = await coalesceRun([appA1, appA2, appA3], { coalesced: false })

gate('repeated changes to one app keep one pending entry and apply once with the latest event', () => {
  assert(repeated.pendingBeforeSettle === 1, 'pending before settle was ' + repeated.pendingBeforeSettle)
  assert(repeated.applied.length === 1, 'applied ' + repeated.applied.length + ' times')
  assert(repeated.applied[0] === appA3, 'applied event was not the latest')
  assert(repeated.pendingAfter === 0, 'pending after settle was ' + repeated.pendingAfter)
})

gate('distinct apps keep one entry each, in first-seen order, with the latest value', () => {
  assert(distinct.applied.length === 2, 'applied ' + distinct.applied.length + ' times')
  assert(distinct.applied[0] === appA2, 'first applied was not the latest app a event')
  assert(distinct.applied[1] === appB, 'second applied was not app b')
})

gate('negative control: with coalescing off every repeated event is applied', () => {
  assert(uncoalesced.applied.length === 3, 'applied ' + uncoalesced.applied.length + ' times, expected 3')
})

const worldEvent = { kind: 'world', reason: 'rebuild', restarting: false }
const baseState = (overrides = {}) => ({
  lastBootId: null,
  singleplayer: true,
  filter: null,
  reloadOrdered: false,
  coalesced: true,
  ...overrides,
})

const firstWorld = decideUpdate(worldEvent, baseState())
const orderedState = baseState({ reloadOrdered: true })
const secondWorld = decideUpdate(worldEvent, orderedState)
const uncoalescedOrdered = decideUpdate(worldEvent, baseState({ reloadOrdered: true, coalesced: false }))

gate('a reload is ordered once and a second reload for the same pending change is ignored', () => {
  assert(firstWorld.route === 'reload' && firstWorld.reason === 'rebuild', 'first world event routed ' + firstWorld.route)
  assert(secondWorld.route === 'record' && secondWorld.result === 'ignored', 'second world event routed ' + secondWorld.route)
})

gate('negative control: with coalescing off the second reload is dispatched again', () => {
  assert(uncoalescedOrdered.route === 'reload', 'uncoalesced second event routed ' + uncoalescedOrdered.route)
})

const filterState = baseState({ filter: /^src\/game\// })

gate('the only-filter refuses paths outside it and admits paths inside it', () => {
  const refused = decideUpdate({ kind: 'module', path: 'src/other/x.js' }, filterState)
  const admitted = decideUpdate({ kind: 'module', path: 'src/game/x.js' }, filterState)
  assert(refused.route === 'record' && refused.result === 'ignored', 'filter did not refuse the outside path')
  assert(admitted.route === 'module', 'filter refused a path inside it')
})

gate('a hello with a new boot id resyncs in singleplayer and reloads in multiplayer', () => {
  const single = decideUpdate({ kind: 'hello', bootId: 'b2' }, baseState({ lastBootId: 'b1' }))
  const multi = decideUpdate({ kind: 'hello', bootId: 'b2' }, baseState({ lastBootId: 'b1', singleplayer: false }))
  assert(single.route === 'resync' && single.bootId === 'b2', 'singleplayer restart routed ' + single.route)
  assert(multi.route === 'reload' && multi.bootId === 'b2', 'multiplayer restart routed ' + multi.route)
})

gate('negative control: a hello repeating the same boot id is a no-op', () => {
  const same = decideUpdate({ kind: 'hello', bootId: 'b1' }, baseState({ lastBootId: 'b1', singleplayer: false }))
  assert(same.route === 'none', 'same boot id routed ' + same.route)
})

gate('findBoundaries stops at the first accepting ancestor', () => {
  const acceptors = new Map([['/a.js', [{ fn: () => {}, self: false }]]])
  const ev = { url: '/leaf.js', parents: { '/leaf.js': ['/a.js'], '/a.js': [] } }
  const boundaries = findBoundaries(acceptors, ev)
  assert(boundaries && boundaries.length === 1 && boundaries[0] === '/a.js', 'boundaries were ' + JSON.stringify(boundaries))
})

gate('negative control: a chain that reaches a root with no accepter has no boundary', () => {
  const ev = { url: '/leaf.js', parents: { '/leaf.js': ['/root.js'], '/root.js': [] } }
  assert(findBoundaries(new Map(), ev) === null, 'a root without an accepter produced a boundary')
})

gate('nothingLive is true only when nothing on the page is live', () => {
  assert(nothingLive({}) === true, 'empty state was not inert')
  assert(nothingLive({ tracked: 1 }) === false, 'tracked instance was reported inert')
  assert(nothingLive({ loaded: true }) === false, 'loaded module was reported inert')
})

gate('createLoadedPaths resets when the resource list shrinks', () => {
  const loaded = createLoadedPaths('http://localhost/')
  loaded.absorb([{ name: 'http://localhost/a.js' }, { name: 'http://localhost/b.js' }])
  assert(loaded.has('/a.js') && loaded.size() === 2, 'initial absorb missed entries')
  loaded.absorb([{ name: 'http://localhost/c.js' }])
  assert(!loaded.has('/a.js') && loaded.has('/c.js'), 'shrink did not reset the set')
})

finish()
