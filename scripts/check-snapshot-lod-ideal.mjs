import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { reducedPoseDue, reducedPosesIn } from '../src/snapshot-lod-pure/cadence.js'
import {
  CROWD_DOT_CELL_LIMIT,
  createCrowdDotBuckets,
  crowdDotCellOf,
  decodeCrowdDotKeys,
  encodeCrowdDotKeys,
  packCrowdDotCell,
  unpackCrowdDotCell
} from '../src/snapshot-lod-pure/crowdDotCells.js'
import {
  buildCrowdDots,
  encodePlayersOnce,
  filterEncodedPlayersAtRate,
  filterEncodedPlayersTiered,
  reducedTickModFor
} from '../src/snapshot-lod-pure/playerLod.js'
import { PLAYER_TIER_REDUCED } from '../src/snapshot-lod-pure/records.js'
import * as lodFnv from '../src/snapshot-lod-pure/fnv1a.js'
import * as sharedFnv from '../src/shared/fnv1a.js'
import { WIRE_STRUCT_HASH, WIRE_STRUCTURES } from '../src/protocol/msgpack.js'
import { createChecksumFold } from '../src/anticheat/LockstepChecksum.js'
import { decodeCrowdDotPoses, crowdPoseBuffer } from '../src/client/crowdDots.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sourceFiles = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name)
  if (statSync(path).isDirectory()) return name === 'engine' ? [] : sourceFiles(path)
  return name.endsWith('.js') ? [path] : []
})
const sources = sourceFiles(join(root, 'src')).map((path) => ({ path: relative(root, path).split('\\').join('/'), text: readFileSync(path, 'utf8') }))

const seeded = (seed) => {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
}

const naivePack = (cx, cz) => cx * 1000003 + cz
const naiveUnpack = (key) => [Math.floor(key / 1000003), key % 1000003]

gate('a crowd dot cell with cx above zero and cz below zero decodes to itself: (30, -30) stays (30, -30)', () => {
  assert.deepEqual(unpackCrowdDotCell(packCrowdDotCell(30, -30)), [30, -30])
  assert.deepEqual(unpackCrowdDotCell(packCrowdDotCell(-30, 30)), [-30, 30])
  assert.deepEqual(unpackCrowdDotCell(packCrowdDotCell(-30, -30)), [-30, -30])
  assert.deepEqual(unpackCrowdDotCell(packCrowdDotCell(30, 30)), [30, 30])
  assert.notDeepEqual(naiveUnpack(naivePack(30, -30)), [30, -30])
})

gate('every cell in a 201 by 201 block around the origin, and each corner of the range, round-trips through one whole number below 2^32', () => {
  const seen = new Set()
  for (let cx = -100; cx <= 100; cx++) {
    for (let cz = -100; cz <= 100; cz++) {
      const key = packCrowdDotCell(cx, cz)
      assert.ok(Number.isInteger(key) && key >= 0 && key < 4294967296, 'key ' + key)
      assert.deepEqual(unpackCrowdDotCell(key), [cx, cz])
      seen.add(key)
    }
  }
  assert.equal(seen.size, 201 * 201)
  const L = CROWD_DOT_CELL_LIMIT
  for (const [cx, cz] of [[L, -L], [-L, L], [L, L], [-L, -L], [0, -L], [L, 0]]) assert.deepEqual(unpackCrowdDotCell(packCrowdDotCell(cx, cz)), [cx, cz])
  let mixedSignWrong = 0
  for (let cx = 1; cx <= 100; cx++) for (let cz = -100; cz < 0; cz++) if (naiveUnpack(naivePack(cx, cz))[0] !== cx) mixedSignWrong++
  assert.equal(mixedSignWrong, 100 * 100, 'control: the single-multiplier key decodes every such cell wrongly')
})

