import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { gate, finish } from './lib/gate.mjs'
import { encodeEntityRecord, encodeSmallestThree } from '../src/wire/index.js'
import { primeEntryDecode as aoiPrimeEntryDecode, unpackBinRecord as aoiUnpackBinRecord } from '../src/aoi-pure/binRecord.js'
import { encodeCustomFields, getComponentSchema, registerComponentSchema } from '../src/protocol/componentSchema.js'
import {
  buildCrowdDots,
  classifyPlayerTiers,
  decodeCustomBySchema,
  decodeSelfBlock,
  encodeCustomBySchema,
  encodeEntity,
  encodeSelfBlock,
  filterEncodedPlayersTiered,
  packQuat,
  PLAYER_LOD_FULL_COUNT,
  PLAYER_LOD_REDUCED2,
  PLAYER_LOD_REDUCED_HZ,
  PLAYER_TIER_FULL,
  PLAYER_TIER_REDUCED,
  primeEntryDecode,
  PROP_MAX_HZ,
  PROP_SLEEP_TICKMOD,
  propTickMod,
  reducedTickModFor,
  SnapshotEncoder,
  TombstoneLog,
  unpackBinRecord,
  unpackQuat
} from '../src/snapshot-lod-pure/snapshotEncoder.js'
import { fnv1aStepString, FNV1A_32_OFFSET_BASIS } from '../src/snapshot-lod-pure/fnv1a.js'

const hex = (bytes) => Buffer.from(bytes).toString('hex')

const serialize = (value) => {
  if (value instanceof Uint8Array) return hex(value)
  if (value instanceof Map) return [...value.entries()].map(([key, item]) => [key, serialize(item)])
  if (value instanceof Set) return [...value].map(serialize)
  if (Array.isArray(value)) return value.map(serialize)
  if (value && typeof value === 'object') {
    const out = {}
    for (const key of Object.keys(value)) out[key] = serialize(value[key])
    return out
  }
  return value
}

const same = (actual, expected) => assert.deepEqual(serialize(actual), serialize(expected))

const claim = (label, actual, expected) => gate(label, () => same(actual, expected))

const rejects = (label, actual, mutant) => gate('control rejects ' + label, () => assert.throws(() => same(actual, mutant)))

const mkPlayer = (id, x, y, z, extra = {}) => ({
  id,
  position: [x, y, z],
  rotation: [0, 0, 0, 1],
  velocity: [0, 0, 0],
  onGround: false,
  health: 100,
  crouch: 0,
  lookPitch: 0,
  lookYaw: 0,
  expr: 0,
  weapon: 0,
  ...extra
})

const boundaryPlayers = () => {
  const players = [mkPlayer(1, 0, 0, 0)]
  for (let i = 0; i < 30; i++) players.push(mkPlayer(2 + i, 5, 0, 0))
  players.push(mkPlayer(40, 119.9, 0, 0), mkPlayer(41, 120, 0, 0), mkPlayer(42, 0, 0, 120.5))
  return players
}

const crowdPlayers = () => {
  const players = []
  for (let i = 0; i < 35; i++) {
    players.push(mkPlayer(2 + i, ((i * 37) % 201) - 100, 0.5, ((i * 53) % 181) - 90, {
      velocity: [i * 0.1 - 2, 0, 0],
      onGround: i % 2 === 0,
      health: 100 - i,
      crouch: i % 3,
      lookPitch: 0.05 * i - 1,
      lookYaw: i * 0.3,
      expr: i % 5,
      weapon: i % 4
    }))
  }
  players.push(mkPlayer(1, 0, 0.5, 0))
  return players
}

const byId = (players) => new Map(players.map((p) => [p.id, p]))

const idsOf = (tuples) => tuples.map((tuple) => tuple[0])

const reducedTupleOf = (tuples) => tuples.find((tuple) => tuple.length === 5)

const mkEntity = (id, x, z, vx = 0, model = 'rock') => ({
  id,
  model,
  position: [x, 0, z],
  rotation: [0, 0, 0, 1],
  velocity: [vx, 0, 0],
  scale: [1, 1, 1],
  bodyType: 'dynamic',
  custom: null
})

const ORIGIN = [0, 0, 0]

