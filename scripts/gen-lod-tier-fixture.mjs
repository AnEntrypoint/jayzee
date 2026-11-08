import { writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { makeScenarios, runScenario, runPoses, inputsDigest } from './lib/lodTierScenario.mjs'

const spointRoot = resolve(process.argv[2] ?? '/workspace/spoint')
const outFile = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'spoint', 'lod-tiers.json')
const load = (rel) => import(pathToFileURL(join(spointRoot, rel)).href)

const encoder = await load('src/netcode/SnapshotEncoder.js')
const binFormat = await load('src/netcode/SnapshotBinFormat.js')

const { scenarios, poses } = makeScenarios()
const spointLib = {
  classifyPlayerTiers: encoder.classifyPlayerTiers,
  filterEncodedPlayersTiered: encoder.filterEncodedPlayersTiered,
  buildCrowdDots: encoder.buildCrowdDots,
}
const cadenceMod = (hz) => Math.max(1, Math.round(hz / encoder.PLAYER_LOD_REDUCED_HZ))

const out = scenarios.map((s) => ({ index: s.index, hz: s.hz, tick: s.tick, ...runScenario(spointLib, s, cadenceMod(s.hz)) }))
const poseOut = runPoses(binFormat.packReducedPlayerPose, poses)

const fixture = {
  source: 'spoint src/netcode/SnapshotEncoder.js classifyPlayerTiers, filterEncodedPlayersTiered, buildCrowdDots; spoint src/netcode/SnapshotBinFormat.js packReducedPlayerPose; cadence modulus transcribed from spoint src/sdk/TickHandler.js line 298',
  inputsSha256: inputsDigest(),
  scenarioCount: scenarios.length,
  poseCount: poses.length,
  scenarios: out,
  poses: poseOut,
}
writeFileSync(outFile, JSON.stringify(fixture, null, 1) + '\n')
const totals = out.reduce((acc, s) => ({
  full: acc.full + s.classify.full.length,
  reduced: acc.reduced + s.classify.reduced.length,
  dots: acc.dots + s.classify.dotIds.length,
}), { full: 0, reduced: 0, dots: 0 })
console.log('wrote lod-tiers.json: scenarios', out.length, 'poses', poseOut.length, 'full', totals.full, 'reduced', totals.reduced, 'dot players', totals.dots)
