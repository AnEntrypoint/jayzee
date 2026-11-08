import { FROM, TO } from './chartMigratorScenarios.mjs'

const TOL = 1e-12
const TIMING_KEYS = new Set(['ms', 'migrateMs', 'nearMs', 'parkMs'])

const clone = (value) => JSON.parse(JSON.stringify(value))

function stripTiming(value) {
  if (Array.isArray(value)) return value.map(stripTiming)
  if (value && typeof value === 'object') {
    const out = {}
    for (const [key, inner] of Object.entries(value)) if (!TIMING_KEYS.has(key)) out[key] = stripTiming(inner)
    return out
  }
  return value
}

function quietly(fn) {
  const sink = console.error
  console.error = () => {}
  try {
    return fn()
  } finally {
    console.error = sink
  }
}

function thrownMessage(fn) {
  try {
    fn()
    return null
  } catch (error) {
    return { name: error.constructor.name, message: error.message }
  }
}

const frameBase = () => clone({ ...FROM, chartEpoch: 0 })
const frameNext = () => clone({ ...TO, chartEpoch: 1 })

function fakeService() {
  const migrators = []
  const gates = []
  return {
    migrators,
    gates,
    onReanchor(fn) {
      migrators.push(fn)
      return () => {
        const i = migrators.indexOf(fn)
        if (i >= 0) migrators.splice(i, 1)
      }
    },
    addTerrainMigrator(terrainMigrator) {
      gates.push(terrainMigrator)
      return () => {
        const i = gates.indexOf(terrainMigrator)
        if (i >= 0) gates.splice(i, 1)
      }
    },
  }
}

function makeEnv(options = {}) {
  const events = []
  const stops = { count: 0 }
  const players = new Map()
  const physics = {
    _planetFrame: options.noFrame ? undefined : frameBase(),
    _dormant: options.dormant ?? null,
    guard: undefined,
    setChartFrameGuard(guard) {
      this.guard = guard
    },
    applyChartTransfer: () => ({ characters: 0, groundedUpwardClamped: 0 }),
    charIdOf: () => null,
    isGrounded: () => false,
  }
  const appRuntime = {
    _physics: null,
    entities: new Map([['e1', { id: 'e1', position: [10, 2, 20], velocity: [1, 0, 0], rotation: [0, 0, 0, 1], bodyType: 'dynamic' }]]),
    apps: new Map(),
    contexts: new Map(),
    _behaviours: new Map(),
    _attachments: new Map(),
    _pendingTrimeshBuilds: new Set(),
    _pendingTrimeshEntities: new Set(),
    _pendingSetupIds: new Set(),
    _resimSuppressed: false,
    chartReanchorBlocks: new Map(),
    _playerIndex: { insert() {} },
    _staticVersion: 0,
    _snapshotEncCache: new Map(),
    _staticXf: new Map(),
    _markDirty() {},
    _safeCall() {},
    _logAppError() {},
    getPlayers: () => [],
  }
  if (options.brokenPlayers) appRuntime.getPlayers = undefined
  const ctx = {
    physics,
    physicsIntegration: {
      physicsWorld: { _charMgr: { applyChartTransfer: () => ({ characters: 0, groundedUpwardClamped: 0 }) }, getCharacterGroundState: () => false },
      playerBodies: new Map(),
    },
    tickSystem: {
      tickDuration: 50,
      callbacks: [],
      onTick(fn) {
        this.callbacks.push(fn)
      },
      stop() {
        stops.count++
      },
    },
    playerManager: { players, getInputs: () => [] },
    networkState: { players: new Map() },
    lagCompensator: { playerHistory: new Map(), applyChartTransfer: () => 0 },
    appRuntime,
    stageLoader: { allStages: () => [] },
    eventLog: { record(name) { events.push(name) } },
    peerSession: null,
  }
  if (options.mutate) options.mutate({ ctx, players, appRuntime })
  const service = fakeService()
  return { ctx, service, events, stops, physics, tickSystem: ctx.tickSystem, appRuntime }
}

