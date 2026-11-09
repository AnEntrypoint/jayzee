import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { gzipSync, gunzipSync, brotliCompressSync, brotliDecompressSync, constants as zlibConstants } from 'node:zlib'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import * as ambient from '../src/terrain-pure/terrainAmbientScalars.js'
import { TERRAIN_DEFAULTS, SHAPE_UNIFORM_DEFAULTS, RELIEF_DESIGN_RADIUS_M } from '../src/terrain-pure/terrainDefaults.js'
import { BAKE_INPUTS_GLB_TRANSFORM, BAKE_INPUTS_KTX2_EXTRACT, BAKE_INPUTS_PROGRESSIVE_BAKE, bakeCodeVersion as versionWith } from '../src/terrain-pure/bakeCodeVersion.js'
import { makeVrmPassthrough, vrm0Passthrough, vrmcPassthrough } from '../src/static/glbVrmPassthrough.js'
import { ByteBudgetLRU, parseRange, makeCompress, GZIP_EXTENSIONS, MAX_CACHEABLE_BYTES, CACHE_BYTE_BUDGET } from '../src/static/staticCacheHelpers.js'
const sha1Hex = (text) => createHash('sha1').update(text).digest('hex')
const bakeCodeVersion = (list, reader) => versionWith(list, reader, sha1Hex)

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'spoint', 'terrain-static.json')
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'))
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-12, label + ': ' + actual + ' vs ' + expected)

gate('ambient constants equal the spoint values in the fixture, and the port exports no other constant', () => {
  const ported = Object.entries(ambient).filter(([, value]) => typeof value !== 'function')
  assert.deepEqual(ported.map(([name]) => name).sort(), Object.keys(fixture.ambient.constants).sort())
  for (const [name, expected] of Object.entries(fixture.ambient.constants)) assert.deepEqual(ambient[name], expected, name)
})

gate('day and night ambient samples equal spoint at 11 sun elevations', () => {
  for (const sample of fixture.ambient.samples) {
    const base = { muS: sample.muS, ndotUp: 0.5, skyFill: 0.3, solar: [1, 0.9, 0.8], rayleigh: [1, 0.7, 0.4], termWidth: 0.45, nightFloor: 0.18 }
    assert.equal(ambient.terrainNightAmount(sample.muS, 0.45), sample.nightAmount, 'nightAmount at ' + sample.muS)
    assert.equal(ambient.terrainDayShade(sample.muS, { termWidth: 0.45, nightFloor: 0.18 }), sample.dayShade, 'dayShade at ' + sample.muS)
    assert.deepEqual(ambient.terrainSkyIrradiance(base), sample.sky, 'sky at ' + sample.muS)
    assert.deepEqual(ambient.vegetationAmbientDelta({ ...base, ambIrr: [0.1, 0.2, 0.3] }), sample.vegetation, 'vegetation at ' + sample.muS)
    assert.deepEqual(ambient.surfaceAmbientComparison({ ...base, ambIrr: [0.1, 0.2, 0.3], albedo: 0.5 }), sample.surface, 'surface at ' + sample.muS)
  }
})

gate('terrain grade equals spoint for 4 colours under 3 grade option sets', () => {
  assert.equal(fixture.ambient.grades.length, 12)
  for (const row of fixture.ambient.grades) {
    const out = ambient.terrainGrade(row.rgb, row.options)
    assert.equal(out.length, row.out.length, JSON.stringify(row.rgb))
    out.forEach((value, i) => near(value, row.out[i], 'grade ' + JSON.stringify(row.rgb) + ' channel ' + i))
  }
})

gate('ACES channel curve and luma equal spoint for the fixture inputs', () => {
  for (const row of fixture.ambient.channels) assert.equal(ambient.acesFilmicChannel(row.x), row.out, 'aces ' + row.x)
  for (const row of fixture.ambient.lumas) assert.equal(ambient.luma(row.rgb), row.out, 'luma ' + row.rgb)
})

gate('hand-derived values from the spoint formulas: night at noon is 0, day shade at the terminator is 0.59, ACES of 0 is 0, luma of white is 1', () => {
  assert.equal(ambient.terrainNightAmount(0, 0.45), 0)
  near(ambient.terrainDayShade(0, { termWidth: 0.45, nightFloor: 0.18 }), 0.59, 'day shade at the terminator')
  assert.equal(ambient.acesFilmicChannel(0), 0)
  near(ambient.luma([1, 1, 1]), 1, 'luma of white')
})

gate('negative control: a 0.01 change in sky fill moves the sky output away from the spoint sample', () => {
  const sample = fixture.ambient.samples[5]
  const changed = ambient.terrainSkyIrradiance({ muS: sample.muS, ndotUp: 0.5, skyFill: 0.31, solar: [1, 0.9, 0.8], rayleigh: [1, 0.7, 0.4] })
  assert.notDeepEqual(changed, sample.sky)
})

