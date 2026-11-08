import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => readFileSync(join(root, file), 'utf8')
const manifest = JSON.parse(read('engine/artifacts.json'))
const workflow = read('.github/workflows/engine-core.yml')
const build = read('engine/build.sh')
const cmake = read('engine/CMakeLists.txt')
const SHA = /^[0-9a-f]{40}$/

gate('the emsdk commit in engine/artifacts.json is a full 40-hex commit', () => {
  assert.match(manifest.emsdkCommit, SHA)
  assert.equal(manifest.emsdk, '4.0.10')
})

gate('every action in the engine workflow is pinned to a full commit SHA, never a tag', () => {
  const uses = [...workflow.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((m) => m[1])
  assert.ok(uses.length >= 4, 'expected at least four action uses, found ' + uses.length)
  for (const ref of uses) assert.match(ref, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, ref)
})

gate('the workflow checks out emsdk at the commit in engine/artifacts.json and activates the same version', () => {
  assert.ok(workflow.includes(manifest.emsdkCommit), 'workflow does not pin ' + manifest.emsdkCommit)
  assert.ok(workflow.includes('install ' + manifest.emsdk), 'workflow does not install ' + manifest.emsdk)
})

gate('every pinned artifact has a 64-hex sha256 and a wasm path under engine/out', () => {
  for (const [name, entry] of Object.entries(manifest.artifacts)) {
    assert.match(entry.sha256, /^[0-9a-f]{64}$/, name)
    assert.equal(entry.wasm, 'engine/out/' + name + '.wasm', name)
  }
})

gate('the fixed variant links with ALLOW_MEMORY_GROWTH=0 and a maximum equal to the tier', () => {
  assert.ok(cmake.includes('-sALLOW_MEMORY_GROWTH=0 -sMAXIMUM_MEMORY=${ENGINE_TIER_BYTES}'), 'engine/CMakeLists.txt fixed link line')
})

gate('the build script configures through emcmake and builds the CMake target', () => {
  assert.ok(build.includes('emcmake cmake'), 'engine/build.sh does not call emcmake')
  assert.ok(build.includes('cmake --build'), 'engine/build.sh does not build')
})

finish()
