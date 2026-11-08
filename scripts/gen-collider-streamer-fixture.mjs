import { writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  RADIUS, LATTICE_SPEC, STREAMER_RADIUS, CENTRES, runStreamerScenario, runFieldLatticeScenario,
} from './lib/colliderStreamerScenario.mjs'

const spointRoot = resolve(process.argv[2] ?? '/workspace/spoint')
const outFile = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'spoint', 'collider-streamer.json')
const load = (rel) => import(pathToFileURL(join(spointRoot, rel)).href)

const { createColliderStreamer } = await load('src/terrain/ColliderStreamer.js')
const { createFieldLattice } = await load('src/terrain/FieldLattice.js')
const { createPlanetFrame } = await load('src/terrain/PlanetFrame.js')
const { snapshotChart } = await load('src/shared/chartAnchor.js')
const { createChartTransfer } = await load('src/shared/chartTransfer.js')

const deps = { createColliderStreamer, createFieldLattice, createPlanetFrame, snapshotChart, createChartTransfer }
const sync = await runStreamerScenario(deps)
const queued = await runStreamerScenario(deps, { queued: true })
const capped = await runStreamerScenario(deps, { maxCenters: 2, cap: 4 })
const fieldLattice = runFieldLatticeScenario(deps)

const fixture = {
  source: 'spoint src/terrain/ColliderStreamer.js and FieldLattice.js with PlanetFrame.js, shared/chartAnchor.js, shared/chartTransfer.js',
  radius: RADIUS,
  latticeSpec: LATTICE_SPEC,
  streamerRadius: STREAMER_RADIUS,
  centres: CENTRES,
  streamer: { sync, queued, capped },
  fieldLattice,
}
writeFileSync(outFile, JSON.stringify(fixture, null, 2) + '\n')
const counts = [sync, queued, capped].map((v) => v.records.length)
console.log('wrote collider-streamer.json: records per variant', counts.join('/'), 'physics calls', sync.log.length, queued.log.length, capped.log.length, 'messages', sync.messages.length, queued.messages.length, capped.messages.length)
