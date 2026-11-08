import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gate, finish } from './lib/gate.mjs'
import { packCellKey } from '../src/terrain-pure/cubeSphereCells.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/spoint/cube-sphere-cell-key.json', import.meta.url), 'utf8'))
const row = (label) => fixture.rows.find((r) => r.label === label)
const keyOf = (r) => packCellKey(r.face, r.cx, r.cy, r.cellsPerFace)
const BIG = 'cell (5, 63709, 63709) at 63710 cells per face'
const ALIAS_A = 'cell (0, 11502, 11613) at 63710 cells per face'
const NEG = 'cell (0, -1, 0) at 63710 cells per face'
const POS = 'cell (0, 16852, 13952) at 63710 cells per face'
const HUGE = 'cell (2, 2000000, 2000000) at 1000000000 cells per face'

gate('the fixture was generated from spoint at 22dca25', () => {
  assert.equal(fixture.source.commit, '22dca25')
  assert.equal(fixture.source.file, 'src/terrain/CubeSphereCells.js')
})

gate('cell (5, 63709, 63709) at 63710 cells per face packs to the spoint key, not a wrapped one', () => {
  assert.equal(keyOf(row(BIG)), row(BIG).key)
})

gate('cell (0, 11502, 11613) at 63710 cells per face packs to the spoint key', () => {
  assert.equal(keyOf(row(ALIAS_A)), row(ALIAS_A).key)
})

gate('cell (0, -1, 0) packs to the spoint key and stays distinct from cell (0, 16852, 13952)', () => {
  assert.equal(keyOf(row(NEG)), row(NEG).key)
  assert.equal(keyOf(row(POS)), row(POS).key)
  assert.notEqual(keyOf(row(NEG)), keyOf(row(POS)))
})

gate('the two aliasing pairs are distinct in spoint and in the port', () => {
  assert.notEqual(row(BIG).key, row(ALIAS_A).key)
  assert.notEqual(keyOf(row(BIG)), keyOf(row(ALIAS_A)))
  assert.notEqual(row(NEG).key, row(POS).key)
  assert.notEqual(keyOf(row(NEG)), keyOf(row(POS)))
})

gate('a key past the safe-integer range is refused with RangeError, as spoint refuses it', () => {
  assert.equal(row(HUGE).threw, 'RangeError')
  assert.throws(() => packCellKey(2, 2000000, 2000000, 1000000000), RangeError)
})

finish()