gate('negative control: a grade with a changed exposure differs from the spoint grade in the fixture', () => {
  const row = fixture.ambient.grades[4]
  assert.notDeepEqual(ambient.terrainGrade(row.rgb, { ...row.options, exposure: (row.options.exposure ?? 1) + 0.01 }), row.out)
})

gate('terrain defaults equal the spoint TERRAIN_DEFAULTS and SHAPE_UNIFORM_DEFAULTS values in the fixture', () => {
  assert.deepEqual(TERRAIN_DEFAULTS, fixture.defaults.TERRAIN_DEFAULTS)
  assert.deepEqual(SHAPE_UNIFORM_DEFAULTS, fixture.defaults.SHAPE_UNIFORM_DEFAULTS)
  assert.equal(RELIEF_DESIGN_RADIUS_M, fixture.defaults.RELIEF_DESIGN_RADIUS_M)
})

gate('shape uniform defaults are read from TERRAIN_DEFAULTS, key by key', () => {
  const sourceKey = {
    uLandBias: 'landBias', uBeachShelfM: 'beachShelf', canyonDepthMul: 'canyonDepth', uDetailOverlay: 'detailOverlay',
    uHiFreqCut: 'hiFreqCut', uCarveWide: 'carveWide', uMtnBandWide: 'mtnBandWide', uClimateRelief: 'climateRelief',
    uIsleWide: 'isleWide', cliffAmt: 'cliffAmt',
  }
  assert.deepEqual(Object.keys(SHAPE_UNIFORM_DEFAULTS).sort(), Object.keys(sourceKey).sort())
  for (const [uniform, source] of Object.entries(sourceKey)) assert.equal(SHAPE_UNIFORM_DEFAULTS[uniform], TERRAIN_DEFAULTS[source], uniform)
})

gate('terrain defaults are frozen at every depth, so a consumer cannot change the single source', () => {
  assert.ok(Object.isFrozen(TERRAIN_DEFAULTS))
  assert.ok(Object.isFrozen(TERRAIN_DEFAULTS.poolDispLo))
  assert.ok(Object.isFrozen(SHAPE_UNIFORM_DEFAULTS))
  assert.throws(() => { TERRAIN_DEFAULTS.landBias = 0 }, TypeError)
  assert.throws(() => { TERRAIN_DEFAULTS.poolDispLo[0] = 0 }, TypeError)
  assert.equal(TERRAIN_DEFAULTS.landBias, -100000)
})

gate('negative control: a defaults copy with landBias changed no longer matches the fixture', () => {
  assert.notDeepEqual({ ...TERRAIN_DEFAULTS, landBias: -99999 }, fixture.defaults.TERRAIN_DEFAULTS)
})

gate('bake input lists equal the spoint pins in the fixture', () => {
  assert.deepEqual([...BAKE_INPUTS_GLB_TRANSFORM], fixture.bake.lists.BAKE_INPUTS_GLB_TRANSFORM)
  assert.deepEqual([...BAKE_INPUTS_KTX2_EXTRACT], fixture.bake.lists.BAKE_INPUTS_KTX2_EXTRACT)
  assert.deepEqual([...BAKE_INPUTS_PROGRESSIVE_BAKE], fixture.bake.lists.BAKE_INPUTS_PROGRESSIVE_BAKE)
})

gate('the fixture records a 12-hex spoint bake version and the file count for each of the three pinned lists', () => {
  for (const name of ['BAKE_INPUTS_GLB_TRANSFORM', 'BAKE_INPUTS_KTX2_EXTRACT', 'BAKE_INPUTS_PROGRESSIVE_BAKE']) {
    const record = fixture.bake.crossCheck[name]
    assert.match(record.version, /^[0-9a-f]{12}$/, name)
    assert.equal(record.files, fixture.bake.lists[name].length, name)
  }
})

const referenceVersion = (list, texts) => {
  const hash = createHash('sha1')
  for (const rel of list) {
    hash.update(rel)
    hash.update(texts[rel].replace(/\r\n/g, '\n'))
  }
  return hash.digest('hex').slice(0, 12)
}
const reader = (texts) => (rel) => texts[rel]
const synthetic = { 'a.js': 'x\r\ny\r\n', 'b.js': 'z\n' }
const syntheticLf = { 'a.js': 'x\ny\n', 'b.js': 'z\n' }

gate('bake version matches the spoint algorithm (rel then CRLF-normalised text, sha1, 12 hex) on synthetic inputs', () => {
  const list = ['a.js', 'b.js']
  assert.equal(bakeCodeVersion(list, reader(synthetic)), referenceVersion(list, synthetic))
})

