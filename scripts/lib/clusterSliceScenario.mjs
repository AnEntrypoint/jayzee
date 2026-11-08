const serialise = (value) => JSON.parse(JSON.stringify(value, (_, v) => (v instanceof Map ? [...v.entries()] : v instanceof Set ? [...v] : v)))

async function withConsole(log, fn) {
  const saved = { error: console.error, warn: console.warn }
  console.error = (...args) => log.push('error ' + args.map(String).join(' '))
  console.warn = (...args) => log.push('warn ' + args.map(String).join(' '))
  try {
    return await fn()
  } finally {
    console.error = saved.error
    console.warn = saved.warn
  }
}

const unit = (x, y, z) => {
  const l = Math.hypot(x, y, z)
  return [x / l, y / l, z / l]
}

export async function runHostScenario(deps) {
  const log = []
  let t = 0
  const createWorld = (id, descriptor) => {
    log.push(`create ${id} ${JSON.stringify(descriptor)}`)
    return id.startsWith('bad') ? Promise.reject(new Error(`no world for ${id}`)) : Promise.resolve({ id })
  }
  const destroyWorld = async (id, world) => {
    log.push(`destroy ${id} ${world.id}`)
  }
  const host = deps.createClusterWorldHost({ createWorld, destroyWorld, maxWorlds: 2, idleGraceMs: 1000, now: () => t })
  const note = (label, value) => log.push(`${label} ${JSON.stringify(value)}`)
  const attempt = async (label, promise) => {
    try {
      const world = await promise
      note(label, world)
    } catch (e) {
      note(`${label} threw`, [e.name, e.code ?? null, e.message])
    }
  }
  await attempt('ensure c1', host.ensure('c1', { anchorDir: [0, 1, 0], spawnDirs: [] }))
  await attempt('ensure c1 again', host.ensure('c1', { anchorDir: [0, 1, 0], spawnDirs: [] }))
  await attempt('ensure c2', host.ensure('c2', { anchorDir: [1, 0, 0], spawnDirs: [[0, 1, 0]] }))
  await attempt('ensure c3 at capacity', host.ensure('c3', { anchorDir: [0, 0, 1], spawnDirs: [] }))
  note('stats after capacity', host.stats)
  host.noteMembers('c1', 0)
  t = 500
  note('sweep at 500', await host.sweep())
  t = 1500
  note('sweep at 1500', await host.sweep())
  note('hosted after first sweep', host.hostedIds)
  host.noteMembers('c2', 2)
  t = 9000
  note('sweep keeps c2', await host.sweep())
  note('worldOf c2', host.worldOf('c2'))
  note('has c1', host.has('c1'))
  note('destroy c2', await host.destroy('c2'))
  note('destroy missing', await host.destroy('nope'))
  await attempt('ensure bad1', host.ensure('bad1', {}))
  note('has bad1 after rejection', host.has('bad1'))
  note('stats final', host.stats)
  return { log }
}

export async function runCoordinatorScenario(deps) {
  const log = []
  const listeners = []
  const manager = { onAssignment: (fn) => listeners.push(fn) }
  const hosted = new Set()
  const refuse = new Set(['c'])
  const host = {
    has: (id) => hosted.has(id),
    ensure: async (id, descriptor) => {
      log.push(`ensure ${id} ${JSON.stringify(descriptor)}`)
      if (id === 'boom') throw new Error('disk full')
      if (refuse.has(id)) throw new deps.ClusterWorldCapacityError(id, hosted.size, 2)
      hosted.add(id)
    },
    noteMembers: (id, n) => log.push(`members ${id} ${n}`),
    get hostedIds() { return [...hosted] },
    sweep: async () => {
      log.push('sweep')
      return []
    },
  }
  const coordinator = deps.createClusterCoordinator({
    manager,
    host,
    descriptorOf: (cluster) => ({ anchorDir: cluster.anchorDir, spawnCount: cluster.memberIds.length }),
    onHandoff: async (event, result) => log.push(`handoff ${event.id} ${result.clusters.length}`),
  })
  const emit = (result) => listeners.forEach((fn) => fn(result))
  const cluster = (id, memberIds) => ({ id, memberIds, anchorDir: [0, 1, 0] })
  await withConsole(log, async () => {
    emit({ clusters: [cluster('a', [1, 2]), cluster('b', [3])], events: [] })
    emit({ clusters: [cluster('a', [1, 2, 4]), cluster('c', [5])], events: [{ type: 'handoff', id: 'h1' }] })
    emit({ clusters: [cluster('a', [1]), cluster('c', [5])], events: [] })
    await coordinator.settle()
    log.push(`refusals ${JSON.stringify(serialise(coordinator.refusals))}`)
    log.push(`refused ids ${JSON.stringify(coordinator.refusedClusterIds)}`)
    emit({ clusters: [cluster('a', [1])], events: [] })
    await coordinator.settle()
    log.push(`refused ids after c leaves ${JSON.stringify(coordinator.refusedClusterIds)}`)
    refuse.delete('c')
    emit({ clusters: [cluster('a', [1]), cluster('c', [5, 6])], events: [] })
    await coordinator.settle()
    log.push(`hosted after c is admitted ${JSON.stringify(host.hostedIds)}`)
    emit({ clusters: [cluster('boom', [7])], events: [] })
    emit({ clusters: [cluster('z', [8])], events: [] })
    try {
      await coordinator.settle()
      log.push('settle ok')
    } catch (e) {
      log.push(`settle threw ${e.message}`)
    }
  })
  return { log }
}

export async function runManagerScenario(deps) {
  const log = []
  let t = 0
  const config = { radius: 400, linkM: 30, memberRadiusM: 40, lattice: null, stayFactor: 1.25, joinFactor: 0.8, hz: 4 }
  const manager = deps.createClusterManager({ config, now: () => t })
  const snap = (label, result) => log.push(`${label} ${JSON.stringify(serialise(result))}`)
  await withConsole(log, async () => {
    manager.setPlayerDir(1, unit(0, 1, 0))
    manager.setPlayerDir(2, unit(0.01, 1, 0))
    manager.setPlayerDir(3, unit(1, 0, 0.2))
    manager.setPlayerDir(4, [Number.NaN, 1, 0])
    snap('step0', manager.step())
    snap('step0 again (inside the period)', manager.step())
    t = 250
    snap('step at 250', manager.step())
    t = 260
    snap('step at 260 (inside the period)', manager.step())
    snap('forced step', manager.step({ force: true }))
    manager.removePlayer(2)
    manager.setPlayerDir(5, unit(-1, 0, 0))
    t = 600
    snap('step after leave and join', manager.step())
    const off = manager.onAssignment((r) => log.push(`listener clusters ${r.clusters.length}`))
    t = 900
    manager.step()
    off()
    t = 1200
    manager.step()
    log.push(`dir of 3 ${JSON.stringify(manager.dirOf(3))}`)
    log.push(`cluster of 1 ${JSON.stringify(serialise(manager.clusterOf(1)))}`)
    log.push(`stats ${JSON.stringify(manager.stats)}`)
  })
  return { log }
}

export async function runClusterSlice(deps) {
  return {
    host: await runHostScenario(deps),
    coordinator: await runCoordinatorScenario(deps),
    manager: await runManagerScenario(deps),
  }
}
