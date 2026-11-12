import { tagAppState, untagAppState } from './AppRuntimeState.js'
import { createEntityTable } from './entityTable.js'
import { createTimeApi } from './timeApi.js'

export const SERVER_HOOKS = Object.freeze(['setup', 'update', 'teardown', 'onInteract', 'onCollision', 'onMessage'])
export const CLIENT_HOOKS = Object.freeze(['setup', 'render', 'teardown'])
export const APP_RUNTIME_PHASES = Object.freeze(['update', 'timers', 'collisions', 'interactions', 'messages'])
export const RAYCAST_UNAVAILABLE = 'raycast-unavailable'
export const APP_UNKNOWN = 'app-unknown'
export const APP_INVALID = 'app-invalid'
const ERROR_LOG_CAPACITY = 64

const invalid = (message) => {
  const error = new TypeError(message)
  error.code = APP_INVALID
  return error
}

export const validateAppModule = (name, def) => {
  if (def === null || typeof def !== 'object') throw invalid('app ' + name + ' must be an object with a server or a client block')
  for (const key of Object.keys(def)) {
    if (key !== 'server' && key !== 'client') throw invalid('app ' + name + ' has an unknown block ' + key)
  }
  if (def.server === undefined && def.client === undefined) throw invalid('app ' + name + ' has neither a server nor a client block')
  const check = (block, allowed, side) => {
    if (block === undefined) return
    if (block === null || typeof block !== 'object') throw invalid('app ' + name + ' ' + side + ' block must be an object')
    for (const hook of Object.keys(block)) {
      if (!allowed.includes(hook)) throw invalid('app ' + name + ' ' + side + ' block has an unknown hook ' + hook)
      if (typeof block[hook] !== 'function') throw invalid('app ' + name + ' ' + side + ' hook ' + hook + ' must be a function')
    }
  }
  check(def.server, SERVER_HOOKS, 'server')
  check(def.client, CLIENT_HOOKS, 'client')
  return def
}

