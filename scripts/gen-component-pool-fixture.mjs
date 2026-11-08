import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { runComponentPoolTrace } from './lib/component-pool-trace.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const spointRoot = process.argv[2] || '/workspace/spoint'
const spoint = await import(pathToFileURL(join(spointRoot, 'src', 'apps', 'ComponentPool.js')).href)
const result = runComponentPoolTrace(spoint.createComponentPool)
writeFileSync(join(here, 'fixtures', 'spoint', 'component-pool.json'), JSON.stringify({ source: 'spoint src/apps/ComponentPool.js createComponentPool', ...result }, null, 2) + '\n')
console.log(JSON.stringify(result.errors))
console.log('lifecycle', result.lifecycle.length, 'growth', result.growth.length)
