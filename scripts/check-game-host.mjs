import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gate, finish } from './lib/gate.mjs'
import { createGameHost, HOST_REFUSAL } from '../src/game/hostContext.js'
import { defineStatsSystem } from '../src/game/StatsSystem.js'
import { defineQuestSystem } from '../src/game/QuestSystem.js'
import { EventChainManager } from '../src/game/EventChainManager.js'
import { PlayerManager } from '../src/netcode/playerManager.js'
import { World } from '../src/world/World.js'
import { createEntityHost, ENTITY_PARK_OFFSET } from '../src/apps/entityHost.js'
import { unpack } from '../src/protocol/msgpack.js'

const QUESTS = {
  rats: {
    title: 'Ten rats',
    objectives: [{ description: 'rats', count: 2 }],
    rewards: { xp: 120, items: { key: 1, coin: 5 }, statBonuses: { damage: 3 } },
  },
}

const LEVELS = {
  cellar: { spawn: [{ id: 'crate-1', app: 'crate', position: [1, 2, 3] }, { id: 'crate-2', app: 'crate', position: [4, 2, 3] }] },
  tower: { spawn: [] },
}

const socket = () => {
  const inbox = []
  return { inbox, isOpen: true, send(data) { inbox.push(unpack(data)); return true } }
}

function setup(options = {}) {
  let nowMs = 1000
  const now = () => nowMs
  const playerManager = new PlayerManager({ now, log: () => {} })
  const world = new World({ capacity: options.capacity ?? 16 })
  const entityHost = createEntityHost(world)
  const host = createGameHost({ playerManager, entityHost, levels: LEVELS, now, ...options.host })
  const sockets = [socket(), socket()]
  const ids = sockets.map((s) => playerManager.addPlayer(s, { position: [0, 0, 0] }))
  const stats = host.bindStats(defineStatsSystem({}, host.ctx))
  const quests = defineQuestSystem({ quests: QUESTS, now }, host.ctx)
  const chains = host.bindChains(new EventChainManager({ clock: now }))
  return { host, playerManager, world, entityHost, sockets, ids, stats, quests, chains, advance(ms) { nowMs += ms } }
}

const typesOf = (inbox) => inbox.map((message) => message.type)

gate('a quest objective reaches the player as decoded wire messages on the quests channel through the real PlayerManager', () => {
  const s = setup()
  const pid = String(s.ids[0])
  assert.deepEqual(s.quests.startQuest(pid, 'rats').ok, true)
  s.quests.completeObjective(pid, 'rats', 0, 2)
  const mine = s.sockets[0].inbox.filter((message) => message.type === 'quests')
  assert.ok(mine.length >= 2, 'the player received ' + mine.length + ' quest messages')
  assert.equal(mine[mine.length - 1].questId, 'rats')
  assert.equal(mine[mine.length - 1].state, 'complete')
  assert.equal(s.sockets[1].inbox.length, 0)
})

gate('claiming the reward awards xp and the stat bonus through the bound stats system and pushes the stats channel', () => {
  const s = setup()
  const pid = String(s.ids[0])
  s.quests.startQuest(pid, 'rats')
  s.quests.completeObjective(pid, 'rats', 0, 2)
  const damageBefore = s.stats.getStats(pid).damage
  assert.equal(s.quests.claimReward(pid, 'rats').ok, true)
  assert.equal(s.stats.getStats(pid).xp, 120)
  assert.equal(s.stats.getLevel(pid), 2)
  assert.ok(s.stats.getStats(pid).damage >= damageBefore + 3, 'damage ' + s.stats.getStats(pid).damage)
  const pushed = s.sockets[0].inbox.filter((message) => message.type === 'stats')
  assert.ok(pushed.length >= 1 && pushed[pushed.length - 1].xp === 120, 'no stats push carrying xp 120')
})

gate('reward items land in the host inventory and open a chain gated on ifItemInInventory for that player only', () => {
  const s = setup()
  const pid = String(s.ids[0])
  s.chains.addChain({ id: 'door', trigger: { type: 'onInteract', entityId: 'door' }, conditions: [{ type: 'ifItemInInventory', itemId: 'key' }], actions: [{ type: 'setVariable', variableName: 'doorOpen', value: true }] })
  assert.equal(s.chains.triggerEvent('onInteract', { entityId: 'door', playerId: s.ids[0] })[0].success, false)
  s.quests.startQuest(pid, 'rats')
  s.quests.completeObjective(pid, 'rats', 0, 2)
  s.quests.claimReward(pid, 'rats')
  assert.equal(s.host.ctx.inventory.count(pid, 'key'), 1)
  assert.equal(s.host.ctx.inventory.count(s.ids[0], 'coin'), 5)
  assert.equal(s.chains.triggerEvent('onInteract', { entityId: 'door', playerId: s.ids[1] })[0].success, false)
  assert.equal(s.chains.triggerEvent('onInteract', { entityId: 'door', playerId: s.ids[0] })[0].success, true)
  assert.equal(s.host.ctx.state.doorOpen, true)
})