export function runServerScenarios(m) {
  const out = {}
  const pick = (entity) => ({ position: entity.position, velocity: entity.velocity, rotation: entity.rotation })
  const event = () => ({ epoch: 1, from: frameBase(), to: frameNext(), transfer: m.createChartTransfer(frameBase(), frameNext()) })

  const base = makeEnv()
  const handle = m.attachServerChartMigrators(base.ctx, base.service)
  out.attach = {
    appliedEpoch: handle.appliedEpoch,
    ledgerEpoch: handle.ledger.currentEpoch,
    staticBudgetMs: handle.staticBudgetMs,
    migrators: base.service.migrators.length,
    gates: base.service.gates.length,
    tickCallbacks: base.tickSystem.callbacks.length,
    ctxLedgerIsHandle: base.ctx.chartEpochLedger === handle.ledger,
    appRuntimeLedgerIsHandle: base.appRuntime.chartEpochLedger === handle.ledger,
    chartServiceIsHandle: base.service.chartState === handle,
    guardEpoch: base.physics.guard.epoch(),
  }
  out.guardAtBase = base.physics.guard.reexpress({ epoch: 0, position: [1, 2, 3], rotation: null })

  const applied = event()
  out.apply = stripTiming(quietly(() => base.service.migrators[0](applied)))
  out.afterApply = {
    appliedEpoch: handle.appliedEpoch,
    ledgerEpoch: handle.ledger.currentEpoch,
    lastReportEpoch: handle.lastReport.epoch,
    entity: pick(base.appRuntime.entities.get('e1')),
    events: base.events,
  }
  out.guardAfter = { epoch: base.physics.guard.epoch(), atBase: base.physics.guard.reexpress({ epoch: 0, position: [1, 2, 3], rotation: null }) }
  out.reapply = quietly(() => base.service.migrators[0](applied))
  out.skipped = quietly(() => thrownMessage(() => base.service.migrators[0]({ epoch: 3, to: frameNext(), transfer: applied.transfer })))

  const broken = makeEnv({ brokenPlayers: true })
  const brokenHandle = m.attachServerChartMigrators(broken.ctx, broken.service)
  out.fault = {
    thrown: quietly(() => thrownMessage(() => broken.service.migrators[0](event()))),
    recorded: broken.ctx.chartReanchorFault ?? null,
    stops: broken.stops.count,
    appliedEpoch: brokenHandle.appliedEpoch,
  }

  const blockerCases = [
    ['none', () => {}],
    ['peer session', ({ ctx }) => { ctx.peerSession = { id: 'p' } }],
    ['teleport hold', ({ players }) => { players.set('p1', { id: 'p1', teleportHold: true }) }],
    ['trimesh builds', ({ appRuntime }) => { appRuntime._pendingTrimeshBuilds.add('x') }],
    ['trimesh entities', ({ appRuntime }) => { appRuntime._pendingTrimeshEntities.add('x') }],
    ['setup in flight', ({ appRuntime }) => { appRuntime._pendingSetupIds.add('x') }],
    ['resimulation', ({ appRuntime }) => { appRuntime._resimSuppressed = true }],
    ['registered block', ({ appRuntime }) => { appRuntime.chartReanchorBlocks.set('custom-block', true) }],
  ]
  out.blockers = blockerCases.map(([label, mutate]) => {
    const env = makeEnv({ mutate })
    m.attachServerChartMigrators(env.ctx, env.service)
    return { label, reason: env.service.gates[0].gate() }
  })

  const drains = []
  const dormant = { pendingCount: 2, stats: { drained: 0 }, drain(budgetMs, movers) { drains.push({ budgetMs, movers: movers.length }) } }
  const dormantEnv = makeEnv({ dormant })
  const dormantHandle = m.attachServerChartMigrators(dormantEnv.ctx, dormantEnv.service)
  dormantEnv.tickSystem.callbacks[0]()
  out.dormant = { drains, stats: dormantHandle.dormantStatics, staticBudgetMs: dormantHandle.staticBudgetMs }

  const detachEnv = makeEnv()
  const detachHandle = m.attachServerChartMigrators(detachEnv.ctx, detachEnv.service)
  detachHandle.detach()
  out.detach = {
    migrators: detachEnv.service.migrators.length,
    gates: detachEnv.service.gates.length,
    tickCallbacks: detachEnv.tickSystem.callbacks.length,
    guardCleared: detachEnv.physics.guard === null,
  }

  const noFrame = makeEnv({ noFrame: true })
  out.missingFrame = thrownMessage(() => m.attachServerChartMigrators(noFrame.ctx, noFrame.service))
  return out
}

export function nearEqual(got, want, path = '$') {
  if (typeof want === 'number') {
    if (typeof got !== 'number' || Math.abs(got - want) > TOL) throw new Error(path + ': got ' + got + ', spoint ' + want)
    return
  }
  if (Array.isArray(want)) {
    if (!Array.isArray(got) || got.length !== want.length) throw new Error(path + ': array length ' + (got && got.length) + ' vs ' + want.length)
    want.forEach((v, i) => nearEqual(got[i], v, path + '[' + i + ']'))
    return
  }
  if (want && typeof want === 'object') {
    if (!got || typeof got !== 'object') throw new Error(path + ': not an object')
    const wantKeys = Object.keys(want).sort()
    const gotKeys = Object.keys(got).sort()
    if (wantKeys.join(',') !== gotKeys.join(',')) throw new Error(path + ': keys ' + gotKeys.join(',') + ' vs ' + wantKeys.join(','))
    for (const key of wantKeys) nearEqual(got[key], want[key], path + '.' + key)
    return
  }
  if (got !== want) throw new Error(path + ': got ' + JSON.stringify(got) + ', spoint ' + JSON.stringify(want))
}