const boundary = boundaryPlayers()
const boundaryMap = byId(boundary)
const boundaryNear = boundary.map((p) => p.id)
const boundaryTiers = classifyPlayerTiers(boundaryMap, boundaryNear, ORIGIN, 1)
const boundaryEncoded = new Map(SnapshotEncoder.encodePlayersOnce(boundary))
const boundaryTick1 = filterEncodedPlayersTiered(boundaryEncoded, boundaryMap, boundaryNear, 1, ORIGIN, 1, 4)
const boundaryTick0 = filterEncodedPlayersTiered(new Map(SnapshotEncoder.encodePlayersOnce(boundary)), boundaryMap, boundaryNear, 1, ORIGIN, 0, 4)

const crowd = crowdPlayers()
const crowdMap = byId(crowd)
const crowdNear = crowd.map((p) => p.id)
const crowdTiers = classifyPlayerTiers(crowdMap, crowdNear, ORIGIN, 1)
const crowdTick3 = filterEncodedPlayersTiered(new Map(SnapshotEncoder.encodePlayersOnce(crowd)), crowdMap, crowdNear, 1, ORIGIN, 3, 4)
const crowdTick4 = filterEncodedPlayersTiered(new Map(SnapshotEncoder.encodePlayersOnce(crowd)), crowdMap, crowdNear, 1, ORIGIN, 4, 4)

const CROWD_FULL = [21, 10, 4, 31, 27, 11, 32, 20, 17, 14, 15, 28, 25, 5, 3, 16, 22, 6, 34, 7, 26, 33, 30, 35, 24, 9, 8, 36, 18, 23]
const BOUNDARY_TICK1_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31]

claim('PLAYER_LOD_FULL_COUNT is 30', PLAYER_LOD_FULL_COUNT, 30)
rejects('PLAYER_LOD_FULL_COUNT is 30', PLAYER_LOD_FULL_COUNT, 31)
claim('PLAYER_LOD_REDUCED2 is 120 m squared (14400)', PLAYER_LOD_REDUCED2, 14400)
rejects('PLAYER_LOD_REDUCED2 is 120 m squared', PLAYER_LOD_REDUCED2, 100 * 100)
claim('PLAYER_LOD_REDUCED_HZ is 5', PLAYER_LOD_REDUCED_HZ, 5)
rejects('PLAYER_LOD_REDUCED_HZ is 5', PLAYER_LOD_REDUCED_HZ, 6)

claim('reducedTickModFor gives tick mods 2, 3, 4, 6, 12 at 10, 15, 20, 30, 60 Hz', [10, 15, 20, 30, 60].map(reducedTickModFor), [2, 3, 4, 6, 12])
rejects('reducedTickModFor tick mods', [10, 15, 20, 30, 60].map(reducedTickModFor), [2, 3, 3, 6, 12])
claim('the reduced cadence is 5 Hz at 10, 15, 20, 30 and 60 Hz snapshot rates', [10, 15, 20, 30, 60].map((hz) => hz / reducedTickModFor(hz)), [5, 5, 5, 5, 5])
rejects('the reduced cadence is 5 Hz', [10, 15, 20, 30, 60].map((hz) => hz / reducedTickModFor(hz)), [5, 5, 20 / 3, 5, 5])

claim('boundary: 30 full, 119.9 m reduced, 120 m and 120.5 m dots', { full: boundaryTiers.full.length, reduced: boundaryTiers.reduced, dots: boundaryTiers.dotPlayers.map((p) => p.id) }, { full: 30, reduced: [40], dots: [41, 42] })
rejects('boundary tiers with 120 m inclusive', { full: boundaryTiers.full.length, reduced: boundaryTiers.reduced, dots: boundaryTiers.dotPlayers.map((p) => p.id) }, { full: 30, reduced: [40, 41], dots: [42] })
rejects('boundary tiers with 31 full', { full: boundaryTiers.full.length, reduced: boundaryTiers.reduced, dots: boundaryTiers.dotPlayers.map((p) => p.id) }, { full: 31, reduced: [40], dots: [41, 42] })

const tieredIds = [...boundaryTiers.full, ...boundaryTiers.reduced, ...boundaryTiers.dotPlayers.map((p) => p.id)]
claim('the self id is in no tier', tieredIds.includes(1), false)
rejects('the self id is in no tier', tieredIds.includes(1), true)

