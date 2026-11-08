import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { buildCrowdDots, filterEncodedPlayersTiered, reducedTickModFor } from '../src/snapshot-lod-pure/playerLod.js'
import { CROWD_DOT_CELL_M, PLAYER_LOD_REDUCED_HZ } from '../src/snapshot-lod-pure/constants.js'
import { decodeEntityRecord, ENTITY_RECORD_BYTES } from '../src/wire/binSnapshot.js'
import { crowdDotScale, decodeCrowdDots } from '../src/client/crowdDots.js'

const fixture = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'spoint', 'crowd-dots.json'), 'utf8'))
const hexBytes = (hex) => Uint8Array.from(hex.match(/../g), (h) => parseInt(h, 16))
const crowdPlayers = fixture.crowd.positions.map((position, i) => ({ id: i + 1, position }))
const origin = [0, 0, 0]
const cadenceAt = (hz) => fixture.cadence.find((row) => row.snapshotHz === hz)
const sentReduced = (out) => out.players.some((p) => Array.isArray(p))

gate('fixture is spoint output: 25 m cells, dot size 1.4, viewer height 2', () => {
  assert.equal(fixture.cellM, CROWD_DOT_CELL_M)
  assert.equal(fixture.dotSize, 1.4)
  assert.equal(fixture.viewerY, 2)
})

gate('buildCrowdDots reproduces spoint dots for every crowd position', () => {
  assert.deepEqual(buildCrowdDots(crowdPlayers, origin, CROWD_DOT_CELL_M), fixture.crowd.dots)
})

gate('spoint fixture: world (30, -30) is cell (1, -2) and is reported at (1, -2)', () => {
  assert.deepEqual(buildCrowdDots([{ position: [30, 0, -30] }], origin, CROWD_DOT_CELL_M), [[1, -2, 1]])
  assert.deepEqual(fixture.crowd.dots[2], [1, -2, 1])
})

gate('spoint fixture: cell (2, -3) is reported at (2, -3)', () => {
  assert.deepEqual(buildCrowdDots([{ position: [60, 0, -60] }], origin, CROWD_DOT_CELL_M), [[2, -3, 1]])
  assert.deepEqual(fixture.crowd.dots[4], [2, -3, 1])
})

gate('negative control: no crowd dot carries a packed key, so every reported cz is within the grid', () => {
  for (const [, cz] of buildCrowdDots(crowdPlayers, origin, CROWD_DOT_CELL_M)) assert.ok(Math.abs(cz) < 1000, 'cz ' + cz)
})

gate('cells with cx below 0 and cz below 0 round-trip through the bucket key', () => {
  assert.deepEqual(buildCrowdDots([{ position: [-30, 0, -30] }], origin, CROWD_DOT_CELL_M), [[-2, -2, 1]])
  assert.deepEqual(buildCrowdDots([{ position: [-3, 0, -30] }], origin, CROWD_DOT_CELL_M), [[-1, -2, 1]])
})

gate('cell (-1, 5) with cx below 0 and cz above 0 is reported at (-1, 5), as the spoint fixture has it', () => {
  assert.deepEqual(fixture.wrap.dots, [[-1, 5, 1]])
  assert.deepEqual(buildCrowdDots([{ position: [-3, 0, 125] }], origin, CROWD_DOT_CELL_M), fixture.wrap.dots)
})

gate('a count of 100 in one cell is one bucket that spoint also reports', () => {
  const many = Array.from({ length: 100 }, (_, i) => ({ id: 1000 + i, position: [55, 0, 55] }))
  assert.deepEqual(buildCrowdDots(many, origin, CROWD_DOT_CELL_M), fixture.cap.dots)
})

gate('client pose of spoint bucket dots matches spoint PlayerLOD arithmetic', () => {
  assert.deepEqual(decodeCrowdDots(fixture.crowd.dots, { dotCellM: CROWD_DOT_CELL_M, dotSize: fixture.dotSize, viewerY: fixture.viewerY }), fixture.crowd.poses)
})

gate('client pose of cell (0, 1) is placed at z 37.5, not at a packed key', () => {
  const pose = decodeCrowdDots([[0, 1, 1]], { dotCellM: CROWD_DOT_CELL_M, viewerY: 2 })[0]
  assert.equal(pose.z, 37.5)
  assert.equal(pose.x, 12.5)
  assert.notEqual(pose.z, 25000037.5)
})

gate('scale caps at three times the dot size for dense cells', () => {
  assert.equal(crowdDotScale(100, fixture.dotSize), fixture.cap.pose.scale)
  assert.equal(decodeCrowdDots(fixture.cap.dots, { viewerY: 2 })[0].scale, fixture.cap.pose.scale)
  assert.ok(Math.abs(fixture.cap.pose.scale - 4.2) < 1e-12)
  assert.equal(crowdDotScale(1, 1.4), 1.4 * 0.95)
})

gate('a ground function replaces the viewer height for bucket dots', () => {
  const pose = decodeCrowdDots([[0, 0, 1]], { dotCellM: 25, viewerY: 2, groundHeightFn: () => 7 })[0]
  assert.equal(pose.y, 7.05)
  assert.notEqual(pose.y, 2.05)
})