gate('negative control: the same quest flow with no host context sends nothing and leaves the gated chain shut', () => {
  const quests = defineQuestSystem({ quests: QUESTS, now: () => 0 }, null)
  const chains = new EventChainManager({ clock: () => 0 })
  chains.addChain({ id: 'door', trigger: { type: 'onInteract', entityId: 'door' }, conditions: [{ type: 'ifItemInInventory', itemId: 'key' }], actions: [] })
  quests.startQuest('1', 'rats')
  quests.completeObjective('1', 'rats', 0, 2)
  assert.equal(quests.claimReward('1', 'rats').ok, true)
  assert.equal(chains.triggerEvent('onInteract', { entityId: 'door', playerId: 1 })[0].success, false)
})

gate('a spawnPrefab action puts a body in the real World at the action position, tagged with its app and spawn id', () => {
  const s = setup()
  s.chains.addChain({ id: 'drop', trigger: { type: 'onTimer', timerId: 't' }, actions: [{ type: 'spawnPrefab', prefabId: 'barrel', position: [5, 6, 7], spawnEntityId: 'barrel-1', config: { hp: 3 } }] })
  const before = s.world.count
  s.chains.triggerEvent('onTimer', { timerId: 't' })
  assert.equal(s.world.count, before + 1)
  const handle = s.host.ctx.world.entity('barrel-1')
  assert.deepEqual(handle.position, [5, 6, 7])
  assert.deepEqual(handle.custom, { spawnId: 'barrel-1', app: 'barrel', config: { hp: 3 }, level: null })
})

gate('a second spawn under a taken id is refused with a named reason and adds no body', () => {
  const s = setup()
  assert.ok(s.host.ctx.world.spawn('a', { app: 'x', position: [0, 1, 0] }))
  const before = s.world.count
  assert.equal(s.host.ctx.world.spawn('a', { app: 'x', position: [9, 9, 9] }), null)
  assert.equal(s.world.count, before)
  assert.equal(s.host.lastRefusal.reason, HOST_REFUSAL.SPAWN_ID_TAKEN)
})

gate('a full World refuses the spawn: the host returns null, counts the refusal and keeps running', () => {
  const s = setup({ capacity: 2 })
  assert.ok(s.host.ctx.world.spawn('a', { position: [0, 0, 0] }))
  assert.ok(s.host.ctx.world.spawn('b', { position: [0, 0, 0] }))
  assert.equal(s.host.ctx.world.spawn('c', { position: [0, 0, 0] }), null)
  assert.equal(s.host.getStats().refusalsByReason[HOST_REFUSAL.WORLD_REFUSED], 1)
  assert.deepEqual(s.host.ctx.world.spawnedIds(), ['a', 'b'])
})

gate('a playSound action is broadcast to every connected player with the volume clamped to 1', () => {
  const s = setup()
  s.chains.addChain({ id: 'bell', trigger: { type: 'onInteract', entityId: 'bell' }, actions: [{ type: 'playSound', sound: 'bell.ogg', volume: 4 }] })
  s.chains.triggerEvent('onInteract', { entityId: 'bell' })
  for (const each of s.sockets) {
    assert.deepEqual(each.inbox.filter((message) => message.type === 'play_sound'), [{ type: 'play_sound', sound: 'bell.ogg', volume: 1, loop: false, targetEntity: 'bell' }])
  }
})

gate('a delayed action runs only after the host has ticked its delay: 0.5 s of ticks plays nothing, 1.0 s plays the sound', () => {
  const s = setup()
  s.chains.addChain({ id: 'late', trigger: { type: 'onInteract', entityId: 'x' }, actions: [{ type: 'playSound', sound: 'late.ogg', delay: 1 }] })
  s.chains.triggerEvent('onInteract', { entityId: 'x' })
  for (let i = 0; i < 5; i++) s.host.tick(0.1)
  assert.equal(s.sockets[0].inbox.length, 0)
  for (let i = 0; i < 6; i++) s.host.tick(0.1)
  assert.deepEqual(typesOf(s.sockets[0].inbox), ['play_sound'])
})

