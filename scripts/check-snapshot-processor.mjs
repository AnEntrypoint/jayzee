import { gate, finish } from './lib/gate.mjs'
import {
  SnapshotProcessor,
  REDUCED_TIER_ABSENCE_GRACE_SNAPSHOTS,
  SNAPSHOT_RELEASE_WINDOW,
  DELTA_FAILURES_BEFORE_FULL_REQUEST,
  FIELD_POS,
  FIELD_VEL,
  FIELD_SLEEP,
  isReducedPlayerPose
} from '../src/client/SnapshotProcessor.js'
import { packGroundNormal, unpackGroundNormal } from '../src/wire/groundNormalWire.js'
import { hasInputDepth, inputDepthFromWire, NO_INPUT_DEPTH } from '../src/wire/inputDepthWire.js'
import { packWallPlanes, unpackWallPlanes } from '../src/wire/wallPlaneWire.js'
import * as selfBlock from '../src/snapshot-lod-pure/selfBlock.js'
import { encodePlayer, encodeReducedPlayer } from '../src/snapshot-lod-pure/playerLod.js'
import { encodeEntity } from '../src/snapshot-lod-pure/entityDelta.js'

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}
const near = (a, b, epsilon = 1e-12) => Math.abs(a - b) <= epsilon
const sameArray = (a, b, epsilon) => a.length === b.length && a.every((value, index) => near(value, b[index], epsilon))
const show = (value) => JSON.stringify(value)
const throwsRange = (fn, pattern) => {
  try {
    fn()
  } catch (error) {
    return error instanceof RangeError && pattern.test(error.message)
  }
  return false
}
const throwsType = (fn, pattern) => {
  try {
    fn()
  } catch (error) {
    return error instanceof TypeError && pattern.test(error.message)
  }
  return false
}

const quat = [0.1, 0.7, -0.1, Math.sqrt(1 - 0.01 - 0.49 - 0.01)]
const decodedQuat = [0.09963148384624532, 0.6999171380512605, -0.09963148384624554, 0.7001879281416693]
const selfPose = { id: 7, position: [1.234, 5.5, -3.21], rotation: quat, velocity: [0.5, -2, 3.333], onGround: true, health: 88, crouch: 1, lookPitch: 0.4, lookYaw: 1.2, expr: 3, weapon: 2 }
const farPose = { id: 9, position: [40, 2, 60], rotation: [0, 0, 0, 1], velocity: [0, 0, 0], lookYaw: 2.5 }
const box = { id: 'box', model: 'm.glb', position: [3, 4, 5], rotation: quat, velocity: [1, 0, 0], scale: [2, 1, 0.5], bodyType: 'dynamic', custom: { a: 1 }, _dynSleeping: true }
const me = selfBlock.encodeSelfBlock({ inputSequence: 42, inputBuffer: 3, groundNormal: [0.3, 0.9, -0.2], wallNormals: [1, 0, 0.6, 0.8], position: [1.234, 5.5, -3.21] })

const events = []
const callbacks = {
  onPlayerJoined: (id) => events.push('join:' + id),
  onPlayerLeft: (id) => events.push('left:' + id),
  onEntityAdded: (id) => events.push('add:' + id),
  onEntityRemoved: (id) => events.push('rm:' + id),
  onDeltaCorruption: (id) => events.push('corrupt:' + id),
  onFullSnapshotRequested: () => events.push('full')
}
const processor = new SnapshotProcessor({ callbacks })
const first = processor.processSnapshot({ tick: 1, timestamp: 1000, players: [encodePlayer(selfPose), encodeReducedPlayer(farPose)], entities: [encodeEntity(box)], me }, 1, 7)
const firstJson = show(first)
const movedBin = encodeEntity({ ...box, position: [9, 9, 9], velocity: [0, 2, 0], scale: [5, 5, 5] })[2]
const second = processor.processSnapshot({ tick: 2, timestamp: 1100, delta: 1, players: [encodePlayer(selfPose)], entities: [['box', FIELD_POS | FIELD_VEL, movedBin], ['ghost', FIELD_POS, movedBin]] }, 2, 7)
const third = processor.processSnapshot({ tick: 3, timestamp: 1200, players: [{ id: 11, position: [1, 2, 3], inputBuffer: 300 }], entities: [{ id: 'o', model: 'x' }] }, 3, 7)
const eventsAfterThree = events.join(',')

const wireSweep = []
for (let a = -1.25; a <= 1.25; a += 0.125) {
  for (let b = -1.25; b <= 1.25; b += 0.375) wireSweep.push([a, b])
}