const withoutPosition = new Map([[2, { id: 2, position: [1, 0, 0] }], [3, { id: 3 }]])
claim('a nearby id with no player or no position is in no tier', classifyPlayerTiers(withoutPosition, [2, 3, 4], ORIGIN, 1), { full: [2], reduced: [], dotPlayers: [] })
rejects('a nearby id with no position is skipped', classifyPlayerTiers(withoutPosition, [2, 3, 4], ORIGIN, 1), { full: [2, 3], reduced: [], dotPlayers: [] })

claim('reduced player 40 is sent on tick 0 with reducedTickMod 4', idsOf(boundaryTick0.players).includes(40), true)
rejects('reduced player 40 is sent on tick 0', idsOf(boundaryTick0.players).includes(40), false)
claim('reduced player 40 is held back on tick 1 with reducedTickMod 4', idsOf(boundaryTick1.players).includes(40), false)
rejects('reduced player 40 is held back on tick 1', idsOf(boundaryTick1.players).includes(40), true)
claim('tick 1 sends the self and the 30 full players in rank order', idsOf(boundaryTick1.players), BOUNDARY_TICK1_IDS)
rejects('tick 1 sends the self and the 30 full players in rank order', idsOf(boundaryTick1.players), [...BOUNDARY_TICK1_IDS, 40])
claim('tick 1 dots are the two far cells', boundaryTick1.dots, [[4, 0, 1], [0, 4, 1]])
rejects('tick 1 dots are the two far cells', boundaryTick1.dots, [[4, 0, 1]])
claim('reduced tuple for player 40 is [id, x*100, z*100, yawN, 1]', reducedTupleOf(boundaryTick0.players), [40, 11990, 0, 0, 1])
rejects('reduced tuple for player 40 has the reduced flag', reducedTupleOf(boundaryTick0.players), [40, 11990, 0, 0, 0])

claim('crowd fixture: the 30 nearest are full, in distance order', crowdTiers.full, CROWD_FULL)
rejects('crowd fixture: the 30 nearest are full', crowdTiers.full, CROWD_FULL.slice(0, 29))
claim('crowd fixture: ranks 30 and up within 120 m are reduced, the rest are dots', { reduced: crowdTiers.reduced, dots: crowdTiers.dotPlayers.map((p) => p.id) }, { reduced: [12, 13, 19], dots: [29, 2] })
rejects('crowd fixture: dot order', { reduced: crowdTiers.reduced, dots: crowdTiers.dotPlayers.map((p) => p.id) }, { reduced: [12, 13, 19], dots: [2, 29] })
claim('crowd fixture: tick 3 omits the reduced players', idsOf(crowdTick3.players), [1, ...CROWD_FULL])
rejects('crowd fixture: tick 3 omits the reduced players', idsOf(crowdTick3.players), [1, ...CROWD_FULL, 12, 13, 19])
claim('crowd fixture: tick 4 sends the reduced players after the full ones', idsOf(crowdTick4.players), [1, ...CROWD_FULL, 12, 13, 19])
rejects('crowd fixture: tick 4 sends the reduced players after the full ones', idsOf(crowdTick4.players), [1, ...CROWD_FULL])
claim('crowd fixture: reduced tuple for player 12 at 5 Hz tick', reducedTupleOf(crowdTick4.players), [12, 6900, 7800, 122, 1])
rejects('crowd fixture: reduced tuple yaw', reducedTupleOf(crowdTick4.players), [12, 6900, 7800, 123, 1])
claim('crowd fixture: far dots at tick 3 and 4', [crowdTick3.dots, crowdTick4.dots], [[[3, 2, 1], [-4, -4, 1]], [[3, 2, 1], [-4, -4, 1]]])
rejects('crowd fixture: far dots at tick 3 and 4', [crowdTick3.dots, crowdTick4.dots], [[[3, 2, 1]], [[3, 2, 1], [-4, -4, 1]]])

