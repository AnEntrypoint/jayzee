import { AppContext } from './hotQueueAppContextStub.mjs'

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

const textOf = (args) => args.map((a) => (typeof a === 'string' ? a : String(a?.message ?? a))).join(' ')

const entity = (id, name, extra = {}) => ({ id, _appName: name, _appState: {}, ...extra })

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const pick = (rnd, list) => list[Math.floor(rnd() * list.length)]

function fakeRuntime(log, options) {
  let failRebuild = options.failRebuild === true
  return {
    _appDefs: new Map(),
    _appVersions: options.versioned === false ? undefined : new Map(options.versions ?? []),
    entities: new Map(),
    apps: new Map(),
    contexts: new Map(),
    _pendingSetupIds: new Set(),
    _staticVersion: 0,
    _connections: options.connections ?? null,
    _placedModelStorage: options.placedStorage ? { persist: () => log.push('persist') } : null,
    _safeCall(target, method, args, label) {
      log.push(`safeCall ${label} ${method}`)
      const fn = target?.[method]
      if (typeof fn !== 'function') return Promise.resolve()
      try {
        return Promise.resolve(fn.apply(target, args))
      } catch (e) {
        log.push(`safeCall threw ${label} ${e.message}`)
        return Promise.resolve()
      }
    },
    _releaseAppContext(eid, ctx) { log.push(`release ${eid} ${ctx ? 'ctx' : 'none'}`) },
    _logAppError(label, e) { log.push(`appError ${label} ${e.message}`) },
    _markDirty(eid) { log.push(`dirty ${eid}`) },
    _deferOrRun(fn) {
      log.push('deferOrRun')
      fn()
    },
    _flushPendingEvents(eid) { log.push(`flush ${eid}`) },
    _scheduleRebuild() { log.push('scheduleRebuild') },
    _rebuildUpdateList() {
      log.push('rebuildUpdates')
      if (failRebuild) {
        failRebuild = false
        throw new Error('rebuild broke')
      }
    },
    _rebuildCollisionList() { log.push('rebuildCollisions') },
  }
}

const makeDef = (log, label, server = {}) => ({
  label,
  server: {
    setup(ctx) { log.push(`setup ${label} ${ctx.entity.id}`) },
    teardown(ctx) { log.push(`teardown ${label} ${ctx.entity.id}`) },
    ...server,
  },
})

function dumpRuntime(rt) {
  return {
    entities: [...rt.entities.values()].map((e) => ({ id: e.id, appName: e._appName, appState: e._appState, custom: e.custom ?? null, bodyType: e.bodyType ?? null })),
    contexts: [...rt.contexts.entries()].map(([id, ctx]) => [id, ctx instanceof AppContext, ctx.entity.id]),
    apps: [...rt.apps.entries()].map(([id, def]) => [id, def.label]),
    versions: rt._appVersions ? [...rt._appVersions.entries()] : null,
    defs: [...rt._appDefs.keys()],
    staticVersion: rt._staticVersion,
    pendingSetupIds: [...rt._pendingSetupIds],
  }
}

async function session(options, makeQueue, body) {
  const log = []
  const logger = { error: (...args) => log.push('error ' + textOf(args)) }
  const savedError = console.error
  console.error = logger.error
  try {
    const rt = fakeRuntime(log, options)
    const q = makeQueue(rt, logger)
    await body({ rt, q, log, def: (label, server) => makeDef(log, label, server) })
    await tick()
    return { log, state: dumpRuntime(rt) }
  } finally {
    console.error = savedError
  }
}

async function scenarioOrder(makeQueue) {
  return session({ versions: [['a', 2]] }, makeQueue, async ({ rt, q, log, def }) => {
    rt.entities.set(1, entity(1, 'a', { _appState: { n: 1 }, custom: { k: 1 } }))
    rt.entities.set(2, entity(2, 'b', { _appState: { n: 2 } }))
    rt.entities.set(3, entity(3, 'a', { _appState: { n: 3 }, bodyType: 'static' }))
    rt.apps.set(1, def('a0'))
    rt.contexts.set(1, new AppContext(rt.entities.get(1), rt))
    q.enqueue('a', def('a1'), (n, d) => log.push(`cb ${n} ${d.label}`))
    q.enqueue('b', def('b1'))
    log.push(`pending ${q.pending}`)
    q.drain()
    log.push(`pendingAfter ${q.pending}`)
    q.drain()
    q.enqueue('a', def('a2'))
    q.drain()
  })
}