gate('groundNormalWire: [0.3, 0.9, -0.2] packs to 0x26e7 and unpacks to x and z over 127 with y rebuilt from the unit length, as spoint', () => {
  const packed = packGroundNormal([0.3, 0.9, -0.2])
  assert(packed === ((38 << 8) | (-25 & 0xff)), 'packed ' + packed)
  const out = unpackGroundNormal(packed, [0, 0, 0])
  assert(sameArray(out, [38 / 127, Math.sqrt(1 - (38 / 127) ** 2 - (25 / 127) ** 2), -25 / 127]), show(out))
  assert(packGroundNormal(null) === 0 && packGroundNormal([NaN, 1, Infinity]) === 0, 'missing or non-finite axes must pack to 0')
  assert(packGroundNormal([5, 0, -5]) === ((127 << 8) | (-127 & 0xff)), 'axes must clamp to plus or minus 127')
  assert(sameArray(unpackGroundNormal(packGroundNormal([1, 0, 1]), [0, 0, 0]), [1, 0, 1]), 'y must clamp to 0 when x and z exceed the unit circle')
})

gate('inputDepthWire: only whole numbers 0 to 255 are depths, anything else reads as NO_INPUT_DEPTH (-1)', () => {
  assert(NO_INPUT_DEPTH === -1, 'NO_INPUT_DEPTH ' + NO_INPUT_DEPTH)
  assert([0, 3, 255].every(hasInputDepth), 'valid depth refused')
  assert(![256, -1, 1.5, '3', null, undefined, NaN].some(hasInputDepth), 'invalid depth accepted')
  assert(inputDepthFromWire(300) === -1 && inputDepthFromWire(12) === 12, 'inputDepthFromWire')
})

gate('wallPlaneWire: normals pack with a millimetre offset along the quantized normal, and a zero normal is skipped', () => {
  const wire = packWallPlanes([1, 0, 0.6, 0.8, 0, 0], [1.234, 5.5, -3.21])
  assert(show(wire) === show([127 << 8, 1234, (76 << 8) | 102, -1837]), show(wire))
  const out = unpackWallPlanes(wire, [9, 9, 9, 9])
  assert(sameArray(out, [1, 0, 1.234, 76 / Math.hypot(76, 102), 102 / Math.hypot(76, 102), -1.837]), show(out))
  assert(packWallPlanes([], [0, 0, 0]) === 0 && packWallPlanes([1, 0], null) === 0 && packWallPlanes([0, 0], [1, 1, 1]) === 0, 'empty input must pack to 0')
  assert(show(unpackWallPlanes(0, [1, 2, 3])) === '[]' && show(unpackWallPlanes([0, 5], [])) === '[]', 'no planes must clear the output')
})

gate('control: the three wire helpers agree with the copies in snapshot-lod-pure/selfBlock.js over a sweep of normals', () => {
  for (const [a, b] of wireSweep) {
    const packed = packGroundNormal([a, 0.5, b])
    assert(packed === selfBlock.packGroundNormal([a, 0.5, b]), 'pack differs at ' + a + ',' + b)
    assert(show(unpackGroundNormal(packed, [0, 0, 0])) === show(selfBlock.unpackGroundNormal(packed, [0, 0, 0])), 'unpack differs at ' + a + ',' + b)
    const wire = packWallPlanes([a, b], [a * 3, 1, b * 7])
    assert(show(wire) === show(selfBlock.packWallPlanes([a, b], [a * 3, 1, b * 7])), 'wall pack differs at ' + a + ',' + b)
    assert(show(unpackWallPlanes(wire, [])) === show(selfBlock.unpackWallPlanes(wire, [])), 'wall unpack differs at ' + a + ',' + b)
  }
  assert(wireSweep.length === 147, 'sweep size ' + wireSweep.length)
})

