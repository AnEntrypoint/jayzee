import assert from 'node:assert/strict'
import { finish, gate } from './lib/gate.mjs'
import { SnapshotProcessor } from '../src/client/SnapshotProcessor.js'
import { MSG } from '../src/protocol/messages.js'
import { pack, unpack } from '../src/protocol/msgpack.js'
import { FIELD_POS, FIELD_ROT } from '../src/snapshot-lod-pure/constants.js'
import { TombstoneLog } from '../src/snapshot-lod-pure/entityDelta.js'
import { SnapshotEncoder } from '../src/snapshot-lod-pure/snapshotEncoder.js'

const SNAP_HZ = 15
const VIEWER = [0, 0, 0]

const mulberry = (seed) => () => {
  seed = (seed + 0x6D2B79F5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const yawQuat = (yaw) => [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)]

function makeScene(seed, count) {
  const random = mulberry(seed)
  const entities = new Map()
  const motion = new Map()
  const spawn = (id) => {
    const ring = id % 3
    const distance = ring === 0 ? 4 + random() * 10 : ring === 1 ? 28 + random() * 20 : 90 + random() * 60
    const angle = random() * Math.PI * 2
    entities.set(id, { id, model: 'crate', position: [Math.cos(angle) * distance, 1 + random(), Math.sin(angle) * distance], rotation: yawQuat(0), velocity: [0, 0, 0], scale: [1, 1, 1], bodyType: 'dynamic', custom: null })
    motion.set(id, { yaw: 0, spin: (random() - 0.5) * 0.4, drift: [(random() - 0.5) * 0.06, (random() - 0.5) * 0.06], moves: random() < 0.8, spinsOnly: ring === 2 && random() < 0.3 })
  }
  for (let id = 1; id <= count; id++) spawn(id)
  return { random, entities, motion, spawn }
}

function stepScene(scene, tick) {
  for (const [id, e] of scene.entities) {
    const m = scene.motion.get(id)
    if (m.spinsOnly) {
      if (tick % 7 === 0) { m.yaw += m.spin; e.rotation = yawQuat(m.yaw) }
      continue
    }
    if (!m.moves) continue
    e.position[0] += m.drift[0]
    e.position[2] += m.drift[1]
    e.velocity[0] = m.drift[0] * SNAP_HZ
    e.velocity[2] = m.drift[1] * SNAP_HZ
    if (tick % 5 === id % 5) { m.yaw += m.spin; e.rotation = yawQuat(m.yaw) }
    if (tick % 37 === id % 37) e.custom = { hp: tick, tag: 'state-' + (tick % 4) }
    if (tick % 53 === id % 53) e.model = e.model === 'crate' ? 'barrel' : 'crate'
    if (tick % 61 === id % 61) e.scale = [1 + (tick % 3) * 0.5, 1, 1]
  }
}

function makeServer(scene, { scratch = true } = {}) {
  const ids = new Set(scene.entities.keys())
  const sleeping = new Set()
  const cache = SnapshotEncoder.buildDynamicCache(ids, sleeping, new Set(), scene.entities, null, null)
  const tombstones = new TombstoneLog()
  let known = SnapshotEncoder.updateTombstones(tombstones, 0, cache, null, null)
  const client = { prev: new Map(), scratch: scratch ? { entities: [], spareMap: new Map(), removed: [] } : null, lastTick: 0, seq: 0 }
  return {
    ids, sleeping, cache, client,
    remove(id, tick) {
      ids.delete(id)
      scene.entities.delete(id)
      cache.delete(id)
      known = SnapshotEncoder.updateTombstones(tombstones, tick, cache, null, known)
    },
    add(id, tick) {
      scene.spawn(id)
      ids.add(id)
      SnapshotEncoder.refreshDynamicCache(cache, ids, scene.entities, sleeping, new Set(), null)
      known = SnapshotEncoder.updateTombstones(tombstones, tick, cache, null, known)
    },
    encode(tick) {
      SnapshotEncoder.refreshDynamicCache(cache, [...ids].filter((id) => !sleeping.has(id)), scene.entities, sleeping, new Set(), null)
      const result = SnapshotEncoder.encodeDeltaFromCache(tick, tick * 66, cache, null, client.prev, [], null, null, null, client.seq, VIEWER, client.scratch, tombstones, client.lastTick, SNAP_HZ)
      const message = { type: MSG.SNAPSHOT, payload: { seq: client.seq, tick: result.encoded.tick, serverTime: result.encoded.serverTime, players: result.encoded.players, entities: result.encoded.entities, removed: result.encoded.removed, delta: 1, dots: undefined, me: undefined, chartEpoch: 0 } }
      const bytes = pack(message)
      if (client.scratch) client.scratch.spareMap = client.prev
      client.prev = result.entityMap
      client.lastTick = tick
      client.seq++
      return { bytes, entities: result.encoded.entities }
    },
  }
}

const decodeBaseline = (base) => SnapshotEncoder.decode({ players: [], entities: [base] }).entities[0]

function differenceOf(track, base) {
  const want = decodeBaseline(base)
  for (const field of ['position', 'velocity', 'scale', 'rotation']) {
    for (let i = 0; i < want[field].length; i++) if (Math.abs(track[field][i] - want[field][i]) > 1e-6) return field + ' ' + JSON.stringify(Array.from(track[field])) + ' against ' + JSON.stringify(want[field])
  }
  if (track.model !== want.model) return 'model ' + track.model + ' against ' + want.model
  if (track.bodyType !== want.bodyType) return 'bodyType'
  if (JSON.stringify(track.custom) !== JSON.stringify(want.custom)) return 'custom ' + JSON.stringify(track.custom) + ' against ' + JSON.stringify(want.custom)
  if (track.sleeping !== want.sleeping) return 'sleeping'
  return null
}

function run({ ticks, seed = 11, count = 60, drop = () => false, scratch = true, events = true }) {
  const scene = makeScene(seed, count)
  const server = makeServer(scene, { scratch })
  const processor = new SnapshotProcessor({ now: () => 0 })
  const tally = { full: 0, delta: 0, deltaBytes: 0, fullBytesIfFull: 0, rotOnlyDeltas: 0, posOnlyDeltas: 0, mismatches: [], removedSeen: 0, wireBytes: 0, baselines: new Set() }
  let nextId = count + 1
  for (let tick = 1; tick <= ticks; tick++) {
    stepScene(scene, tick)
    if (events && tick % 40 === 0) server.remove([...server.ids][tick % server.ids.size], tick)
    if (events && tick % 45 === 0) server.add(nextId++, tick)
    if (events && tick % 30 === 0) { const id = [...server.ids][0]; if (server.sleeping.has(id)) server.sleeping.delete(id); else server.sleeping.add(id) }
    const sent = server.encode(tick)
    tally.wireBytes += sent.bytes.length
    for (const record of sent.entities) {
      if (typeof record[1] === 'number') {
        tally.delta++
        tally.deltaBytes += pack(record).length
        tally.fullBytesIfFull += pack(server.cache.get(record[0]).enc).length
        if (record[1] === FIELD_ROT) tally.rotOnlyDeltas++
        if (record[1] === FIELD_POS) tally.posOnlyDeltas++
      } else if (tick > 1) tally.full++
    }
    if (drop(tick)) continue
    const payload = unpack(sent.bytes).payload
    if (payload.removed) tally.removedSeen += payload.removed.length
    processor.processSnapshot(payload, tick)
    for (const [id, tuple] of server.client.prev) {
      tally.baselines.add(tuple[3])
      const track = processor.getEntity(id)
      const difference = track ? differenceOf(track, tuple[3]) : 'the client has no entity ' + id
      if (difference !== null && tally.mismatches.length < 5) tally.mismatches.push('tick ' + tick + ' entity ' + id + ': ' + difference)
    }
    if (processor.getAllEntities().size !== server.client.prev.size && tally.mismatches.length < 5) tally.mismatches.push('tick ' + tick + ': the client holds ' + processor.getAllEntities().size + ' entities, the server baseline ' + server.client.prev.size)
  }
  return { scene, server, processor, tally }
}

gate('over 600 snapshots of 60 moving, turning, sleeping, spawning and despawning entities, the client state equals the baseline the server holds for it, entity by entity, every snapshot', () => {
  const { tally, processor } = run({ ticks: 600 })
  assert.deepEqual(tally.mismatches, [])
  assert.equal(processor.deltaFailures, 0)
  assert.ok(tally.removedSeen >= 10, 'only ' + tally.removedSeen + ' removals reached the client')
})

gate('after the first snapshot a cached entity that changed is sent as a field delta, not a full record: more than 95 in 100 sends', () => {
  const { tally } = run({ ticks: 600 })
  assert.ok(tally.delta > 5000, 'only ' + tally.delta + ' deltas were sent')
  assert.ok(tally.delta / (tally.delta + tally.full) > 0.95, tally.delta + ' deltas against ' + tally.full + ' full records')
  assert.ok(tally.posOnlyDeltas > 100, 'position-only deltas ' + tally.posOnlyDeltas)
})

gate('the field deltas cost less than 85 in 100 of the bytes the same sends would cost as full records', () => {
  const { tally } = run({ ticks: 600 })
  assert.ok(tally.deltaBytes < tally.fullBytesIfFull * 0.85, tally.deltaBytes + ' delta bytes against ' + tally.fullBytesIfFull + ' full bytes')
})

gate('the near ring is exact: every near entity on the client equals the live server record on the snapshot it was built from', () => {
  const scene = makeScene(5, 30)
  const server = makeServer(scene)
  const processor = new SnapshotProcessor({ now: () => 0 })
  let checked = 0
  for (let tick = 1; tick <= 200; tick++) {
    stepScene(scene, tick)
    processor.processSnapshot(unpack(server.encode(tick).bytes).payload, tick)
    for (const [id, e] of scene.entities) {
      if (Math.hypot(e.position[0], e.position[1], e.position[2]) >= 19) continue
      const difference = differenceOf(processor.getEntity(id), server.cache.get(id).enc)
      assert.equal(difference, null, 'tick ' + tick + ' near entity ' + id + ': ' + difference)
      checked++
    }
  }
  assert.ok(checked > 1500, 'only ' + checked + ' near checks ran')
})

gate('a far entity that only turns is not sent, and its turn reaches the client with the next delta that carries anything else', () => {
  const scene = makeScene(3, 3)
  const far = scene.entities.get(2)
  far.position = [150, 1, 0]
  for (const m of scene.motion.values()) { m.moves = false; m.spinsOnly = false }
  const server = makeServer(scene)
  const processor = new SnapshotProcessor({ now: () => 0 })
  const feed = (tick) => { const sent = server.encode(tick); processor.processSnapshot(unpack(sent.bytes).payload, tick); return sent.entities.filter((record) => record[0] === 2) }
  feed(1)
  far.rotation = yawQuat(1)
  let sends = 0
  for (let tick = 2; tick <= 40; tick++) sends += feed(tick).length
  assert.equal(sends, 0)
  assert.ok(Math.abs(processor.getEntity(2).rotation[3] - 1) < 1e-6, 'the client turned without a send')
  far.position[0] = 151
  let carried = null
  for (let tick = 41; tick <= 80 && carried === null; tick++) { const records = feed(tick); if (records.length > 0) carried = records[0] }
  assert.ok(carried !== null && (carried[1] & FIELD_ROT) !== 0 && (carried[1] & FIELD_POS) !== 0, 'the delta was ' + JSON.stringify(carried && carried[1]))
  assert.ok(Math.abs(processor.getEntity(2).rotation[3] - Math.cos(0.5)) < 1e-3, 'client w ' + processor.getEntity(2).rotation[3])
  assert.equal(differenceOf(processor.getEntity(2), server.client.prev.get(2)[3]), null)
})

gate('the per-client baselines are pooled: 600 snapshots reuse a set of baseline records no larger than three times the entity count', () => {
  const { tally, server } = run({ ticks: 600, events: false })
  assert.ok(tally.baselines.size <= 180, tally.baselines.size + ' distinct baseline records for 60 entities')
  assert.ok(server.client.scratch.baselines.length <= 60, 'free list holds ' + server.client.scratch.baselines.length)
  const unpooled = run({ ticks: 600, events: false, scratch: false })
  assert.deepEqual(unpooled.tally.mismatches, [])
  assert.ok(unpooled.tally.baselines.size > 2000, 'the unpooled run made only ' + unpooled.tally.baselines.size + ' baseline records')
  assert.equal(unpooled.tally.wireBytes, tally.wireBytes)
})

gate('negative control: a client that misses one snapshot no longer equals the server baseline, so the equality check can fail', () => {
  const { tally } = run({ ticks: 120, drop: (tick) => tick === 50, events: false })
  assert.ok(tally.mismatches.length > 0, 'a dropped snapshot left no difference')
  assert.ok(tally.mismatches[0].startsWith('tick 51'), 'first difference: ' + tally.mismatches[0])
})

gate('negative control: a client that joins mid-stream gets deltas for entities it never saw and reports each as a delta failure', () => {
  const scene = makeScene(11, 20)
  const server = makeServer(scene)
  for (let tick = 1; tick <= 10; tick++) { stepScene(scene, tick); server.encode(tick) }
  const late = new SnapshotProcessor({ now: () => 0 })
  stepScene(scene, 11)
  late.processSnapshot(unpack(server.encode(11).bytes).payload, 11)
  assert.ok(late.deltaFailures > 0, 'no delta failure was reported')
  assert.equal(late.getAllEntities().size, 0)
})

finish()