gate('a cell outside the range, a fractional cell, a bad key and a non-finite position are refused', () => {
  assert.throws(() => packCrowdDotCell(CROWD_DOT_CELL_LIMIT + 1, 0), RangeError)
  assert.throws(() => packCrowdDotCell(0, -CROWD_DOT_CELL_LIMIT - 1), RangeError)
  assert.throws(() => packCrowdDotCell(0.5, 0), RangeError)
  assert.throws(() => unpackCrowdDotCell(-1), RangeError)
  assert.throws(() => unpackCrowdDotCell(4294967296), RangeError)
  assert.throws(() => unpackCrowdDotCell(1.5), RangeError)
  assert.throws(() => crowdDotCellOf(NaN, 0), RangeError)
  assert.throws(() => crowdDotCellOf(0, 0, 0), RangeError)
  assert.throws(() => decodeCrowdDotKeys([1]), TypeError)
  assert.throws(() => decodeCrowdDotKeys([1, 0]), RangeError)
  assert.throws(() => encodeCrowdDotKeys([[0, 0, 0]]), RangeError)
})

gate('the keyed buckets hold the same cells and counts as buildCrowdDots over 60 seeded scenes in all four sign quadrants', () => {
  const buckets = createCrowdDotBuckets()
  const keys = []
  const decoded = []
  let players = 0
  let mixed = 0
  for (let scene = 0; scene < 60; scene++) {
    const random = seeded(scene + 1)
    const list = []
    const n = 1 + Math.floor(random() * 80)
    for (let i = 0; i < n; i++) list.push({ position: [(random() - 0.5) * 4000, random() * 10, (random() - 0.5) * 4000] })
    const expected = buildCrowdDots(list, [0, 0, 0])
    buckets.build(list, 25, keys)
    decodeCrowdDotKeys(keys, decoded)
    assert.deepEqual(decoded, expected, 'scene ' + scene)
    assert.deepEqual(encodeCrowdDotKeys(expected), keys, 'scene ' + scene + ' keys')
    players += n
    mixed += expected.filter(([cx, cz]) => cx > 0 && cz < 0).length
  }
  assert.ok(players > 1000, 'players ' + players)
  assert.ok(mixed > 100, 'cells with cx above zero and cz below zero: ' + mixed)
  assert.deepEqual(buckets.build(null, 25, keys), [])
  assert.deepEqual(buckets.build([{ position: [760, 0, -740] }, { position: [770, 0, -745] }, {}], 25, keys), [packCrowdDotCell(30, -30), 2])
})

gate('a keyed dot at cell (30, -30) reaches the client pose at x 762.5 and z -737.5', () => {
  const dots = decodeCrowdDotKeys([packCrowdDotCell(30, -30), 4])
  const poses = crowdPoseBuffer(1)
  assert.equal(decodeCrowdDotPoses(dots, { viewerY: 2 }, poses), 1)
  assert.equal(poses[0], 762.5)
  assert.equal(poses[2], -737.5)
  const wrong = [[...naiveUnpack(naivePack(30, -30)), 4]]
  decodeCrowdDotPoses(wrong, { viewerY: 2 }, poses)
  assert.notEqual(poses[2], -737.5, 'control: the single-multiplier key puts the dot elsewhere')
})

gate('the reduced pose is sent exactly 5 times in every second at every whole snapshot rate from 5 to 240 Hz', () => {
  for (let hz = 5; hz <= 240; hz++) {
    for (const first of [0, hz, 7 * hz, 1000003 * hz]) assert.equal(reducedPosesIn(first, hz, hz), 5, hz + ' Hz from tick ' + first)
    assert.equal(reducedPosesIn(0, 60 * hz, hz), 300, hz + ' Hz over a minute')
  }
})

gate('the rounded modulus is inexact where the exact cadence is not: 12 Hz gives 6 a second by modulus and 5 by cadence', () => {
  const byModulus = (hz) => {
    const mod = reducedTickModFor(hz)
    let sent = 0
    for (let tick = 0; tick < hz; tick++) if (tick % mod === 0) sent++
    return sent
  }
  assert.equal(byModulus(12), 6)
  assert.equal(reducedPosesIn(0, 12, 12), 5)
  const inexact = []
  for (let hz = 5; hz <= 240; hz++) if (byModulus(hz) !== 5) inexact.push(hz)
  assert.ok(inexact.includes(12) && inexact.includes(8) && inexact.length > 50, 'rates the modulus gets wrong: ' + inexact.length)
  assert.equal(byModulus(60), 5)
})

