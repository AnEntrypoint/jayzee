import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import * as g from '../src/packages/mapspinner/glsl-rt.js'
import { transpileGlsl, compileGlsl, GlslTranspileError } from '../src/packages/mapspinner/glsl-to-js.js'
import { HEIGHT_GLSL, HEIGHT_GLSL_EXPORTS } from '../src/packages/mapspinner/height-glsl.js'
import * as committed from '../src/packages/mapspinner/height-gen.js'

const dirs = Array.from({ length: 160 }, (_, i) => [Math.sin(i * 1.7 + 0.3), Math.cos(i * 0.9 - 1.1), Math.sin(i * 0.31 + 2.2)])
const hpfSample = (d) => [Math.fround(d[0] * 40 - d[2] * 7), 0, 0, 0]
const uniformSets = [
  { uNoUnroll: 64, uLandBias: 0, uBeachShelfM: 150, uReliefScale: 1 },
  { uNoUnroll: 60, uLandBias: 900, uBeachShelfM: 0.5, uReliefScale: 0 },
  { uNoUnroll: 0, uLandBias: -20000, uBeachShelfM: 4000, uReliefScale: 0.01 },
]
const compiled = compileGlsl(HEIGHT_GLSL, g, { exports: HEIGHT_GLSL_EXPORTS })
const run = (source, name, ...args) => compileGlsl(source, g, { factoryName: 'make' }).make({ u: 3 })[name](...args)
const code = (fn) => {
  try {
    fn()
  } catch (error) {
    return error instanceof GlslTranspileError ? error.code : error.constructor.name
  }
  return null
}

gate('the height GLSL transpiles to a module whose composeHeight, snoise3 and continentalBias equal the committed height-gen.js bit for bit', () => {
  let compared = 0
  for (const U of uniformSets) {
    const want = committed.makeHeight(U, hpfSample)
    const got = compiled.makeHeight(U, hpfSample)
    assert.deepEqual(Object.keys(got), ['snoise3', 'composeHeight', 'continentalBias'])
    for (const dir of dirs) {
      assert.ok(Object.is(got.composeHeight(dir), want.composeHeight(dir)), `composeHeight at ${dir}`)
      assert.ok(Object.is(got.snoise3(g.mul(dir, 37.5)), want.snoise3(g.mul(dir, 37.5))), `snoise3 at ${dir}`)
      assert.ok(Object.is(got.continentalBias(dir), want.continentalBias(dir)))
      compared += 3
    }
  }
  assert.equal(compared, 1440)
  const heights = dirs.map((d) => compiled.makeHeight(uniformSets[0], hpfSample).composeHeight(d))
  assert.ok(heights.some((h) => h < 0) && heights.some((h) => h > 150), 'the seeded set covers sea and land above the shelf')
})

gate('the constants come out of the GLSL with the values the committed module carries', () => {
  assert.deepEqual(compiled.NOISE_LAYERS, committed.NOISE_LAYERS)
  assert.equal(compiled.CONTINENTAL_BIAS_AMP, committed.CONTINENTAL_BIAS_AMP)
  assert.ok(Object.isFrozen(compiled.NOISE_LAYERS) && Object.isFrozen(compiled.NOISE_LAYERS[0]))
  assert.deepEqual(compiled.transpiled.uniforms, ['uNoUnroll', 'uLandBias', 'uBeachShelfM', 'uReliefScale'])
  assert.deepEqual(compiled.transpiled.externs, ['hpfSample'])
})

gate('negative control: one changed GLSL constant or operator changes the heights', () => {
  const U = uniformSets[0]
  const want = committed.makeHeight(U, hpfSample)
  for (const [from, to] of [['0.1031', '0.1032'], ['p.yxz + 33.33', 'p.zxy + 33.33'], ['h * OCEAN_DEEPEN', 'h + OCEAN_DEEPEN'], ['f * 6.0 - 15.0', 'f * (6.0 - 15.0)']]) {
    assert.ok(HEIGHT_GLSL.includes(from), from)
    const mutated = compileGlsl(HEIGHT_GLSL.replace(from, to), g, { exports: HEIGHT_GLSL_EXPORTS }).makeHeight(U, hpfSample)
    assert.ok(dirs.some((d) => !Object.is(mutated.composeHeight(d), want.composeHeight(d))), `${from} -> ${to} left every height the same`)
  }
})

