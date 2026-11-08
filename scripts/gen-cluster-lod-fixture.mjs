import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { runClusterLodScenario } from './lib/clusterLodScenario.mjs'

const spointRoot = resolve(process.argv[2] ?? '/workspace/spoint')
const relative = 'packages/streaming-gltf/src/meshlet-codec.js'
const sourcePath = join(spointRoot, relative)
const spoint = await import(pathToFileURL(sourcePath).href)

const sections = await runClusterLodScenario({
  buildClusterLod: spoint.buildClusterLod,
  buildClusterLodExtra: spoint.buildClusterLodExtra,
  lod0OnlyClusterLodExtras: spoint.lod0OnlyClusterLodExtras,
  parseClusterLod: spoint.parseClusterLod,
})

const fixture = {
  source: {
    file: relative,
    sha256: createHash('sha256').update(readFileSync(sourcePath)).digest('hex'),
    meshoptimizer: JSON.parse(readFileSync(join(spointRoot, 'node_modules', 'meshoptimizer', 'package.json'), 'utf8')).version,
  },
  sections,
}

const out = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'spoint', 'cluster-lod.json')
writeFileSync(out, JSON.stringify(fixture, null, 2) + '\n')
console.log('wrote ' + out + ' from ' + relative)
console.log('build: ' + sections.build.length + ' records: ' + sections.records.length + ' malformed: ' + sections.malformed.length)