claim('buildCrowdDots bins 25 m cells and counts members', buildCrowdDots([{ position: [1, 0, 1] }, { position: [-3, 0, -30] }, { position: [30, 0, -30] }, { position: [30, 0, 30] }], ORIGIN, 25), [[0, 0, 1], [-1, -2, 1], [1, -2, 1], [1, 1, 1]])
rejects('control rejects buildCrowdDots bins 25 m cells and counts members', buildCrowdDots([{ position: [1, 0, 1] }, { position: [-3, 0, -30] }, { position: [30, 0, -30] }, { position: [30, 0, 30] }], ORIGIN, 25), [[0, 0, 1], [-1, -2, 1], [0, 1000001, 1], [1, 1, 1]])
claim('buildCrowdDots decodes cell (1, -2) as (1, -2), spoint 0769dae', buildCrowdDots([{ position: [30, 0, -30] }], ORIGIN, 25), [[1, -2, 1]])
rejects('control rejects buildCrowdDots decodes cell (1, -2) as (0, 1000001)', buildCrowdDots([{ position: [30, 0, -30] }], ORIGIN, 25), [[0, 1000001, 1]])
claim('buildCrowdDots with a 10 m cell places (30, -30) in cell (3, -3)', buildCrowdDots([{ position: [30, 0, -30] }], ORIGIN, 10), [[3, -3, 1]])
rejects('control rejects buildCrowdDots with a 10 m cell', buildCrowdDots([{ position: [30, 0, -30] }], ORIGIN, 10), [[2, 1000000, 1]])
claim('buildCrowdDots of no players is empty', buildCrowdDots([], ORIGIN, 25), [])
rejects('buildCrowdDots of no players is empty', buildCrowdDots([], ORIGIN, 25), [[0, 0, 0]])

const player9 = mkPlayer(9, 1, 2, 3, { lookYaw: 4, lookPitch: 0.3, health: 87.6, crouch: 1, expr: 2, weapon: 3, onGround: true, velocity: [0.5, 0, -0.25] })
claim('encodePlayers tuple for player 9 matches spoint', SnapshotEncoder.encodePlayers([player9]), [[9, '64000000c80000002c01000032000000e7fffffdf7df', 1, 88, 1, 39075, 2, 3]])
rejects('encodePlayers tuple for player 9 yaw', SnapshotEncoder.encodePlayers([player9]), [[9, '64000000c80000002c01000032000000e7fffffdf7df', 1, 88, 1, 39076, 2, 3]])
claim('encodePlayersOnce tuple for player 9 matches encodePlayers', SnapshotEncoder.encodePlayersOnce([player9]).get(9), [9, '64000000c80000002c01000032000000e7fffffdf7df', 1, 88, 1, 39075, 2, 3])
rejects('encodePlayersOnce tuple for player 9 health', SnapshotEncoder.encodePlayersOnce([player9]).get(9), [9, '64000000c80000002c01000032000000e7fffffdf7df', 1, 87, 1, 39075, 2, 3])
claim('decode restores player 9 as spoint does', SnapshotEncoder.decode({ players: SnapshotEncoder.encodePlayers([player9]), tick: 1, entities: [] }).players, [{ id: 9, position: [1, 2, 3], rotation: [-1.1102230246251565e-16, -1.1102230246251565e-16, -1.1102230246251565e-16, 1], velocity: [0.5, 0, -0.25], onGround: true, health: 88, crouch: 1, lookPitch: 0.30183929416843114, lookYaw: 4.000621894805752, expr: 2, weapon: 3 }])
rejects('decode restores player 9 health', SnapshotEncoder.decode({ players: SnapshotEncoder.encodePlayers([player9]), tick: 1, entities: [] }).players[0].health, 87)

const entity7 = { id: 7, model: 'm', position: [1.5, -2, 0.25], rotation: [0, 0, 0, 1], velocity: [0, 0, 0], scale: [0, 2, 0.5], bodyType: 'dynamic', custom: null }
const entity8 = { id: 8, position: [1, 2, 3], rotation: [0, 0, 0, 1], velocity: [NaN, undefined, -0], bodyType: 'static' }
const ENTITY7_HEX = '9600000038ffffff19000000000000000000fffdf7df6400c800320000'
const ENTITY8_HEX = '64000000c80000002c010000000000000000fffdf7df64006400640000'
claim('encodeEntity of entity 7 matches spoint, including zero scale becoming 1', encodeEntity(entity7), [7, 'm', ENTITY7_HEX, 'dynamic', null, 0])
rejects('encodeEntity keeps a zero scale', encodeEntity(entity7), [7, 'm', ENTITY7_HEX.replace('6400c800', '0000c800'), 'dynamic', null, 0])
claim('encodeEntity of entity 8 coerces NaN, undefined and -0 velocity to 0', encodeEntity(entity8)[2], ENTITY8_HEX)
rejects('encodeEntity of entity 8 velocity', encodeEntity(entity8)[2], ENTITY8_HEX.slice(0, 24) + '0100' + ENTITY8_HEX.slice(28))
claim('the entity record equals the src/wire 29-byte record', hex(encodeEntity(entity7)[2]), hex(encodeEntityRecord({ position: [1.5, -2, 0.25], rotationWord: 3757571583, velocity: [0, 0, 0], scale: [1, 2, 0.5], flags: 0 })))
rejects('the entity record carries flags', hex(encodeEntity(entity7)[2]), hex(encodeEntityRecord({ position: [1.5, -2, 0.25], rotationWord: 3757571583, velocity: [0, 0, 0], scale: [1, 2, 0.5], flags: 1 })))

