import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = dirname(here)
const fixture = JSON.parse(readFileSync(join(here, 'fixtures', 'spoint', 'ab-elevation.json'), 'utf8'))
const script = join(here, 'ab-elevation.mjs')
const result = spawnSync(process.execPath, [script], { cwd: root, env: { ...process.env, AB_N: String(fixture.N) }, encoding: 'utf8' })

gate('the A/B script exits 0 and prints spoint output line for line for N=' + fixture.N, () => {
  assert.equal(result.status, 0, 'exit status, stderr: ' + result.stderr)
  assert.equal(result.stdout, fixture.stdout)
})

gate('the A/B script reads AB_N and defaults N to 20000 as spoint does', () => {
  const text = readFileSync(script, 'utf8')
  assert.match(text, /const N = Number\(process\.env\.AB_N\) \|\| 20000/)
})

gate('the pinned A/B verdicts: only land-bias moves elevation, the other nine terms are no-ops', () => {
  const rows = fixture.stdout.split('\n').filter((line) => /^(canyon|detail|cliff|peak|broadlow|incise|detailfbm|octmax|land|climate)/.test(line))
  assert.equal(rows.length, 10)
  assert.equal(rows.filter((line) => line.includes('works')).length, 1)
  assert.ok(rows.find((line) => line.startsWith('land-bias')).includes('works'))
  assert.equal(rows.filter((line) => line.includes('NO-OP')).length, 9)
})

finish()
