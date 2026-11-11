import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { GLUE_TIERS_MIB } from '../src/engine/glueTier.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const chain = JSON.parse(readFileSync(join(root, 'scripts', 'test-chain.json'), 'utf8'))
const GLUE_NAME = /engine-core-(\d+)mib((?:-[a-z]+)*)/g
const IMPORT = /(?:from|import)\s*\(?\s*'(\.{1,2}\/[^']+)'/g
const VARIANT_OF = { '': 'fixed', '-leak': 'leak', '-timed': 'timed', '-threads': 'threads', '-timed-threads': 'threadstimed' }

const closure = (entries) => {
  const seen = new Set()
  const queue = entries.slice()
  while (queue.length > 0) {
    const file = queue.pop()
    if (seen.has(file) || !existsSync(file)) continue
    seen.add(file)
    for (const match of readFileSync(file, 'utf8').matchAll(IMPORT)) queue.push(resolve(dirname(file), match[1]))
  }
  return [...seen]
}

const commandFor = (tier, flags) => {
  const simd = flags.endsWith('-simd')
  const variant = VARIANT_OF[simd ? flags.slice(0, -5) : flags]
  if (variant === undefined) return null
  const parts = []
  if (variant !== 'fixed') parts.push('ENGINE_VARIANT=' + variant)
  if (tier !== 64) parts.push('ENGINE_TIER_MIB=' + tier)
  if (simd) parts.push('ENGINE_WASM_SIMD=ON')
  return [...parts, 'bash engine/build.sh'].join(' ')
}

const chainFiles = chain.flatMap((name) => (pkg.scripts[name] ?? '').split(' ').filter((word) => word.endsWith('.mjs')).map((word) => resolve(root, word)))
const glues = new Map()
for (const file of closure(chainFiles)) {
  if (file === fileURLToPath(import.meta.url)) continue
  for (const match of readFileSync(file, 'utf8').matchAll(GLUE_NAME)) glues.set('engine-core-' + match[1] + 'mib' + match[2], commandFor(Number(match[1]), match[2]))
}
for (const tier of GLUE_TIERS_MIB) glues.set('engine-core-' + tier + 'mib', commandFor(tier, ''))
const REQUIRED = [...new Set([...glues.values()].filter((command) => command !== null))].sort()

const judgeCi = (text) => {
  const lines = text.split('\n').map((line) => line.trim())
  const testAt = lines.indexOf('- run: npm test')
  assert.ok(testAt !== -1, 'the workflow runs npm test')
  for (const command of REQUIRED) {
    const at = lines.indexOf(command)
    assert.ok(at !== -1, 'the workflow builds no glue with: ' + command)
    assert.ok(at < testAt, command + ' runs after npm test')
  }
}

const ci = readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8')
console.log('glues the chain reads: ' + [...glues.keys()].sort().join(', '))

gate('the chain reads at least the fixed, timed, leak and threaded glues, so the derived list is not empty', () => {
  for (const name of ['engine-core-64mib', 'engine-core-64mib-timed', 'engine-core-64mib-leak', 'engine-core-512mib-threads', 'engine-core-1024mib-threads']) assert.ok(glues.has(name), name)
  assert.ok(REQUIRED.length >= 9, 'only ' + REQUIRED.length + ' build commands were derived')
})
gate('every glue name the chain reads maps to a build variant', () => {
  for (const [name, command] of glues) assert.notEqual(command, null, name + ' has no build variant')
})
gate('the ci test job builds every engine glue the test chain reads, derived from the chain files and their imports, before npm test', () => {
  judgeCi(ci)
})
gate('the ci gate refuses a workflow without the threaded 512 build', () => {
  assert.throws(() => judgeCi(ci.replace('ENGINE_VARIANT=threads ENGINE_TIER_MIB=512 bash engine/build.sh', '')), /threads ENGINE_TIER_MIB=512/)
})
gate('the ci gate refuses a workflow whose glue build comes after npm test', () => {
  const block = ci.slice(ci.indexOf('      - name: Build the engine glue'), ci.indexOf('      - name: Fetch JoltPhysics'))
  const moved = ci.replace(block, '') + block
  assert.throws(() => judgeCi(moved), /after npm test/)
})

finish()
