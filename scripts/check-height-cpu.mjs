import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { createHeightSampler, HEIGHT_UNIFORM_DEFAULTS } from '../src/packages/mapspinner/height-cpu.js'
import { createAnchorField } from '../src/packages/mapspinner/anchor-field.js'
import { hpfFaceSampler } from '../src/packages/mapspinner/hpf-lattice.js'
import { createSplatWeights } from '../src/packages/mapspinner/splat-weights.js'
import { SNOISE3_FLOAT_V1, SNOISE3_INTEGER_V2 } from '../src/packages/mapspinner/splat-snoise-table.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = dirname(here)
const fixture = JSON.parse(readFileSync(join(here, 'fixtures', 'spoint', 'height-cpu.json'), 'utf8'))
const dec = (v) => (v === '-0' ? -0 : typeof v === 'string' ? Number(v) : v)
const decAll = (xs) => xs.map(dec)
const TOLERANCE = 1e-12
const close = (got, want) => Object.is(got, want) || (Number.isFinite(got) && Number.isFinite(want) && Math.abs(got - want) <= TOLERANCE * Math.max(1, Math.abs(want)))
const sameList = (got, want, label) => {
  assert.equal(got.length, want.length, label + ' length')
  for (let i = 0; i < want.length; i++) assert.ok(close(got[i], want[i]), label + ' index ' + i + ': got ' + String(got[i]) + ' want ' + String(want[i]))
}
const attempt = (fn) => {
  try {
    fn()
    return { threw: false }
  } catch (error) {
    return { threw: true, name: error.name, code: error.code === undefined ? null : error.code, message: String(error.message) }
  }
}
const DIRS = []
for (let i = 0; i < fixture.directions.length; i += 3) DIRS.push(decAll(fixture.directions.slice(i, i + 3)))
const CARVE_CONFIG = fixture.samplers.find((s) => s.name === 'hv2-carves').opts.carves

gate('the fixture covers both hash versions, carves, the refusals and the splat table', () => {
  assert.ok(fixture.samplers.some((s) => s.opts.hashVersion === 1))
  assert.ok(fixture.samplers.some((s) => s.opts.hashVersion === 2 && s.carves.length > 0))
  assert.ok(fixture.refusals.length >= 8)
  assert.equal(fixture.splat.length, 2)
  assert.equal(fixture.snoise.length, 2)
})

gate('HEIGHT_UNIFORM_DEFAULTS holds the same keys and values as spoint', () => {
  const keys = Object.keys(fixture.uniforms).sort()
  assert.deepEqual(Object.keys(HEIGHT_UNIFORM_DEFAULTS).sort(), keys)
  for (const key of keys) assert.ok(Object.is(HEIGHT_UNIFORM_DEFAULTS[key], dec(fixture.uniforms[key])), key)
})

for (const row of fixture.samplers) {
  gate('sampler ' + row.name + ' heights match spoint bit for bit over ' + DIRS.length + ' directions', () => {
    const s = createHeightSampler(row.opts)
    sameList(DIRS.map((d) => s.heightAt(d)), decAll(row.heights), row.name + ' heightAt')
    sameList(row.surface.flatMap((_, i) => s.surfacePoint(DIRS[i])), row.surface.flatMap((p) => decAll(p)), row.name + ' surfacePoint')
    assert.equal(s.carves.length, row.carves.length)
    row.carves.forEach((c, i) => {
      sameList(s.carves[i].dir, decAll(c.dir), row.name + ' carve dir ' + i)
      assert.ok(close(s.carves[i].innerChord2, dec(c.innerChord2)), row.name + ' innerChord2 ' + i)
      assert.ok(close(s.carves[i].outerChord2, dec(c.outerChord2)), row.name + ' outerChord2 ' + i)
      assert.ok(close(s.carves[i].targetH, dec(c.targetH)), row.name + ' targetH ' + i)
    })
  })
}

gate('carves change the height where they act and leave the rest of the sphere alone', () => {
  const plain = fixture.samplers.find((s) => s.name === 'hv2-default').heights.map(dec)
  const carved = fixture.samplers.find((s) => s.name === 'hv2-carves').heights.map(dec)
  assert.ok(carved.some((h, i) => h !== plain[i]), 'carves had no effect')
  assert.ok(carved.some((h, i) => h === plain[i]), 'carves changed every direction')
})