gate('flat player dots use their own height and the dot size', () => {
  assert.deepEqual(decodeCrowdDots([fixture.flat.sample], { viewerY: 99 }), [fixture.flat.pose])
})

gate('cadence: spoint reduced-tick modulus equals jayzee reducedTickModFor at every rate', () => {
  for (const row of fixture.cadence) assert.equal(reducedTickModFor(row.snapshotHz), row.reducedTickMod, 'rate ' + row.snapshotHz)
  assert.equal(PLAYER_LOD_REDUCED_HZ, 5)
})

gate('cadence: 12 Hz gives 6 reduced sends per second, matching spoint', () => {
  assert.equal(cadenceAt(12).reducedPerSecond, 6)
  assert.equal(reducedTickModFor(12), 2)
})

gate('cadence: 20 Hz gives 5 reduced sends per second, matching spoint', () => {
  assert.equal(cadenceAt(20).reducedPerSecond, 5)
  assert.equal(reducedTickModFor(20), 4)
})

gate('cadence: jayzee tiered output equals spoint output tick for tick at every rate', () => {
  const encodedMap = new Map(Array.from({ length: 32 }, (_, i) => [i + 1, 'enc' + (i + 1)]))
  const playersById = new Map()
  const nearbyIds = []
  for (let i = 1; i <= 30; i++) { playersById.set(i, { id: i, position: [4 + i, 0, 0], lookYaw: 0.5 }); nearbyIds.push(i) }
  playersById.set(31, { id: 31, position: [50, 0, 0], lookYaw: 0.5 }); nearbyIds.push(31)
  playersById.set(32, { id: 32, position: [150, 0, 0], lookYaw: 0.5 }); nearbyIds.push(32)
  for (const row of fixture.cadence) {
    for (const expected of row.ticks) {
      const out = filterEncodedPlayersTiered(encodedMap, playersById, nearbyIds, 0, origin, expected.tick, row.reducedTickMod)
      assert.deepEqual(JSON.parse(JSON.stringify(out.players)), expected.players, row.snapshotHz + ' Hz tick ' + expected.tick)
      assert.deepEqual(out.dots, expected.dots, row.snapshotHz + ' Hz tick ' + expected.tick)
    }
  }
})

gate('negative control: with the modulus forced to 1, 12 Hz gives 12 reduced sends, not 6', () => {
  const encodedMap = new Map(Array.from({ length: 32 }, (_, i) => [i + 1, 'enc' + (i + 1)]))
  const playersById = new Map()
  const nearbyIds = []
  for (let i = 1; i <= 30; i++) { playersById.set(i, { id: i, position: [4 + i, 0, 0], lookYaw: 0.5 }); nearbyIds.push(i) }
  playersById.set(31, { id: 31, position: [50, 0, 0], lookYaw: 0.5 }); nearbyIds.push(31)
  let sent = 0
  for (let tick = 0; tick < 12; tick++) if (sentReduced(filterEncodedPlayersTiered(encodedMap, playersById, nearbyIds, 0, origin, tick, 1))) sent++
  assert.equal(sent, 12)
  assert.notEqual(sent, cadenceAt(12).reducedPerSecond)
})

gate('cached entity records: spoint 29-byte records decode through jayzee to spoint values', () => {
  assert.equal(ENTITY_RECORD_BYTES, 29)
  for (const sample of fixture.records) {
    const bytes = hexBytes(sample.hex)
    assert.equal(bytes.length, 29, sample.name)
    const got = decodeEntityRecord(bytes)
    const want = sample.decoded
    assert.deepEqual(got.position, [want.px, want.py, want.pz], sample.name + ' position')
    assert.deepEqual(got.velocity, [want.vx, want.vy, want.vz], sample.name + ' velocity')
    assert.deepEqual(got.scale, [want.sx, want.sy, want.sz], sample.name + ' scale')
    assert.equal(got.rotationWord, want.qrot, sample.name + ' rotation word')
    assert.equal(got.flags, want.flags, sample.name + ' flags')
  }
})

gate('negative control: a changed flags byte in a spoint record is seen as a different flags value', () => {
  const sample = fixture.records[0]
  const bytes = hexBytes(sample.hex)
  bytes[28] = bytes[28] ^ 0x01
  assert.notEqual(decodeEntityRecord(bytes).flags, sample.decoded.flags)
})

gate('negative control: a truncated 28-byte cached record is refused, not read', () => {
  assert.throws(() => decodeEntityRecord(hexBytes(fixture.records[0].hex).subarray(0, 28)))
})

gate('negative control: a wrong quantum (one record shifted by 0.01 m) is not equal to the spoint value', () => {
  const sample = fixture.records[0]
  const got = decodeEntityRecord(hexBytes(sample.hex))
  assert.notDeepEqual(got.position, [sample.decoded.px + 0.01, sample.decoded.py, sample.decoded.pz])
})

finish()