gate('full player record: position and velocity in centimetres, smallest-three rotation, look bytes, flags and the self block for selfId', () => {
  const p = first.players[0]
  assert(p.id === 7 && p.tier === 0 && p.heightAbsent === false, show(p))
  assert(sameArray(p.position, [1.23, 5.5, -3.21]) && sameArray(p.velocity, [0.5, -2, 3.33]), show(p.position) + show(p.velocity))
  assert(sameArray(p.rotation, decodedQuat), show(p.rotation))
  assert(p.onGround === true && p.health === 88 && p.crouch === 1 && p.expr === 3 && p.weapon === 2, show(p))
  assert(near(p.lookPitch, 0.40039906369281675) && near(p.lookYaw, 1.2026409377023426), p.lookPitch + ' ' + p.lookYaw)
  assert(p.inputSequence === 42 && p.inputBuffer === 3, 'self block sequence ' + p.inputSequence + ' depth ' + p.inputBuffer)
  assert(sameArray(p.groundNormal, [0.2992125984251969, 0.933660400490182, -0.1968503937007874]), show(p.groundNormal))
  assert(sameArray(p.wallPlanes, [1, 0, 1.234, 0.5974813225354739, 0.8018828276133992, -1.837]), show(p.wallPlanes))
})

gate('reduced player record: x, z and yaw only, height NaN with heightAbsent, tier 1; a full 8-field record is not reduced', () => {
  const p = first.players[1]
  assert(p.id === 9 && p.tier === 1 && p.heightAbsent === true, show(p))
  assert(p.position[0] === 40 && Number.isNaN(p.position[1]) && p.position[2] === 60, show(p.position))
  assert(near(p.lookYaw, 2.5034566458293663), 'yaw ' + p.lookYaw)
  assert(p.inputBuffer === -1 && p.inputSequence === 0 && p.health === 100, show(p))
  assert(isReducedPlayerPose([1, 2, 3, 4, 1]) && !isReducedPlayerPose([1, 2, 3, 4, 0]) && !isReducedPlayerPose(encodePlayer(selfPose)), 'reduced detection')
})

gate('the self block is applied only to the player whose id is selfId', () => {
  const other = new SnapshotProcessor()
  const out = other.processSnapshot({ tick: 1, timestamp: 5, players: [encodePlayer(selfPose)], me }, 1, 8)
  assert(out.players[0].inputSequence === 0 && out.players[0].inputBuffer === -1 && out.players[0].wallPlanes === undefined, show(out.players[0]))
})

gate('full entity record: model, centimetre position, rotation, velocity, scale, body type, custom and sleep flag', () => {
  const e = first.entities[0]
  assert(e.id === 'box' && e.model === 'm.glb' && e.bodyType === 'dynamic' && show(e.custom) === '{"a":1}' && e.sleeping === true, show(e))
  assert(sameArray(e.position, [3, 4, 5]) && sameArray(e.velocity, [1, 0, 0]) && sameArray(e.scale, [2, 1, 0.5]), show(e))
  assert(sameArray(e.rotation, decodedQuat), show(e.rotation))
})

gate('field delta: a POS|VEL mask writes position and velocity from the record and leaves rotation, scale and the rest alone', () => {
  const e = second.entities[0]
  assert(second.entities.length === 1, 'entities ' + second.entities.length)
  assert(sameArray(e.position, [9, 9, 9]) && sameArray(e.velocity, [0, 2, 0]), show(e))
  assert(sameArray(e.scale, [2, 1, 0.5]) && sameArray(e.rotation, decodedQuat) && e.model === 'm.glb' && e.sleeping === true, show(e))
})

gate('field delta: a sleep-only mask reads its flag from the next field with no record', () => {
  const p = new SnapshotProcessor()
  p.processSnapshot({ tick: 1, timestamp: 1, entities: [encodeEntity(box)] }, 1)
  const out = p.processSnapshot({ tick: 2, timestamp: 2, delta: 1, entities: [['box', FIELD_SLEEP, 0]] }, 2)
  assert(out.entities[0].sleeping === false && sameArray(out.entities[0].position, [3, 4, 5]), show(out.entities[0]))
})

gate('callback order across three snapshots matches spoint: joins, add, one corruption for an unknown delta, reduced player kept, full player left, unseen entity removed', () => {
  assert(eventsAfterThree === 'join:7,join:9,add:box,corrupt:ghost,join:11,left:7,add:o,rm:box', eventsAfterThree)
  assert(processor.deltaFailures === 1 && processor.deltaFailureIds.has('ghost'), 'failures ' + processor.deltaFailures)
  assert(show(third.players.map((p) => p.id)) === '[11,9]', show(third.players.map((p) => p.id)))
})

gate('object player defaults: id, zero vectors, identity rotation, health 100, and an out-of-range input depth reads as -1', () => {
  const p = third.players[0]
  assert(p.tier === 0 && p.heightAbsent === false && p.inputBuffer === -1 && p.health === 100 && p.onGround === false, show(p))
  assert(show(p.position) === '[1,2,3]' && show(p.rotation) === '[0,0,0,1]' && show(p.velocity) === '[0,0,0]', show(p))
  const e = third.entities[0]
  assert(e.bodyType === 'static' && e.custom === null && show(e.scale) === '[1,1,1]' && show(e.position) === '[0,0,0]', show(e))
})