gate('CRLF and LF text produce the same bake version', () => {
  const list = ['a.js', 'b.js']
  assert.equal(bakeCodeVersion(list, reader(synthetic)), bakeCodeVersion(list, reader(syntheticLf)))
})

gate('negative control: a lone carriage return is not normalised, so it changes the version', () => {
  const list = ['a.js']
  assert.notEqual(bakeCodeVersion(list, reader({ 'a.js': 'x\ry' })), bakeCodeVersion(list, reader({ 'a.js': 'x\ny' })))
})

gate('negative control: the version depends on the path string and on the input order', () => {
  const text = { 'a.js': 'same', 'b.js': 'other' }
  assert.notEqual(bakeCodeVersion(['a.js'], reader({ 'a.js': 'same' })), bakeCodeVersion(['c.js'], reader({ 'c.js': 'same' })))
  assert.notEqual(bakeCodeVersion(['a.js', 'b.js'], reader(text)), bakeCodeVersion(['b.js', 'a.js'], reader(text)))
})

gate('bake version refuses an empty list, a non-string path and a missing reader', () => {
  assert.throws(() => bakeCodeVersion([], reader({})), TypeError)
  assert.throws(() => bakeCodeVersion([1], reader({})), TypeError)
  assert.throws(() => bakeCodeVersion(['a.js'], undefined), TypeError)
})

gate('parseRange equals spoint on every fixture header and total', () => {
  let found = 0
  let refused = 0
  for (const row of fixture.parseRange) {
    assert.deepEqual(parseRange(row.header, row.total), row.out, JSON.stringify(row.header) + ' total ' + row.total)
    if (row.out === null) refused++
    else found++
  }
  assert.ok(found > 0 && refused > 0, 'the fixture must cover both answers')
})

gate('parseRange hand-derived: a suffix of 5 over 100 bytes is 95 to 99, and an open start of 10 over 10 bytes is refused', () => {
  assert.deepEqual(parseRange('bytes=-5', 100), { start: 95, end: 99 })
  assert.equal(parseRange('bytes=10-', 10), null)
  assert.deepEqual(parseRange('bytes=3-', 10), { start: 3, end: 9 })
})

