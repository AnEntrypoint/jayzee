import { writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { bytesOf, enc, runSample, runCarve, runErode, runStamps, replayField } from './lib/spline-erosion-codec.mjs'

const SPOINT_ROOT = '/workspace/spoint'
const SPOINT_TERRAIN = join(SPOINT_ROOT, 'src', 'terrain')
const SOURCE_FILES = ['SplineCarve.js', 'TerrainErosion.js', 'ContactOcclusionField.js']

const spline = await import(pathToFileURL(join(SPOINT_TERRAIN, 'SplineCarve.js')).href)
const erosion = await import(pathToFileURL(join(SPOINT_TERRAIN, 'TerrainErosion.js')).href)
const contact = await import(pathToFileURL(join(SPOINT_TERRAIN, 'ContactOcclusionField.js')).href)

const mulberry32 = (seed) => {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rng = mulberry32(20260711)
const between = (lo, hi) => lo + (hi - lo) * rng()

const terrain = (width, nanCell = -1) => {
  const h = new Float32Array(width * width)
  for (let z = 0; z < width; z++) {
    for (let x = 0; x < width; x++) {
      h[z * width + x] = 10 * Math.sin(x * 0.3) + 5 * Math.cos(z * 0.5) + between(0, 2) + 0.2 * x
    }
  }
  if (nanCell >= 0) h[nanCell] = NaN
  return h
}

const placements = (count, lo, hi, species) => {
  const out = []
  for (let i = 0; i < count; i++) {
    out.push({
      x: between(lo, hi),
      z: between(lo, hi),
      scale: between(0.5, 2.5),
      species: species[i % species.length],
    })
  }
  return out
}

const sampleCases = [
  { name: 'open polyline, step 1', input: { controlPoints: [[0, 0], [10, 0], [10, 10]], stepSize: 1 } },
  { name: 'closed polyline, step 1', input: { controlPoints: [[0, 0], [10, 0], [10, 10]], stepSize: 1, closed: true } },
  { name: 'object points, step 2.5', input: { controlPoints: [{ x: 0, z: 0 }, { x: 5, z: 8 }, { x: 14, z: 3 }, { x: 22, z: 17 }, { x: 30, z: 10 }], stepSize: 2.5 } },
  { name: 'coincident points', input: { controlPoints: [[1, 1], [1, 1]], stepSize: 3 } },
  { name: 'single point is refused', input: { controlPoints: [[4, 4]], stepSize: 1 } },
  { name: 'null points are refused', input: { controlPoints: null, stepSize: 1 } },
  { name: 'fractional step on long segment', input: { controlPoints: [[-20, 3], [0, -6], [25, 9], [40, 40]], stepSize: 0.7 } },
]

const carveBase = { width: 24, spacing: 2, cornerX: -10, cornerZ: -10, controlPoints: [[0, 0], [15, 5], [30, -5], [40, 20]], carveWidth: 6, carveDepth: 1.5 }
const carveNaN = terrain(24, 6 * 24 + 10)
const carveCases = [
  { name: 'river, no bank', input: { ...carveBase, heightsB64: bytesOf(terrain(24)), opts: {} } },
  { name: 'road with bank 4', input: { ...carveBase, heightsB64: bytesOf(terrain(24)), opts: { bankWidth: 4, flag: 'road' } } },
  { name: 'object control points with bank 2', input: { ...carveBase, controlPoints: [{ x: 0, z: 0 }, { x: 15, z: 5 }, { x: 30, z: -5 }, { x: 40, z: 20 }], heightsB64: bytesOf(terrain(24)), opts: { bankWidth: 2 } } },
  { name: 'negative depth raises the bed', input: { ...carveBase, spacing: 0.5, width: 40, cornerX: -2, cornerZ: -2, carveDepth: -0.75, heightsB64: bytesOf(terrain(40)), opts: {} } },
  { name: 'non-finite cell on the path is skipped', input: { ...carveBase, heightsB64: bytesOf(carveNaN), opts: { bankWidth: 3 } } },
  { name: 'width below 2 returns the input', input: { ...carveBase, width: 1, heightsB64: bytesOf(terrain(24)), opts: {} } },
  { name: 'zero carve width returns the input', input: { ...carveBase, carveWidth: 0, heightsB64: bytesOf(terrain(24)), opts: {} } },
]

const erodeCases = [
  { name: 'defaults on a 17 grid', input: { width: 17, spacing: 1, heightsB64: bytesOf(terrain(17)), opts: {} } },
  { name: 'seed 7, 300 drops, spacing 2', input: { width: 21, spacing: 2, heightsB64: bytesOf(terrain(21)), opts: { seed: 7, drops: 300 } } },
  { name: 'negative seed with tuned rates', input: { width: 25, spacing: 1, heightsB64: bytesOf(terrain(25)), opts: { seed: -5, drops: 400, capacity: 0.02, deposition: 0.03, erosion: 0.02, evaporation: 0.05, minSlope: 0.0005 } } },
  { name: 'non-finite cell is skipped by addHeight', input: { width: 9, spacing: 1, heightsB64: bytesOf(terrain(9, 4 * 9 + 4)), opts: { seed: 3, drops: 120 } } },
  { name: 'width below 3 returns the input', input: { width: 2, spacing: 1, heightsB64: bytesOf(terrain(2)), opts: {} } },
  { name: 'zero spacing returns the input', input: { width: 9, spacing: 0, heightsB64: bytesOf(terrain(9)), opts: {} } },
]

const treeSpecies = [1, 4, 9, 10, 2]
const stampCases = [
  { name: 'tree stamps with bush species', kind: 'tree', placements: placements(12, 0, 64, treeSpecies) },
  { name: 'rock stamps', kind: 'rock', placements: placements(6, 0, 64, [0]) },
  { name: 'empty placement list', kind: 'tree', placements: [] },
]

const treeA = runStamps(contact, 'tree', placements(6, 4, 28, treeSpecies))
const rockB = runStamps(contact, 'rock', placements(4, 4, 28, [0]))
const treeD = runStamps(contact, 'tree', placements(6, 290, 310, treeSpecies))
const rockE = runStamps(contact, 'rock', placements(4, 290, 310, [0]))
const treeF = runStamps(contact, 'tree', placements(16, 100, 400, treeSpecies))
const rockF = runStamps(contact, 'rock', placements(8, 100, 400, [0]))
const treeG = runStamps(contact, 'tree', placements(6, 30, 50, treeSpecies))

const contactCases = [
  {
    name: 'small window: load, unload, slack and moving recentre',
    spec: {
      options: { windowM: 32, texelM: 0.5 },
      ops: [
        { op: 'load', key: 'trees-a', stamps: treeA },
        { op: 'load', key: 'rocks-b', stamps: rockB },
        { op: 'load', key: 'empty-c', stamps: [] },
        { op: 'unload', key: 'trees-a' },
        { op: 'unload', key: 'missing' },
        { op: 'recentre', x: 40, z: 40 },
        { op: 'recentre', x: 41, z: 40 },
        { op: 'load', key: 'trees-d', stamps: treeD },
        { op: 'recentre', x: 300, z: 300 },
        { op: 'load', key: 'rocks-e', stamps: rockE },
        { op: 'load', key: 'rocks-b', stamps: rockB },
        { op: 'unload', key: 'rocks-b' },
      ],
    },
  },
  {
    name: 'default window: tree and rock chunks, then recentre',
    spec: {
      options: {},
      ops: [
        { op: 'load', key: 'tree-f', stamps: treeF },
        { op: 'load', key: 'rock-f', stamps: rockF },
        { op: 'recentre', x: 250, z: 250 },
        { op: 'unload', key: 'tree-f' },
        { op: 'load', key: 'tree-g', stamps: treeG },
      ],
    },
  },
]

const sourceDigests = {}
for (const file of SOURCE_FILES) {
  sourceDigests[file] = createHash('sha256').update(readFileSync(join(SPOINT_TERRAIN, file))).digest('hex')
}

const commit = execFileSync('git', ['-C', SPOINT_ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()

const fixture = {
  version: 1,
  generator: 'scripts/gen-spline-erosion-fixture.mjs',
  codec: 'scripts/lib/spline-erosion-codec.mjs',
  source: { repo: SPOINT_ROOT, commit, files: sourceDigests, dir: 'src/terrain' },
  sampleSpline: sampleCases.map((c) => ({ name: c.name, input: c.input, expected: enc(runSample(spline, c.input)) })),
  carveSpline: carveCases.map((c) => ({ name: c.name, input: c.input, expected: enc(runCarve(spline, c.input)) })),
  hydraulicErode: erodeCases.map((c) => ({ name: c.name, input: c.input, expected: enc(runErode(erosion, c.input)) })),
  contactStamps: stampCases.map((c) => ({ name: c.name, kind: c.kind, placements: c.placements, expected: enc(runStamps(contact, c.kind, c.placements)) })),
  contactField: contactCases.map((c) => ({ name: c.name, spec: c.spec, steps: enc(replayField(contact, c.spec)) })),
}

const outDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'spoint')
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'spline-erosion.json'), JSON.stringify(fixture, null, 1) + '\n')
console.log('wrote ' + join(outDir, 'spline-erosion.json'))
console.log('spoint commit ' + commit)
