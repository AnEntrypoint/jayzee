import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { bakeCodeVersion as portBakeCodeVersion } from '../src/terrain-pure/bakeCodeVersion.js'

const spointRoot = resolve(process.argv[2] ?? '/workspace/spoint')
const outDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'spoint')
const spointUrl = (rel) => pathToFileURL(join(spointRoot, rel)).href

const ambient = await import(spointUrl('packages/mapspinner/src/tsl/terrain-ambient-shared.js'))
const defaults = await import(spointUrl('packages/mapspinner/src/terrain-defaults.js'))
const staticCache = await import(spointUrl('src/sdk/StaticCache.js'))
const bakeVersion = await import(spointUrl('src/static/BakeCodeVersion.js'))

const plain = (value) => JSON.parse(JSON.stringify(value))

const constants = {}
for (const [name, value] of Object.entries(ambient)) {
  if (typeof value !== 'function') constants[name] = plain(value)
}

const muSamples = [-1, -0.5, -0.2, -0.1, -0.05, 0, 0.05, 0.1, 0.25, 0.5, 1]
const ambientSamples = muSamples.map((muS) => {
  const base = { muS, ndotUp: 0.5, skyFill: 0.3, solar: [1, 0.9, 0.8], rayleigh: [1, 0.7, 0.4], termWidth: 0.45, nightFloor: 0.18 }
  return {
    muS,
    nightAmount: ambient.terrainNightAmount(muS, 0.45),
    dayShade: ambient.terrainDayShade(muS, { termWidth: 0.45, nightFloor: 0.18 }),
    sky: plain(ambient.terrainSkyIrradiance(base)),
    vegetation: plain(ambient.vegetationAmbientDelta({ ...base, ambIrr: [0.1, 0.2, 0.3] })),
    surface: plain(ambient.surfaceAmbientComparison({ ...base, ambIrr: [0.1, 0.2, 0.3], albedo: 0.5 })),
  }
})

const gradeInputs = [[0, 0, 0], [0.5, 0.4, 0.3], [1, 1, 1], [2, -1, 0.1]]
const gradeOptions = [
  {},
  { dayShade: 0.3, nightFill: [0.06, 0.075, 0.11], exposure: 1.05, lookSat: 1.25, lookContrast: 1.0 },
  { dayShade: 1, nightFill: [0.1, 0.1, 0.1], exposure: 0.8, lookSat: 0.5, lookContrast: 1.3 },
]
const grades = []
for (const rgb of gradeInputs) for (const options of gradeOptions) grades.push({ rgb, options, out: plain(ambient.terrainGrade(rgb, options)) })

const channels = [-1, 0, 0.1, 0.5, 1, 2].map((x) => ({ x, out: ambient.acesFilmicChannel(x) }))
const lumas = gradeInputs.map((rgb) => ({ rgb, out: ambient.luma(rgb) }))

const defaultsFixture = {
  RELIEF_DESIGN_RADIUS_M: defaults.RELIEF_DESIGN_RADIUS_M,
  TERRAIN_DEFAULTS: plain(defaults.TERRAIN_DEFAULTS),
  SHAPE_UNIFORM_DEFAULTS: plain(defaults.SHAPE_UNIFORM_DEFAULTS),
}

const rangeHeaders = [
  'bytes=0-', 'bytes=0-0', 'bytes=-5', 'bytes=-0', 'bytes=5-2', 'bytes=10-', 'bytes=abc', 'bytes=0-1,5-6',
  ' bytes=0-1', 'bytes=-', 'bytes=3-7', 'bytes=99-120', 'bytes=0-99999', 'bytes=-100',
  'bytes=-1', 'bytes=1-1', 'items=0-1', '', null, 'bytes=2-3 , 9-9', 'bytes=0x1-2', 'bytes=00-03',
  'bytes=1-2-3', 'bytes=999999999999999999999-', 'bytes=-999999999999999999999', 'bytes=-5 ',
]
const rangeTotals = [0, 1, 10, 100]
const rangeCases = []
for (const total of rangeTotals) {
  for (const header of rangeHeaders) {
    rangeCases.push({ header, total, out: staticCache.parseRange(header, total) })
  }
}

