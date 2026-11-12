import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import * as g from '../src/packages/mapspinner/glsl-rt.js'
import { compileGlsl } from '../src/packages/mapspinner/glsl-to-js.js'
import { HEIGHT_GLSL, HEIGHT_GLSL_EXPORTS } from '../src/packages/mapspinner/height-glsl.js'

const SPOINT = '/workspace/spoint/packages/mapspinner/src/'
if (!existsSync(SPOINT + 'height-gen.js')) {
  console.log('SKIP no spoint checkout at ' + SPOINT)
  console.log('RESULT: FAIL the spoint checkout this gate compares against is absent')
  process.exit(1)
}
const spoint = await import(pathToFileURL(SPOINT + 'height-gen.js').href)
const terrain = readFileSync(SPOINT + 'shaders/terrain.glsl', 'utf8').split('\n')
const slice = (from, to) => terrain.slice(from - 1, to).join('\n')
const first = terrain.findIndex((line) => line.startsWith('highp float continentalBias')) + 1
const last = terrain.findIndex((line) => line.startsWith('const float PI'))
const prelude = 'uniform int uNoUnroll;\nvec4 hpfSample(vec3 dir);\n'
const upstream = (prelude + slice(first, last)).replace(/^uniform int uNoUnroll;$/m, (line, offset) => (offset === 0 ? line : ''))
const dirs = Array.from({ length: 120 }, (_, i) => [Math.sin(i * 1.7 + 0.3), Math.cos(i * 0.9 - 1.1), Math.sin(i * 0.31 + 2.2)])
const hpfSample = (d) => [Math.fround(d[0] * 40 - d[2] * 7), 0, 0, 0]
const U = { uNoUnroll: 64, uLandBias: 0, uBeachShelfM: 150, uReliefScale: 1 }

gate('spoint terrain.glsl, from continentalBias to sample_fractal_terrain, transpiles as written', () => {
  assert.ok(first > 0 && last > first, `slice ${first}..${last}`)
  const made = compileGlsl(upstream, g, { factoryName: 'make' })
  assert.deepEqual(made.transpiled.functions, ['continentalBias', 'h3', 'snoise3', 'value_fbm', 'value_fbm_scaled', 'rotate_domain', 'value_ridged_fbm_rot', 'value_ridged_fbm_rot_scaled', 'eval_layer', 'sample_fractal_terrain'])
})

gate('snoise3 and continentalBias transpiled from spoint GLSL equal spoint generated height-gen.js bit for bit', () => {
  const mine = compileGlsl(upstream, g, { factoryName: 'make' }).make(U, hpfSample)
  const theirs = spoint.makeHeight({ ...U, hasHpf: 1 }, hpfSample)
  for (const d of dirs) {
    const p = g.mul(d, 53.25)
    assert.ok(Object.is(mine.snoise3(p), theirs.snoise3(p)), `snoise3 at ${p}`)
    assert.ok(Object.is(mine.continentalBias(d), theirs.continentalBias(d)))
  }
})

gate('the fractal terrain of the jayzee height GLSL equals the one transpiled from spoint GLSL bit for bit', () => {
  const upstreamMade = compileGlsl(upstream, g, { factoryName: 'make' }).make(U, hpfSample)
  const jayzee = compileGlsl(HEIGHT_GLSL, g, { factoryName: 'make' }).make(U, hpfSample)
  for (const d of dirs) {
    const p = g.mul(g.normalize(d), 3.0)
    assert.ok(Object.is(jayzee.sampleFractalTerrain(p), upstreamMade.sample_fractal_terrain(p)), `at ${p}`)
  }
  const other = compileGlsl(upstream.replace('1.005', '1.105'), g, { factoryName: 'make' }).make(U, hpfSample)
  assert.ok(dirs.some((d) => !Object.is(other.sample_fractal_terrain(g.mul(d, 3)), upstreamMade.sample_fractal_terrain(g.mul(d, 3)))), 'negative control: a changed layer constant changes the terrain')
})

gate('composeHeight transpiled from the jayzee height GLSL equals spoint generated composeHeight bit for bit', () => {
  const mine = compileGlsl(HEIGHT_GLSL, g, { exports: HEIGHT_GLSL_EXPORTS }).makeHeight(U, hpfSample)
  const theirs = spoint.makeHeight({ ...U, hasHpf: 1, defRadius: 6360 }, hpfSample)
  for (const d of dirs) assert.ok(Object.is(mine.composeHeight(d), theirs.composeHeight(d)), `composeHeight at ${d}`)
})

finish()