claim('packQuat of the identity is spoint word 3757571583', packQuat(0, 0, 0, 1), 3757571583)
rejects('packQuat of the identity', packQuat(0, 0, 0, 1), 3757571582)
claim('packQuat of (0.6, 0, 0.8, 0) is spoint word 3138911743', packQuat(0.6, 0, 0.8, 0), 3138911743)
rejects('packQuat of (0.6, 0, 0.8, 0)', packQuat(0.6, 0, 0.8, 0), 3138911742)
claim('packQuat of (0, -s, 0, s) is spoint word 1610087424', packQuat(0, -0.7071067811865476, 0, 0.7071067811865476), 1610087424)
rejects('packQuat of (0, -s, 0, s)', packQuat(0, -0.7071067811865476, 0, 0.7071067811865476), 1610087425)
claim('unpackQuat of 3138911743 matches spoint components', unpackQuat(3138911743, [0, 0, 0, 0]), [0.6005564442954238, -1.1102230246251565e-16, 0.7995823642472598, -1.1102230246251565e-16])
rejects('unpackQuat of 3138911743', unpackQuat(3138911743, [0, 0, 0, 0]), [0.6, 0, 0.8, 0])
claim('encodeSmallestThree is the word packQuat returns', encodeSmallestThree([0, 0, 0, 1]), 3757571583)
rejects('encodeSmallestThree is the word packQuat returns', encodeSmallestThree([0, 0, 0, 1]), 3757571582)

const selfInput = { inputSequence: 5, inputBuffer: 3, groundNormal: [0.3, 0.9, -0.2], wallNormals: [1, 0, 0, 1], position: [10, 0, 20] }
claim('encodeSelfBlock packs input, ground normal and wall planes as spoint does', encodeSelfBlock(selfInput), [5, 3, 9959, [32512, 10000, 127, 20000]])
rejects('encodeSelfBlock packs the input depth', encodeSelfBlock(selfInput), [5, 4, 9959, [32512, 10000, 127, 20000]])
claim('decodeSelfBlock restores ground normal and wall planes', decodeSelfBlock([5, 3, 9959, [32512, 10000, 127, 20000]], {}), { inputSequence: 5, inputBuffer: 3, groundNormal: [0.2992125984251969, 0.933660400490182, -0.1968503937007874], wallPlanes: [1, 0, 10, 0, 1, 20] })
rejects('decodeSelfBlock restores the input depth', decodeSelfBlock([5, 3, 9959, [32512, 10000, 127, 20000]], {}).inputBuffer, 4)
claim('a null input depth encodes as null and decodes as -1', [encodeSelfBlock({ inputSequence: 1, inputBuffer: null, groundNormal: null, wallNormals: null, position: [0, 0, 0] }), decodeSelfBlock([1, null, 0, 0], {})], [[1, null, 0, 0], { inputSequence: 1, inputBuffer: -1, groundNormal: [0, 1, 0], wallPlanes: [] }])
rejects('a null input depth decodes as -1', decodeSelfBlock([1, null, 0, 0], {}).inputBuffer, null)
claim('an absent player has no self block', encodeSelfBlock(null), undefined)
rejects('an absent player has no self block', encodeSelfBlock(null), [])

claim('propTickMod for 20, 15, 60, null and 100 Hz is 2, 1, 4, 1, 7', [20, 15, 60, null, 100].map(propTickMod), [2, 1, 4, 1, 7])
rejects('propTickMod for 15 Hz', propTickMod(15), 2)
claim('PROP_MAX_HZ is 15 and PROP_SLEEP_TICKMOD is 60', [PROP_MAX_HZ, PROP_SLEEP_TICKMOD], [15, 60])
rejects('PROP_MAX_HZ is 15', PROP_MAX_HZ, 16)

