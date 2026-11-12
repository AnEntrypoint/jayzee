import { tryParsePlayerId } from './playerId.js'

const DEFAULT_WARNING_CAPACITY = 64
const DEFAULT_LOOP_CAPACITY = 32
const DEFAULT_ANIMATION_FADE = 0.15
const INTEGER_ID = /^\d+$/
const PLAYER_MANAGER_METHODS = ['sendToPlayer', 'broadcast', 'getPlayer']

export const HOST_REFUSAL = Object.freeze({
  UNKNOWN_PLAYER: 'unknown-player',
  NOT_DELIVERED: 'not-delivered',
  SOUND_NAME: 'sound-name-not-string',
  CLIP_NAME: 'clip-name-not-string',
  SPAWN_ID_TAKEN: 'spawn-id-taken',
  SPAWN_ID: 'spawn-id-not-string',
  WORLD_REFUSED: 'world-refused',
  UNKNOWN_LEVEL: 'unknown-level',
  ITEM: 'item-not-string',
  COUNT: 'count-not-positive-integer',
  UNKNOWN_SPAWN: 'unknown-spawn',
})

const missingMethods = (value, names) => names.filter((name) => typeof value?.[name] !== 'function')

const clamp01 = (value) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1)

export function createGameHost({ playerManager, entityHost, levels = {}, now, warningCapacity = DEFAULT_WARNING_CAPACITY, loopCapacity = DEFAULT_LOOP_CAPACITY }) {
  const missing = missingMethods(playerManager, PLAYER_MANAGER_METHODS)
  if (missing.length > 0) throw new TypeError('[game-host] playerManager needs ' + missing.join(', '))
  if (typeof entityHost?.spawn !== 'function') throw new TypeError('[game-host] entityHost needs spawn')
  if (typeof now !== 'function') throw new TypeError('[game-host] now must be a clock function')
  if (levels === null || typeof levels !== 'object' || Array.isArray(levels)) throw new TypeError('[game-host] levels must be an object of level definitions')
  if (!Number.isInteger(warningCapacity) || warningCapacity < 1) throw new RangeError('[game-host] warningCapacity must be an integer of at least 1')
  if (!Number.isInteger(loopCapacity) || loopCapacity < 1) throw new RangeError('[game-host] loopCapacity must be an integer of at least 1')

  const stats = { sent: 0, undelivered: 0, broadcasts: 0, sounds: 0, animations: 0, spawns: 0, levelLoads: 0, itemsAdded: 0, refused: 0, warnings: 0 }
  const refusals = new Map()
  const warnings = []
  const loops = []
  const spawned = new Map()
  const inventories = new Map()
  const chainManagers = []
  const state = { level: null }
  let levelEpoch = 0
  let animationSeq = 0
  let lastRefusal = null

  const warn = (text) => {
    stats.warnings++
    if (warnings.length === warningCapacity) warnings.shift()
    warnings.push({ at: now(), text: String(text) })
  }

  const refuse = (reason, detail) => {
    stats.refused++
    refusals.set(reason, (refusals.get(reason) || 0) + 1)
    lastRefusal = { reason, detail }
    warn('[game-host] ' + reason + ': ' + detail)
    return reason
  }

  const transportId = (pid) => (typeof pid === 'string' && INTEGER_ID.test(pid) ? Number(pid) : pid)

  const broadcast = (message) => {
    stats.broadcasts++
    return playerManager.broadcast(message)
  }

  const players = {
    send(pid, message) {
      const id = transportId(pid)
      if (!playerManager.getPlayer(id)) {
        stats.undelivered++
        refuse(HOST_REFUSAL.UNKNOWN_PLAYER, 'send to ' + String(pid))
        return false
      }
      if (!playerManager.sendToPlayer(id, message)) {
        stats.undelivered++
        refuse(HOST_REFUSAL.NOT_DELIVERED, 'send to ' + String(pid))
        return false
      }
      stats.sent++
      return true
    },
    broadcast,
    playAnimation(target, clip, options = {}) {
      const id = transportId(target)
      const player = playerManager.getPlayer(id)
      if (!player) {
        refuse(HOST_REFUSAL.UNKNOWN_PLAYER, 'playAnimation on ' + String(target))
        return false
      }
      if (typeof clip !== 'string' || clip.length === 0) {
        refuse(HOST_REFUSAL.CLIP_NAME, 'playAnimation clip ' + String(clip))
        return false
      }
      const loop = options.loop !== false
      const fade = Number.isFinite(options.fade) && options.fade >= 0 ? options.fade : DEFAULT_ANIMATION_FADE
      animationSeq++
      player.state.animation = { clip, loop, fade, seq: animationSeq }
      stats.animations++
      broadcast({ type: 'play_animation', playerId: id, clip, loop, fade, seq: animationSeq })
      return true
    },
  }

  const loopIndex = (sound, targetEntity) => loops.findIndex((entry) => entry.sound === sound && entry.targetEntity === targetEntity)

  const audio = {
    play(sound, options = {}) {
      if (typeof sound !== 'string' || sound.length === 0) {
        refuse(HOST_REFUSAL.SOUND_NAME, 'audio.play ' + String(sound))
        return false
      }
      const volume = clamp01(options.volume)
      const loop = options.loop === true
      const targetEntity = options.targetEntity ?? null
      if (loop) {
        const at = loopIndex(sound, targetEntity)
        if (at !== -1) loops.splice(at, 1)
        if (loops.length === loopCapacity) {
          const dropped = loops.shift()
          warn('[game-host] loop capacity ' + loopCapacity + ' reached: ' + dropped.sound + ' is no longer replayed to a late joiner')
        }
        loops.push({ sound, volume, targetEntity, startedAt: now() })
      }
      stats.sounds++
      broadcast({ type: 'play_sound', sound, volume, loop, targetEntity })
      return true
    },
    stop(sound, targetEntity = null) {
      const at = loopIndex(sound, targetEntity)
      if (at === -1) return false
      loops.splice(at, 1)
      broadcast({ type: 'stop_sound', sound, targetEntity })
      return true
    },
    activeLoops() {
      return loops.map((entry) => ({ ...entry }))
    },
  }

  const destroyAllSpawned = () => {
    for (const record of spawned.values()) record.handle.destroy()
    spawned.clear()
  }

  const world = {
    spawn(spawnId, spec = {}) {
      if (typeof spawnId !== 'string' || spawnId.length === 0) {
        refuse(HOST_REFUSAL.SPAWN_ID, 'world.spawn id ' + String(spawnId))
        return null
      }
      if (spawned.has(spawnId)) {
        refuse(HOST_REFUSAL.SPAWN_ID_TAKEN, 'world.spawn ' + spawnId)
        return null
      }
      const app = typeof spec.app === 'string' ? spec.app : null
      let handle
      try {
        handle = entityHost.spawn({ position: spec.position || [0, 0, 0], custom: { spawnId, app, config: spec.config || {}, level: state.level } })
      } catch (error) {
        refuse(HOST_REFUSAL.WORLD_REFUSED, 'world.spawn ' + spawnId + ': ' + error.message)
        return null
      }
      spawned.set(spawnId, { handle, app })
      stats.spawns++
      return handle
    },
    destroy(spawnId) {
      const record = spawned.get(spawnId)
      if (!record) {
        refuse(HOST_REFUSAL.UNKNOWN_SPAWN, 'world.destroy ' + String(spawnId))
        return false
      }
      record.handle.destroy()
      spawned.delete(spawnId)
      return true
    },
    entity(spawnId) {
      const record = spawned.get(spawnId)
      return record ? record.handle : null
    },
    spawnedIds() {
      return [...spawned.keys()]
    },
  }

  const inventoryKeys = (pid) => {
    const key = tryParsePlayerId(pid)
    if (key === null) return null
    return INTEGER_ID.test(key) ? [key, Number(key)] : [key]
  }

  const inventory = {
    add(pid, itemId, count = 1) {
      const keys = inventoryKeys(pid)
      if (keys === null) return { ok: false, reason: refuse(HOST_REFUSAL.UNKNOWN_PLAYER, 'inventory.add for ' + String(pid)) }
      if (typeof itemId !== 'string' || itemId.length === 0) return { ok: false, reason: refuse(HOST_REFUSAL.ITEM, 'inventory.add item ' + String(itemId)) }
      if (!Number.isInteger(count) || count < 1) return { ok: false, reason: refuse(HOST_REFUSAL.COUNT, 'inventory.add count ' + String(count)) }
      let items = inventories.get(keys[0])
      if (!items) {
        items = new Map()
        inventories.set(keys[0], items)
      }
      const total = (items.get(itemId) || 0) + count
      items.set(itemId, total)
      stats.itemsAdded += count
      for (const manager of chainManagers) {
        for (const key of keys) manager.setInventoryItem(key, itemId, total)
      }
      return { ok: true, reason: null, total }
    },
    count(pid, itemId) {
      const keys = inventoryKeys(pid)
      if (keys === null) return 0
      return inventories.get(keys[0])?.get(itemId) || 0
    },
    itemsOf(pid) {
      const keys = inventoryKeys(pid)
      if (keys === null) return {}
      return Object.fromEntries(inventories.get(keys[0]) || [])
    },
  }

  const ctx = {
    players,
    audio,
    world,
    inventory,
    state,
    progression: null,
    debug: { warn },
    loadLevel(levelId) {
      if (typeof levelId !== 'string' || !Object.hasOwn(levels, levelId)) {
        refuse(HOST_REFUSAL.UNKNOWN_LEVEL, 'loadLevel ' + String(levelId))
        return false
      }
      destroyAllSpawned()
      loops.length = 0
      state.level = levelId
      levelEpoch++
      stats.levelLoads++
      broadcast({ type: 'load_level', levelId, levelEpoch })
      const entries = Array.isArray(levels[levelId]?.spawn) ? levels[levelId].spawn : []
      for (const entry of entries) world.spawn(entry.id, entry)
      return true
    },
  }

  return {
    ctx,
    bindStats(statsSystem) {
      const lacking = missingMethods(statsSystem, ['addXP', 'applyBonus'])
      if (lacking.length > 0) throw new TypeError('[game-host] a stats system needs ' + lacking.join(', '))
      ctx.progression = statsSystem
      return statsSystem
    },
    bindChains(manager) {
      const lacking = missingMethods(manager, ['setContext', 'setInventoryItem', 'tick'])
      if (lacking.length > 0) throw new TypeError('[game-host] a chain manager needs ' + lacking.join(', '))
      manager.setContext(ctx)
      if (!chainManagers.includes(manager)) chainManagers.push(manager)
      for (const [key, items] of inventories) {
        for (const [itemId, total] of items) {
          for (const each of inventoryKeys(key)) manager.setInventoryItem(each, itemId, total)
        }
      }
      return manager
    },
    syncPlayer(pid) {
      let delivered = 0
      if (state.level !== null && players.send(pid, { type: 'load_level', levelId: state.level, levelEpoch })) delivered++
      for (const entry of loops) {
        if (players.send(pid, { type: 'play_sound', sound: entry.sound, volume: entry.volume, loop: true, targetEntity: entry.targetEntity })) delivered++
      }
      return delivered
    },
    tick(dt) {
      for (const manager of chainManagers) manager.tick(dt)
    },
    get levelEpoch() { return levelEpoch },
    get lastRefusal() { return lastRefusal },
    getWarnings() { return warnings.map((entry) => ({ ...entry })) },
    getStats() { return { ...stats, refusalsByReason: Object.fromEntries(refusals) } },
  }
}
