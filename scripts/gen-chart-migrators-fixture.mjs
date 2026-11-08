import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { runAll, anchorScenario, EMPTY_SPAWN_NO_SINGULAR } from './lib/chartMigratorScenarios.mjs'

const spointRoot = resolve(process.argv[2] ?? '/workspace/spoint')
const outDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'spoint')
const load = (rel) => import(pathToFileURL(join(spointRoot, rel)).href)

const spoint = {
  createPlayerMigrator: (await load('src/sdk/chartState/migratePlayers.js')).createPlayerMigrator,
  createWorldAnchorMigrator: (await load('src/sdk/chartState/migrateWorldAnchors.js')).createWorldAnchorMigrator,
  LagCompensator: (await load('src/netcode/LagCompensator.js')).LagCompensator,
  createChartTransfer: (await load('src/shared/chartTransfer.js')).createChartTransfer,
  createReexpressPass: (await load('src/shared/chartReexpress.js')).createReexpressPass,
}

const result = runAll(spoint, { spoint: true })

let emptySpawnNoSingular
try {
  anchorScenario(spoint, EMPTY_SPAWN_NO_SINGULAR)
  emptySpawnNoSingular = { threw: null }
} catch (error) {
  emptySpawnNoSingular = { threw: error.constructor.name }
}

mkdirSync(outDir, { recursive: true })
const target = join(outDir, 'chart-migrators.json')
writeFileSync(target, JSON.stringify({
  generatedFrom: 'spoint src/sdk/chartState/migratePlayers.js and migrateWorldAnchors.js, with src/netcode/LagCompensator.js, src/shared/chartTransfer.js and src/shared/chartReexpress.js, through scripts/lib/chartMigratorScenarios.mjs',
  result,
  emptySpawnNoSingular,
}, null, 1) + '\n')
console.log('wrote ' + target)