gate('the gaps between reduced poses differ by at most one tick, a rate at or below 5 Hz sends every tick, and a fractional rate holds 5 Hz over a long run', () => {
  for (const hz of [7, 12, 13, 64, 144]) {
    const gaps = new Set()
    let last = -1
    for (let tick = 0; tick < hz * 20; tick++) {
      if (!reducedPoseDue(tick, hz)) continue
      if (last >= 0) gaps.add(tick - last)
      last = tick
    }
    const sorted = [...gaps].sort((a, b) => a - b)
    assert.ok(sorted.length <= 2 && sorted[sorted.length - 1] - sorted[0] <= 1, hz + ' Hz gaps ' + sorted)
  }
  for (const hz of [1, 3, 5]) assert.equal(reducedPosesIn(0, 50, hz), 50)
  assert.equal(reducedPosesIn(0, 599, 59.9), 50)
  assert.equal(reducedPosesIn(0, 100, 20, 10), 50)
  assert.throws(() => reducedPoseDue(-1, 60), RangeError)
  assert.throws(() => reducedPoseDue(0.5, 60), RangeError)
  assert.throws(() => reducedPoseDue(0, 0), RangeError)
  assert.throws(() => reducedPoseDue(0, NaN), RangeError)
  assert.throws(() => reducedPoseDue(0, 60, 0), RangeError)
})

gate('filterEncodedPlayersAtRate sends a reduced player 5 times a second at 12 Hz, where the modulus filter sends it 6 times', () => {
  const players = []
  for (let i = 0; i < 33; i++) players.push({ id: i + 1, position: [i < 31 ? i : 40 + i, 0, 0], rotation: [0, 0, 0, 1], velocity: [0, 0, 0], lookYaw: 0, lookPitch: 0 })
  const byId = new Map(players.map((p) => [p.id, p]))
  const ids = players.map((p) => p.id)
  const encoded = encodePlayersOnce(players)
  const reducedIn = (records) => records.filter((r) => r.length === 5 && r[4] === PLAYER_TIER_REDUCED).length
  let exact = 0
  let modulus = 0
  const mod = reducedTickModFor(12)
  for (let tick = 0; tick < 12; tick++) {
    exact += reducedIn(filterEncodedPlayersAtRate(encoded, byId, ids, 1, [0, 0, 0], tick, 12).players)
    modulus += reducedIn(filterEncodedPlayersTiered(encoded, byId, ids, 1, [0, 0, 0], tick, mod).players)
  }
  assert.equal(exact, 2 * 5)
  assert.equal(modulus, 2 * 6)
  const due = filterEncodedPlayersAtRate(encoded, byId, ids, 1, [0, 0, 0], 2, 12)
  const idle = filterEncodedPlayersAtRate(encoded, byId, ids, 1, [0, 0, 0], 0, 12)
  assert.equal(due.players.length, 1 + 30 + 2)
  assert.equal(idle.players.length, 1 + 30)
  assert.deepEqual(due.dots, idle.dots)
})

gate('the FNV-1a step functions are defined once, in src/shared/fnv1a.js, and the protocol, checksum and snapshot modules import them', () => {
  const stepDefinition = /Math\.imul\([^)]*\^[^)]*,\s*FNV1A_32_PRIME\)/
  const named = ['src/protocol/msgpack.js', 'src/anticheat/LockstepChecksum.js', 'src/snapshot-lod-pure/fnv1a.js', 'src/snapshot-lod-pure/entityDelta.js']
  for (const path of named) {
    const text = sources.find((s) => s.path === path).text
    assert.ok(!stepDefinition.test(text), path + ' defines its own step')
    assert.ok(!/0x811c9dc5|0x0?1000193|16777619|2166136261/i.test(text), path + ' repeats an FNV constant')
    assert.ok(/fnv1a\.js'/.test(text), path + ' does not import the shared step')
  }
  const definers = sources.filter((s) => /FNV1A_32_PRIME\s*=/.test(s.text)).map((s) => s.path)
  assert.deepEqual(definers, ['src/shared/fnv1a.js'])
  assert.ok(stepDefinition.test(sources.find((s) => s.path === 'src/shared/fnv1a.js').text), 'control: the pattern finds the shared definition')
  for (const name of Object.keys(sharedFnv)) assert.equal(lodFnv[name], sharedFnv[name], name)
})

