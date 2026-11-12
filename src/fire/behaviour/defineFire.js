import { createFireKernel, FIRE_EVENT, FIRE_STATE } from '../fireKernel.js'
import { createFireTimeline } from '../timeline.js'
import { encodeFireEvent, decodeFireEvent, FIRE_WIRE_TYPE, FIRE_SEQ_RANGE, FIRE_MAX_TICK, FIRE_MAX_ROWS_PER_MESSAGE } from '../wire.js'
import { encodeFireKeyframe, decodeFireKeyframe, keyframeToBase64, keyframeFromBase64 } from '../keyframe.js'
import { resolveFireSpec } from './spec.js'
import { createFirebreakFuel } from './terrain.js'
import { createFireWeather } from './weather.js'
import { createFireGameplay } from './gameplay.js'
import { createChecksumLedger, checkFireCell, checkFireByte, igniteAreaRadiusCells, extinguishRadiusCells, checkWindVector, parseKeyframeRow, parseChecksumRow } from './fire.js'

const NO_STAGE = 255

function optionalFunction(appCtx, name) {
  const value = appCtx[name]
  if (value === undefined || value === null) return null
  if (typeof value !== 'function') throw new TypeError(`[fire] appCtx.${name} is ${typeof value}: a terrain sampler on the app ctx is a function (x, z) or is absent`)
  return (x, z) => value.call(appCtx, x, z)
}

export function terrainAccessors(appCtx) {
  if (appCtx === null || typeof appCtx !== 'object') throw new TypeError('[fire] terrainAccessors needs the app ctx object')
  return {
    heightAt: optionalFunction(appCtx, 'terrainHeightAt'),
    seaLevelAt: optionalFunction(appCtx, 'seaLevelAt'),
    kindAt: optionalFunction(appCtx, 'terrainKindAt'),
  }
}

export function createEmitSlots() {
  let slotTick = -1
  let slotSeq = 0
  const slot = { tick: 0, seq: 0, id: 0 }
  return {
    take(earliestTick) {
      if (!Number.isSafeInteger(earliestTick) || earliestTick < 0) throw new RangeError(`[fire] an emit slot needs a non-negative integer tick, got ${earliestTick}`)
      if (earliestTick > slotTick) { slotTick = earliestTick; slotSeq = 0 }
      if (slotSeq === FIRE_SEQ_RANGE) { slotTick++; slotSeq = 0 }
      if (slotTick > FIRE_MAX_TICK) throw new RangeError(`[fire] emit tick ${slotTick} is beyond the wire limit ${FIRE_MAX_TICK}`)
      slot.tick = slotTick
      slot.seq = slotSeq++
      slot.id = slot.tick * FIRE_SEQ_RANGE + slot.seq
      return slot
    },
    get tick() { return slotTick },
    get seq() { return slotSeq },
  }
}

function checkTrunks(trunks) {
  if (trunks === null || trunks === undefined) return null
  for (const name of ['cellIdAt', 'setBurnStage']) if (typeof trunks[name] !== 'function') throw new TypeError(`[fire] the trunk streamer has no ${name} function: the fire reads each trunk's placement cell and writes its burn stage`)
  if (!Number.isInteger(trunks.capacity) || trunks.capacity < 1) throw new TypeError(`[fire] the trunk streamer states capacity ${String(trunks.capacity)}: the stage cache is sized once from a positive integer capacity`)
  return trunks
}

