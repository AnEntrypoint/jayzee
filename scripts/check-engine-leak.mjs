import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const glue = resolve(process.argv[2] ?? join(root, 'engine/out/engine-core-64mib-leak.mjs'))
const name = basename(glue, '.mjs')
const wasm = glue.replace(/\.mjs$/, '.wasm')
const manifest = JSON.parse(readFileSync(join(root, 'engine/artifacts.json'), 'utf8'))
const tierMib = Number(/engine-core-(\d+)mib/.exec(name)?.[1])
assert.ok(Number.isInteger(tierMib) && tierMib > 0, 'the glue name must carry its tier in MiB: ' + name)
const TIER = tierMib * 1024 * 1024
const TICKS = 10000

gate('the leak variant wasm hash equals the hash pinned in engine/artifacts.json', () => {
  const pinned = manifest.artifacts[name]
  assert.ok(pinned, 'no pinned hash for ' + name)
  assert.equal(createHash('sha256').update(readFileSync(wasm)).digest('hex'), pinned.sha256)
})

const mod = await (await import(pathToFileURL(glue).href)).default()

gate('engine_init returns 0 and the memory starts at the tier named by the glue', () => {
  assert.equal(mod._engine_init(64, 1, TIER), 0)
  assert.equal(mod.HEAPU8.buffer.byteLength, TIER)
})

gate('the leak variant grows its memory with each tick: after 10000 ticks the buffer is above the tier', () => {
  for (let i = 0; i < TICKS; i++) mod._engine_tick(1)
  assert.equal(Number(mod._engine_ticks()), TICKS)
  assert.ok(mod.HEAPU8.buffer.byteLength > TIER, 'the leak variant did not grow: byteLength ' + mod.HEAPU8.buffer.byteLength)
})

finish()