gate('the shared steps keep the pinned values: the FNV-1a test vectors, the wire structure hash and the checksum digest', () => {
  const { FNV1A_32_OFFSET_BASIS, fnv1aStepBytes, fnv1aStepFloat32, fnv1aStepFloat64, fnv1aStepString } = sharedFnv
  assert.equal(fnv1aStepString(FNV1A_32_OFFSET_BASIS, 'a') >>> 0, 0xe40c292c)
  assert.equal(fnv1aStepString(FNV1A_32_OFFSET_BASIS, 'foobar') >>> 0, 0xbf9cf968)
  assert.equal(fnv1aStepBytes(FNV1A_32_OFFSET_BASIS, new TextEncoder().encode('foobar')) >>> 0, 0xbf9cf968)
  assert.equal(fnv1aStepFloat32(FNV1A_32_OFFSET_BASIS, 1) >>> 0, fnv1aStepBytes(FNV1A_32_OFFSET_BASIS, [0x3f, 0x80, 0, 0]) >>> 0)
  assert.equal(fnv1aStepFloat64(FNV1A_32_OFFSET_BASIS, 1) >>> 0, fnv1aStepBytes(FNV1A_32_OFFSET_BASIS, [0x3f, 0xf0, 0, 0, 0, 0, 0, 0]) >>> 0)
  assert.equal(fnv1aStepFloat64(FNV1A_32_OFFSET_BASIS, 1, 1) >>> 0, fnv1aStepBytes(FNV1A_32_OFFSET_BASIS, [0x40, 0xf1, 1, 1, 1, 1, 1, 1]) >>> 0)
  let hash = FNV1A_32_OFFSET_BASIS
  for (const fields of WIRE_STRUCTURES) {
    hash = fnv1aStepString(hash, '|')
    for (const field of fields) hash = fnv1aStepString(fnv1aStepString(hash, field), ',')
  }
  assert.equal(WIRE_STRUCT_HASH, (hash >>> 0).toString(16))
  const digest = createChecksumFold().pushInt(7).push(1.5).push(-0).digest()
  let laneA = FNV1A_32_OFFSET_BASIS
  let laneB = 0x1000193
  for (const n of [7, 1.5, 0]) {
    laneA = fnv1aStepFloat64(laneA, n)
    laneB = fnv1aStepFloat64(laneB, n, 1)
  }
  assert.equal(digest, (laneA >>> 0).toString(16).padStart(8, '0') + (laneB >>> 0).toString(16).padStart(8, '0'))
  assert.notEqual(fnv1aStepString(FNV1A_32_OFFSET_BASIS, 'foobaz') >>> 0, 0xbf9cf968)
})

gate('the name packQuat belongs to one module, the spoint-core 10-bit packer; the snapshot 32-bit word is packRotationWord', () => {
  const owners = sources.filter((s) => /export\s+(function|const)\s+packQuat\b/.test(s.text)).map((s) => s.path)
  assert.deepEqual(owners, ['src/packages/spoint-core/quaternion.js'])
  const unpackOwners = sources.filter((s) => /export\s+(function|const)\s+unpackQuat\b/.test(s.text)).map((s) => s.path)
  assert.deepEqual(unpackOwners, ['src/packages/spoint-core/quaternion.js'])
  const users = sources.filter((s) => /\bpackQuat\b/.test(s.text) && s.path.startsWith('src/snapshot-lod-pure/')).map((s) => s.path)
  assert.deepEqual(users, [])
  const records = sources.find((s) => s.path === 'src/snapshot-lod-pure/records.js').text
  assert.ok(/export const packRotationWord\b/.test(records) && /export const unpackRotationWord\b/.test(records))
})

finish()