gate('a triggerAnimation action writes the animation on the player state and broadcasts it with a rising sequence', () => {
  const s = setup()
  s.chains.addChain({ id: 'wave', trigger: { type: 'onInteract', entityId: 'npc' }, actions: [{ type: 'triggerAnimation', clip: 'wave', loop: false, fade: 0.3 }] })
  s.chains.triggerEvent('onInteract', { entityId: 'npc', playerId: s.ids[1] })
  assert.deepEqual(s.playerManager.getPlayer(s.ids[1]).state.animation, { clip: 'wave', loop: false, fade: 0.3, seq: 1 })
  assert.equal(s.playerManager.getPlayer(s.ids[0]).state.animation, undefined)
  assert.deepEqual(s.sockets[0].inbox, [{ type: 'play_animation', playerId: s.ids[1], clip: 'wave', loop: false, fade: 0.3, seq: 1 }])
  s.chains.triggerEvent('onInteract', { entityId: 'npc', playerId: s.ids[1] })
  assert.equal(s.playerManager.getPlayer(s.ids[1]).state.animation.seq, 2)
})

gate('an animation aimed at a player who is not connected is refused and nothing is broadcast', () => {
  const s = setup()
  assert.equal(s.host.ctx.players.playAnimation(99, 'wave'), false)
  assert.equal(s.host.lastRefusal.reason, HOST_REFUSAL.UNKNOWN_PLAYER)
  assert.equal(s.sockets[0].inbox.length, 0)
})

gate('a loadLevel action switches the level, spawns the level entities in the World and tells every player', () => {
  const s = setup()
  s.chains.addChain({ id: 'go', trigger: { type: 'onEnterZone', zoneId: 'stairs' }, actions: [{ type: 'loadLevel', levelId: 'cellar' }] })
  s.chains.triggerEvent('onEnterZone', { zoneId: 'stairs' })
  assert.equal(s.host.ctx.state.level, 'cellar')
  assert.deepEqual(s.host.ctx.world.spawnedIds(), ['crate-1', 'crate-2'])
  assert.deepEqual(s.host.ctx.world.entity('crate-2').position, [4, 2, 3])
  assert.deepEqual(s.sockets[1].inbox, [{ type: 'load_level', levelId: 'cellar', levelEpoch: 1 }])
})

gate('loading the next level parks the bodies of the level before it and drops its looping sounds', () => {
  const s = setup()
  s.host.ctx.loadLevel('cellar')
  const crate = s.host.ctx.world.entity('crate-1')
  const crateId = crate.id
  s.host.ctx.audio.play('drip.ogg', { loop: true })
  s.host.ctx.loadLevel('tower')
  assert.deepEqual(s.world.position(crateId), [...ENTITY_PARK_OFFSET])
  assert.throws(() => crate.position, /destroyed/)
  assert.deepEqual(s.host.ctx.world.spawnedIds(), [])
  assert.deepEqual(s.host.ctx.audio.activeLoops(), [])
  assert.equal(s.host.levelEpoch, 2)
})

gate('an unknown level is refused: the level, its bodies and its loops stay and no message is sent', () => {
  const s = setup()
  s.host.ctx.loadLevel('cellar')
  const sentBefore = s.sockets[0].inbox.length
  assert.equal(s.host.ctx.loadLevel('moon'), false)
  assert.equal(s.host.ctx.state.level, 'cellar')
  assert.deepEqual(s.host.ctx.world.spawnedIds(), ['crate-1', 'crate-2'])
  assert.equal(s.sockets[0].inbox.length, sentBefore)
  assert.equal(s.host.lastRefusal.reason, HOST_REFUSAL.UNKNOWN_LEVEL)
})

gate('a player who joins late is sent the current level and each looping sound, and no one-shot sound', () => {
  const s = setup()
  s.host.ctx.loadLevel('cellar')
  s.host.ctx.audio.play('drip.ogg', { loop: true, volume: 0.4 })
  s.host.ctx.audio.play('bang.ogg')
  const late = socket()
  const lateId = s.playerManager.addPlayer(late, {})
  assert.equal(s.host.syncPlayer(lateId), 2)
  assert.deepEqual(late.inbox, [
    { type: 'load_level', levelId: 'cellar', levelEpoch: 1 },
    { type: 'play_sound', sound: 'drip.ogg', volume: 0.4, loop: true, targetEntity: null },
  ])
})