export function createAppRuntime({ tickDt, capacity = 256, timerCapacity = 256, pairCapacity = 1024, queueCapacity = 256, world = null, queries = null, bus = null } = {}) {
  if (!(typeof tickDt === 'number' && tickDt > 0 && Number.isFinite(tickDt))) throw new RangeError('tickDt must be a positive finite number')
  if (!Number.isInteger(pairCapacity) || pairCapacity < 1) throw new RangeError('pairCapacity must be a positive whole number')
  if (!Number.isInteger(queueCapacity) || queueCapacity < 1) throw new RangeError('queueCapacity must be a positive whole number')
  if (queries !== null && typeof queries.raycast !== 'function') throw new TypeError('queries must provide raycast')
  const table = createEntityTable({ capacity, world })
  const time = createTimeApi({ tickDt, capacity: timerCapacity })
  const { position, radius, alive, app: appOf, body: bodyOf, ids } = table.views

  const appNames = []
  const appDefs = []
  const appIndex = new Map()
  const contexts = new Array(capacity).fill(null)
  const bornTick = new Int32Array(capacity).fill(-1)
  const order = new Int32Array(capacity)
  const pairKeys = new Float64Array(pairCapacity)
  const previousKeys = new Float64Array(pairCapacity)
  const queueKind = new Uint8Array(queueCapacity)
  const queueEntity = new Float64Array(queueCapacity)
  const queuePayload = new Array(queueCapacity).fill(null)
  const bodyOwner = new Map()
  const contact = { began: false, depth: 0, normal: [0, 0, 0] }
  const errors = []
  const stats = { pairOverflow: 0, queueDropped: 0, errorCount: 0, collisions: 0, updates: 0 }
  let orderCount = 0
  let orderEpoch = -1
  let pairCount = 0
  let previousCount = 0
  let queueHead = 0
  let queueCount = 0
  let currentTick = -1
  let lastTick = -1

  const record = (id, hook, error) => {
    stats.errorCount += 1
    if (errors.length === ERROR_LOG_CAPACITY) errors.shift()
    errors.push({ tick: currentTick, id, hook, message: error && error.message ? error.message : String(error) })
  }

  const recordTimer = (id, error) => record(id, 'timer', error)

  const call = (slot, hook, a, b) => {
    const def = appDefs[appOf[slot]]
    const fn = def && def.server ? def.server[hook] : undefined
    if (typeof fn !== 'function') return false
    try {
      fn(contexts[slot], a, b)
    } catch (error) {
      record(ids[slot], hook, error)
    }
    return true
  }

  const appId = (name) => {
    if (!appIndex.has(name)) {
      const error = new RangeError('no app named ' + name + ' is registered')
      error.code = APP_UNKNOWN
      throw error
    }
    return appIndex.get(name)
  }

  const raycastFor = (slot, exclude) => (origin, direction, maxDistance = Infinity) => {
    if (queries === null) {
      const error = new Error('ctx.raycast needs a query module on the runtime')
      error.code = RAYCAST_UNAVAILABLE
      throw error
    }
    exclude.length = bodyOf[slot] >= 0 ? 1 : 0
    if (exclude.length === 1) exclude[0] = bodyOf[slot]
    const hit = queries.raycast(origin, direction, maxDistance, { exclude })
    const isBody = hit.kind === 'body'
    return { ...hit, body: isBody ? hit.id : null, entity: isBody && bodyOwner.has(hit.id) ? bodyOwner.get(hit.id) : null }
  }

  const worldApi = Object.freeze({
    spawn: (config) => spawn(config),
    destroy: (ref) => destroy(ref),
    getEntity: (ref) => table.getEntity(ref),
    query: (filter, out) => {
      if (out !== undefined) return table.query(filter, out)
      const found = new Array(table.query(filter, []))
      table.query(filter, found)
      return found
    },
    get count() { return table.count },
  })

  function spawn(config = {}) {
    if (config === null || typeof config !== 'object') throw new TypeError('spawn takes a config object')
    const index = config.app === undefined || config.app === null ? -1 : appId(config.app)
    if (config.state !== undefined && (config.state === null || typeof config.state !== 'object' || Array.isArray(config.state))) throw new TypeError('state must be a plain object')
    const id = table.spawn({ ...config, app: index })
    const slot = table.slotOf(id)
    const state = config.state === undefined ? {} : config.state
    bornTick[slot] = currentTick
    if (bodyOf[slot] >= 0) bodyOwner.set(bodyOf[slot], id)
    contexts[slot] = {
      entity: table.getEntity(id),
      state,
      config: config.config === undefined ? null : config.config,
      time: time.view(id),
      world: worldApi,
      bus,
      raycast: raycastFor(slot, []),
    }
    call(slot, 'setup')
    return id
  }

  function destroy(ref) {
    const handle = table.getEntity(ref)
    if (handle === null) return false
    const id = handle.id
    const slot = table.slotOf(id)
    call(slot, 'teardown')
    time.cancelOwner(id)
    if (bodyOf[slot] >= 0) bodyOwner.delete(bodyOf[slot])
    contexts[slot] = null
    bornTick[slot] = -1
    let kept = 0
    for (let n = 0; n < previousCount; n++) {
      const key = previousKeys[n]
      const low = key % capacity
      if (low === slot || (key - low) / capacity === slot) continue
      previousKeys[kept] = key
      kept += 1
    }
    previousCount = kept
    table.destroy(id)
    return true
  }

  const registerApp = (name, def) => {
    if (typeof name !== 'string' || name.length === 0) throw new TypeError('an app name must be a non-empty string')
    if (appIndex.has(name)) throw new RangeError('app ' + name + ' is already registered; use hotReload to replace it')
    validateAppModule(name, def)
    appIndex.set(name, appDefs.length)
    appNames.push(name)
    appDefs.push(def)
    return appDefs.length - 1
  }

  const hotReload = (name, def) => {
    const index = appId(name)
    validateAppModule(name, def)
    let reloaded = 0
    for (let slot = 0; slot < capacity; slot++) {
      if (alive[slot] === 0 || appOf[slot] !== index) continue
      call(slot, 'teardown')
      time.cancelOwner(ids[slot])
    }
    appDefs[index] = def
    for (let slot = 0; slot < capacity; slot++) {
      if (alive[slot] === 0 || appOf[slot] !== index) continue
      const carried = contexts[slot].state
      if (carried === null || typeof carried !== 'object' || Array.isArray(carried)) contexts[slot].state = {}
      call(slot, 'setup')
      reloaded += 1
    }
    return reloaded
  }

  const enqueue = (kind, ref, payload) => {
    const handle = table.getEntity(ref)
    if (handle === null) return false
    if (queueCount === queueCapacity) {
      stats.queueDropped += 1
      return false
    }
    const at = (queueHead + queueCount) % queueCapacity
    queueKind[at] = kind
    queueEntity[at] = handle.id
    queuePayload[at] = payload
    queueCount += 1
    return true
  }

  const drain = (kind, hook) => {
    let ran = 0
    const pending = queueCount
    for (let n = 0; n < pending; n++) {
      const at = queueHead
      queueHead = (queueHead + 1) % queueCapacity
      queueCount -= 1
      const entity = queueEntity[at]
      const payload = queuePayload[at]
      const itemKind = queueKind[at]
      queuePayload[at] = null
      if (itemKind !== kind) {
        const back = (queueHead + queueCount) % queueCapacity
        queueKind[back] = itemKind
        queueEntity[back] = entity
        queuePayload[back] = payload
        queueCount += 1
        continue
      }
      const slot = table.slotOf(entity)
      if (slot >= 0 && call(slot, hook, payload)) ran += 1
    }
    return ran
  }

  const rebuildOrder = () => {
    orderCount = 0
    for (let slot = 0; slot < capacity; slot++) {
      if (alive[slot] === 1 && radius[slot] > 0) {
        order[orderCount] = slot
        orderCount += 1
      }
    }
    orderEpoch = table.colliderEpoch
  }

  const hasKey = (keys, count, key) => {
    let lo = 0
    let hi = count - 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (keys[mid] === key) return true
      if (keys[mid] < key) lo = mid + 1
      else hi = mid - 1
    }
    return false
  }

  const detect = () => {
    if (orderEpoch !== table.colliderEpoch) rebuildOrder()
    for (let i = 0; i < orderCount; i++) table.syncBody(order[i])
    for (let i = 1; i < orderCount; i++) {
      const slot = order[i]
      const edge = position[slot * 3] - radius[slot]
      let j = i - 1
      while (j >= 0 && position[order[j] * 3] - radius[order[j]] > edge) {
        order[j + 1] = order[j]
        j -= 1
      }
      order[j + 1] = slot
    }
    pairCount = 0
    for (let i = 0; i < orderCount; i++) {
      const a = order[i]
      const reachX = position[a * 3] + radius[a]
      for (let j = i + 1; j < orderCount; j++) {
        const b = order[j]
        if (position[b * 3] - radius[b] > reachX) break
        const dx = position[b * 3] - position[a * 3]
        const dy = position[b * 3 + 1] - position[a * 3 + 1]
        const dz = position[b * 3 + 2] - position[a * 3 + 2]
        const span = radius[a] + radius[b]
        if (dx * dx + dy * dy + dz * dz > span * span) continue
        if (pairCount === pairCapacity) {
          stats.pairOverflow += 1
          continue
        }
        const key = a < b ? a * capacity + b : b * capacity + a
        let at = pairCount - 1
        while (at >= 0 && pairKeys[at] > key) {
          pairKeys[at + 1] = pairKeys[at]
          at -= 1
        }
        pairKeys[at + 1] = key
        pairCount += 1
      }
    }
  }

  const dispatchCollisions = () => {
    for (let n = 0; n < pairCount; n++) {
      const key = pairKeys[n]
      const b = key % capacity
      const a = (key - b) / capacity
      if (alive[a] === 0 || alive[b] === 0) continue
      const dx = position[b * 3] - position[a * 3]
      const dy = position[b * 3 + 1] - position[a * 3 + 1]
      const dz = position[b * 3 + 2] - position[a * 3 + 2]
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz)
      const began = !hasKey(previousKeys, previousCount, key)
      const depth = radius[a] + radius[b] - distance
      const nx = distance > 0 ? dx / distance : 0
      const ny = distance > 0 ? dy / distance : 1
      const nz = distance > 0 ? dz / distance : 0
      const handleA = contexts[a].entity
      const handleB = contexts[b].entity
      contact.began = began
      contact.depth = depth
      contact.normal[0] = nx
      contact.normal[1] = ny
      contact.normal[2] = nz
      if (call(a, 'onCollision', handleB, contact)) stats.collisions += 1
      if (alive[a] === 0 || alive[b] === 0) continue
      contact.began = began
      contact.depth = depth
      contact.normal[0] = -nx
      contact.normal[1] = -ny
      contact.normal[2] = -nz
      if (call(b, 'onCollision', handleA, contact)) stats.collisions += 1
    }
    previousKeys.set(pairKeys)
    previousCount = pairCount
  }

  const tick = (tickNumber) => {
    if (!Number.isInteger(tickNumber) || tickNumber < 0) throw new RangeError('tickNumber must be a non-negative integer')
    if (tickNumber <= lastTick) throw new RangeError('tick ' + tickNumber + ' does not advance past ' + lastTick)
    lastTick = tickNumber
    currentTick = tickNumber
    time.setTick(tickNumber)
    for (let slot = 0; slot < capacity; slot++) {
      if (alive[slot] === 0 || bornTick[slot] === tickNumber) continue
      if (call(slot, 'update', tickDt)) stats.updates += 1
    }
    time.advance(tickNumber, recordTimer)
    detect()
    dispatchCollisions()
    drain(1, 'onInteract')
    drain(2, 'onMessage')
    return tickNumber
  }

  const exportStates = () => {
    const out = []
    for (let slot = 0; slot < capacity; slot++) {
      if (alive[slot] === 0) continue
      const handle = contexts[slot].entity
      out.push({ name: handle.name, app: appOf[slot] < 0 ? null : appNames[appOf[slot]], state: tagAppState(contexts[slot].state) })
    }
    return out
  }

  const importStates = (saved) => {
    if (!Array.isArray(saved)) throw new TypeError('saved states must be a list')
    let restored = 0
    for (const entry of saved) {
      if (!entry || typeof entry.name !== 'string') continue
      const slot = table.slotOf(table.idByName(entry.name))
      if (slot < 0) continue
      const next = untagAppState(entry.state) ?? {}
      const state = contexts[slot].state
      for (const key of Object.keys(state)) delete state[key]
      Object.assign(state, next)
      restored += 1
    }
    return restored
  }

  const clientApps = (engine = null) => {
    const clientState = new Map()
    const ctxFor = (id) => {
      const slot = table.slotOf(id)
      if (slot < 0) return null
      if (!clientState.has(id)) clientState.set(id, { entity: contexts[slot].entity, state: {}, engine, config: contexts[slot].config })
      return clientState.get(id)
    }
    const run = (id, hook, arg) => {
      const ctx = ctxFor(id)
      if (ctx === null) return undefined
      const def = appDefs[appOf[table.slotOf(id)]]
      const fn = def && def.client ? def.client[hook] : undefined
      if (typeof fn !== 'function') return undefined
      try {
        return fn(ctx, arg)
      } catch (error) {
        record(id, 'client.' + hook, error)
        return undefined
      }
    }
    return {
      setup: (id) => run(id, 'setup'),
      render: (id, frame = null) => run(id, 'render', frame),
      teardown: (id) => {
        const result = run(id, 'teardown')
        clientState.delete(id)
        return result
      },
    }
  }

  return {
    registerApp,
    hotReload,
    spawn,
    destroy,
    tick,
    interact: (ref, player = null) => enqueue(1, ref, player),
    message: (ref, payload = null) => enqueue(2, ref, payload),
    getEntity: (ref) => table.getEntity(ref),
    query: worldApi.query,
    contextOf: (ref) => {
      const handle = table.getEntity(ref)
      return handle === null ? null : contexts[table.slotOf(handle.id)]
    },
    hasApp: (name) => appIndex.has(name),
    appNames: () => [...appNames],
    exportStates,
    importStates,
    clientApps,
    time,
    table,
    world: worldApi,
    errors,
    stats,
    get count() { return table.count },
    get pendingEvents() { return queueCount },
    get contactCount() { return pairCount },
  }
}
