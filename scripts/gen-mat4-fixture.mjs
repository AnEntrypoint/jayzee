import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { runMat4Scenario } from './lib/mat4Scenario.mjs'

const spointRoot = resolve(process.argv[2] ?? '/workspace/spoint')
const relative = 'packages/mapspinner/src/gl-render-mat4.js'
const sourcePath = join(spointRoot, relative)
const spoint = await import(pathToFileURL(sourcePath).href)

const sections = runMat4Scenario({ TU: spoint.TU, M4: spoint.M4 })
const fixture = {
  source: {
    file: relative,
    sha256: createHash('sha256').update(readFileSync(sourcePath)).digest('hex'),
  },
  sections,
}

const out = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'spoint', 'gl-render-mat4.json')
writeFileSync(out, JSON.stringify(fixture, null, 2) + '\n')
console.log('wrote ' + out + ' from ' + relative)
for (const [name, rows] of Object.entries(sections)) console.log(name + ': ' + rows.length)
