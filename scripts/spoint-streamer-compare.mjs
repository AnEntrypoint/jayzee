import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const spoint = resolve(process.env.SPOINT_ROOT ?? '/workspace/spoint')
const builds = Number(process.argv[2] ?? '200')
const outPath = resolve(root, process.argv[3] ?? 'build/diag/item1/compare.json')
if (!Number.isInteger(builds) || builds < 20) throw new RangeError('builds must be a whole number of at least 20')

const { PhysicsWorld } = await import(pathToFileURL(join(spoint, 'src/physics/World.js')).href)
const { timeFieldSteps } = await import(pathToFileURL(join(spoint, 'src/terrain/HeightfieldStreamer.js')).href)

const N = 33
const EXTENT = 256
const CORNER = -128
const world = new PhysicsWorld({ gravity: [0, -9.8, 0] })
await world.init()
const steps = []
for (let i = 0; i < builds; i++) {
  const phase = i * 0.37
  const heightFn = (x, z) => Math.sin((x + phase) * 0.01) * 4 + z * 0.001
  steps.push(await timeFieldSteps({ physics: world, heightFn, N, extent: EXTENT, cornerX: CORNER, cornerZ: CORNER }))
}

const quantile = (values, q) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
}
const summarise = (key) => {
  const values = steps.map((s) => s[key])
  return { p50: quantile(values, 0.5), p99: quantile(values, 0.99), max: Math.max(...values), mean: values.reduce((a, b) => a + b, 0) / values.length }
}

const witness = execFileSync(join(root, 'build/engine-host-witness/engine-witness'), { encoding: 'utf8', timeout: 120000 })
const phase5Line = witness.split('\n').find((line) => line.startsWith('INFO phase 5: flight frame-time p99 in ms'))
if (!phase5Line) throw new Error('the native witness printed no phase 5 frame-time p99 line')
const jayzeePhase5P99Ms = Number(phase5Line.trim().split(' ').pop())

const spointHead = execFileSync('git', ['-C', spoint, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim()
const spointDirty = execFileSync('git', ['-C', spoint, 'status', '--short', '--', 'src/terrain', 'src/physics'], { encoding: 'utf8' }).trim()

const out = {
  spoint: { head: spointHead, dirtyInStreamerPaths: spointDirty === '' ? [] : spointDirty.split('\n'), field: { N, extentM: EXTENT, builds }, timeMs: { sample: summarise('sampleMs'), add: summarise('addMs'), total: summarise('totalMs') } },
  jayzee: { phase5FlightFrameP99Ms: jayzeePhase5P99Ms, source: 'build/engine-host-witness/engine-witness, INFO phase 5 line' },
  ratio: { spointStepP99OverPhase5P99: summarise('totalMs').p99 / jayzeePhase5P99Ms },
  caveat: 'Different operations: spoint is one HeightfieldStreamer step (sample and Jolt add) per build; jayzee phase 5 is the per-frame flight time of the native planet witness. The unit is the same (ms), the path is not.',
}
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, JSON.stringify(out, null, 1) + '\n')
console.log(JSON.stringify(out, null, 1))
