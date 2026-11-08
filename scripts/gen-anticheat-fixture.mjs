import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { runAnticheat, spointApi } from './lib/anticheatScenario.mjs'

const spointRoot = resolve(process.argv[2] ?? '/workspace/spoint')
const files = ['src/netcode/InputGuard.js', 'src/netcode/OutlierDetector.js']
const outFile = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'spoint', 'anticheat.json')

const guard = await import(pathToFileURL(join(spointRoot, files[0])).href)
const outliers = await import(pathToFileURL(join(spointRoot, files[1])).href)

let now = 0
const clock = { set: (t) => { now = t } }
const realNow = Date.now
Date.now = () => now
let sections
try {
  sections = runAnticheat(spointApi({ ...guard, ...outliers }, clock))
} finally {
  Date.now = realNow
}

const fixture = {
  source: {
    files: files.map((file) => ({ file, sha256: createHash('sha256').update(readFileSync(join(spointRoot, file))).digest('hex') })),
    note: 'spoint InputGuard and OutlierDetector run on scripts/lib/anticheatScenario.mjs with Date.now set to each scenario time. Spoint reads Date.now in both modules, so the clock is injected by replacing Date.now for the run.',
  },
  sections,
}
writeFileSync(outFile, JSON.stringify(fixture, null, 1) + '\n')
console.log('wrote anticheat.json', Object.entries(sections).map(([name, lines]) => name + ' ' + lines.length).join(', '))
