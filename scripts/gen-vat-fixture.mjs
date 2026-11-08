import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { runVatScenario } from './lib/vatScenario.mjs'

const spointRoot = resolve(process.argv[2] ?? '/workspace/spoint')
const relative = 'client/core/PlayerVATBake.js'
const sourcePath = join(spointRoot, relative)
const threePackage = JSON.parse(readFileSync(join(spointRoot, 'node_modules', 'three', 'package.json'), 'utf8'))
const THREE = await import(pathToFileURL(join(spointRoot, 'node_modules', 'three', 'build', 'three.module.js')).href)
const spoint = await import(pathToFileURL(sourcePath).href)

const { rows } = runVatScenario(THREE, { bakeVAT: spoint.bakeVAT, bakeVATMultiClip: spoint.bakeVATMultiClip })
const fixture = {
  source: {
    file: relative,
    sha256: createHash('sha256').update(readFileSync(sourcePath)).digest('hex'),
    three: threePackage.version,
  },
  rows,
}
const out = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'spoint', 'vat-bake.json')
writeFileSync(out, JSON.stringify(fixture, null, 2) + '\n')
console.log('wrote ' + out + ' with ' + rows.length + ' rows from ' + relative)
