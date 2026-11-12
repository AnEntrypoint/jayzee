import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { finish, gate } from './lib/gate.mjs'
import { createEntityHost } from '../src/apps/entityHost.js'
import { GAME_CLIENT_REFUSAL, GAME_MESSAGE_TYPES, createGameMessageClient } from '../src/client/gameMessages.js'
import { EventChainManager } from '../src/game/EventChainManager.js'
import { createGameHost } from '../src/game/hostContext.js'
import { PlayerManager } from '../src/netcode/playerManager.js'
import { unpack } from '../src/protocol/msgpack.js'
import { World } from '../src/world/World.js'

const LEVELS = {
  cellar: { spawn: [{ id: 'crate-1', app: 'crate', position: [1, 2, 3] }] },
  tower: { spawn: [] },
}

function makeClient(options = {}) {
  const log = []
  let nextHandle = 1
  const audio = {
    play(sound, { volume, loop, targetEntity }) {
      if (options.audioThrows) throw new Error('no audio device')
      const handle = nextHandle++
      log.push(['audio.play', sound, volume, loop, targetEntity, handle])
      return handle
    },
    stop(handle) { log.push(['audio.stop', handle]) },
  }
  const animations = { play(playerId, clip, { loop, fade, seq }) { log.push(['animations.play', playerId, clip, loop, fade, seq]) } }
  const levels = {
    load(levelId, levelEpoch) { log.push(['levels.load', levelId, levelEpoch]) },
    unload(levelId) { log.push(['levels.unload', levelId]) },
  }
  const client = createGameMessageClient({ audio, animations, levels, ...options.client })
  return { client, log }
}

function setup(options = {}) {
  let nowMs = 1000
  const now = () => nowMs
  const playerManager = new PlayerManager({ now, log: () => {} })
  const entityHost = createEntityHost(new World({ capacity: 16 }))
  const host = createGameHost({ playerManager, entityHost, levels: LEVELS, now })
  const chains = host.bindChains(new EventChainManager({ clock: now }))
  const connect = () => {
    const made = makeClient(options)
    const unhandled = []
    const socket = { isOpen: true, send(data) { const message = unpack(data); if (!made.client.handle(message)) unhandled.push(message); return true } }
    const id = playerManager.addPlayer(socket, { position: [0, 0, 0] })
    return { ...made, id, unhandled }
  }
  const first = connect()
  const second = connect()
  return { host, chains, playerManager, first, second, connect }
}

gate('the client handles the four host message types and no other', () => {
  const { client } = makeClient()
  assert.deepEqual([...GAME_MESSAGE_TYPES], ['play_sound', 'stop_sound', 'play_animation', 'load_level'])
  for (const type of GAME_MESSAGE_TYPES) assert.equal(client.handles(type), true)
  assert.equal(client.handles('quest_update'), false)
  assert.equal(client.handle({ type: 'quest_update' }), false)
  assert.equal(client.handle(null), false)
  assert.equal(client.handle([1]), false)
})

gate('a playSound chain action on the host reaches each client audio sink over the wire with the volume clamped to 1', () => {
  const s = setup()
  s.chains.addChain({ id: 'bang', trigger: { type: 'onEnterZone', zoneId: 'door' }, actions: [{ type: 'playSound', sound: 'bang.ogg', volume: 7 }] })
  s.chains.triggerEvent('onEnterZone', { zoneId: 'door' })
  assert.deepEqual(s.first.log, [['audio.play', 'bang.ogg', 1, false, null, 1]])
  assert.deepEqual(s.second.log, [['audio.play', 'bang.ogg', 1, false, null, 1]])
  assert.deepEqual(s.first.client.activeLoops(), [])
  assert.equal(s.first.client.getStats().sounds, 1)
})

gate('a looping sound started on the host is held by the client until the host stops it', () => {
  const s = setup()
  s.host.ctx.audio.play('drip.ogg', { loop: true, volume: 0.4, targetEntity: 'pipe' })
  assert.deepEqual(s.first.client.activeLoops(), [{ sound: 'drip.ogg', targetEntity: 'pipe' }])
  assert.equal(s.host.ctx.audio.stop('drip.ogg', 'pipe'), true)
  assert.deepEqual(s.first.log, [['audio.play', 'drip.ogg', 0.4, true, 'pipe', 1], ['audio.stop', 1]])
  assert.deepEqual(s.first.client.activeLoops(), [])
})

