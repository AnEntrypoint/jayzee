import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { grassWindGust } from '../src/render/grassWind.js'
import { GRASS_WIND_FIELD_CELLS, GRASS_WIND_FIELD_CHANNELS, GRASS_WIND_FIELD_REACH_M, GRASS_WIND_FIELD_TEXEL_BYTES, GRASS_WIND_SWAY_RANGE, createGrassWindField, grassWindFieldValue } from '../src/render/grassWindField.js'

const DIR = [Math.SQRT1_2, Math.SQRT1_2]
const value = (x, z, t = 3.5, reach = 64) => grassWindFieldValue([0, 0, 0], x, z, t, DIR[0], DIR[1], reach)
const gap = (p, q) => Math.max(Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1]), Math.abs(p[2] - q[2]))

gate('the field is 64 cells over a 64 m reach with three channels and four texel bytes, sized once', () => {
  assert.equal(GRASS_WIND_FIELD_CELLS, 64)
  assert.equal(GRASS_WIND_FIELD_REACH_M, 64)
  const field = createGrassWindField()
  assert.equal(field.data.length, 64 * 64 * GRASS_WIND_FIELD_CHANNELS)
  assert.equal(field.texels.length, 64 * 64 * GRASS_WIND_FIELD_TEXEL_BYTES)
  assert.equal(field.cellM, 1)
  assert.equal(field.version, 0)
})

gate('the field function repeats exactly every reach in x and z, so the tile has no seam', () => {
  let worst = 0
  for (let i = 0; i < 200; i++) {
    const x = (i * 7.31) % 64
    const z = (i * 3.77) % 64
    const base = value(x, z)
    worst = Math.max(worst, gap(base, value(x + 64, z)), gap(base, value(x, z + 64)), gap(base, value(x - 128, z + 192)))
  }
  assert.ok(worst < 1e-9, 'period gap ' + worst)
})

gate('the field is continuous across the tile edge: the step over the seam is no larger than a step inside the tile', () => {
  const eps = 1e-3
  let inside = 0
  let seam = 0
  for (let i = 0; i < 64; i++) {
    const z = i + 0.25
    inside = Math.max(inside, gap(value(20, z), value(20 + eps, z)), gap(value(z, 41), value(z, 41 + eps)))
    seam = Math.max(seam, gap(value(64 - eps / 2, z), value(eps / 2, z)), gap(value(z, 64 - eps / 2), value(z, eps / 2)))
  }
  assert.ok(seam < inside * 4 + 1e-6, 'seam step ' + seam + ' against inside step ' + inside)
  assert.ok(seam < 0.01, 'seam step ' + seam)
})

gate('control: the plain gust function is not periodic, so tiling it unblended would show a seam', () => {
  const raw = (x, z) => grassWindGust([0, 0, 0], x, z, 3.5, DIR[0], DIR[1])
  let worst = 0
  for (let i = 0; i < 64; i++) worst = Math.max(worst, gap(raw(0, i + 0.5), raw(64, i + 0.5)))
  assert.ok(worst > 0.2, 'raw seam gap ' + worst)
})

gate('update fills the same buffers in place with the field value at each cell centre, and bumps the version', () => {
  const field = createGrassWindField({ dirX: 1, dirZ: 1 })
  const data = field.data
  const texels = field.texels
  assert.equal(field.update(3.5), 1)
  assert.equal(field.data, data)
  assert.equal(field.texels, texels)
  assert.equal(field.time, 3.5)
  for (const [ix, iz] of [[0, 0], [63, 63], [10, 40], [31, 32]]) {
    const expected = value(ix + 0.5, iz + 0.5)
    const o = (iz * 64 + ix) * 3
    for (let k = 0; k < 3; k++) assert.equal(data[o + k], Math.fround(expected[k]), 'cell ' + ix + ',' + iz + ' channel ' + k)
  }
  const before = Float32Array.from(data)
  assert.equal(field.update(4.5), 2)
  assert.notDeepEqual(Float32Array.from(data), before)
  field.update(3.5)
  assert.deepEqual(Float32Array.from(data), before)
})

