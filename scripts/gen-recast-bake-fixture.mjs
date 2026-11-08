import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { runRecastBakeScenario } from './lib/recastBakeScenario.mjs'

const spointRoot = resolve(process.argv[2] ?? '/workspace/spoint')
const relative = 'src/pathfinding/RecastIntegration.js'
const sourcePath = join(spointRoot, relative)
const spoint = await import(pathToFileURL(sourcePath).href)

const sections = await runRecastBakeScenario({ bakeNavmesh: spoint.bakeNavmesh })

const recastPackage = JSON.parse(readFileSync(join(spointRoot, 'node_modules', 'recast-navigation', 'package.json'), 'utf8'))
const fixture = {
  source: {
    file: relative,
    sha256: createHash('sha256').update(readFileSync(sourcePath)).digest('hex'),
    recastNavigation: recastPackage.version,
  },
  sections,
}

const out = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'spoint', 'recast-bake.json')
writeFileSync(out, JSON.stringify(fixture, null, 2) + '\n')
console.log('wrote ' + out + ' from ' + relative)
console.log('bakes: ' + sections.bakes.length + ' refused: ' + sections.bakes.filter((row) => row.includes('threw')).length)