gate('a loop that is played again replaces the first voice, so a late-join replay never doubles a sound', () => {
  const s = setup()
  s.host.ctx.loadLevel('cellar')
  s.host.ctx.audio.play('drip.ogg', { loop: true })
  assert.equal(s.host.syncPlayer(s.first.id), 2)
  assert.deepEqual(s.first.client.activeLoops(), [{ sound: 'drip.ogg', targetEntity: null }])
  assert.deepEqual(s.first.log.filter((entry) => entry[0].startsWith('audio')), [['audio.play', 'drip.ogg', 1, true, null, 1], ['audio.stop', 1], ['audio.play', 'drip.ogg', 1, true, null, 2]])
  assert.deepEqual(s.first.log.filter((entry) => entry[0] === 'levels.load'), [['levels.load', 'cellar', 1]])
  assert.equal(s.first.client.getStats().staleLevels, 1)
})

gate('a player who joins late is brought to the host level and its looping sounds, and hears no one-shot sound', () => {
  const s = setup()
  s.host.ctx.loadLevel('cellar')
  s.host.ctx.audio.play('drip.ogg', { loop: true, volume: 0.4 })
  s.host.ctx.audio.play('bang.ogg')
  const late = s.connect()
  assert.equal(s.host.syncPlayer(late.id), 2)
  assert.deepEqual(late.log, [['levels.load', 'cellar', 1], ['audio.play', 'drip.ogg', 0.4, true, null, 1]])
  assert.equal(late.client.level, s.host.ctx.state.level)
  assert.equal(late.client.levelEpoch, s.host.levelEpoch)
  assert.deepEqual(late.client.activeLoops(), s.host.ctx.audio.activeLoops().map(({ sound, targetEntity }) => ({ sound, targetEntity })))
})

gate('a loadLevel chain action unloads the level before it and stops its loops on the client, as the host drops them', () => {
  const s = setup()
  s.host.ctx.loadLevel('cellar')
  s.host.ctx.audio.play('drip.ogg', { loop: true })
  s.chains.addChain({ id: 'up', trigger: { type: 'onEnterZone', zoneId: 'stairs' }, actions: [{ type: 'loadLevel', levelId: 'tower' }] })
  s.chains.triggerEvent('onEnterZone', { zoneId: 'stairs' })
  assert.deepEqual(s.first.log, [['levels.load', 'cellar', 1], ['audio.play', 'drip.ogg', 1, true, null, 1], ['audio.stop', 1], ['levels.unload', 'cellar'], ['levels.load', 'tower', 2]])
  assert.deepEqual([s.first.client.level, s.first.client.levelEpoch], ['tower', 2])
  assert.deepEqual(s.first.client.activeLoops(), [])
  assert.deepEqual(s.host.ctx.audio.activeLoops(), [])
})

gate('a load_level that arrives late or twice is ignored: the client stays on the newer level', () => {
  const { client, log } = makeClient()
  client.handle({ type: 'load_level', levelId: 'tower', levelEpoch: 2 })
  client.handle({ type: 'load_level', levelId: 'cellar', levelEpoch: 1 })
  client.handle({ type: 'load_level', levelId: 'tower', levelEpoch: 2 })
  assert.deepEqual(log, [['levels.load', 'tower', 2]])
  assert.deepEqual([client.level, client.getStats().staleLevels], ['tower', 2])
})

gate('a triggerAnimation chain action plays on each client with the host fade and a rising sequence, and a stale sequence is dropped', () => {
  const s = setup()
  s.chains.addChain({ id: 'wave', trigger: { type: 'onInteract', entityId: 'npc' }, actions: [{ type: 'triggerAnimation', clip: 'wave' }] })
  s.chains.triggerEvent('onInteract', { entityId: 'npc', playerId: s.second.id })
  s.host.ctx.players.playAnimation(s.second.id, 'bow', { loop: false, fade: 0.5 })
  assert.deepEqual(s.first.log, [['animations.play', s.second.id, 'wave', true, 0.15, 1], ['animations.play', s.second.id, 'bow', false, 0.5, 2]])
  assert.equal(s.first.client.animationSeqOf(s.second.id), 2)
  assert.equal(s.first.client.handle({ type: 'play_animation', playerId: s.second.id, clip: 'wave', loop: true, fade: 0.15, seq: 1 }), true)
  assert.equal(s.first.log.length, 2)
  assert.equal(s.first.client.getStats().staleAnimations, 1)
  assert.equal(s.first.client.animationSeqOf(s.first.id), 0)
})