const cadenceEnts = new Map([[201, mkEntity(201, 5, 0)], [202, mkEntity(202, 40, 0)]])
const cadenceCache = SnapshotEncoder.buildDynamicCache([201, 202], new Set(), new Set(), cadenceEnts, null, null)
const keysBuild = [...cadenceCache.keys()].map((id) => [id, cadenceCache.get(id).k])
claim('buildDynamicCache keys match spoint FNV-1a entity keys', keysBuild, [[201, 3717634348], [202, 1444758966]])
rejects('buildDynamicCache keys match spoint FNV-1a entity keys', keysBuild, [[201, 3717634348], [202, 1444758967]])
const boulderCache = SnapshotEncoder.buildDynamicCache([201, 202], new Set(), new Set(), new Map([[201, mkEntity(201, 5, 0)], [202, mkEntity(202, 40, 0, 0, 'boulder')]]), null, null)
const boulderKey = boulderCache.get(202).k
gate('control: a changed model changes the entity key', () => assert.notEqual(boulderKey, 1444758966))
rejects('a changed model keeps the key', [[201, 3717634348], [202, boulderKey]], [[201, 3717634348], [202, 1444758966]])

claim('FNV-1a of "a" and "foobar" are the standard 32-bit vectors', [fnv1aStepString(FNV1A_32_OFFSET_BASIS, 'a') >>> 0, fnv1aStepString(FNV1A_32_OFFSET_BASIS, 'foobar') >>> 0], [0xe40c292c, 0xbf9cf968])
rejects('FNV-1a of "foobar"', fnv1aStepString(FNV1A_32_OFFSET_BASIS, 'foobar') >>> 0, 0xbf9cf969)

const staticEntities = [
  { id: 1, bodyType: 'static', model: 'wall', position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [2, 2, 2] },
  { id: 2, bodyType: 'static', model: 'floor', position: [5, 0, 5], rotation: [0, 0, 0, 1] },
  { id: 3, bodyType: 'dynamic', model: 'x', position: [1, 1, 1], rotation: [0, 0, 0, 1] }
]
const staticFirst = SnapshotEncoder.encodeStaticEntities(staticEntities, new Map())
claim('static entities: first pass keys, changed ids and count match spoint', { keys: [...staticFirst.staticMap.entries()].map(([id, v]) => [id, v[0], v[2]]), changedIds: staticFirst.changedEntries.map((c) => c.id), count: staticFirst.staticEntries.length, changed: staticFirst.staticChanged }, { keys: [[1, 2199390603, ''], [2, 3001079751, '']], changedIds: [1, 2], count: 2, changed: true })
rejects('static entities: first pass changed flag', staticFirst.staticChanged, false)
const staticSecond = SnapshotEncoder.encodeStaticEntities(staticEntities, staticFirst.staticMap)
claim('static entities: an unchanged second pass reports no change', { changedIds: staticSecond.changedEntries.map((c) => c.id), changed: staticSecond.staticChanged }, { changedIds: [], changed: false })
rejects('static entities: an unchanged second pass reports no change', { changedIds: staticSecond.changedEntries.map((c) => c.id), changed: staticSecond.staticChanged }, { changedIds: [1], changed: false })

const deltaEnts = new Map([
  [101, mkEntity(101, 5, 0)],
  [102, mkEntity(102, 30, 0)],
  [103, mkEntity(103, 100, 0, 3)],
  [104, mkEntity(104, 0, 10)],
  [105, mkEntity(105, 0, 60)],
  [106, mkEntity(106, 200, 0)]
])
const deltaIds = [101, 102, 103, 104, 105, 106]
const cacheA = SnapshotEncoder.buildDynamicCache(deltaIds, new Set(), new Set(), deltaEnts, null, null)
const tombstones = new TombstoneLog()
const knownA = SnapshotEncoder.updateTombstones(tombstones, 0, cacheA, null, null)
const delta1 = SnapshotEncoder.encodeDeltaFromCache(1, 0, cacheA, null, new Map(), [], null, null, null, 0, ORIGIN, null, null, 0, 15)
const delta1Out = serialize(delta1.encoded.entities)
deltaEnts.set(101, mkEntity(101, 6, 0))
deltaEnts.set(103, mkEntity(103, 101, 0, 3))
SnapshotEncoder.refreshDynamicCache(cacheA, deltaIds, deltaEnts, new Set(), new Set(), null)
const delta2 = SnapshotEncoder.encodeDeltaFromCache(2, 0, cacheA, null, delta1.entityMap, [], null, null, null, 1, ORIGIN, null, null, 1, 15)
const delta2Out = serialize(delta2.encoded.entities)
const delta3 = SnapshotEncoder.encodeDeltaFromCache(3, 0, cacheA, null, delta2.entityMap, [], null, null, null, 16, ORIGIN, null, null, 2, 15)
const delta3Out = serialize(delta3.encoded.entities)
const cacheB = SnapshotEncoder.buildDynamicCache(deltaIds.slice(0, 5), new Set(), new Set(), deltaEnts, cacheA, null)
SnapshotEncoder.updateTombstones(tombstones, 4, cacheB, null, knownA)
const delta4 = SnapshotEncoder.encodeDeltaFromCache(5, 0, cacheB, null, delta3.entityMap, [], null, null, null, 17, ORIGIN, null, tombstones, 3, 15)