gate('delta corruption: the first nine unknown deltas report onDeltaCorruption, the tenth and later request a full snapshot, and the count never resets', () => {
  const seen = []
  const p = new SnapshotProcessor({ callbacks: { onDeltaCorruption: (id) => seen.push('c' + id), onFullSnapshotRequested: () => seen.push('full') } })
  for (let i = 0; i < 12; i++) p.processSnapshot({ tick: i, timestamp: 1, delta: 1, entities: [[i, FIELD_POS, movedBin]] }, i)
  assert(DELTA_FAILURES_BEFORE_FULL_REQUEST === 10, 'threshold')
  assert(seen.join(',') === 'c0,c1,c2,c3,c4,c5,c6,c7,c8,full,full,full', seen.join(','))
  assert(p.deltaFailures === 12 && p.getAllEntities().size === 0, 'failures ' + p.deltaFailures)
})

gate('reduced grace: an absent reduced player stays for 39 more snapshots and leaves on the 40th; an absent full player leaves at once', () => {
  const left = []
  const p = new SnapshotProcessor({ callbacks: { onPlayerLeft: (id) => left.push(id) } })
  p.processSnapshot({ tick: 0, timestamp: 1, players: [encodeReducedPlayer(farPose), encodePlayer(selfPose)] }, 0)
  let keptThrough = 0
  for (let i = 1; i <= REDUCED_TIER_ABSENCE_GRACE_SNAPSHOTS; i++) {
    const out = p.processSnapshot({ tick: i, timestamp: 1, players: [] }, i)
    if (out.players.some((pl) => pl.id === 9)) keptThrough = i
  }
  assert(REDUCED_TIER_ABSENCE_GRACE_SNAPSHOTS === 40 && keptThrough === 39, 'kept through ' + keptThrough)
  assert(show(left) === '[7,9]' && p.getPlayerState(9) === undefined, show(left))
})

gate('delta snapshots remove only listed entities, full snapshots remove every unseen one', () => {
  const removed = []
  const p = new SnapshotProcessor({ callbacks: { onEntityRemoved: (id) => removed.push(id) } })
  p.processSnapshot({ tick: 1, timestamp: 1, entities: [encodeEntity(box), encodeEntity({ ...box, id: 'b2' })] }, 1)
  p.processSnapshot({ tick: 2, timestamp: 1, delta: 1, entities: [], removed: ['b2', 'never'] }, 2)
  assert(show(removed) === '["b2"]' && p.getEntity('box') !== undefined, show(removed))
  p.processSnapshot({ tick: 3, timestamp: 1, entities: [] }, 3)
  assert(show(removed) === '["b2","box"]' && p.getAllEntities().size === 0, show(removed))
})

gate('slot pool: a returned snapshot keeps its slots for 96 later snapshots, then its slots are reused by the next one', () => {
  const p = new SnapshotProcessor()
  const pl = encodePlayer({ id: 1, position: [1, 2, 3], rotation: [0, 0, 0, 1], velocity: [0, 0, 0] })
  const kept = p.processSnapshot({ tick: 1, timestamp: 1, players: [pl] }, 1)
  const slot = kept.players[0]
  let reusedAt = 0
  for (let t = 2; t <= 100 && !reusedAt; t++) {
    const out = p.processSnapshot({ tick: t, timestamp: 1, players: [pl] }, t)
    if (out.players[0] === slot) reusedAt = t
  }
  assert(SNAPSHOT_RELEASE_WINDOW === 96 && reusedAt === 98, 'reused at ' + reusedAt)
})

gate('improvement over spoint: a recycled slot does not carry the previous owner\'s wall planes to a player without any', () => {
  const p = new SnapshotProcessor()
  const pl = (id) => encodePlayer({ id, position: [1, 2, 3], rotation: [0, 0, 0, 1], velocity: [0, 0, 0] })
  const block = selfBlock.encodeSelfBlock({ inputSequence: 1, inputBuffer: 1, groundNormal: [0, 1, 0], wallNormals: [1, 0], position: [1, 2, 3] })
  const firstOut = p.processSnapshot({ tick: 1, timestamp: 1, players: [pl(7)], me: block }, 1, 7)
  assert(show(firstOut.players[0].wallPlanes) === '[1,0,1]', show(firstOut.players[0].wallPlanes))
  const firstSlot = firstOut.players[0]
  for (let t = 2; t <= 97; t++) p.processSnapshot({ tick: t, timestamp: 1, players: [] }, t, 7)
  const later = p.processSnapshot({ tick: 98, timestamp: 1, players: [pl(8)] }, 98, 7)
  assert(later.players[0] === firstSlot, 'the slot was not recycled, so the claim was not exercised')
  assert(show(later.players[0].wallPlanes) === '[]', 'spoint leaves [1,0,1] here; got ' + show(later.players[0].wallPlanes))
})