const lruOps = [
  { op: 'set', key: 'a', raw: 10 },
  { op: 'set', key: 'b', raw: 20, variants: [5] },
  { op: 'get', key: 'a' },
  { op: 'set', key: 'c', raw: 30 },
  { op: 'set', key: 'd', content: 15 },
  { op: 'get', key: 'b' },
  { op: 'grow', key: 'a', variant: 40 },
  { op: 'set', key: 'e', raw: 4, variants: [2, 3] },
  { op: 'get', key: 'zz' },
  { op: 'delete', key: 'c' },
  { op: 'set', key: 'b', raw: 1 },
  { op: 'set', key: 'f', raw: 61 },
  { op: 'set', key: 'g', raw: 25, content: 10 },
  { op: 'grow', key: 'g', variant: 30 },
  { op: 'set', key: 'h', raw: 0 },
]
const lruBudget = 60

const buildEntry = (step) => {
  const entry = {}
  if (step.raw !== undefined) entry.raw = new Uint8Array(step.raw)
  if (step.variants) entry.variants = new Map(step.variants.map((n, i) => [`v${i}`, new Uint8Array(n)]))
  if (step.content !== undefined) entry.content = new Uint8Array(step.content)
  return entry
}

const replayLru = (lru, ops) => {
  const objects = new Map()
  const trace = []
  for (const step of ops) {
    let got = null
    if (step.op === 'set') {
      const entry = buildEntry(step)
      objects.set(step.key, entry)
      lru.set(step.key, entry)
    } else if (step.op === 'get') {
      got = lru.get(step.key) === undefined ? null : step.key
    } else if (step.op === 'delete') {
      lru.delete(step.key)
    } else if (step.op === 'grow') {
      const entry = objects.get(step.key)
      if (entry) {
        if (!entry.variants) entry.variants = new Map()
        entry.variants.set('grown', new Uint8Array(step.variant))
      }
      lru.resync(step.key)
    }
    trace.push({ keys: [...lru.map.keys()], bytes: lru.bytes, got })
  }
  return trace
}

const spointLru = new staticCache.ByteBudgetLRU(lruBudget)
const lruTrace = replayLru(spointLru, lruOps)

const jayzeeHelpers = await import(pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'static', 'staticCacheHelpers.js')).href)
const portTrace = replayLru(new jayzeeHelpers.ByteBudgetLRU(lruBudget), lruOps)
if (JSON.stringify(portTrace) !== JSON.stringify(lruTrace)) throw new Error('port LRU trace differs from spoint at generation time')

const bakeLists = {
  BAKE_INPUTS_GLB_TRANSFORM: plain(bakeVersion.BAKE_INPUTS_GLB_TRANSFORM),
  BAKE_INPUTS_KTX2_EXTRACT: plain(bakeVersion.BAKE_INPUTS_KTX2_EXTRACT),
  BAKE_INPUTS_PROGRESSIVE_BAKE: plain(bakeVersion.BAKE_INPUTS_PROGRESSIVE_BAKE),
}
const staticDir = join(spointRoot, 'src', 'static')
const readSpointText = (rel) => readFileSync(resolve(staticDir, rel), 'utf8')
const bakeCrossCheck = {}
for (const [name, list] of Object.entries(bakeLists)) {
  const spointVersion = bakeVersion.bakeCodeVersion(list)
  const ported = portBakeCodeVersion(list, readSpointText)
  if (spointVersion !== ported) throw new Error(`bake version differs for ${name}: ${spointVersion} vs ${ported}`)
  bakeCrossCheck[name] = { version: spointVersion, files: list.length }
}

mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'terrain-static.json'), JSON.stringify({
  generatedFrom: {
    ambient: 'spoint packages/mapspinner/src/tsl/terrain-ambient-shared.js',
    defaults: 'spoint packages/mapspinner/src/terrain-defaults.js',
    staticCache: 'spoint src/sdk/StaticCache.js (ByteBudgetLRU, parseRange)',
    bakeCodeVersion: 'spoint src/static/BakeCodeVersion.js (lists and bakeCodeVersion over spoint files)',
  },
  ambient: { constants, samples: ambientSamples, grades, channels, lumas },
  defaults: defaultsFixture,
  parseRange: rangeCases,
  lru: { budget: lruBudget, ops: lruOps, trace: lruTrace },
  bake: { lists: bakeLists, crossCheck: bakeCrossCheck },
}, null, 2) + '\n')

console.log('wrote scripts/fixtures/spoint/terrain-static.json')
