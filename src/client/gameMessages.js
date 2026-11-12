export const GAME_MESSAGE_TYPES = Object.freeze(['play_sound', 'stop_sound', 'play_animation', 'load_level'])

export const GAME_CLIENT_REFUSAL = Object.freeze({
  SOUND: 'sound-name-not-string',
  VOLUME: 'volume-not-in-unit-range',
  CLIP: 'clip-name-not-string',
  PLAYER: 'player-id-missing',
  SEQ: 'animation-seq-not-positive-integer',
  FADE: 'fade-not-non-negative',
  LEVEL: 'level-id-not-string',
  EPOCH: 'level-epoch-not-positive-integer',
  SINK: 'sink-threw',
})

const DEFAULT_LOOP_CAPACITY = 32
const DEFAULT_PLAYER_CAPACITY = 256
const SINKS = { audio: ['play', 'stop'], animations: ['play'], levels: ['load', 'unload'] }

const isName = (value) => typeof value === 'string' && value.length > 0
const isPositiveInteger = (value) => Number.isInteger(value) && value > 0

export function createGameMessageClient({ audio, animations, levels, loopCapacity = DEFAULT_LOOP_CAPACITY, playerCapacity = DEFAULT_PLAYER_CAPACITY }) {
  const sinks = { audio, animations, levels }
  for (const [name, methods] of Object.entries(SINKS)) {
    const missing = methods.filter((method) => typeof sinks[name]?.[method] !== 'function')
    if (missing.length > 0) throw new TypeError('[game-client] ' + name + ' needs ' + missing.join(', '))
  }
  if (!Number.isInteger(loopCapacity) || loopCapacity < 1) throw new RangeError('[game-client] loopCapacity must be an integer of at least 1')
  if (!Number.isInteger(playerCapacity) || playerCapacity < 1) throw new RangeError('[game-client] playerCapacity must be an integer of at least 1')

  const loopSound = new Array(loopCapacity).fill(null)
  const loopTarget = new Array(loopCapacity).fill(null)
  const loopHandle = new Array(loopCapacity).fill(null)
  const loopOrder = new Float64Array(loopCapacity)
  const seqPlayer = new Array(playerCapacity).fill(null)
  const seqValue = new Float64Array(playerCapacity)
  const stats = { sounds: 0, loopsStarted: 0, loopsStopped: 0, loopsDropped: 0, animations: 0, staleAnimations: 0, levelLoads: 0, staleLevels: 0, refused: 0, ignored: 0 }
  const refusals = new Map()
  const options = { volume: 1, loop: false, targetEntity: null }
  const animationOptions = { loop: true, fade: 0, seq: 0 }
  let loopCount = 0
  let loopSerial = 0
  let seqCount = 0
  let level = null
  let levelEpoch = 0
  let lastRefusal = null

  const refuse = (reason, detail) => {
    stats.refused++
    refusals.set(reason, (refusals.get(reason) || 0) + 1)
    lastRefusal = { reason, detail }
    return false
  }

  const guarded = (what, call) => {
    try {
      return { ok: true, value: call() }
    } catch (error) {
      refuse(GAME_CLIENT_REFUSAL.SINK, what + ': ' + (error && error.message ? error.message : String(error)))
      return { ok: false, value: null }
    }
  }

  const loopSlot = (sound, target) => {
    for (let i = 0; i < loopCapacity; i++) if (loopSound[i] === sound && loopTarget[i] === target) return i
    return -1
  }

  const freeLoop = (i) => {
    const handle = loopHandle[i]
    const sound = loopSound[i]
    loopSound[i] = null
    loopTarget[i] = null
    loopHandle[i] = null
    loopCount--
    guarded('audio.stop ' + sound, () => audio.stop(handle))
  }

  const oldestLoop = () => {
    let at = -1
    for (let i = 0; i < loopCapacity; i++) {
      if (loopSound[i] === null) continue
      if (at === -1 || loopOrder[i] < loopOrder[at]) at = i
    }
    return at
  }

  const stopAllLoops = () => {
    for (let i = 0; i < loopCapacity; i++) {
      if (loopSound[i] === null) continue
      freeLoop(i)
      stats.loopsStopped++
    }
  }

  function playSound(message) {
    if (!isName(message.sound)) return refuse(GAME_CLIENT_REFUSAL.SOUND, 'play_sound ' + String(message.sound))
    const volume = message.volume === undefined ? 1 : message.volume
    if (!(Number.isFinite(volume) && volume >= 0 && volume <= 1)) return refuse(GAME_CLIENT_REFUSAL.VOLUME, 'play_sound volume ' + String(message.volume))
    const target = message.targetEntity ?? null
    const loop = message.loop === true
    options.volume = volume
    options.loop = loop
    options.targetEntity = target
    if (!loop) {
      if (!guarded('audio.play ' + message.sound, () => audio.play(message.sound, options)).ok) return false
      stats.sounds++
      return true
    }
    const existing = loopSlot(message.sound, target)
    if (existing !== -1) freeLoop(existing)
    if (loopCount === loopCapacity) {
      freeLoop(oldestLoop())
      stats.loopsDropped++
    }
    const started = guarded('audio.play ' + message.sound, () => audio.play(message.sound, options))
    if (!started.ok) return false
    const slot = loopSlot(null, null)
    loopSound[slot] = message.sound
    loopTarget[slot] = target
    loopHandle[slot] = started.value
    loopOrder[slot] = ++loopSerial
    loopCount++
    stats.sounds++
    stats.loopsStarted++
    return true
  }

  function stopSound(message) {
    if (!isName(message.sound)) return refuse(GAME_CLIENT_REFUSAL.SOUND, 'stop_sound ' + String(message.sound))
    const slot = loopSlot(message.sound, message.targetEntity ?? null)
    if (slot === -1) { stats.ignored++; return true }
    freeLoop(slot)
    stats.loopsStopped++
    return true
  }

  const seqSlot = (playerId) => {
    for (let i = 0; i < seqCount; i++) if (seqPlayer[i] === playerId) return i
    return -1
  }

  function playAnimation(message) {
    const playerId = message.playerId
    if (playerId === undefined || playerId === null) return refuse(GAME_CLIENT_REFUSAL.PLAYER, 'play_animation with no playerId')
    if (!isName(message.clip)) return refuse(GAME_CLIENT_REFUSAL.CLIP, 'play_animation clip ' + String(message.clip))
    if (!isPositiveInteger(message.seq)) return refuse(GAME_CLIENT_REFUSAL.SEQ, 'play_animation seq ' + String(message.seq))
    const fade = message.fade === undefined ? 0 : message.fade
    if (!(Number.isFinite(fade) && fade >= 0)) return refuse(GAME_CLIENT_REFUSAL.FADE, 'play_animation fade ' + String(message.fade))
    let slot = seqSlot(playerId)
    if (slot !== -1 && message.seq <= seqValue[slot]) { stats.staleAnimations++; return true }
    animationOptions.loop = message.loop !== false
    animationOptions.fade = fade
    animationOptions.seq = message.seq
    if (!guarded('animations.play ' + message.clip, () => animations.play(playerId, message.clip, animationOptions)).ok) return false
    if (slot === -1) {
      if (seqCount === playerCapacity) {
        let lowest = 0
        for (let i = 1; i < playerCapacity; i++) if (seqValue[i] < seqValue[lowest]) lowest = i
        slot = lowest
      } else {
        slot = seqCount++
      }
      seqPlayer[slot] = playerId
    }
    seqValue[slot] = message.seq
    stats.animations++
    return true
  }

  function loadLevel(message) {
    if (!isName(message.levelId)) return refuse(GAME_CLIENT_REFUSAL.LEVEL, 'load_level ' + String(message.levelId))
    if (!isPositiveInteger(message.levelEpoch)) return refuse(GAME_CLIENT_REFUSAL.EPOCH, 'load_level epoch ' + String(message.levelEpoch))
    if (message.levelEpoch <= levelEpoch) { stats.staleLevels++; return true }
    stopAllLoops()
    if (level !== null) guarded('levels.unload ' + level, () => levels.unload(level))
    level = null
    levelEpoch = message.levelEpoch
    if (!guarded('levels.load ' + message.levelId, () => levels.load(message.levelId, message.levelEpoch)).ok) return false
    level = message.levelId
    stats.levelLoads++
    return true
  }

  const handlers = { play_sound: playSound, stop_sound: stopSound, play_animation: playAnimation, load_level: loadLevel }

  return {
    handles(type) { return Object.hasOwn(handlers, type) },
    handle(message) {
      if (message === null || typeof message !== 'object' || Array.isArray(message)) return false
      if (typeof message.type !== 'string' || !Object.hasOwn(handlers, message.type)) return false
      handlers[message.type](message)
      return true
    },
    activeLoops() {
      const out = []
      for (let i = 0; i < loopCapacity; i++) if (loopSound[i] !== null) out.push({ sound: loopSound[i], targetEntity: loopTarget[i], order: loopOrder[i] })
      out.sort((a, b) => a.order - b.order)
      return out.map(({ sound, targetEntity }) => ({ sound, targetEntity }))
    },
    animationSeqOf(playerId) {
      const slot = seqSlot(playerId)
      return slot === -1 ? 0 : seqValue[slot]
    },
    get level() { return level },
    get levelEpoch() { return levelEpoch },
    get lastRefusal() { return lastRefusal },
    getStats() { return { ...stats, refusalsByReason: Object.fromEntries(refusals) } },
  }
}
