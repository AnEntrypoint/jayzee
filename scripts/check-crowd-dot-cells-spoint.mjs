import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { buildCrowdDots } from '../src/snapshot-lod-pure/playerLod.js'

const fixture = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'spoint', 'crowd-dots.json'), 'utf8'))
const { positions, dots } = fixture.mixed
const CELL = fixture.cellM
const decode = (list) => buildCrowdDots(list.map((position) => ({ position })), [0, 0, 0], CELL)

gate('the mixed-sign fixture is spoint output at 0769dae, the commit that keys crowd buckets by the [cx, cz] pair', () => {
  assert.equal(fixture.spointCommit, '0769dae')
  assert.equal(fixture.cellM, 25)
})

gate('spoint fixture: cell [2, -5] and cell [-4, 7] are each reported at their own cell, and the (-4, 7) pair counts 3', () => {
  assert.deepEqual(dots, [[2, -5, 1], [-4, 7, 3], [1, -1, 1], [-1, 1, 1]])
})

gate('buildCrowdDots equals spoint dots for every mixed-sign fixture position', () => {
  assert.deepEqual(decode(positions), dots)
})

gate('a player in cell [2, -5] is reported at [2, -5], not at the packed key decode', () => {
  assert.deepEqual(decode([positions[0]]), [[2, -5, 1]])
})

gate('a player in cell [-4, 7] is reported at [-4, 7]', () => {
  assert.deepEqual(decode([positions[1]]), [[-4, 7, 1]])
})

gate('the diagonal pair (1, -1) and (-1, 1) stays two dots, one each', () => {
  assert.deepEqual(decode([positions[4], positions[5]]), [[1, -1, 1], [-1, 1, 1]])
})

gate('players sharing the mixed-sign cell [-4, 7] are counted together', () => {
  assert.deepEqual(decode(positions.slice(1, 4)), [[-4, 7, 3]])
})

gate('negative control: no reported cz is a packed key, so every cz is within the grid', () => {
  for (const [, cz] of decode(positions)) assert.ok(Math.abs(cz) < 1000, 'cz ' + cz)
})

finish()
