import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { runServerScenarios } from './lib/chartStateServerScenarios.mjs'

const spointRoot = resolve(process.argv[2] ?? '/workspace/spoint')
const outFile = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'spoint', 'chart-state-server.json')
const load = (rel) => import(pathToFileURL(join(spointRoot, rel)).href)
const index = await load('src/sdk/chartState/index.js')
const transfer = await load('src/shared/chartTransfer.js')
const result = JSON.parse(JSON.stringify(runServerScenarios({ attachServerChartMigrators: index.attachServerChartMigrators, createChartTransfer: transfer.createChartTransfer })))
mkdirSync(dirname(outFile), { recursive: true })
writeFileSync(outFile, JSON.stringify({ generatedFrom: 'spoint src/sdk/chartState/index.js with scripts/lib/chartStateServerScenarios.mjs, using spoint src/shared/chartTransfer.js', result }, null, 1) + '\n')
console.log('wrote ' + outFile)