gate('the loop table holds its capacity: a third loop in a table of two stops the oldest voice', () => {
  const { client, log } = makeClient({ client: { loopCapacity: 2 } })
  for (const sound of ['a.ogg', 'b.ogg', 'c.ogg']) client.handle({ type: 'play_sound', sound, volume: 1, loop: true, targetEntity: null })
  assert.deepEqual(client.activeLoops(), [{ sound: 'b.ogg', targetEntity: null }, { sound: 'c.ogg', targetEntity: null }])
  assert.deepEqual(log[2], ['audio.stop', 1])
  assert.equal(client.getStats().loopsDropped, 1)
})

gate('malformed messages are consumed, refused with a named reason and reach no sink', () => {
  const { client, log } = makeClient()
  const cases = [
    [{ type: 'play_sound', sound: 5 }, GAME_CLIENT_REFUSAL.SOUND],
    [{ type: 'play_sound', sound: 'a.ogg', volume: 2 }, GAME_CLIENT_REFUSAL.VOLUME],
    [{ type: 'stop_sound' }, GAME_CLIENT_REFUSAL.SOUND],
    [{ type: 'play_animation', clip: 'wave', seq: 1 }, GAME_CLIENT_REFUSAL.PLAYER],
    [{ type: 'play_animation', playerId: 1, clip: '', seq: 1 }, GAME_CLIENT_REFUSAL.CLIP],
    [{ type: 'play_animation', playerId: 1, clip: 'wave', seq: 0 }, GAME_CLIENT_REFUSAL.SEQ],
    [{ type: 'play_animation', playerId: 1, clip: 'wave', seq: 1, fade: -1 }, GAME_CLIENT_REFUSAL.FADE],
    [{ type: 'load_level', levelId: null, levelEpoch: 1 }, GAME_CLIENT_REFUSAL.LEVEL],
    [{ type: 'load_level', levelId: 'cellar', levelEpoch: 1.5 }, GAME_CLIENT_REFUSAL.EPOCH],
  ]
  for (const [message, reason] of cases) {
    assert.equal(client.handle(message), true)
    assert.equal(client.lastRefusal.reason, reason)
  }
  assert.deepEqual(log, [])
  assert.equal(client.getStats().refused, cases.length)
})

gate('a sink that throws is caught and named, and the client keeps handling messages', () => {
  const { client } = makeClient({ audioThrows: true })
  assert.equal(client.handle({ type: 'play_sound', sound: 'a.ogg', volume: 1, loop: true, targetEntity: null }), true)
  assert.equal(client.lastRefusal.reason, GAME_CLIENT_REFUSAL.SINK)
  assert.deepEqual(client.activeLoops(), [])
  assert.equal(client.handle({ type: 'load_level', levelId: 'cellar', levelEpoch: 1 }), true)
  assert.equal(client.level, 'cellar')
})

gate('the client refuses to be built without an audio, animation or level sink', () => {
  const sinks = { audio: { play() {}, stop() {} }, animations: { play() {} }, levels: { load() {}, unload() {} } }
  assert.throws(() => createGameMessageClient({ ...sinks, audio: { play() {} } }), /audio needs stop/)
  assert.throws(() => createGameMessageClient({ ...sinks, animations: null }), /animations needs play/)
  assert.throws(() => createGameMessageClient({ ...sinks, levels: {} }), /levels needs load, unload/)
  assert.throws(() => createGameMessageClient({ ...sinks, loopCapacity: 0 }), /loopCapacity/)
})

gate('negative control: a socket with no game client leaves every host effect unhandled', () => {
  const s = setup()
  const inbox = []
  s.playerManager.addPlayer({ isOpen: true, send(data) { inbox.push(unpack(data)); return true } }, {})
  s.host.ctx.loadLevel('cellar')
  s.host.ctx.audio.play('bang.ogg')
  assert.deepEqual(inbox.map((message) => message.type), ['load_level', 'play_sound'])
  assert.deepEqual(s.first.unhandled, [])
  assert.equal(s.first.log.length, 2)
})

gate('the module carries no comments and reads no host clock, console or random source', () => {
  const source = readFileSync(new URL('../src/client/gameMessages.js', import.meta.url), 'utf8')
  assert.equal(/\/\/|\/\*/.test(source), false)
  assert.equal(/Date\.now|performance\.|console\.|Math\.random/.test(source), false)
})

finish()
