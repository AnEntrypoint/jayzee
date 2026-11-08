export function makeRng(seed) {
  let state = seed >>> 0
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function makeHost(index) {
  const clock = { t: 1000 }
  const disposers = []
  return {
    clock,
    now: () => clock.t,
    random: makeRng(0x5eed + index),
    registerDisposer: (fn) => { disposers.push(fn) },
    disposers,
  }
}

export function messageOf(fn) {
  try {
    fn()
  } catch (error) {
    return error.message
  }
  return null
}

export function refused(fn) {
  return messageOf(fn) !== null
}

function healthHooks(events) {
  return {
    onDeath: (event) => events.push(['onDeath', event]),
    onDamage: (event) => events.push(['onDamage', event]),
    onRespawn: () => events.push(['onRespawn']),
  }
}

function destructibleHooks(events) {
  return {
    onDestroyed: (event) => events.push(['onDestroyed', event.ids]),
    onRespawn: () => events.push(['onRespawn']),
  }
}

function snapHealth(h) {
  return { hp: h.hp, max: h.max, alive: h.alive, fraction: h.fraction }
}

export function makeWorld(host) {
  const log = []
  const entities = new Map()
  let restAll = false
  return {
    log,
    entities,
    setRestAll(value) { restAll = value },
    spawnChild(id, cfg) {
      log.push(['spawnChild', id, cfg])
      entities.set(id, { id, position: cfg.position, rotation: cfg.rotation, scale: [1, 1, 1] })
    },
    setPosition(id, position, rotation) {
      log.push(['setPosition', id, position, rotation])
      const e = entities.get(id)
      if (e) {
        e.position = position
        if (rotation !== undefined) e.rotation = rotation
      }
    },
    getEntity(id) { return entities.get(id) },
    setBodyActive(id, active) { log.push(['setBodyActive', id, active]) },
    applyImpulse(id, impulse) { log.push(['applyImpulse', id, impulse]) },
    destroy(id) {
      log.push(['destroy', id])
      entities.delete(id)
    },
    isAtRest(id) {
      log.push(['isAtRest', id])
      return restAll
    },
    setMotionType(id, motion) {
      log.push(['setMotionType', id, motion])
      return true
    },
    nearby(position, radius) {
      const ids = []
      for (const [id, e] of entities) {
        const dx = e.position[0] - position[0]
        const dy = e.position[1] - position[1]
        const dz = e.position[2] - position[2]
        if (dx * dx + dy * dy + dz * dz <= radius * radius) ids.push(id)
      }
      log.push(['nearby', radius, ids])
      return ids
    },
  }
}

export function makeSite(host, entityOverrides = {}, players = []) {
  const world = makeWorld(host)
  const entity = {
    id: 'crate',
    position: [10, 2, -4],
    rotation: [0, 0, 0, 1],
    scale: [1, 1, 1],
    custom: { sx: 2, sy: 4, sz: 2, mass: 40, color: 0xff0000, roughness: 0.5 },
    ...entityOverrides,
  }
  return { world, entity, players: { getAll: () => players } }
}

function snapDestructible(d, site) {
  return {
    destroyed: d.destroyed,
    damageTaken: d.damageTaken,
    health: d.health,
    debrisIds: d.debrisIds,
    poolSize: d.debrisPoolSize,
    poolFree: d.debrisPoolFree,
    lod: d.debrisLOD,
    position: site.entity.position,
    scale: site.entity.scale,
  }
}

const scenarios = []
const scenario = (name, run) => scenarios.push({ name, run })

scenario('health-schema', (adapter) => adapter.healthSchema())

scenario('health-death-and-hooks', (adapter, host) => {
  const events = []
  const h = adapter.health({ max: 100, ...healthHooks(events) }, host)
  const steps = []
  steps.push(['damage30', h.damage(30, 'gun'), snapHealth(h)])
  steps.push(['damage200', h.damage(200, 'gun'), snapHealth(h)])
  steps.push(['damage5', h.damage(5), snapHealth(h)])
  steps.push(['kill', h.kill('again'), snapHealth(h)])
  steps.push(['healDead', h.heal(10), snapHealth(h)])
  return { steps, events }
})

scenario('health-float32-storage', (adapter, host) => {
  const events = []
  const h = adapter.health({ max: 100, ...healthHooks(events) }, host)
  const returned = h.damage(0.1)
  const small = adapter.health({ max: 0.3 }, host)
  return { returned, hp: h.hp, fraction: h.fraction, smallMax: small.max, smallFraction: small.fraction, events }
})

scenario('health-invulnerability-window', (adapter, host) => {
  const events = []
  const h = adapter.health({ max: 100, invulnMs: 500, ...healthHooks(events) }, host)
  const seq = []
  for (const t of [1000, 1100, 1600]) {
    host.clock.t = t
    seq.push([t, h.damage(10)])
  }
  return { seq, hp: h.hp, events }
})

scenario('health-heal-and-respawn', (adapter, host) => {
  const events = []
  const h = adapter.health({ max: 50, hp: 10, ...healthHooks(events) }, host)
  const steps = []
  steps.push(['heal5', h.heal(5), snapHealth(h)])
  steps.push(['heal100', h.heal(100), snapHealth(h)])
  steps.push(['healNaN', h.heal(NaN), snapHealth(h)])
  h.kill('fall')
  steps.push(['healDead', h.heal(10), snapHealth(h)])
  steps.push(['respawnFull', h.respawn(), snapHealth(h)])
  steps.push(['respawnZero', h.respawn(0), snapHealth(h)])
  steps.push(['respawn30', h.respawn(30), snapHealth(h)])
  return { steps, events }
})

scenario('health-set-max', (adapter, host) => {
  const events = []
  const h = adapter.health({ max: 100, ...healthHooks(events) }, host)
  h.damage(30)
  const steps = []
  steps.push(['setMax40', h.setMax(40), snapHealth(h)])
  steps.push(['setMaxNegative', h.setMax(-1), snapHealth(h)])
  steps.push(['setMaxNaN', h.setMax(NaN), snapHealth(h)])
  steps.push(['setMaxZero', h.setMax(0), snapHealth(h)])
  steps.push(['setMax90', h.setMax(90), snapHealth(h)])
  return { steps, events }
})

scenario('health-pool-growth-keeps-handles', (adapter, host) => {
  const handles = []
  for (let i = 0; i < 20; i++) handles.push(adapter.health({ max: 10, hp: 1 + (i % 10) }, host))
  handles[0].damage(0.5)
  handles[19].damage(100)
  return { states: handles.map((h) => [h.hp, h.max, h.alive]) }
})

scenario('health-dispose-and-slot-reuse', (adapter, host) => {
  const a = adapter.health({ max: 10 }, host)
  a.damage(4)
  const before = snapHealth(a)
  host.disposers[0]()
  const b = adapter.health({ max: 20 }, host)
  return { before, after: snapHealth(b), staleHandle: snapHealth(a), disposers: host.disposers.length }
})

scenario('health-refused-specs', (adapter, host) => {
  const cases = {
    missingMax: {},
    zeroMax: { max: 0 },
    unknownKey: { max: 10, bogus: 1 },
    stringHp: { max: 10, hp: 'x' },
    numberHook: { max: 10, onDeath: 5 },
    stringSpec: 'x',
  }
  return Object.fromEntries(Object.entries(cases).map(([name, spec]) => [name, refused(() => adapter.health(spec, host))]))
})

scenario('destructible-destroy-and-debris', (adapter, host) => {
  const site = makeSite(host)
  const events = []
  const d = adapter.destructible({ health: 100, debrisCount: 3, debrisImpulsePattern: 'up', debrisLifetime: 8, ...destructibleHooks(events) }, site, host)
  const steps = []
  steps.push(['damage60', d.damage(60), snapDestructible(d, site)])
  steps.push(['damage40', d.damage(40), snapDestructible(d, site)])
  return { steps, events, world: site.world.log }
})

scenario('destructible-respawn-after-delay', (adapter, host) => {
  const site = makeSite(host)
  const events = []
  const d = adapter.destructible({ health: 10, debrisCount: 2, respawnDelay: 2, debrisLifetime: 0, debrisImpulsePattern: 'outward', ...destructibleHooks(events) }, site, host)
  const steps = []
  steps.push(['destroy', d.damage(10), snapDestructible(d, site)])
  d.tick(1)
  steps.push(['tick1', d.destroyed, snapDestructible(d, site)])
  d.tick(1.5)
  steps.push(['tick2', d.destroyed, snapDestructible(d, site)])
  return { steps, events, world: site.world.log }
})

scenario('destructible-lifetime-expiry-and-reuse', (adapter, host) => {
  const site = makeSite(host)
  site.world.setRestAll(true)
  const events = []
  const d = adapter.destructible({ health: 5, debrisCount: 2, debrisLifetime: 3, debrisFreezeAfter: 0, debrisImpulsePattern: 'up', ...destructibleHooks(events) }, site, host)
  const steps = []
  steps.push(['destroy', d.damage(5), snapDestructible(d, site)])
  d.tick(0.6)
  steps.push(['tick06', d.destroyed, snapDestructible(d, site)])
  d.tick(0.6)
  steps.push(['tick12', d.destroyed, snapDestructible(d, site)])
  d.tick(3)
  steps.push(['expire', d.destroyed, snapDestructible(d, site)])
  d.respawn()
  steps.push(['respawn', d.destroyed, snapDestructible(d, site)])
  steps.push(['redestroy', d.damage(5), snapDestructible(d, site)])
  return { steps, events, world: site.world.log }
})

scenario('destructible-fractured-keyed-pieces', (adapter, host) => {
  const site = makeSite(host)
  const events = []
  const d = adapter.destructible({ health: 1, fracturedAsset: 'crate.glb', fracturedPieceCount: 2, debrisImpulsePattern: 'outward', ...destructibleHooks(events) }, site, host)
  const steps = []
  steps.push(['destroy', d.damage(1), snapDestructible(d, site)])
  d.respawn()
  steps.push(['respawn', d.destroyed, snapDestructible(d, site)])
  steps.push(['redestroy', d.damage(1), snapDestructible(d, site)])
  d.drain()
  steps.push(['drain', d.destroyed, snapDestructible(d, site)])
  return { steps, events, world: site.world.log }
})

scenario('destructible-impact-scan', (adapter, host) => {
  const out = {}
  const cases = {
    slowNear: [{ state: { position: [12, 2, -4], velocity: [1, 0, 0] } }],
    fastFar: [{ state: { position: [30, 2, -4], velocity: [9, 0, 0] } }],
    fastNear: [{ state: { position: [12, 2, -4], velocity: [6, 0, 0] } }],
  }
  for (const [name, players] of Object.entries(cases)) {
    const site = makeSite(host, {}, players)
    const d = adapter.destructible({ health: 50, debrisCount: 2, impactThreshold: 4, impactRadius: 5 }, site, host)
    d.tick(0.1)
    out[name] = snapDestructible(d, site)
  }
  const ballSite = makeSite(host)
  ballSite.world.entities.set('ball', { id: 'ball', position: [10, 2, -1], velocity: [0, -9, 0] })
  const ball = adapter.destructible({ health: 50, debrisCount: 2, impactThreshold: 4, impactRadius: 5 }, ballSite, host)
  ball.tick(0.1)
  out.worldBall = snapDestructible(ball, ballSite)
  return out
})

scenario('destructible-drain-destroys-pool', (adapter, host) => {
  const site = makeSite(host)
  const d = adapter.destructible({ health: 1, debrisCount: 3 }, site, host)
  d.damage(1)
  const beforeDrain = snapDestructible(d, site)
  d.drain()
  return { beforeDrain, afterDrain: snapDestructible(d, site), world: site.world.log }
})

scenario('destructible-reset-and-chart-reanchor', (adapter, host) => {
  const site = makeSite(host)
  const d = adapter.destructible({ health: 2, debrisCount: 2 }, site, host)
  d.damage(2)
  d.reset()
  const afterReset = snapDestructible(d, site)
  const moved = []
  d.onChartReanchor({ transfer: { point: (src, dst) => moved.push([src, dst]) } })
  return { afterReset, moved, world: site.world.log }
})

scenario('destructible-forced-freeze-then-static', (adapter, host) => {
  const site = makeSite(host)
  const d = adapter.destructible({ health: 1, debrisCount: 1, debrisLifetime: 0, debrisSettleGrace: 0.2, debrisFreezeAfter: 1 }, site, host)
  d.damage(1)
  const steps = []
  d.tick(0.3)
  steps.push(['t03', snapDestructible(d, site)])
  d.tick(0.8)
  steps.push(['t11', snapDestructible(d, site)])
  d.tick(0.1)
  steps.push(['t12', snapDestructible(d, site)])
  return { steps, world: site.world.log }
})

scenario('destructible-ignored-inputs', (adapter, host) => {
  const site = makeSite(host)
  const d = adapter.destructible({ health: 10, impactThreshold: 3, debrisCount: 2 }, site, host)
  const returns = [d.damage(-5), d.damage('x'), d.damage(NaN), d.impact('abc'), d.impact([1, 0, 0])]
  return { returns, snap: snapDestructible(d, site) }
})

scenario('destructible-validation-messages', (adapter, host) => {
  const cases = {
    health0: { health: 0 },
    healthString: { health: 'x' },
    impactThresholdNegative: { impactThreshold: -1 },
    impactRadiusZero: { impactRadius: 0 },
    debrisCountFraction: { debrisCount: 1.5 },
    debrisLifetimeNegative: { debrisLifetime: -1 },
    settleGraceNegative: { debrisSettleGrace: -1 },
    freezeAfterNaN: { debrisFreezeAfter: NaN },
    respawnNegative: { respawnDelay: -1 },
    impulseWord: { debrisImpulsePattern: 'sideways' },
    shapeArray: { debrisShape: [] },
    fracturedNoCount: { fracturedAsset: 'crate.glb' },
    fracturedNumber: { fracturedAsset: 5 },
    fracturedCountZero: { fracturedAsset: 'crate.glb', fracturedPieceCount: 0 },
    onDestroyedNumber: { onDestroyed: 5 },
    onRespawnNumber: { onRespawn: 5 },
    stringSpec: 'x',
    valid: { health: 10, debrisCount: 2 },
  }
  return Object.fromEntries(Object.entries(cases).map(([name, spec]) => [name, messageOf(() => adapter.destructible(spec, makeSite(host), host))]))
})

export const SCENARIOS = Object.freeze(scenarios.slice())

export function runScenarios(makeAdapter) {
  const results = {}
  SCENARIOS.forEach((entry, index) => {
    const host = makeHost(index)
    const adapter = makeAdapter()
    adapter.begin(host)
    results[entry.name] = JSON.parse(JSON.stringify(entry.run(adapter, host)))
  })
  return results
}