async function scenarioMigrate(makeQueue) {
  return session({ versions: [['m', 4]] }, makeQueue, async ({ rt, q, log, def }) => {
    rt.entities.set(1, entity(1, 'm', { _appState: { old: 1 }, custom: { c: 0 } }))
    rt.entities.set(2, entity(2, 'm', { _appState: { old: 2 } }))
    rt.entities.set(3, entity(3, 'm', { _appState: { old: 3 } }))
    rt.entities.set(4, entity(4, 'm', { _appState: { old: 4 } }))
    rt.entities.set(5, entity(5, 'other', { _appState: { old: 5 } }))
    rt.entities.set(6, entity(6, 'n', { _appState: { old: 6 } }))
    const migrate = (state, from, to, custom) => {
      log.push(`migrate ${state.old} ${from} ${to} ${JSON.stringify(custom ?? null)}`)
      if (state.old === 1) return { __hotReloadMigration: true, appState: { m: 1 }, custom: { c: 9 } }
      if (state.old === 2) return { __hotReloadMigration: true, appState: undefined, custom: undefined }
      if (state.old === 3) return { plain: 3 }
      if (state.old === 4) throw new Error('bad migrate')
      return undefined
    }
    q.enqueue('m', def('m', { migrate }))
    q.drain()
    q.enqueue('n', def('n', { migrate }))
    q.drain()
  })
}

async function scenarioUnversioned(makeQueue) {
  return session({ versioned: false, placedStorage: true }, makeQueue, async ({ rt, q, log, def }) => {
    rt.entities.set(1, entity(1, 'u', { _appState: { old: 1 }, custom: { c: 1 } }))
    const migrate = (state, from, to, custom) => {
      log.push(`migrate ${state.old} ${from} ${to} ${JSON.stringify(custom ?? null)}`)
      return { __hotReloadMigration: true, appState: { u: 1 }, custom: { c: 2 } }
    }
    q.enqueue('u', def('u', { migrate }))
    q.drain()
  })
}

async function scenarioErrors(makeQueue) {
  return session({ failRebuild: true }, makeQueue, async ({ rt, q, log, def }) => {
    rt.entities.set(1, entity(1, 'w'))
    rt.entities.set(2, entity(2, 'x'))
    rt.entities.set(3, entity(3, 'y'))
    rt.entities.set(4, entity(4, 'z'))
    q.enqueue('w', def('w'), () => log.push('cb w'))
    q.enqueue('x', def('x'), () => { throw new Error('cb boom') })
    q.enqueue('y', def('y'), () => {
      log.push(`pending in y ${q.pending}`)
      q.drain()
      q.enqueue('z', def('z'))
    })
    q.drain()
    log.push(`after ${q.pending}`)
  })
}

async function scenarioDuplicates(makeQueue) {
  const clients = new Map([[1, { lastHeartbeat: 0 }], [2, { lastHeartbeat: 0 }]])
  return session({ connections: { clients } }, makeQueue, async ({ rt, q, log, def }) => {
    rt.entities.set(1, entity(1, 'd'))
    q.enqueue('d', def('d1'), (n) => log.push(`cb ${n}`))
    q.enqueue('d', def('d2'), (n) => log.push(`cb2 ${n}`))
    q.drain()
    log.push(`heartbeats ${[...clients.values()].map((c) => `${typeof c.lastHeartbeat}:${c.lastHeartbeat > 0}`).join(',')}`)
  })
}

export async function runQueueScenarios(makeQueue) {
  return {
    order: await scenarioOrder(makeQueue),
    migrate: await scenarioMigrate(makeQueue),
    unversioned: await scenarioUnversioned(makeQueue),
    errors: await scenarioErrors(makeQueue),
    duplicates: await scenarioDuplicates(makeQueue),
  }
}

