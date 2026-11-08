import { readFileSync } from 'node:fs'
import { Buffer } from 'node:buffer'
import { gate, finish } from './lib/gate.mjs'
import {
  bytesOf,
  canon,
  firstDiff,
  replayField,
  runCarve,
  runErode,
  runSample,
  runStamps,
  viewOf,
} from './lib/spline-erosion-codec.mjs'
import * as spline from '../src/terrain-pure/splineCarve.js'
import * as erosion from '../src/terrain-pure/terrainErosion.js'
import * as contact from '../src/terrain-pure/contactOcclusionField.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/spoint/spline-erosion.json', import.meta.url), 'utf8'))

const expectSame = (actual, expected) => {
  const a = canon(actual)
  const b = JSON.stringify(expected)
  if (a !== b) throw new Error(firstDiff(a, b))
}

const expectDifferent = (actual, expected) => {
  if (canon(actual) === JSON.stringify(expected)) throw new Error('control matched the spoint fixture, so the comparison is blind to this change')
}

const ok = (condition, what) => {
  if (!condition) throw new Error(what)
}

const SHA256 = /^[0-9a-f]{64}$/
const COMMIT = /^[0-9a-f]{40}$/

gate('fixture names its spoint repo, commit and the three source digests', () => {
  ok(fixture.source.repo === '/workspace/spoint', 'repo is ' + fixture.source.repo)
  ok(COMMIT.test(fixture.source.commit), 'commit is not a 40-hex id')
  for (const file of ['SplineCarve.js', 'TerrainErosion.js', 'ContactOcclusionField.js']) {
    ok(SHA256.test(fixture.source.files[file] ?? ''), file + ' has no sha256 digest')
  }
})

gate('fixture covers sampleSpline, carveSpline, hydraulicErode, contact stamps and the contact field', () => {
  ok(fixture.sampleSpline.length >= 5, 'too few sampleSpline cases')
  ok(fixture.carveSpline.length >= 6, 'too few carveSpline cases')
  ok(fixture.hydraulicErode.length >= 5, 'too few hydraulicErode cases')
  ok(fixture.contactStamps.length >= 3, 'too few contact stamp cases')
  ok(fixture.contactField.length >= 2, 'too few contact field cases')
})

for (const c of fixture.sampleSpline) {
  gate(`sampleSpline ${c.name} matches spoint`, () => expectSame(runSample(spline, c.input), c.expected))
}

for (const c of fixture.carveSpline) {
  gate(`carveSpline ${c.name} matches spoint`, () => expectSame(runCarve(spline, c.input), c.expected))
}

for (const c of fixture.hydraulicErode) {
  gate(`hydraulicErode ${c.name} matches spoint`, () => expectSame(runErode(erosion, c.input), c.expected))
}

for (const c of fixture.contactStamps) {
  gate(`contact ${c.kind} stamps ${c.name} match spoint`, () => expectSame(runStamps(contact, c.kind, c.placements), c.expected))
}

for (const c of fixture.contactField) {
  gate(`contact field ${c.name} matches spoint at every step`, () => {
    const steps = replayField(contact, c.spec)
    ok(steps.length === c.steps.length, 'step count ' + steps.length + ' != ' + c.steps.length)
    for (let i = 0; i < steps.length; i++) {
      try {
        expectSame(steps[i], c.steps[i])
      } catch (error) {
        throw new Error('step ' + i + ' (' + c.steps[i].op + '): ' + error.message)
      }
    }
  })
}

gate('coverage: a carve case has a non-finite cell on its path and a road case keeps its flag', () => {
  const nan = fixture.carveSpline.find((c) => c.name.includes('non-finite'))
  ok(nan, 'no non-finite carve case')
  const heights = viewOf(nan.input.heightsB64, Float32Array)
  const idx = heights.findIndex((h) => Number.isNaN(h))
  ok(idx >= 0, 'carve input has no NaN')
  const finite = new Float32Array(heights)
  finite[idx] = 0
  const carvedWhenFinite = viewOf(runCarve(spline, { ...nan.input, heightsB64: bytesOf(finite) }).heights, Float32Array)
  ok(carvedWhenFinite[idx] !== 0, 'the NaN cell is not carved when finite, so it is off the path')
  ok(Number.isNaN(viewOf(nan.expected.heights, Float32Array)[idx]), 'spoint output does not keep the NaN cell')
  ok(fixture.carveSpline.some((c) => c.expected.flag === 'road'), 'no road-flag case')
})

gate('coverage: an erosion case has a non-finite cell and the contact field reports both recentre outcomes', () => {
  ok(fixture.hydraulicErode.some((c) => viewOf(c.input.heightsB64, Float32Array).some((h) => Number.isNaN(h))), 'no NaN erosion input')
  const results = fixture.contactField.flatMap((c) => c.steps.filter((s) => s.op === 'recentre').map((s) => s.result))
  ok(results.includes(true) && results.includes(false), 'recentre outcomes are ' + JSON.stringify(results))
})

gate('negative control: a one-bit change in the jayzee carve heights is caught', () => {
  const c = fixture.carveSpline[0]
  const out = runCarve(spline, c.input)
  const bytes = Buffer.from(out.heights, 'base64')
  bytes[0] ^= 1
  expectDifferent({ ...out, heights: bytes.toString('base64') }, c.expected)
})

gate('negative control: carveDepth one unit deeper changes the carve output', () => {
  const c = fixture.carveSpline[0]
  expectDifferent(runCarve(spline, { ...c.input, carveDepth: c.input.carveDepth + 1 }), c.expected)
})

gate('negative control: a different erosion seed changes the hydraulic output', () => {
  const c = fixture.hydraulicErode[1]
  expectDifferent(runErode(erosion, { ...c.input, opts: { ...c.input.opts, seed: c.input.opts.seed + 1 } }), c.expected)
})

gate('negative control: doubling the sample step changes the spline samples', () => {
  const c = fixture.sampleSpline[0]
  expectDifferent(runSample(spline, { ...c.input, stepSize: c.input.stepSize * 2 }), c.expected)
})

gate('negative control: a bush species placed as a tree changes the stamp strength', () => {
  const c = fixture.contactStamps[0]
  const placements = c.placements.map((p, i) => (i === 0 ? { ...p, species: p.species === 4 ? 2 : 4 } : p))
  expectDifferent(runStamps(contact, c.kind, placements), c.expected)
})

gate('negative control: dropping the unload of trees-a from the field replay changes the steps', () => {
  const c = fixture.contactField[0]
  const ops = c.spec.ops.filter((_, i) => i !== 3)
  expectDifferent(replayField(contact, { ...c.spec, ops }), c.steps)
})

gate('negative control: a field replay with a different window changes the snapshot', () => {
  const c = fixture.contactField[0]
  expectDifferent(replayField(contact, { ...c.spec, options: { windowM: 64, texelM: 0.5 } }), c.steps)
})

finish()