const DELTA1 = [
  [101, 'rock', 'f40100000000000000000000000000000000fffdf7df64006400640000', 'dynamic', null, 0],
  [102, 'rock', 'b80b00000000000000000000000000000000fffdf7df64006400640000', 'dynamic', null, 0],
  [103, 'rock', '102700000000000000000000000000000000fffdf7df64006400640000', 'dynamic', null, 0],
  [104, 'rock', '0000000000000000e8030000000000000000fffdf7df64006400640000', 'dynamic', null, 0],
  [105, 'rock', '000000000000000070170000000000000000fffdf7df64006400640000', 'dynamic', null, 0],
  [106, 'rock', '204e00000000000000000000000000000000fffdf7df64006400640000', 'dynamic', null, 0]
]
claim('first delta sends all six entities in full, far ones without velocity', delta1Out, DELTA1)
rejects('first delta sends all six entities in full', delta1Out, DELTA1.slice(0, 5))
claim('delta at seq 1 sends only the near entity 101, as a full record', delta2Out, [[101, 'rock', '580200000000000000000000000000000000fffdf7df64006400640000', 'dynamic', null, 0]])
rejects('delta at seq 1 sends only the near entity 101', delta2Out, [[101, 'rock', '580200000000000000000000000000000000fffdf7df64006400640000', 'dynamic', null, 0], [102, 'rock', 'b80b00000000000000000000000000000000fffdf7df64006400640000', 'dynamic', null, 0]])
claim('delta at seq 16 sends far entity 103 as a position delta with velocity stripped', delta3Out, [[103, 1, '742700000000000000000000000000000000fffdf7df64006400640000']])
rejects('delta at seq 16 sends far entity 103 as a position delta', delta3Out, [[103, 2, '742700000000000000000000000000000000fffdf7df64006400640000']])
claim('a removed entity is tombstoned into removed', { removed: delta4.encoded.removed, entities: serialize(delta4.encoded.entities) }, { removed: [106], entities: [] })
rejects('a removed entity is tombstoned into removed', { removed: delta4.encoded.removed, entities: [] }, { removed: [], entities: [] })

const tombLog = new TombstoneLog()
tombLog.push(10, 1)
tombLog.push(11, 2)
tombLog.push(12, 3)
const tombMap = new Map([[10, [0]], [11, [0]], [12, [0]]])
claim('tombstone log serves ids newer than the client tick', [tombLog.forClient(0, tombMap, []), tombLog.forClient(2, tombMap, []), tombLog.forClient(5, tombMap, [])], [[10, 11, 12], [12], []])
rejects('tombstone log serves ids newer than the client tick', [tombLog.forClient(0, tombMap, []), tombLog.forClient(2, tombMap, []), tombLog.forClient(5, tombMap, [])], [[10, 11, 12], [11, 12], []])
tombLog.pruneBefore(2)
claim('pruneBefore drops tombstones older than the tick', tombLog.forClient(0, tombMap, []), [11, 12])
rejects('pruneBefore drops tombstones older than the tick', tombLog.forClient(0, tombMap, []), [10, 11, 12])