export function defineFire(rawSpec, env) {
  if (env === null || typeof env !== 'object') throw new TypeError('[fire] defineFire needs its environment: { appCtx, frameOf, latticeFor, trunks }')
  const { appCtx, frameOf, latticeFor } = env
  if (appCtx === null || typeof appCtx !== 'object') throw new TypeError('[fire] defineFire needs env.appCtx, the app context the behaviour is bound to')
  if (typeof appCtx.send !== 'function') throw new TypeError('[fire] appCtx.send is missing: the fire broadcasts its events through the app ctx')
  if (typeof frameOf !== 'function') throw new TypeError('[fire] defineFire needs env.frameOf, a function returning the live planet frame')
  if (typeof latticeFor !== 'function') throw new TypeError('[fire] defineFire needs env.latticeFor, a function (radius, cellsPerFireCell) returning the fire lattice')
  const spec = resolveFireSpec(rawSpec)
  const colliderContract = env.trunks !== null && env.trunks !== undefined && typeof env.trunks.setExclude === 'function'
  if (env.trunkStreamerOf !== undefined && env.trunkStreamerOf !== null && typeof env.trunkStreamerOf !== 'function') throw new TypeError('[fire] env.trunkStreamerOf is a function returning the trunk collider streamer, or is absent')
  const trunkStreamerOf = typeof env.trunkStreamerOf === 'function' ? env.trunkStreamerOf : (colliderContract ? () => env.trunks : null)
  const trunks = colliderContract ? null : checkTrunks(env.trunks)
  const warn = typeof env.warn === 'function' ? env.warn : null
  const authority = spec.role === 'authority'
  const frame0 = frameOf()
  const radius = spec.radius ?? frame0?.radius
  if (!(Number.isFinite(radius) && radius > 0)) throw new TypeError(`[fire] the fire needs a planet radius: spec.radius or the planet frame's radius must be a positive finite number, got ${String(radius)}`)
  const lattice = latticeFor(radius, spec.config.cellsPerFireCell)
  if (!lattice || typeof lattice.walk !== 'function' || typeof lattice.cellOfDir !== 'function') throw new TypeError('[fire] env.latticeFor returned no fire lattice')
  const terrain = terrainAccessors(appCtx)
  const fuelClassAt = spec.firebreaks === null ? spec.fuelClassAt : createFirebreakFuel({ baseClassAt: spec.fuelClassAt, breaks: spec.firebreaks, frame: frame0, lattice, terrain })
  const kernel = createFireKernel({
    lattice, fuelClassAt, classes: spec.classes, seed: spec.seed, stepTicks: spec.config.stepTicks, maxTiles: spec.config.maxTiles,
    softActiveCells: spec.config.softActiveCells, maxActiveCells: spec.config.maxActiveCells, regrowSteps: spec.config.regrowSteps,
    regrowFuelFraction: spec.config.regrowFuelFraction, windAt: spec.windField, undo: spec.rewind,
  })
  const timeline = createFireTimeline({ kernel, windowSteps: spec.config.windowSteps, keepSnapshots: spec.rewind })
  const ledger = createChecksumLedger()
  const slots = createEmitSlots()
  const readWeather = spec.weather === null ? null : (spec.weather.source ?? (typeof appCtx.weather === 'function' ? () => appCtx.weather() : null))
  if (spec.weather !== null && authority && readWeather === null) throw new TypeError('[fire] spec.weather needs a weather reading: pass spec.weather.source or expose weather() on the app ctx')
  const weather = spec.weather === null || !authority ? null : createFireWeather({ config: spec.weather, readWeather, stepTicks: spec.config.stepTicks, wind: spec.wind })
  const weatherOut = { rain: -1, moisture: -1, wind: null }
  const cellScratch = { face: 0, I: 0, J: 0 }
  const outbox = new Array(FIRE_MAX_ROWS_PER_MESSAGE).fill(null)
  let outCount = 0
  const checksumRows = []
  const stats = { emitted: 0, messages: 0, received: 0, refused: 0, trunkWrites: 0, trunkRefreshes: 0, checksums: 0, keyframesAdopted: 0, collidersSwept: 0, colliderRefreshes: 0, colliderRefreshFailures: 0 }
  let simTick = 0
  let started = false
  const checksumPeriodTicks = spec.config.stepTicks * spec.config.checksumEverySteps
  let ledgerRewinds = 0

  const trunkStage = trunks === null ? null : new Uint8Array(trunks.capacity).fill(NO_STAGE)
  const trunkFace = trunks === null ? null : new Uint8Array(trunks.capacity)
  const trunkI = trunks === null ? null : new Int32Array(trunks.capacity)
  const trunkJ = trunks === null ? null : new Int32Array(trunks.capacity)
  let trunkCount = 0
  let trunkGeneration = -1
  let trunkSerial = -1
  let trunkRewinds = 0

  function cellOfPosition(position, out = cellScratch) {
    const frame = frameOf()
    const dir = frame.localToDir(position[0], position[2], position[1])
    return lattice.cellOfDir(dir[0], dir[1], dir[2], out)
  }

  function flush() {
    if (outCount === 0 && checksumRows.length === 0) return
    const message = { type: FIRE_WIRE_TYPE }
    if (outCount > 0) message.rows = outbox.slice(0, outCount)
    if (checksumRows.length > 0) message.checksums = checksumRows.splice(0, checksumRows.length)
    outCount = 0
    stats.messages++
    appCtx.send(message)
  }

  function emit(event) {
    if (!authority) throw new Error('[fire] a mirror does not emit fire events: it applies the rows the authority sends, so this call belongs on the authority')
    if (!started) throw new Error('[fire] emit before start: an event emitted before the fire starts would be dropped by the timeline, so start the fire first')
    const slot = slots.take(simTick + spec.config.leadTicks)
    event.tick = slot.tick
    event.seq = slot.seq
    event.id = slot.id
    const result = timeline.submit(event)
    if (!result.ok) throw new Error(`[fire] the timeline refused an emitted event at tick ${event.tick}: ${result.reason}`)
    outbox[outCount++] = encodeFireEvent(lattice, event)
    stats.emitted++
    if (outCount === FIRE_MAX_ROWS_PER_MESSAGE) flush()
    return event.id
  }

  function start(tick = 0) {
    if (started) throw new Error('[fire] the fire is already started')
    if (!Number.isSafeInteger(tick) || tick < 0) throw new RangeError(`[fire] start needs a non-negative integer tick, got ${tick}`)
    timeline.startAt(tick)
    simTick = tick
    started = true
    if (!authority) return
    if (spec.wind[0] !== 0 || spec.wind[1] !== 0 || spec.wind[2] !== 0) emit({ kind: FIRE_EVENT.WIND, wx: spec.wind[0], wy: spec.wind[1], wz: spec.wind[2] })
    if (spec.moisture !== 0) emit({ kind: FIRE_EVENT.MOISTURE, value: spec.moisture })
    if (spec.rain !== 0) emit({ kind: FIRE_EVENT.RAIN, value: spec.rain })
  }

  function syncWeather(tick) {
    if (weather === null) return 0
    const pending = weather.step(tick, weatherOut)
    if (pending === null) return 0
    let sent = 0
    const rain = pending.rain >= 0 ? pending.rain : weather.emittedRain
    const moisture = pending.moisture >= 0 ? pending.moisture : weather.emittedMoisture
    const wind = pending.wind !== null ? pending.wind : weather.emittedWind
    if (pending.rain >= 0) { emit({ kind: FIRE_EVENT.RAIN, value: pending.rain }); sent++ }
    if (pending.moisture >= 0) { emit({ kind: FIRE_EVENT.MOISTURE, value: pending.moisture }); sent++ }
    if (pending.wind !== null) { emit({ kind: FIRE_EVENT.WIND, wx: pending.wind[0], wy: pending.wind[1], wz: pending.wind[2] }); sent++ }
    if (sent > 0) weather.markEmitted(rain, moisture, wind)
    return sent
  }

  function writeTrunk(i) {
    const stage = kernel.stateCodeAt(trunkFace[i], trunkI[i], trunkJ[i])
    if (stage === trunkStage[i]) return
    trunkStage[i] = stage
    trunks.setBurnStage(i, stage)
    stats.trunkWrites++
  }

  function refreshTrunks() {
    if (trunks === null) return 0
    const count = trunks.count
    if (!Number.isInteger(count) || count < 0 || count > trunks.capacity) throw new RangeError(`[fire] the trunk streamer reports ${String(count)} trunks for a capacity of ${trunks.capacity}`)
    for (let i = 0; i < count; i++) {
      lattice.cellOfPlacementId(trunks.cellIdAt(i), cellScratch)
      trunkFace[i] = cellScratch.face
      trunkI[i] = cellScratch.I
      trunkJ[i] = cellScratch.J
      trunkStage[i] = NO_STAGE
    }
    trunkCount = count
    trunkGeneration = trunks.generation
    trunkSerial = kernel.changeSerial
    trunkRewinds = timeline.stats.rewinds
    for (let i = 0; i < count; i++) writeTrunk(i)
    stats.trunkRefreshes++
    return count
  }

  function syncTrunks() {
    if (trunks === null) return 0
    if (trunks.generation !== trunkGeneration || trunks.count !== trunkCount || timeline.stats.rewinds !== trunkRewinds) return refreshTrunks()
    if (kernel.changeSerial === trunkSerial) return 0
    trunkSerial = kernel.changeSerial
    const before = stats.trunkWrites
    for (let i = 0; i < trunkCount; i++) writeTrunk(i)
    return stats.trunkWrites - before
  }

  let colliderStreamer = null
  let colliderSerial = -1
  let colliderScars = 0
  const charScratch = { face: 0, I: 0, J: 0 }

  function isTrunkCharred(trunkId) {
    if (kernel.activeCount === 0 && kernel.scarCount === 0) return false
    lattice.cellOfPlacementId(trunkId, charScratch)
    return kernel.stateCodeAt(charScratch.face, charScratch.I, charScratch.J) === FIRE_STATE.BURNT
  }

  function refreshTrunkColliders() {
    stats.colliderRefreshes++
    const pending = colliderStreamer.refresh()
    if (pending && typeof pending.then === 'function') {
      pending.then(null, (error) => {
        stats.colliderRefreshFailures++
        if (warn !== null) warn('[fire] trunk collider refresh failed and the ring is left partial: ' + (error && error.message ? error.message : String(error)))
      })
    }
  }

  function syncTrunkColliders() {
    if (trunkStreamerOf === null) return 0
    if (colliderStreamer === null) {
      const streamer = trunkStreamerOf()
      if (!streamer || typeof streamer.setExclude !== 'function') return 0
      for (const name of ['sweepExcluded', 'refresh']) if (typeof streamer[name] !== 'function') throw new TypeError(`[fire] the trunk collider streamer has no ${name} function: the fire sweeps charred trunks out and refreshes the ring when cells regrow`)
      colliderStreamer = streamer
      streamer.setExclude(isTrunkCharred)
    }
    if (kernel.changeSerial === colliderSerial) return 0
    colliderSerial = kernel.changeSerial
    const swept = colliderStreamer.sweepExcluded()
    stats.collidersSwept += swept
    if (kernel.scarCount < colliderScars) refreshTrunkColliders()
    colliderScars = kernel.scarCount
    return swept
  }

  const gameplay = spec.gameplay === null ? null : createFireGameplay({
    gameplay: spec.gameplay,
    getWorld: () => ({ kernel, lattice }),
    cellOfPosition: (position) => cellOfPosition(position),
    frameOf,
    targets: () => (spec.gameplay.targets ? spec.gameplay.targets(appCtx) : (typeof appCtx.fireTargets === 'function' ? appCtx.fireTargets() : [])),
    io: {
      sendEntity: (id, message) => appCtx.sendEntity(id, message),
      sendPlayer: (id, message) => appCtx.sendPlayer(id, message),
      applyImpulse: (id, impulse) => appCtx.applyImpulse(id, impulse),
    },
  })

  function noteChecksum() {
    if (simTick % checksumPeriodTicks !== 0) return
    if (timeline.stats.rewinds !== ledgerRewinds) { ledgerRewinds = timeline.stats.rewinds; ledger.clear() }
    const hash = kernel.checksum()
    ledger.rememberLocal(simTick, hash)
    stats.checksums++
    if (authority) checksumRows.push([simTick, hash])
  }

  function tick(tickNumber, dtSeconds) {
    if (!started) throw new Error('[fire] tick before start: the fire is started at the tick its world begins')
    if (!Number.isSafeInteger(tickNumber) || tickNumber < simTick) throw new RangeError(`[fire] tick ${tickNumber} is behind the fire at ${simTick}`)
    while (simTick < tickNumber) {
      const next = simTick + 1
      if (authority) syncWeather(next)
      timeline.advanceTo(next)
      simTick = next
      noteChecksum()
      if (gameplay !== null && authority) gameplay.tickDamage(next, dtSeconds)
    }
    if (!authority) ledger.compare(simTick)
    syncTrunks()
    syncTrunkColliders()
    flush()
  }

  function igniteCell(face, I, J, source = 0) {
    checkFireCell(lattice, face, I, J, 'ignite')
    const id = emit({ kind: FIRE_EVENT.IGNITE, face, I, J, source: checkFireByte(source, 'ignite source') })
    if (typeof rawSpec.onIgnite === 'function') rawSpec.onIgnite({ face, I, J, id })
    return id
  }

  function ignite(position, source = 0) {
    const c = cellOfPosition(position)
    return igniteCell(c.face, c.I, c.J, source)
  }

  function igniteArea(position, radiusM) {
    const radius = igniteAreaRadiusCells(radiusM, lattice.cellM)
    const c = cellOfPosition(position)
    const id = emit({ kind: FIRE_EVENT.IGNITE_AREA, face: c.face, I: c.I, J: c.J, radius })
    if (typeof rawSpec.onIgnite === 'function') rawSpec.onIgnite({ face: c.face, I: c.I, J: c.J, radius, id })
    return id
  }

  function extinguish(position, radiusM = 0) {
    const radius = extinguishRadiusCells(radiusM, lattice.cellM)
    const c = cellOfPosition(position)
    const id = emit({ kind: FIRE_EVENT.EXTINGUISH, face: c.face, I: c.I, J: c.J, radius })
    if (typeof rawSpec.onExtinguish === 'function') rawSpec.onExtinguish({ face: c.face, I: c.I, J: c.J, radius, id })
    return id
  }

  function setWind(vector) {
    checkWindVector(vector)
    return emit({ kind: FIRE_EVENT.WIND, wx: vector[0], wy: vector[1], wz: vector[2] })
  }

  function keyframe() {
    const snapshot = kernel.snapshot()
    const bytes = encodeFireKeyframe({ tick: simTick, snapshot, log: timeline.log.filter((e) => e.tick > simTick) })
    return { type: FIRE_WIRE_TYPE, keyframe: [simTick, kernel.checksum(), keyframeToBase64(bytes)] }
  }

  function adoptKeyframe(row) {
    const { tick: frameTick, hash, b64 } = parseKeyframeRow(row)
    const decoded = decodeFireKeyframe(keyframeFromBase64(b64))
    if (decoded.tick !== frameTick) throw new TypeError(`[fire] keyframe row states tick ${frameTick} but its payload carries tick ${decoded.tick}`)
    const adopted = timeline.adopt(decoded.snapshot, decoded.tick)
    if (!adopted.ok) throw new Error(`[fire] the keyframe at tick ${frameTick} was not adopted: ${adopted.reason}`)
    if (kernel.checksum() !== hash) throw new Error(`[fire] the keyframe at tick ${frameTick} restored to checksum ${kernel.checksum()}, the authority stated ${hash}`)
    for (const ev of decoded.log) timeline.submit(ev)
    simTick = decoded.tick
    started = true
    ledger.clear()
    ledgerRewinds = timeline.stats.rewinds
    stats.keyframesAdopted++
    refreshTrunks()
  }

  function receive(message) {
    if (message === null || typeof message !== 'object' || message.type !== FIRE_WIRE_TYPE) return false
    if (authority) throw new Error('[fire] the authority received a fire message: fire rows flow from the authority to its mirrors only')
    if (message.keyframe !== undefined) adoptKeyframe(message.keyframe)
    if (message.rows !== undefined) {
      if (!Array.isArray(message.rows) || message.rows.length > FIRE_MAX_ROWS_PER_MESSAGE) throw new TypeError(`[fire] a fire message carries at most ${FIRE_MAX_ROWS_PER_MESSAGE} rows in an array`)
      for (const row of message.rows) {
        const result = timeline.submit(decodeFireEvent(lattice, row))
        stats.received++
        if (!result.ok) stats.refused++
      }
    }
    if (message.checksums !== undefined) {
      if (!Array.isArray(message.checksums)) throw new TypeError('[fire] fire checksums are an array of [tick, hash] rows')
      for (const row of message.checksums) { const c = parseChecksumRow(row); ledger.receiveRemote(c.tick, c.hash) }
      ledger.compare(simTick)
    }
    syncTrunks()
    syncTrunkColliders()
    return true
  }

  return {
    role: spec.role,
    spec,
    kernel,
    lattice,
    timeline,
    ledger,
    weather,
    gameplay,
    terrain,
    stats,
    slots,
    start,
    tick,
    emit,
    flush,
    ignite,
    igniteCell,
    igniteArea,
    extinguish,
    setWind,
    setMoisture: (value) => emit({ kind: FIRE_EVENT.MOISTURE, value: checkFireByte(value, 'moisture') }),
    setRain: (value) => emit({ kind: FIRE_EVENT.RAIN, value: checkFireByte(value, 'rain') }),
    cellOfPosition,
    stateAt: (position) => { const c = cellOfPosition(position); return kernel.stateCodeAt(c.face, c.I, c.J) },
    isBurningAt: (position) => { const c = cellOfPosition(position); return kernel.stateCodeAt(c.face, c.I, c.J) === FIRE_STATE.BURNING },
    syncWeather,
    syncTrunks,
    syncTrunkColliders,
    isTrunkCharred,
    refreshTrunks,
    keyframe,
    receive,
    get tickNumber() { return simTick },
    get trunkCount() { return trunkCount },
  }
}
