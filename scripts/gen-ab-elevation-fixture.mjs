import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = dirname(here)
const spointRoot = process.argv[2] || '/workspace/spoint'
const N = 300
const script = join(spointRoot, 'packages', 'mapspinner', 'scripts', 'ab-elevation.mjs')
const result = spawnSync(process.execPath, [script], { env: { ...process.env, AB_N: String(N) }, encoding: 'utf8' })
if (result.status !== 0) throw new Error('spoint ab-elevation exited ' + result.status + ': ' + result.stderr)
const out = join(root, 'scripts', 'fixtures', 'spoint', 'ab-elevation.json')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify({ generator: 'scripts/gen-ab-elevation-fixture.mjs', source: 'spoint packages/mapspinner/scripts/ab-elevation.mjs run with AB_N=' + N, N, stdout: result.stdout }, null, 1) + '\n')
console.log('wrote ' + out + ' lines=' + result.stdout.split('\n').length)
