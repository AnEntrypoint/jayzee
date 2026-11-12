import { EventBus } from '../apps/EventBus.js'
import { createAppRuntime } from '../apps/appRuntime.js'
import { DEFAULT_MOVEMENT } from '../motion-pure/movement.js'
import { createConnectionHost } from '../sessions-host/connectionHost.js'
import { createGroundCharacterWorld } from '../tick-host/groundCharacterWorld.js'
import { createTickHost } from '../tick-host/tickHost.js'
import { createTickScheduler } from '../tick-pure/tickScheduler.js'
import { World } from '../world/World.js'
import { WORLD_DEFAULTS } from '../world/options.js'
import { createQueries } from '../world/query.js'

export const SERVER_SUBSYSTEMS = Object.freeze(['bus', 'world', 'queries', 'characters', 'appRuntime', 'tickHost', 'connections', 'scheduler'])
export const SERVER_CONFIG_INVALID = 'server-config-invalid'
export const GRAVITY_NOT_VERTICAL = 'gravity-not-vertical'
export const SCHEDULER_UNAVAILABLE = 'scheduler-unavailable'
const BODY_TYPES = Object.freeze(['static', 'dynamic'])
const IDENTITY_ROTATION = Object.freeze([0, 0, 0, 1])

const refuse = (code, message) => {
  const error = new TypeError(message)
  error.code = code
  return error
}

const isTriple = (value) => Array.isArray(value) && value.length === 3 && value.every((x) => typeof x === 'number' && Number.isFinite(x))

export function resolveServerConfig(config = {}) {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) throw refuse(SERVER_CONFIG_INVALID, 'the world config must be an object')
  const tickRate = config.tickRate === undefined ? WORLD_DEFAULTS.tickRate : config.tickRate
  if (!Number.isInteger(tickRate) || tickRate < 1) throw refuse(SERVER_CONFIG_INVALID, 'tickRate must be a positive whole number')
  const gravity = config.gravity === undefined ? [0, WORLD_DEFAULTS.gravity, 0] : config.gravity
  if (!isTriple(gravity)) throw refuse(SERVER_CONFIG_INVALID, 'gravity must be a finite [x, y, z] triple')
  if (gravity[0] !== 0 || gravity[2] !== 0) throw refuse(GRAVITY_NOT_VERTICAL, 'gravity must be vertical: the kernel integrates gravity on y only')
  const movement = config.movement === undefined ? {} : config.movement
  if (movement === null || typeof movement !== 'object') throw refuse(SERVER_CONFIG_INVALID, 'movement must be an object')
  for (const key of Object.keys(movement)) {
    if (!(typeof movement[key] === 'number' && Number.isFinite(movement[key]))) throw refuse(SERVER_CONFIG_INVALID, 'movement.' + key + ' must be a finite number')
  }
  const spawnPoint = config.spawnPoint === undefined ? [0, 0, 0] : config.spawnPoint
  if (!isTriple(spawnPoint)) throw refuse(SERVER_CONFIG_INVALID, 'spawnPoint must be a finite [x, y, z] triple')
  const playerModel = config.playerModel === undefined ? null : config.playerModel
  if (playerModel !== null && typeof playerModel !== 'string') throw refuse(SERVER_CONFIG_INVALID, 'playerModel must be a string or null')
  const list = config.entities === undefined ? [] : config.entities
  if (!Array.isArray(list)) throw refuse(SERVER_CONFIG_INVALID, 'entities must be a list')
  const seen = new Set()
  const entities = list.map((entry, index) => {
    if (entry === null || typeof entry !== 'object') throw refuse(SERVER_CONFIG_INVALID, 'entity ' + index + ' must be an object')
    if (typeof entry.id !== 'string' || entry.id.length === 0) throw refuse(SERVER_CONFIG_INVALID, 'entity ' + index + ' needs a string id')
    if (seen.has(entry.id)) throw refuse(SERVER_CONFIG_INVALID, 'entity id ' + entry.id + ' appears twice')
    seen.add(entry.id)
    const position = entry.position === undefined ? [0, 0, 0] : entry.position
    if (!isTriple(position)) throw refuse(SERVER_CONFIG_INVALID, 'entity ' + entry.id + ' position must be a finite [x, y, z] triple')
    const bodyType = entry.bodyType === undefined ? 'static' : entry.bodyType
    if (!BODY_TYPES.includes(bodyType)) throw refuse(SERVER_CONFIG_INVALID, 'entity ' + entry.id + ' bodyType must be static or dynamic')
    if (entry.model !== undefined && entry.model !== null && typeof entry.model !== 'string') throw refuse(SERVER_CONFIG_INVALID, 'entity ' + entry.id + ' model must be a string')
    if (entry.app !== undefined && entry.app !== null && typeof entry.app !== 'string') throw refuse(SERVER_CONFIG_INVALID, 'entity ' + entry.id + ' app must be an app name')
    if (entry.radius !== undefined && !(Number.isFinite(entry.radius) && entry.radius >= 0)) throw refuse(SERVER_CONFIG_INVALID, 'entity ' + entry.id + ' radius must be at or above zero')
    return {
      id: entry.id,
      model: entry.model ?? null,
      app: entry.app ?? null,
      position: [...position],
      rotation: entry.rotation === undefined ? [...IDENTITY_ROTATION] : [...entry.rotation],
      bodyType,
      radius: entry.radius,
      config: entry.config === undefined ? null : entry.config,
    }
  })
  return { tickRate, gravity: [...gravity], movement: { ...DEFAULT_MOVEMENT, ...movement }, spawnPoint: [...spawnPoint], playerModel, entities }
}

