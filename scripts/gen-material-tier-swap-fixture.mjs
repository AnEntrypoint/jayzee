import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { runMaterialTierSwapScenario } from './lib/materialTierSwapScenario.mjs'

const spointRoot = resolve(process.argv[2] ?? '/workspace/spoint')
const relative = 'packages/streaming-gltf/src/material-tier-swap.js'
const sourcePath = join(spointRoot, relative)
const spoint = await import(pathToFileURL(sourcePath).href)

const sections = runMaterialTierSwapScenario({
  shouldSwapMaterials: spoint.shouldSwapMaterials,
  shouldStripNormalMaps: spoint.shouldStripNormalMaps,
  applyLowTierMaterials: spoint.applyLowTierMaterials,
  setThreeRef: spoint.setThreeRef,
})

const fixture = {
  source: {
    file: relative,
    sha256: createHash('sha256').update(readFileSync(sourcePath)).digest('hex'),
  },
  sections,
}

const out = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'spoint', 'material-tier-swap.json')
writeFileSync(out, JSON.stringify(fixture, null, 2) + '\n')
console.log('wrote ' + out + ' from ' + relative)
for (const [name, rows] of Object.entries(sections)) console.log(name + ': ' + rows.length)