const replayLru = (lru, ops) => {
  const objects = new Map()
  const trace = []
  for (const step of ops) {
    let got = null
    if (step.op === 'set') {
      const entry = {}
      if (step.raw !== undefined) entry.raw = new Uint8Array(step.raw)
      if (step.variants) entry.variants = new Map(step.variants.map((n, i) => [`v${i}`, new Uint8Array(n)]))
      if (step.content !== undefined) entry.content = new Uint8Array(step.content)
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

gate('ByteBudgetLRU reproduces the spoint trace (keys in order, bytes, and each get) over the fixture operations', () => {
  const trace = replayLru(new ByteBudgetLRU(fixture.lru.budget), fixture.lru.ops)
  assert.deepEqual(trace, fixture.lru.trace)
})

gate('ByteBudgetLRU hand-derived: after set a, set b (20 + 5), get a, set c the cache evicts b and holds a and c at 40 bytes', () => {
  const trace = replayLru(new ByteBudgetLRU(60), fixture.lru.ops.slice(0, 4))
  assert.deepEqual(trace[1], { keys: ['a', 'b'], bytes: 35, got: null })
  assert.deepEqual(trace[3], { keys: ['a', 'c'], bytes: 40, got: null })
})

gate('negative control: an LRU whose get does not promote the key diverges from the spoint trace', () => {
  class NoPromote extends ByteBudgetLRU {
    get(key) { return this.map.get(key) }
  }
  assert.notDeepEqual(replayLru(new NoPromote(fixture.lru.budget), fixture.lru.ops), fixture.lru.trace)
})

gate('negative control: an LRU whose set does not subtract the replaced entry diverges from the spoint trace', () => {
  class NoReplaceSubtract extends ByteBudgetLRU {
    set(key, entry) {
      this.map.delete(key)
      this.map.set(key, entry)
      this.bytes += this.sizeOf(entry)
      this.evictOverBudget()
    }
  }
  const replace = [{ op: 'set', key: 'x', raw: 10 }, { op: 'set', key: 'x', raw: 12 }]
  const honest = replayLru(new ByteBudgetLRU(60), replace)
  assert.deepEqual(honest[1], { keys: ['x'], bytes: 12, got: null })
  assert.notDeepEqual(replayLru(new NoReplaceSubtract(60), replace), honest)
})

const brotliSample = Buffer.from(Array.from({ length: 3000 }, (_, i) => 'line ' + ((i * 7919) % 1000) + ' value ' + ((i * 31) % 97)).join('\n'))
const brotliAt = (raw, quality) => brotliCompressSync(raw, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: quality } })

gate('the compressor writes brotli at quality 5 for br and gzip for any other encoding, byte for byte as zlib does', () => {
  const compress = makeCompress({ gzipSync, brotliCompressSync, brotliParamQuality: zlibConstants.BROTLI_PARAM_QUALITY })
  const raw = Buffer.from('terrain '.repeat(300) + 'end')
  assert.deepEqual(compress(raw, 'gzip'), gzipSync(raw))
  assert.deepEqual(compress(raw, 'deflate'), gzipSync(raw))
  assert.deepEqual(compress(brotliSample, 'br'), brotliAt(brotliSample, 5))
  assert.deepEqual(gunzipSync(compress(raw, 'gzip')), raw)
  assert.deepEqual(brotliDecompressSync(compress(brotliSample, 'br')), brotliSample)
})

gate('negative control: brotli at quality 6 and at quality 11 each differ from the quality 5 output the port writes', () => {
  const compress = makeCompress({ gzipSync, brotliCompressSync, brotliParamQuality: zlibConstants.BROTLI_PARAM_QUALITY })
  assert.notDeepEqual(compress(brotliSample, 'br'), brotliAt(brotliSample, 6))
  assert.notDeepEqual(compress(brotliSample, 'br'), brotliAt(brotliSample, 11))
})

gate('makeCompress refuses missing codecs, and the cache constants keep the spoint values', () => {
  assert.throws(() => makeCompress({ gzipSync, brotliParamQuality: 1 }), TypeError)
  assert.equal(CACHE_BYTE_BUDGET, 256 * 1024 * 1024)
  assert.equal(MAX_CACHEABLE_BYTES, 20 * 1024 * 1024)
  assert.deepEqual([...GZIP_EXTENSIONS].sort(), ['.css', '.glb', '.gltf', '.html', '.js', '.json', '.mjs', '.vrm', '.wasm'])
})

const vrmDoc = (extensions) => ({ json: extensions === undefined ? {} : { extensions } })

gate('VRM0 passthrough copies the VRM extension out of a document and writes the same content into another', () => {
  const source = vrmDoc({ VRM: { specVersion: '0.0', meta: { title: 'avatar' } } })
  const passthrough = vrm0Passthrough()
  assert.equal(passthrough.read(source), passthrough)
  const target = vrmDoc()
  passthrough.write(target)
  assert.deepEqual(target.json.extensions, { VRM: { specVersion: '0.0', meta: { title: 'avatar' } } })
})

gate('VRMC_vrm passthrough reads VRMC_vrm and ignores VRM, and the write keeps other extensions', () => {
  const passthrough = vrmcPassthrough()
  passthrough.read(vrmDoc({ VRM: { specVersion: '0.0' } }))
  const empty = vrmDoc({ OTHER: 1 })
  passthrough.write(empty)
  assert.deepEqual(empty.json.extensions, { OTHER: 1 })
  passthrough.read(vrmDoc({ VRMC_vrm: { specVersion: '1.0' } }))
  const target = vrmDoc({ OTHER: 1 })
  passthrough.write(target)
  assert.deepEqual(target.json.extensions, { OTHER: 1, VRMC_vrm: { specVersion: '1.0' } })
})

gate('the passthrough stores a copy, so later changes to the source do not reach the written document', () => {
  const source = vrmDoc({ VRM: { meta: { title: 'a' } } })
  const passthrough = vrm0Passthrough()
  passthrough.read(source)
  source.json.extensions.VRM.meta.title = 'changed'
  const target = vrmDoc()
  passthrough.write(target)
  assert.equal(target.json.extensions.VRM.meta.title, 'a')
  target.json.extensions.VRM.meta.title = 'edited'
  assert.deepEqual(passthrough.held(), { meta: { title: 'a' } })
})

gate('a document without the extension writes nothing, and a read without it keeps the earlier copy as spoint does', () => {
  const passthrough = vrm0Passthrough()
  const untouched = vrmDoc()
  passthrough.write(untouched)
  assert.equal(untouched.json.extensions, undefined)
  passthrough.read(vrmDoc({ VRM: { specVersion: '0.0' } }))
  passthrough.read(vrmDoc())
  const target = vrmDoc()
  passthrough.write(target)
  assert.deepEqual(target.json.extensions, { VRM: { specVersion: '0.0' } })
})

gate('a null extension value is carried as null, as spoint carries it', () => {
  const passthrough = vrm0Passthrough()
  passthrough.read(vrmDoc({ VRM: null }))
  const target = vrmDoc()
  passthrough.write(target)
  assert.deepEqual(target.json.extensions, { VRM: null })
})

gate('the passthrough refuses a missing or empty extension name', () => {
  assert.throws(() => makeVrmPassthrough(''), TypeError)
  assert.throws(() => makeVrmPassthrough(undefined), TypeError)
})

finish()
