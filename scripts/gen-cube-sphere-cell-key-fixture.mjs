import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const spointRoot = resolve(process.argv[2] ?? '/workspace/spoint')
const file = 'src/terrain/CubeSphereCells.js'
const { packCellKey } = await import(pathToFileURL(join(spointRoot, file)).href)

const CASES = [
  ['cell (5, 63709, 63709) at 63710 cells per face', 5, 63709, 63709, 63710],
  ['cell (0, 11502, 11613) at 63710 cells per face', 0, 11502, 11613, 63710],
  ['cell (0, -1, 0) at 63710 cells per face', 0, -1, 0, 63710],
  ['cell (0, 16852, 13952) at 63710 cells per face', 0, 16852, 13952, 63710],
  ['cell (2, 2000000, 2000000) at 1000000000 cells per face', 2, 2000000, 2000000, 1000000000],
]

const rows = CASES.map(([label, face, cx, cy, cellsPerFace]) => {
  try {
    return { label, face, cx, cy, cellsPerFace, key: packCellKey(face, cx, cy, cellsPerFace) }
  } catch (error) {
    return { label, face, cx, cy, cellsPerFace, threw: error.name }
  }
})

const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: spointRoot }).toString().trim()
const sha256 = createHash('sha256').update(readFileSync(join(spointRoot, file))).digest('hex')
const out = join(here, 'fixtures', 'spoint', 'cube-sphere-cell-key.json')
writeFileSync(out, JSON.stringify({ source: { file, commit, sha256 }, rows }, null, 2) + '\n')
console.log('wrote ' + out + ' with ' + rows.length + ' rows')