gate('stricter than spoint: a truncated player or entity record is refused, where spoint reads past the end silently', () => {
  const p = new SnapshotProcessor()
  const shortPlayer = encodePlayer(selfPose)
  shortPlayer[1] = shortPlayer[1].subarray(0, 21)
  assert(throwsRange(() => p.processSnapshot({ tick: 1, timestamp: 1, players: [shortPlayer] }, 1), /21 bytes, expected 22 \(truncated\)/), 'short player accepted')
  const shortEntity = encodeEntity(box)
  shortEntity[2] = shortEntity[2].subarray(0, 28)
  assert(throwsRange(() => new SnapshotProcessor().processSnapshot({ tick: 1, timestamp: 1, entities: [shortEntity] }, 1), /28 bytes, expected 29/), 'short entity accepted')
})

gate('stricter than spoint: a rotation word whose three fields exceed unit length is refused, where spoint clamps the fourth to 0', () => {
  const bad = encodePlayer(selfPose)
  const bytes = Uint8Array.from(bad[1])
  bytes[18] = 0xff
  bytes[19] = 0xfb
  bytes[20] = 0xef
  bytes[21] = 0x3f
  bad[1] = bytes
  assert(throwsRange(() => new SnapshotProcessor().processSnapshot({ tick: 1, timestamp: 1, players: [bad] }, 1), /no unit quaternion can have/), 'bad rotation word accepted')
})

gate('clock injection: a missing timestamp reads the injected now, 0 counts as missing as in spoint, and without a clock it is refused', () => {
  const clocked = new SnapshotProcessor({ now: () => 4242 })
  assert(clocked.processSnapshot({ tick: 1 }, 1).timestamp === 4242, 'clock not read')
  assert(clocked.processSnapshot({ tick: 2, timestamp: 0 }, 2).timestamp === 4242, 'timestamp 0 must fall to the clock')
  assert(clocked.processSnapshot({ tick: 3, timestamp: 77 }, 3).timestamp === 77, 'timestamp overridden')
  assert(throwsType(() => new SnapshotProcessor().processSnapshot({ tick: 4 }, 4), /no now clock/), 'missing clock accepted')
  assert(throwsType(() => new SnapshotProcessor({ now: 5 }), /now must be a function/), 'non-function clock accepted')
  assert(new SnapshotProcessor().processSnapshot({ tick: 5, timestamp: 9, dots: [1] }, 5).dots[0] === 1, 'dots not carried')
})

gate('applyChartTransfer re-expresses every player and entity track, and removePlayer and clear drop tracks', () => {
  const calls = []
  const pass = {
    point: (v) => calls.push('point:' + v.length),
    vector: (v) => calls.push('vector:' + v.length),
    yawRotation: () => calls.push('yaw'),
    rotation: () => calls.push('rot'),
    look: () => calls.push('look')
  }
  processor.applyChartTransfer(pass)
  assert(calls.join(',') === 'point:3,vector:3,yaw,look,vector:3,point:3,vector:3,yaw,look,vector:3,point:3,vector:3,rot', calls.join(','))
  assert(processor.lastSnapshotTick === 3, 'lastSnapshotTick ' + processor.lastSnapshotTick)
  processor.removePlayer(11)
  assert(processor.getPlayerState(11) === undefined && processor.getAllPlayerStates().size === 1, 'removePlayer')
  processor.clear()
  assert(processor.getAllPlayerStates().size === 0 && processor.getAllEntities().size === 0, 'clear')
})

gate('control: perturbing one position centimetre in the record changes the decoded player', () => {
  const perturbed = encodePlayer({ ...selfPose, position: [1.244, 5.5, -3.21] })
  const out = new SnapshotProcessor().processSnapshot({ tick: 1, timestamp: 1, players: [perturbed] }, 1)
  assert(near(out.players[0].position[0], 1.24) && show(out) !== firstJson, show(out.players[0].position))
})

finish()
