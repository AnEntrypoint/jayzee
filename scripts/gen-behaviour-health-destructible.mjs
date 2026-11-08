import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runScenarios } from './lib/healthDestructibleScenarios.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const spointRoot = resolve(process.argv[2] ?? '/workspace/spoint')
const sources = [
  'src/behaviours/health.js',
  'src/behaviours/destructible.js',
  'src/behaviours/destructibleSpec.js',
]

const healthMod = await import(join(spointRoot, 'src/behaviours/health.js'))
const destructibleMod = await import(join(spointRoot, 'src/behaviours/destructible.js'))

function wrapHealthSpec(spec) {
  if (spec === null || typeof spec !== 'object') return spec
  const out = { ...spec }
  if (typeof spec.onDeath === 'function') out.onDeath = (appCtx, event) => spec.onDeath(event)
  if (typeof spec.onDamage === 'function') out.onDamage = (appCtx, event) => spec.onDamage(event)
  if (typeof spec.onRespawn === 'function') out.onRespawn = () => spec.onRespawn()
  return out
}

function wrapDestructibleSpec(spec) {
  if (spec === null || typeof spec !== 'object') return spec
  const out = { ...spec }
  if (typeof spec.onDestroyed === 'function') out.onDestroyed = (appCtx, ids) => spec.onDestroyed({ ids })
  if (typeof spec.onRespawn === 'function') out.onRespawn = () => spec.onRespawn()
  return out
}

function spointAdapter() {
  return {
    begin(host) {
      globalThis.Date.now = host.now
      Math.random = host.random
    },
    healthSchema: () => healthMod.HEALTH_SCHEMA,
    health: (spec, host) => healthMod.defineHealth(wrapHealthSpec(spec), { _registerDisposer: host.registerDisposer }),
    destructible: (spec, site) => destructibleMod.createDestructible(wrapDestructibleSpec(spec), {
      entity: site.entity,
      world: site.world,
      players: site.players,
    }),
  }
}

const results = runScenarios(spointAdapter)
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')
const spointHead = execFileSync('git', ['-C', spointRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()

const outDir = join(here, 'fixtures', 'spoint')
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'health-destructible.json'), JSON.stringify({
  generatedFrom: 'spoint src/behaviours/health.js, destructible.js and destructibleSpec.js, run through scripts/lib/healthDestructibleScenarios.mjs',
  spointHead,
  sources: Object.fromEntries(sources.map((source) => [source, sha256(join(spointRoot, source))])),
  scenarios: results,
}, null, 2) + '\n')

console.log(`wrote ${Object.keys(results).length} scenarios from spoint ${spointHead}`)
