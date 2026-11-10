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

const { planetCellSize } = await import(pathToFileURL(join(root, 'src/engine/pageLayout.js')).href)
const PLANET = { radius: 6371000, gravity: 9.8, maxHeight: 8000 }
const engineGlue = await import(pathToFileURL(join(root, 'engine/out/engine-core-64mib.mjs')).href)
const engine = await engineGlue.default()
if (engine._engine_init(64, 1, 67108864) !== 0) throw new Error('engine_init failed')
if (engine._engine_world_configure(2048, 60, -9.8, 0, 0.5, 0, 8) !== 0) throw new Error('engine_world_configure failed')
if (engine._engine_planet_configure(PLANET.radius, planetCellSize(PLANET.radius), PLANET.gravity, PLANET.maxHeight) !== 0) throw new Error('engine_planet_configure failed')
const sampleGrid = () => {
  const started = performance.now()
  const step = EXTENT / (N - 1)
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) engine._engine_planet_height(CORNER + i * step, PLANET.radius, CORNER + j * step)
  }
  return performance.now() - started
}
const jayzeeSamples = []
for (let i = 0; i < builds; i++) jayzeeSamples.push(sampleGrid())

const quantile = (values, q) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
}
const summariseValues = (values) => ({ p50: quantile(values, 0.5), p99: quantile(values, 0.99), max: Math.max(...values), mean: values.reduce((a, b) => a + b, 0) / values.length })
const summarise = (key) => summariseValues(steps.map((s) => s[key]))

const witness = execFileSync(join(root, 'build/engine-host-witness/engine-witness'), { encoding: 'utf8', timeout: 120000 })
const phase5Line = witness.split('\n').find((line) => line.startsWith('INFO phase 5: flight frame-time p99 in ms'))
if (!phase5Line) throw new Error('the native witness printed no phase 5 frame-time p99 line')
const jayzeePhase5P99Ms = Number(phase5Line.trim().split(' ').pop())

const spointHead = execFileSync('git', ['-C', spoint, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim()
const spointDirty = execFileSync('git', ['-C', spoint, 'status', '--short', '--', 'src/terrain', 'src/physics'], { encoding: 'utf8' }).trim()

const out = {
  spoint: { head: spointHead, dirtyInStreamerPaths: spointDirty === '' ? [] : spointDirty.split('\n'), field: { N, extentM: EXTENT, builds }, timeMs: { sample: summarise('sampleMs'), add: summarise('addMs'), total: summarise('totalMs') } },
  jayzee: {
    phase5FlightFrameP99Ms: jayzeePhase5P99Ms,
    source: 'build/engine-host-witness/engine-witness, INFO phase 5 line',
    sampleGridMs: summariseValues(jayzeeSamples),
    sampleGridOperation: 'engine_planet_height at the 33 by 33 grid over 256 m, 64 MiB build, Node, same host as spoint',
  },
  likeForLike: {
    operation: 'sample a 33 by 33 height grid over 256 m, once per build',
    spointSampleP99Ms: summarise('sampleMs').p99,
    jayzeeSampleP99Ms: summariseValues(jayzeeSamples).p99,
    ratioSpointOverJayzee: summarise('sampleMs').p99 / summariseValues(jayzeeSamples).p99,
  },
  ratio: { spointStepP99OverPhase5P99: summarise('totalMs').p99 / jayzeePhase5P99Ms },
  caveat: 'The likeForLike row compares the same sampling operation on the same grid, on the same host. spoint samples with a JavaScript height function and jayzee samples with the engine export, so the call boundary differs. The ratio row compares one streamer step with one native flight frame, which are different operations. The unit is ms in both.',
}
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, JSON.stringify(out, null, 1) + '\n')
console.log(JSON.stringify(out, null, 1))