for (const row of fixture.refusals) {
  gate('refusal ' + row.label + ' throws the same error as spoint', () => {
    const configs = {
      'carves on hash 1': () => createHeightSampler({ hashVersion: 1, carves: CARVE_CONFIG }),
      'sculpt override': () => createHeightSampler({ sculpt: () => 0 }),
      'relief NaN': () => createHeightSampler({ reliefScale: NaN }),
      'relief string': () => createHeightSampler({ reliefScale: '2' }),
      'carve zero direction': () => createHeightSampler({ hashVersion: 2, carves: [{ dir: [0, 0, 0], innerM: 1, outerM: 2 }] }),
      'carve inner not below outer': () => createHeightSampler({ hashVersion: 2, carves: [{ dir: [1, 0, 0], innerM: 5, outerM: 5 }] }),
      'carve count above four': () => createHeightSampler({ hashVersion: 2, carves: [1, 2, 3, 4, 5].map((k) => ({ dir: [k, 1, 0], innerM: 1, outerM: 9 })) }),
      'hash version three': () => createHeightSampler({ hashVersion: 3 }),
      'precision f16': () => createHeightSampler({ hashVersion: 2, precision: 'f16' }),
    }
    assert.deepEqual(attempt(configs[row.label]), { threw: true, name: row.name, code: row.code, message: row.message })
  })
}

for (const seedRow of fixture.anchors) {
  gate('anchor field seed ' + String(seedRow.seed) + ' matches spoint sampleUV and dirToFaceUV', () => {
    const af = seedRow.seed === null ? createAnchorField() : createAnchorField({ seed: seedRow.seed })
    for (const [face, fu, fv, level, want] of seedRow.samples) {
      const s = af.sampleUV(face, fu, fv, level)
      sameList([s.seaBias, s.elevAmp, s.temp, s.humidity, s.erosion, s.roughness], decAll(want), 'sampleUV ' + face + ' ' + level)
    }
    seedRow.faces.forEach((f, i) => {
      const got = af.dirToFaceUV(DIRS[i])
      assert.equal(got.face, f.face)
      assert.ok(close(got.fu, dec(f.fu)) && close(got.fv, dec(f.fv)), 'face uv ' + i)
    })
  })
}

gate('anchor field seed refusals match spoint (code and message)', () => {
  for (const row of fixture.anchorRefusals) {
    const seed = row.seedType === 'string' ? row.seed : dec(row.seed)
    assert.deepEqual(attempt(() => createAnchorField({ seed })), { threw: true, name: row.name, code: row.code, message: row.message })
  }
})

gate('hpf face sampler matches spoint on a fixed buffer', () => {
  const res = fixture.hpf.res
  const buffer = new Float32Array(res * res * 4)
  for (let i = 0; i < buffer.length; i++) buffer[i] = Math.sin(i * fixture.hpf.sine)
  const sampler = hpfFaceSampler(buffer, res)
  const points = [[0.3, 0.7], [0.99, 0.01], [0, 0], [1, 1], [0.5, 0.25]]
  points.forEach(([fu, fv], i) => sameList(sampler(fu, fv, [0, 0, 0, 0]), decAll(fixture.hpf.samples[i]), 'hpf ' + i))
})

gate('the static splat snoise table matches spoint compiled snoise3 for both hash versions', () => {
  const pick = { 1: SNOISE3_FLOAT_V1, 2: SNOISE3_INTEGER_V2 }
  for (const row of fixture.snoise) {
    const f = pick[row.hashVersion]
    sameList(fixture.snoisePoints.map((p) => { const q = decAll(p); return f(q[0], q[1], q[2]) }), row.values.map(dec), 'snoise hash ' + row.hashVersion)
  }
})

for (const row of fixture.splat) {
  gate('splat weights for hash ' + row.hashVersion + ' match spoint over ' + row.outputs.length + ' inputs', () => {
    const weights = createSplatWeights({ hashVersion: row.hashVersion })
    fixture.splatInputs.forEach((x, i) => {
      const o = weights(decAll(x.dir), dec(x.h), dec(x.slope), dec(x.temp), dec(x.humid))
      sameList([o.grass, o.rock, o.sand, o.snow], decAll(row.outputs[i]), 'splat input ' + i)
    })
  })
}

gate('no height or splat module builds code at run time (no Function constructor, no eval)', () => {
  for (const file of ['height-spec.js', 'height-eval.js', 'height-cpu.js', 'splat-weights.js', 'splat-snoise-table.js']) {
    const text = readFileSync(join(root, 'src', 'packages', 'mapspinner', file), 'utf8')
    assert.ok(!/new Function|[^a-zA-Z]eval\(/.test(text), file + ' builds code at run time')
  }
})

finish()