gate('the loop table holds its capacity: a third loop in a table of two drops the oldest with a warning', () => {
  const s = setup({ host: { loopCapacity: 2 } })
  for (const sound of ['a', 'b', 'c']) s.host.ctx.audio.play(sound, { loop: true })
  assert.deepEqual(s.host.ctx.audio.activeLoops().map((entry) => entry.sound), ['b', 'c'])
  assert.ok(s.host.getWarnings().some((entry) => entry.text.includes('loop capacity 2')), 'no capacity warning')
  assert.equal(s.host.ctx.audio.stop('b'), true)
  assert.deepEqual(s.host.ctx.audio.activeLoops().map((entry) => entry.sound), ['c'])
})

gate('a send to a player whose socket has closed is counted as undelivered and named, not dropped silently', () => {
  const s = setup()
  s.sockets[0].send = () => false
  s.sockets[0].isOpen = false
  assert.equal(s.host.ctx.players.send(String(s.ids[0]), { type: 'quests', questId: 'rats' }), false)
  assert.equal(s.host.getStats().undelivered, 1)
  assert.equal(s.host.lastRefusal.reason, HOST_REFUSAL.NOT_DELIVERED)
})

gate('a quest hook that throws is caught and its text lands in the host warning log with the host clock time', () => {
  const s = setup()
  const quests = defineQuestSystem({ quests: QUESTS, now: () => 0, onQuestComplete: () => { throw new Error('boom') } }, s.host.ctx)
  quests.startQuest('1', 'rats')
  quests.completeObjective('1', 'rats', 0, 2)
  const warnings = s.host.getWarnings()
  assert.equal(warnings.length, 1)
  assert.equal(warnings[0].at, 1000)
  assert.ok(warnings[0].text.includes('boom'), warnings[0].text)
})

gate('the warning log holds its capacity: 5 warnings in a log of 3 keep the last 3', () => {
  const s = setup({ host: { warningCapacity: 3 } })
  for (let i = 0; i < 5; i++) s.host.ctx.debug.warn('w' + i)
  assert.deepEqual(s.host.getWarnings().map((entry) => entry.text), ['w2', 'w3', 'w4'])
  assert.equal(s.host.getStats().warnings, 5)
})

gate('inventory refuses a bad item, a zero count and a fractional count, and changes nothing', () => {
  const s = setup()
  assert.equal(s.host.ctx.inventory.add('1', '', 1).reason, HOST_REFUSAL.ITEM)
  assert.equal(s.host.ctx.inventory.add('1', 'key', 0).reason, HOST_REFUSAL.COUNT)
  assert.equal(s.host.ctx.inventory.add('1', 'key', 1.5).reason, HOST_REFUSAL.COUNT)
  assert.deepEqual(s.host.ctx.inventory.itemsOf('1'), {})
})

gate('a chain manager bound after items were added still sees them', () => {
  const s = setup()
  s.host.ctx.inventory.add(s.ids[0], 'key', 2)
  const later = s.host.bindChains(new EventChainManager({ clock: () => 0 }))
  assert.equal(later.getInventoryItem(s.ids[0], 'key'), 2)
  assert.equal(later.getInventoryItem(String(s.ids[0]), 'key'), 2)
})

gate('the host refuses to be built without a player manager, an entity host or a clock', () => {
  const s = setup()
  const base = { playerManager: s.playerManager, entityHost: s.entityHost, now: () => 0 }
  assert.throws(() => createGameHost({ ...base, playerManager: {} }), TypeError)
  assert.throws(() => createGameHost({ ...base, entityHost: {} }), TypeError)
  assert.throws(() => createGameHost({ ...base, now: undefined }), TypeError)
  assert.throws(() => createGameHost({ ...base, loopCapacity: 0 }), RangeError)
  assert.throws(() => s.host.bindStats({}), TypeError)
})

gate('the module carries no comments and reads no host clock, console or random source', () => {
  const source = readFileSync(new URL('../src/game/hostContext.js', import.meta.url), 'utf8')
  assert.equal(source.includes('//') || source.includes('/*'), false)
  for (const hostName of ['Date', 'performance', 'process', 'console', 'globalThis', 'Math.random', 'setTimeout']) assert.equal(source.includes(hostName), false, hostName)
})

finish()