const cadenceSource = new Map([[201, mkEntity(201, 6, 0)]])
const cadenceRunCache = SnapshotEncoder.buildDynamicCache([201], new Set(), new Set(), cadenceSource, null, null)
const cadencePrev = SnapshotEncoder.encodeDeltaFromCache(1, 0, cadenceRunCache, null, new Map(), [], null, null, null, 0, ORIGIN, null, null, 0, 20).entityMap
cadenceSource.set(201, mkEntity(201, 7, 0))
SnapshotEncoder.refreshDynamicCache(cadenceRunCache, [201], cadenceSource, new Set(), new Set(), null)
const cadenceSeq1 = SnapshotEncoder.encodeDeltaFromCache(2, 0, cadenceRunCache, null, cadencePrev, [], null, null, null, 1, ORIGIN, null, null, 1, 20)
const cadenceSeq2 = SnapshotEncoder.encodeDeltaFromCache(3, 0, cadenceRunCache, null, cadencePrev, [], null, null, null, 2, ORIGIN, null, null, 1, 20)
const cadenceSeq1Out = serialize(cadenceSeq1.encoded.entities)
const cadenceSeq2Out = serialize(cadenceSeq2.encoded.entities)
claim('a simulated entity at 20 Hz is held to even sequence numbers', [cadenceSeq1Out, cadenceSeq2Out], [[], [[201, 'rock', 'bc0200000000000000000000000000000000fffdf7df64006400640000', 'dynamic', null, 0]]])
rejects('a simulated entity at 20 Hz is held to even sequence numbers', [cadenceSeq1Out, cadenceSeq2Out], [[[201, 'rock', 'bc0200000000000000000000000000000000fffdf7df64006400640000', 'dynamic', null, 0]], [[201, 'rock', 'bc0200000000000000000000000000000000fffdf7df64006400640000', 'dynamic', null, 0]]])

claim('the module reuses the aoi-pure binary decoders', [unpackBinRecord === aoiUnpackBinRecord, primeEntryDecode === aoiPrimeEntryDecode], [true, true])
rejects('the module reuses the aoi-pure binary decoders', [unpackBinRecord === aoiUnpackBinRecord, primeEntryDecode === aoiPrimeEntryDecode], [false, true])
claim('the player tier constants are 0 and 1', [PLAYER_TIER_FULL, PLAYER_TIER_REDUCED], [0, 1])
rejects('the player tier constants are 0 and 1', [PLAYER_TIER_FULL, PLAYER_TIER_REDUCED], [1, 0])

registerComponentSchema('lod-probe', { hp: { type: 'u8' } })
claim('an unknown custom schema encodes and decodes to null', [encodeCustomBySchema('lod-missing', {}), decodeCustomBySchema('lod-missing', new Uint8Array(0))], [null, null])
rejects('a registered custom schema does not encode to null', [encodeCustomBySchema('lod-probe', { hp: 7 }), null], [null, null])
claim('a registered custom schema is encoded by the component schema module', encodeCustomBySchema('lod-probe', { hp: 7 }), encodeCustomFields(getComponentSchema('lod-probe'), { hp: 7 }))
rejects('a registered custom schema is encoded by the component schema module', encodeCustomBySchema('lod-probe', { hp: 7 }), encodeCustomFields(getComponentSchema('lod-probe'), { hp: 8 }))

const sourceDir = new URL('../src/snapshot-lod-pure/', import.meta.url)
const sources = readdirSync(sourceDir).filter((name) => name.endsWith('.js')).map((name) => readFileSync(new URL(name, sourceDir), 'utf8'))
const COMMENT_TOKEN = /\/\/|\/\*/
const CLOCK_TIMER_SOCKET_FS = /setTimeout|setInterval|setImmediate|Date\.now|performance\.|node:fs|node:net|node:http|node:dgram|WebSocket|require\(|process\./
const IMPORT_SPECIFIER = /from '([^']+)'/g
const specifiers = sources.flatMap((text) => [...text.matchAll(IMPORT_SPECIFIER)].map((match) => match[1]))

claim('no source file in snapshot-lod-pure carries a comment', sources.map((text) => COMMENT_TOKEN.test(text)), sources.map(() => false))
rejects('no source file carries a comment', COMMENT_TOKEN.test('const a = 1 // note'), false)
claim('no source file in snapshot-lod-pure uses a timer, a clock, a socket or fs', sources.map((text) => CLOCK_TIMER_SOCKET_FS.test(text)), sources.map(() => false))
rejects('no source file uses a timer, a clock, a socket or fs', CLOCK_TIMER_SOCKET_FS.test("setTimeout(run, 5)"), false)
const isRelativeSpecifier = (spec) => spec.startsWith('./') || spec.startsWith('../')
claim('every import in snapshot-lod-pure is relative', specifiers.every(isRelativeSpecifier), true)
rejects('every import is relative', ['node:fs'].every(isRelativeSpecifier), true)

finish()
