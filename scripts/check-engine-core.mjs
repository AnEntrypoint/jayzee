import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const glue = resolve(process.argv[2] ?? join(root, 'engine/out/engine-core-64mib.mjs'))
const name = basename(glue, '.mjs')
const wasm = glue.replace(/\.mjs$/, '.wasm')
const manifest = JSON.parse(readFileSync(join(root, 'engine/artifacts.json'), 'utf8'))
const TIER = 64 * 1024 * 1024
const TICKS = 10000

gate('the wasm artifact hash equals the hash pinned in engine/artifacts.json', () => {
  const pinned = manifest.artifacts[name]
  assert.ok(pinned, 'no pinned hash for ' + name)
  assert.equal(createHash('sha256').update(readFileSync(wasm)).digest('hex'), pinned.sha256)
})

const mod = await (await import(pathToFileURL(glue).href)).default()

gate('engine_init returns 0 and the memory starts at the 64 MiB tier', () => {
  assert.equal(mod._engine_init(), 0)
  assert.equal(mod.HEAPU8.buffer.byteLength, TIER)
  assert.equal(Number(mod._engine_memory_bytes()), TIER)
})

gate('memory.buffer.byteLength is unchanged after 10000 ticks, and the tick counter reads 10000', () => {
  const before = mod.HEAPU8.buffer
  for (let i = 0; i < TICKS; i++) mod._engine_tick(1)
  assert.equal(mod.HEAPU8.buffer.byteLength, TIER, 'buffer byteLength is ' + mod.HEAPU8.buffer.byteLength)
  assert.equal(before.byteLength, TIER, 'the buffer at boot was detached')
  assert.equal(Number(mod._engine_memory_bytes()), TIER)
  assert.equal(Number(mod._engine_ticks()), TICKS)
})

finish()