export function createServer({ config = {}, apps = {}, now, log = () => {}, heightAt = () => 0, timers = null, entityCapacity = 256, bodyCapacity = WORLD_DEFAULTS.capacity, bodyRadius = WORLD_DEFAULTS.radius, boxes = [], onStep = null, randomFill = undefined } = {}) {
  if (typeof now !== 'function') throw new TypeError('createServer needs a clock function in milliseconds')
  if (typeof log !== 'function') throw new TypeError('createServer needs a log function')
  const resolved = resolveServerConfig(config)
  const created = []
  const make = (name, build) => {
    const subsystem = build()
    created.push(name)
    return subsystem
  }
  const bus = make('bus', () => new EventBus({ now, error: (...args) => log('error', ...args), warn: (...args) => log('warn', ...args) }))
  const world = make('world', () => new World({ capacity: bodyCapacity, tickRate: resolved.tickRate, gravity: resolved.gravity[1], radius: bodyRadius, boxes }))
  const queries = make('queries', () => createQueries(world, { radius: bodyRadius, boxes }))
  const characters = make('characters', () => createGroundCharacterWorld({ heightAt }))
  const appRuntime = make('appRuntime', () => createAppRuntime({ tickDt: 1 / resolved.tickRate, capacity: entityCapacity, world, queries, bus }))
  const records = []
  let recordsEpoch = -1
  const entityRecords = () => {
    const table = appRuntime.table
    if (recordsEpoch !== table.epoch) {
      records.length = 0
      for (let slot = 0; slot < table.capacity; slot++) {
        const id = table.idOf(slot)
        if (id < 0) continue
        const handle = table.getEntity(id)
        records.push({ id: handle.name ?? String(id), model: handle.model ?? '', position: [0, 0, 0], rotation: [0, 0, 0, 1], velocity: [0, 0, 0], bodyType: handle.body === null ? 'static' : 'dynamic', custom: handle.custom, handle })
      }
      recordsEpoch = table.epoch
    }
    for (const record of records) {
      record.handle.readPosition(record.position)
      record.handle.readVelocity(record.velocity)
      record.handle.readRotation(record.rotation)
      record.custom = record.handle.custom
    }
    return records
  }
  const tickHost = make('tickHost', () => createTickHost({
    now,
    log,
    tickRate: resolved.tickRate,
    physicsWorld: characters,
    bodyWorld: world,
    gravity: resolved.gravity,
    movement: resolved.movement,
    entities: entityRecords,
    appRuntimeTick: (tick) => appRuntime.tick(tick),
    onStep,
  }))
  const spawnAt = [resolved.spawnPoint[0], resolved.spawnPoint[1], resolved.spawnPoint[2]]
  const connections = make('connections', () => createConnectionHost({ tickHost, now, randomFill, snapSpawn: () => [spawnAt[0], spawnAt[1], spawnAt[2]] }))
  const scheduler = timers === null ? null : make('scheduler', () => {
    const built = createTickScheduler({ clock: { now }, setTimer: timers.setTimer, clearTimer: timers.clearTimer, logger: { error: (...args) => log('error', ...args) }, tickRate: resolved.tickRate })
    built.onTick(() => tickHost.tick())
    return built
  })

  for (const name of Object.keys(apps)) appRuntime.registerApp(name, apps[name])

  const spawnEntity = (entry) => {
    const dynamic = entry.bodyType === 'dynamic'
    const body = dynamic ? world.spawn(entry.position) : -1
    return appRuntime.spawn({
      name: entry.id,
      app: entry.app,
      model: entry.model,
      position: entry.position,
      rotation: entry.rotation,
      radius: entry.radius === undefined ? (dynamic ? bodyRadius : 0) : entry.radius,
      body,
      config: entry.config,
    })
  }
  const loaded = resolved.entities.map(spawnEntity)

  const interact = (playerId, entityRef) => {
    const player = tickHost.playerManager.getPlayer(playerId)
    if (!player) return false
    return appRuntime.interact(entityRef, { id: playerId, position: [player.state.position[0], player.state.position[1], player.state.position[2]] })
  }

  const needScheduler = () => {
    if (scheduler === null) {
      const error = new Error('start and stop need timers injected into createServer')
      error.code = SCHEDULER_UNAVAILABLE
      throw error
    }
    return scheduler
  }

  return {
    config: resolved,
    subsystems: Object.freeze([...created]),
    bus,
    world,
    queries,
    characters,
    appRuntime,
    tickHost,
    connections,
    scheduler,
    loadedEntities: Object.freeze(loaded),
    spawnEntity: (entry) => spawnEntity(resolveServerConfig({ entities: [entry] }).entities[0]),
    destroyEntity: (ref) => appRuntime.destroy(ref),
    getEntity: (ref) => appRuntime.getEntity(ref),
    registerApp: (name, def) => appRuntime.registerApp(name, def),
    reloadApp: (name, def) => appRuntime.hotReload(name, def),
    attach: (socket) => connections.attach(socket),
    connect: (socket) => connections.connect(socket),
    receive: (socket, data) => connections.receive(socket, data),
    disconnect: (socket) => connections.closed(socket),
    interact,
    tick: () => tickHost.tick(),
    start: () => needScheduler().start(),
    stop: () => needScheduler().stop(),
    get tickNumber() { return tickHost.tickNumber },
    get playerModel() { return resolved.playerModel },
    get spawnPoint() { return [spawnAt[0], spawnAt[1], spawnAt[2]] },
  }
}