const LOAD_TOKENS = ['/a.js', 'a.js', './a.js', 'http://localhost/a.js', 'b.js', '', 'http://[bad', 'https://other.test/a.js', '/app/x.js', 'x.js']
const PATH_TOKENS = ['a.js', '/b.js', './a.js', { name: 'c.js' }, { name: 5 }, 5, null, 'http://[bad', 'x.js']
const GRAPH_NAMES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']

function runGraphCases(lib, rnd) {
  const cases = Array.from({ length: 120 }, () => {
    const parents = {}
    for (const n of GRAPH_NAMES) if (rnd() < 0.5) parents[n] = GRAPH_NAMES.filter(() => rnd() < 0.25)
    const acceptors = new Map()
    for (const n of GRAPH_NAMES) if (rnd() < 0.35) acceptors.set(n, [{ self: rnd() < 0.5 }])
    return { parents, acceptors, url: pick(rnd, GRAPH_NAMES) }
  })
  return {
    ancestorsOf: cases.map((g) => Object.keys(lib.ancestorsOf(g.parents, g.url)).sort()),
    findBoundaries: cases.map((g) => lib.findBoundaries(g.acceptors, { url: g.url, parents: g.parents })),
  }
}

function runLoadedCases(lib, rnd) {
  const bases = ['http://localhost/', 'https://example.com/app/']
  return Array.from({ length: 80 }, () => {
    const entries = Array.from({ length: Math.floor(rnd() * 4) }, () => pick(rnd, LOAD_TOKENS))
    return lib.loadedByPath(entries, pick(rnd, LOAD_TOKENS), pick(rnd, bases))
  })
}

function runPathSequences(lib, rnd) {
  const probes = ['a.js', '/b.js', 'c.js', 'x.js', 'http://[bad', '/a.js']
  return Array.from({ length: 40 }, () => {
    const set = lib.createLoadedPaths()
    return Array.from({ length: 4 + Math.floor(rnd() * 3) }, () => {
      const entries = rnd() < 0.1 ? null : Array.from({ length: Math.floor(rnd() * 5) }, () => pick(rnd, PATH_TOKENS))
      let absorbed
      try {
        absorbed = [...set.absorb(entries)].sort()
      } catch (e) {
        absorbed = `threw ${e.constructor.name}`
      }
      return { absorbed, size: set.size(), has: probes.map((p) => set.has(p)) }
    })
  })
}

function runSameValue(lib) {
  const fn = () => 1
  const circA = {}
  circA.self = circA
  const circB = {}
  circB.self = circB
  const pairs = [
    [1, 1], [NaN, NaN], [0, -0], [{ a: 1 }, { a: 1 }], [[1, 2], [1, 2]], [fn, fn], [() => 1, () => 1],
    [undefined, null], [undefined, undefined], [{ toJSON() { throw new Error('x') } }, {}], [circA, circB],
    ['1', 1], [{ a: undefined }, {}], [null, null], [{ a: 1 }, { a: 2 }],
  ]
  return pairs.map(([a, b]) => lib.sameValue(a, b))
}

function runNothingLive(lib) {
  const out = [lib.nothingLive()]
  for (const worker of [false, true]) {
    for (const eager of [false, true]) {
      for (const loaded of [false, true]) {
        for (const tracked of [0, 1, 2]) out.push(lib.nothingLive({ worker, eager, loaded, tracked }))
      }
    }
  }
  return out
}

function runIsClass(lib) {
  const values = [class A {}, class {}, function f() {}, () => {}, async function g() {}, function* h() {}, 'class A {}', null, undefined, 1, {}, Object.assign(function q() {}, {})]
  return values.map((v) => lib.isClass(v))
}

export function runDecideCases(lib) {
  const rnd = mulberry32(0x39)
  const graphs = runGraphCases(lib, rnd)
  return {
    ancestorsOf: graphs.ancestorsOf,
    findBoundaries: graphs.findBoundaries,
    isClass: runIsClass(lib),
    loadedByPath: runLoadedCases(lib, rnd),
    createLoadedPaths: runPathSequences(lib, rnd),
    sameValue: runSameValue(lib),
    nothingLive: runNothingLive(lib),
  }
}
