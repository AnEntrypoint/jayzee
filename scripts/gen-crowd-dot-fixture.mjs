import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const spointRoot = resolve(process.argv[2] ?? '/workspace/spoint')
const outDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'spoint')

const encoder = await import(join(spointRoot, 'src/netcode/SnapshotEncoder.js'))
const binFormat = await import(join(spointRoot, 'src/netcode/SnapshotBinFormat.js'))

const CELL_M = 25
const DOT_SIZE = 1.4
const VIEWER_Y = 2
const LIFT = 0.05
const ORIGIN = [0, 0, 0]

const crowdPositions = [
  [1, 0, 1], [-3, 0, -30], [30, 0, -30], [30, 0, 30], [60, 0, -60],
  [-30, 0, 30], [-30, 0, -30], [26, 0, -1], [0, 0, -0.5], [1, 0, 1]
]
const crowdPlayers = crowdPositions.map((position, i) => ({ id: i + 1, position }))
const crowdDots = encoder.buildCrowdDots(crowdPlayers, ORIGIN, CELL_M)
const crowdPoses = crowdDots.map(([cx, cz, count]) => ({
  x: (cx + 0.5) * CELL_M,
  y: VIEWER_Y + LIFT,
  z: (cz + 0.5) * CELL_M,
  scale: DOT_SIZE * Math.min(3, 0.6 + Math.sqrt(count) * 0.35)
}))

const capDots = encoder.buildCrowdDots(Array.from({ length: 100 }, (_, i) => ({ id: 1000 + i, position: [55, 0, 55] })), ORIGIN, CELL_M)
const capPose = { x: (capDots[0][0] + 0.5) * CELL_M, y: VIEWER_Y + LIFT, z: (capDots[0][1] + 0.5) * CELL_M, scale: DOT_SIZE * Math.min(3, 0.6 + Math.sqrt(capDots[0][2]) * 0.35) }

const wrapPositions = [[-3, 0, 125]]
const wrapDots = encoder.buildCrowdDots(wrapPositions.map((position, i) => ({ id: i + 1, position })), ORIGIN, CELL_M)

const flatSample = { x: 3, y: 1, z: -4 }
const flatPose = { x: flatSample.x, y: flatSample.y + LIFT, z: flatSample.z, scale: DOT_SIZE }

const reducedHz = encoder.PLAYER_LOD_REDUCED_HZ
const playersById = new Map()
const nearbyIds = []
for (let i = 1; i <= 30; i++) { playersById.set(i, { id: i, position: [4 + i, 0, 0], lookYaw: 0.5 }); nearbyIds.push(i) }
playersById.set(31, { id: 31, position: [50, 0, 0], lookYaw: 0.5 }); nearbyIds.push(31)
playersById.set(32, { id: 32, position: [150, 0, 0], lookYaw: 0.5 }); nearbyIds.push(32)
const encodedMap = new Map(nearbyIds.map((id) => [id, 'enc' + id]))

const cadence = [12, 20, 10, 30, 7].map((snapshotHz) => {
  const reducedTickMod = Math.max(1, Math.round(snapshotHz / reducedHz))
  const ticks = []
  for (let tick = 0; tick < snapshotHz; tick++) {
    const out = encoder.filterEncodedPlayersTiered(encodedMap, playersById, nearbyIds, 0, ORIGIN, tick, reducedTickMod)
    ticks.push({ tick, players: out.players, dots: out.dots })
  }
  const reducedPerSecond = ticks.filter((t) => t.players.some((p) => Array.isArray(p))).length
  return { snapshotHz, reducedTickMod, reducedPerSecond, ticks }
})

const recordSamples = [
  { name: 'cached-near-entity', px: 12.5, py: 1.25, pz: -40.75, qrot: 0x1234567, vx: 0.5, vy: -0.25, vz: 3, sx: 1, sy: 2.5, sz: 0.75, flags: 5 },
  { name: 'cached-far-entity', px: -120.01, py: 0, pz: 300, qrot: 0x2ABCDEF, vx: -1.5, vy: 0, vz: 0.01, sx: 0.5, sy: 0.5, sz: 0.5, flags: 255 }
].map((s) => {
  const bytes = binFormat.packBinRecord(s.px, s.py, s.pz, s.qrot, s.vx, s.vy, s.vz, s.sx, s.sy, s.sz, s.flags)
  const decoded = binFormat.unpackBinRecord(bytes, {})
  return { name: s.name, hex: Buffer.from(bytes).toString('hex'), decoded }
})

const payload = {
  generatedFrom: 'spoint src/netcode/SnapshotEncoder.js buildCrowdDots and filterEncodedPlayersTiered, PLAYER_LOD_REDUCED_HZ, src/netcode/SnapshotBinFormat.js packBinRecord and unpackBinRecord, client/core/PlayerLOD.js update pose arithmetic',
  cellM: CELL_M,
  dotSize: DOT_SIZE,
  viewerY: VIEWER_Y,
  crowd: { positions: crowdPositions, dots: crowdDots, poses: crowdPoses },
  cap: { count: 100, dots: capDots, pose: capPose },
  wrap: { positions: wrapPositions, dots: wrapDots },
  flat: { sample: flatSample, pose: flatPose },
  cadence,
  records: recordSamples
}

const text = JSON.stringify(payload, null, 2) + '\n'
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'crowd-dots.json'), text)
const sha256 = createHash('sha256').update(text).digest('hex')
console.log(`wrote crowd-dots.json ${text.length} chars sha256 ${sha256}`)
console.log(JSON.stringify({ crowdDots, capDots, cadence: cadence.map((c) => [c.snapshotHz, c.reducedTickMod, c.reducedPerSecond]) }))
