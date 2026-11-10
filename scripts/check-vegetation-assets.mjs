import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { finish, gate } from './lib/gate.mjs'
import { validateAsset } from '../tools/asset-pipeline/validate.mjs'

const root = resolve(import.meta.dirname, '..')
const SOURCE_DIR = '/workspace/hy3d/output/relay-prepped'
const NAMES = ['tree', 'tall_tree', 'grass_large', 'flowers']
const OUT_DIR = resolve(root, 'build/assets/vegetation')

const inputs = NAMES.map((name) => resolve(SOURCE_DIR, name + '.glb'))
const missing = inputs.filter((path) => !existsSync(path))

gate('every vegetation source GLB is present under the relay-prepped directory', () => {
  assert.deepEqual(missing, [], 'missing: ' + missing.join(', '))
})

let manifest = null
gate('the prep tool writes every asset through the meshopt and KTX2 steps and the validator accepts it', () => {
  execFileSync(process.execPath, [resolve(root, 'tools/asset-pipeline/prep.mjs'), OUT_DIR, ...inputs], { stdio: 'pipe' })
  manifest = JSON.parse(readFileSync(resolve(OUT_DIR, 'manifest.json'), 'utf8'))
  assert.equal(manifest.assets.length, NAMES.length)
  for (const name of NAMES) {
    const bytes = readFileSync(resolve(OUT_DIR, name + '.glb'))
    const result = validateAsset(name + '.glb', bytes)
    assert.ok(result.ok, name + ': ' + result.reasons.join('; '))
  }
})

gate('each prepared asset encodes at least one KTX2 texture', () => {
  for (const asset of manifest.assets) assert.ok(asset.texturesEncoded >= 1, asset.name + ' has no KTX2 texture')
})

gate('the meshopt level is recorded in the manifest as medium', () => {
  assert.equal(manifest.meshoptLevel, 'medium')
})

gate('each prepared asset is written and is not larger than its source by more than 2x', () => {
  for (const name of NAMES) {
    const out = resolve(OUT_DIR, name + '.glb')
    assert.ok(existsSync(out), name + ' was not written')
    const sourceBytes = statSync(resolve(SOURCE_DIR, name + '.glb')).size
    const outBytes = statSync(out).size
    assert.ok(outBytes <= 2 * sourceBytes, name + ': ' + outBytes + ' B against source ' + sourceBytes + ' B')
  }
})

finish()