gate('the texel bytes decode back to the float field within one byte step, with full alpha', () => {
  const field = createGrassWindField()
  field.update(1.25)
  let worst = 0
  for (let cell = 0; cell < 64 * 64; cell++) {
    const sway = ((field.texels[cell * 4] - 127.5) / 127.5) * GRASS_WIND_SWAY_RANGE
    const fx = (field.texels[cell * 4 + 1] - 127.5) / 127.5
    const fz = (field.texels[cell * 4 + 2] - 127.5) / 127.5
    worst = Math.max(worst, Math.abs(sway - field.data[cell * 3]) / GRASS_WIND_SWAY_RANGE, Math.abs(fx - field.data[cell * 3 + 1]), Math.abs(fz - field.data[cell * 3 + 2]))
    assert.equal(field.texels[cell * 4 + 3], 255)
  }
  assert.ok(worst <= 0.5 / 127.5 + 1e-6, 'byte error ' + worst)
  assert.equal(GRASS_WIND_SWAY_RANGE, 1.5)
})

gate('sample reads the cell value at a cell centre, blends between centres, and wraps for negative and far coordinates', () => {
  const field = createGrassWindField()
  field.update(2)
  const at = (x, z) => field.sample([0, 0, 0], x, z)
  const cell = (ix, iz) => Array.from(field.data.subarray((iz * 64 + ix) * 3, (iz * 64 + ix) * 3 + 3))
  assert.deepEqual(at(10.5, 20.5), cell(10, 20))
  const mid = at(11, 20.5)
  cell(10, 20).forEach((v, k) => assert.ok(Math.abs(mid[k] - (v + cell(11, 20)[k]) / 2) < 1e-6))
  assert.deepEqual(at(10.5 - 64, 20.5 + 640), cell(10, 20))
  const edge = at(0, 5.5)
  cell(63, 5).forEach((v, k) => assert.ok(Math.abs(edge[k] - (v + cell(0, 5)[k]) / 2) < 1e-6, 'the edge sample blends the last and first columns'))
  const out = [0, 0, 0]
  assert.equal(field.sample(out, 1, 1), out)
})

gate('a new wind direction changes the next update and is normalised, and the same inputs give the same field', () => {
  const a = createGrassWindField({ dirX: 3, dirZ: 4 })
  const b = createGrassWindField({ dirX: 0.6, dirZ: 0.8 })
  assert.ok(Math.abs(a.dirX - 0.6) < 1e-12 && Math.abs(a.dirZ - 0.8) < 1e-12)
  a.update(7)
  b.update(7)
  assert.deepEqual(Float32Array.from(a.data), Float32Array.from(b.data))
  b.setDirection(0, -2)
  assert.deepEqual([b.dirX, b.dirZ], [0, -1])
  b.update(7)
  assert.notDeepEqual(Float32Array.from(a.data), Float32Array.from(b.data))
})

gate('an invalid reach, cell count, direction or time is refused by name, where upstream takes a default for a bad reach', () => {
  for (const reachM of [0, -5, Number.NaN, Infinity, '64', null]) assert.throws(() => createGrassWindField({ reachM }), { name: 'RangeError', message: /reach must be a positive finite number of metres/ })
  for (const cells of [0, 1, 48, 64.5, '64']) assert.throws(() => createGrassWindField({ cells }), { name: 'RangeError', message: /cells must be a power of two/ })
  assert.throws(() => createGrassWindField({ dirX: 0, dirZ: 0 }), { name: 'RangeError', message: /direction/ })
  assert.throws(() => createGrassWindField({ dirX: Number.NaN }), { name: 'RangeError', message: /direction/ })
  const field = createGrassWindField({ cells: 16, reachM: 24 })
  assert.equal(field.cellM, 1.5)
  assert.throws(() => field.update(Number.NaN), { name: 'RangeError', message: /time/ })
  assert.throws(() => field.setDirection(0, 0), { name: 'RangeError', message: /direction/ })
  assert.equal(field.version, 0)
  assert.equal(field.update(0), 1)
})

finish()
