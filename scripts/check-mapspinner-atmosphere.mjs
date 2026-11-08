import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { probeAtmosphere, GLSL_EXPORTS } from './lib/atmosphere-probe.mjs'
import * as trans from '../src/packages/mapspinner/atmosphere-transmittance-lut.js'
import * as scat from '../src/packages/mapspinner/atmosphere-scattering-lut.js'
import * as rt from '../src/packages/mapspinner/glsl-rt.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const reference = JSON.parse(readFileSync(join(root, 'scripts/fixtures/spoint/atmosphere-reference.json'), 'utf8'))
const ours = probeAtmosphere({ trans, scat, rt })

const UNDERFILLED = new Set(['vec3 [1,2]', 'vec4 [1,2,3]'])
const probeHash = (floats) => createHash('sha256').update(new Uint8Array(floats.buffer, floats.byteOffset, floats.byteLength)).digest('hex')
const caseKey = (entry) => entry.name + ' ' + JSON.stringify(entry.args)

gate('constants and LUT sizes equal spoint', () => assert.deepEqual(ours.constants, reference.constants))

gate('transmittanceAt, uFromR and vFromMu equal spoint bit for bit at 13 points, including below ground, at the top and above it', () => {
  assert.equal(ours.transmittance.length, 13)
  assert.deepEqual(ours.transmittance, reference.transmittance)
})

gate('transmittance LUT 16x8 at 40 steps hashes to spoint sha256', () => assert.equal(ours.smallTransSha256, reference.smallTransSha256))

gate('default transmittance LUT 256x128 at 500 steps hashes to spoint sha256', () => {
  assert.deepEqual(ours.defaultTransShape, [256, 128, 98304])
  assert.equal(ours.defaultTransSha256, reference.defaultTransSha256)
})

gate('verifyLUT reports what spoint reports for both bakes', () => {
  assert.deepEqual(ours.smallTransVerify, reference.smallTransVerify)
  assert.deepEqual(ours.defaultTransVerify, reference.defaultTransVerify)
  assert.equal(ours.defaultTransVerify.ok, true)
})

gate('scattering LUT 8x4x4 at 16 steps over the small transmittance LUT hashes to spoint sha256', () => assert.equal(ours.smallScatSha256, reference.smallScatSha256))

gate('default scattering LUT 64x32x24 at 64 steps hashes to spoint sha256', () => {
  assert.deepEqual(ours.defaultScatShape, [64, 32, 24, 196608])
  assert.equal(ours.defaultScatSha256, reference.defaultScatSha256)
})

gate('verifyScatteringLUT reports what spoint reports, including the 2 smoothness violations of the coarse 8-wide bake', () => {
  assert.deepEqual(ours.smallScatVerify, reference.smallScatVerify)
  assert.equal(ours.smallScatVerify.jumpViolations, 2)
  assert.deepEqual(ours.defaultScatVerify, reference.defaultScatVerify)
  assert.equal(ours.defaultScatVerify.ok, true)
})

gate('inscatterAt equals spoint at 39 (r, mu, muS) points', () => {
  assert.equal(ours.inscatter.length, 39)
  assert.deepEqual(ours.inscatter, reference.inscatter)
})

gate('muSFromLayer and layerFromMuS equal spoint for 1, 4, 24 and 7 layers', () => assert.deepEqual(ours.layers, reference.layers))

gate('glsl-rt exports the same 56 names as spoint', () => {
  assert.deepEqual(ours.glslExports, reference.glslExports)
  assert.deepEqual(ours.glslExports, GLSL_EXPORTS)
})

gate('glsl-rt equals spoint on every case but the two underfilled constructors', () => {
  assert.equal(ours.glsl.length, reference.glsl.length)
  let compared = 0
  for (let i = 0; i < ours.glsl.length; i++) {
    const key = caseKey(reference.glsl[i])
    assert.equal(caseKey(ours.glsl[i]), key)
    if (UNDERFILLED.has(key)) continue
    assert.deepEqual(ours.glsl[i].result, reference.glsl[i].result, key)
    compared++
  }
  assert.equal(compared, reference.glsl.length - 2)
})

gate('improvement: an underfilled vector constructor is refused, where spoint returns a short vector', () => {
  for (const entry of reference.glsl.filter((e) => UNDERFILLED.has(caseKey(e)))) {
    assert.equal(entry.result.value.length, entry.args.length, 'spoint returned a short vector')
    assert.deepEqual(ours.glsl.find((e) => caseKey(e) === caseKey(entry)).result, { threw: 'RangeError' })
  }
  assert.throws(() => rt.uvec3(1, 2), RangeError)
  assert.throws(() => rt.ivec2([]), RangeError)
  assert.deepEqual(rt.ivec2([1.5]), [1, 1])
  assert.deepEqual(rt.vec2(1, 2, 3), [1, 2])
})

gate('glsl-rt rounds arithmetic to float32 and keeps spoint quirks (clamp, dot and neg are not rounded)', () => {
  assert.equal(rt.add(0.1, 0.2), Math.fround(0.1 + 0.2))
  assert.notEqual(rt.add(0.1, 0.2), 0.1 + 0.2)
  assert.equal(rt.dot([0.1, 0.2], [0.3, 0.4]), 0.1 * 0.3 + 0.2 * 0.4)
  assert.equal(rt.clamp(0.1, 0, 1), 0.1)
  assert.ok(Object.is(rt.neg(0), -0))
  assert.equal(rt.mod(-1, 3), 2)
  assert.equal(rt.sw([1, 2, 3, 4], 'k'), 4)
  assert.deepEqual(rt.sw([1, 2, 3, 4], 'xk'), [1, undefined])
})