gate('the generated text is a comment-free ES module over glsl-rt that node loads and that matches again', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jz-glsl-'))
  try {
    const out = join(dir, 'height-gen.mjs')
    const script = fileURLToPath(new URL('./gen-height-js.mjs', import.meta.url))
    const runtimePath = pathToFileURL(fileURLToPath(new URL('../src/packages/mapspinner/glsl-rt.js', import.meta.url))).href
    const ran = spawnSync(process.execPath, [script, '--out', out, '--runtime-path', runtimePath], { encoding: 'utf8' })
    assert.equal(ran.status, 0, ran.stderr)
    const printed = spawnSync(process.execPath, [script], { encoding: 'utf8' }).stdout
    assert.equal(printed, transpileGlsl(HEIGHT_GLSL, { exports: HEIGHT_GLSL_EXPORTS }).code)
    assert.ok(printed.startsWith("import * as g from './glsl-rt.js'\n"))
    assert.ok(!printed.includes('/*') && !printed.replace(/'[^'\n]*'/g, '').includes('//'))
    assert.ok(printed.includes("p = g.add(p, g.dot(p, g.add(g.sw(p, 'yxz'), 33.33)))"), 'a vector compound assignment goes through the runtime')
    assert.ok(printed.includes('v += (a * snoise3(p))'), 'a scalar compound assignment stays a raw operator')
    const loaded = await import(pathToFileURL(out).href)
    const want = committed.makeHeight(uniformSets[1], hpfSample)
    const got = loaded.makeHeight(uniformSets[1], hpfSample)
    for (const d of dirs) assert.ok(Object.is(got.composeHeight(d), want.composeHeight(d)))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

gate('scalars keep double arithmetic, vectors go through the float32 runtime, and int division truncates', () => {
  assert.equal(run('float f(float a) { return a * 0.1 + 0.2; }', 'f', 7), 7 * 0.1 + 0.2)
  assert.deepEqual(run('vec3 f(vec3 a) { return a * 0.1 + 0.2; }', 'f', [7, 7, 7]), [g.add(g.mul(7, 0.1), 0.2), g.add(g.mul(7, 0.1), 0.2), g.add(g.mul(7, 0.1), 0.2)])
  assert.notEqual(run('vec3 f(vec3 a) { return a * 0.1 + 0.2; }', 'f', [7, 7, 7])[0], 7 * 0.1 + 0.2)
  assert.equal(run('int f(int a, int b) { return a / b; }', 'f', 7, 2), 3)
  assert.equal(run('int f(int a, int b) { return a / b; }', 'f', -7, 2), -3)
  assert.equal(run('float f(float a, float b) { return a / b; }', 'f', 7, 2), 3.5)
  assert.deepEqual(run('vec3 f(vec3 a) { return -a.zyx; }', 'f', [1, 2, 3]), [-3, -2, -1])
  assert.equal(run('uniform int u; int f(int a) { return a + u; }', 'f', 4), 7)
})

gate('control flow, precision qualifiers, bare declarations, structs and arrays transpile', () => {
  const source = `
    struct Pair { float a; int n; };
    const Pair PAIRS[2] = Pair[2](Pair(1.5, 2), Pair(0.25, 5));
    highp float total(highp vec2 seed, int which) {
      float sum;
      mediump float scale = PAIRS[which].a;
      sum = 0.0;
      for (int i = 0; i < PAIRS[which].n; i++) {
        if (i == 1 || seed.x > 100.0) sum += 10.0;
        else { sum += scale * seed.y; }
      }
      return sum > 0.0 && which != 9 ? sum : -1.0;
    }`
  assert.equal(run(source, 'total', [1, 4], 0), 6 + 10)
  assert.equal(run(source, 'total', [1, 4], 1), 0.25 * 4 * 4 + 10)
  assert.equal(run(source, 'total', [500, 4], 1), 50)
  assert.equal(run(source, 'total', [1, -40], 1), -1)
})

gate('unsupported or wrong GLSL is refused with a code and the line it is on', () => {
  const cases = [
    ['float f(float a) {\n  return b;\n}', 'glsl-unknown-name', 2],
    ['float f(float a) {\n  return noise(a);\n}', 'glsl-unknown-function', 2],
    ['float f(vec3 a) {\n\n  return a.q9;\n}', 'glsl-bad-swizzle', 3],
    ['float f(float a) { return a.x; }', 'glsl-field-of-scalar', 1],
    ['mat9 f(float a) { return a; }', 'glsl-unknown-type', 1],
    ['float f(float a) { float a = 1.0; return a; }', 'glsl-redeclared', 1],
    ['float f(float a) { return a # 2.0; }', 'glsl-bad-character', 1],
    ['float f(vec3 a, vec3 b) { return a < b ? 1.0 : 0.0; }', 'glsl-vector-comparison', 1],
    ['float f(float a) { return a }', 'glsl-unexpected-token', 1],
    ['float g(float a) { return a; }\nfloat f(float a) { return g(a, a); }', 'glsl-call-arity', 2],
    ['uniform float u;\nfloat f(float a) { u = a; return a; }', 'glsl-assign-to-global', 2],
    ['const float K = vec3(1.0);', 'glsl-const-type', 1],
    ['float f(vec3 a) { return a[0.5]; }', 'glsl-index-not-int', 1],
    ['float f(float a, vec3 b) { a += b; return a; }', 'glsl-arithmetic-type', 1],
  ]
  for (const [source, want, line] of cases) {
    let caught = null
    try {
      transpileGlsl(source)
    } catch (error) {
      caught = error
    }
    assert.ok(caught instanceof GlslTranspileError, `${want} was not refused`)
    assert.equal(caught.code, want)
    assert.equal(caught.line, line, want)
  }
  assert.equal(code(() => transpileGlsl(42)), 'glsl-source-not-text')
  assert.equal(code(() => transpileGlsl('float f(float a) { return a; }', { exports: ['nope'] })), 'glsl-export-unknown')
  assert.equal(code(() => compileGlsl('float f(float a) { return a; }', null)), 'glsl-runtime-missing')
  assert.equal(code(() => transpileGlsl('float f(float a) { return a; }')), null)
})

finish()