gate('zenith transmittance at the ground matches the analytic exponential column within 1e-5, and closer than a 50-step march', () => {
  const rayleighColumn = trans.ATM_RAYLEIGH_H * (1 - Math.exp(-(trans.ATM_TOP - trans.ATM_BOTTOM) / trans.ATM_RAYLEIGH_H))
  const mieColumn = trans.ATM_MIE_H * (1 - Math.exp(-(trans.ATM_TOP - trans.ATM_BOTTOM) / trans.ATM_MIE_H))
  const got = trans.transmittanceAt(trans.ATM_BOTTOM, 1)
  const coarse = trans.transmittanceAt(trans.ATM_BOTTOM, 1, 50)
  for (let c = 0; c < 3; c++) {
    const expected = Math.exp(-(trans.ATM_RAYLEIGH[c] * rayleighColumn + trans.ATM_MIE_EXT * mieColumn))
    assert.ok(Math.abs(got[c] - expected) < 1e-5, `channel ${c}: ${got[c]} vs ${expected}`)
    assert.ok(Math.abs(got[c] - expected) < Math.abs(coarse[c] - expected), `channel ${c} does not converge`)
  }
  assert.ok(got[2] < got[1] && got[1] < got[0], 'blue is extinguished most')
})

gate('a ray from above the top that misses the shell transmits fully and gathers no inscatter', () => {
  assert.deepEqual(trans.transmittanceAt(6600, 0.5), [1, 1, 1])
  const small = trans.bakeTransmittanceLUT(4, 4, 4)
  assert.deepEqual(scat.inscatterAt(6600, 0.5, 0.3, small), { inscatR: [0, 0, 0], inscatM: 0 })
})

gate('spoint quirk kept: a ray into the ground marches through the planet, so its transmittance is below the horizon ray', () => {
  const into = trans.transmittanceAt(trans.ATM_BOTTOM, -0.2, 50)
  const horizon = trans.transmittanceAt(trans.ATM_BOTTOM, 0, 50)
  assert.ok(into[0] < horizon[0])
})

gate('negative control: a perturbed step count changes the transmittance hash and the scattering hash', () => {
  const perturbed = probeHash(trans.bakeTransmittanceLUT(16, 8, 41).data)
  assert.notEqual(perturbed, reference.smallTransSha256)
  const small = trans.bakeTransmittanceLUT(16, 8, 40)
  assert.equal(probeHash(small.data), reference.smallTransSha256)
  assert.notEqual(probeHash(scat.bakeScatteringLUT(8, 4, 4, 17, small).data), reference.smallScatSha256)
})

gate('negative control: verifyLUT flags a NaN texel, a texel above 1 and a negative one', () => {
  const lut = trans.bakeTransmittanceLUT(4, 4, 8)
  lut.data[0] = NaN
  lut.data[1] = 1.01
  lut.data[2] = -0.5
  const result = trans.verifyLUT(lut)
  assert.equal(result.ok, false)
  assert.equal(result.nonFinite, 1)
  assert.equal(result.outOfRange, 2)
})

gate('negative control: verifyScatteringLUT flags a negative texel and an altitude jump', () => {
  const lut = scat.bakeScatteringLUT(8, 4, 4, 8, trans.bakeTransmittanceLUT(8, 4, 8))
  const midRow = 2 * 8 * 4 * 4
  lut.data[midRow + 3 * 4] = 10
  lut.data[5] = -1
  const result = scat.verifyScatteringLUT(lut)
  assert.equal(result.ok, false)
  assert.equal(result.negative, 1)
  assert.ok(result.jumpViolations >= 1)
})

gate('improvement: bake sizes and step counts must be whole numbers of at least 1', () => {
  for (const bad of [0, -1, 2.5, NaN, Infinity, '4']) {
    assert.throws(() => trans.bakeTransmittanceLUT(bad, 4, 4), RangeError)
    assert.throws(() => trans.bakeTransmittanceLUT(4, 4, bad), RangeError)
    assert.throws(() => trans.transmittanceAt(6360, 1, bad), RangeError)
    assert.throws(() => scat.bakeScatteringLUT(4, 4, bad, 4, trans.bakeTransmittanceLUT(4, 4, 4)), RangeError)
  }
  assert.throws(() => scat.inscatterAt(6360, 0.5, 0.5, trans.bakeTransmittanceLUT(4, 4, 4), 0), RangeError)
})

gate('the three ported sources carry no comments and read no host globals', () => {
  for (const file of ['atmosphere-transmittance-lut.js', 'atmosphere-scattering-lut.js', 'glsl-rt.js']) {
    const text = readFileSync(join(root, 'src/packages/mapspinner', file), 'utf8')
    assert.ok(!/\/\/|\/\*/.test(text), file + ' has a comment marker')
    assert.ok(!/\b(Date|performance|console|window|process|setTimeout|globalThis|require|Buffer)\b|Math\.random/.test(text), file + ' reads a host global')
    assert.ok(!/__spointHmr/.test(text), file + ' keeps an HMR tail')
  }
})

finish()
