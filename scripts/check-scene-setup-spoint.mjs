import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { gate, finish } from './lib/gate.mjs'
import { firstDivergence } from './lib/canon.mjs'
import { SCENE_SETUP_CASE_LABELS, runSceneSetupScenario } from './lib/sceneSetupScenario.mjs'
import * as sceneSetup from '../src/client/sceneSetup.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/spoint/scene-setup.json', import.meta.url), 'utf8'))
const host = {}
const canvasFor = () => {
  const c = { width: 0, height: 0, drawn: false }
  c.getContext = () => ({ drawImage() { c.drawn = true } })
  return c
}

const got = await runSceneSetupScenario({
  THREE,
  host,
  setupLights: sceneSetup.setupLights,
  applySceneConfig: (s, scene, ambient, sun, studio, camera) => sceneSetup.applySceneConfig(s, scene, ambient, sun, studio, camera, host),
  createScene: () => sceneSetup.createScene({ installUnderwaterTint: () => {}, host }),
  installSkeletonUploadSkip: sceneSetup.installSkeletonUploadSkip,
  installStuckPipelineRecovery: (renderer, scene) => sceneSetup.installStuckPipelineRecovery(renderer, scene, { now: () => 0, warn: () => {}, host }),
  limitTextureSize: (texture) => sceneSetup.limitTextureSize(texture, canvasFor),
  waitForManifestResidence: (meshes, manifest, waitMs) => sceneSetup.waitForManifestResidence(meshes, manifest, waitMs, { now: () => 0, sleep: async () => {} }),
  constants: { MAX_UNMANIFESTED_WARMUP_MESHES: sceneSetup.MAX_UNMANIFESTED_WARMUP_MESHES, MANIFEST_RESIDENCE_WAIT_MS: sceneSetup.MANIFEST_RESIDENCE_WAIT_MS, MANIFEST_RESIDENCE_POLL_MS: sceneSetup.MANIFEST_RESIDENCE_POLL_MS, MANIFEST_RESIDENCE_MAX_POLLS: sceneSetup.MANIFEST_RESIDENCE_MAX_POLLS },
})

gate('the scene setup fixture was generated from spoint SceneSetup.js at a pinned commit', () => {
  assert.match(fixture.source.commit, /^[0-9a-f]{7,}$/)
  assert.deepEqual(fixture.source.files, ['client/core/SceneSetup.js'])
})

gate('the fixture covers every scene setup case in order', () => {
  assert.equal(fixture.rows.length, SCENE_SETUP_CASE_LABELS.length)
  SCENE_SETUP_CASE_LABELS.forEach((label, i) => assert.ok(fixture.rows[i].includes('s:' + JSON.stringify(label)), label))
})

gate('lights, applySceneConfig, createScene, the skeleton skip, limitTextureSize and the manifest wait equal spoint on every case', () => {
  assert.equal(firstDivergence(got.rows, fixture.rows), null)
})

gate('the fixture shows a pose change swapping the bone texture, so a dead skip would show', () => {
  assert.ok(fixture.rows[6].includes('"swapped":b:true'), fixture.rows[6])
})

gate('the fixture shows an oversize texture scaled to 2048 by 512, so a dead limit would show', () => {
  assert.ok(fixture.rows[8].includes('"width":n:2048'), fixture.rows[8])
  assert.ok(fixture.rows[8].includes('"height":n:512'), fixture.rows[8])
})

gate('negative control: a fixture row with one changed number does not equal the port', () => {
  const tampered = fixture.rows.slice()
  tampered[1] = tampered[1].replace(/n:(-?[0-9.]+)/, 'n:123456.5')
  assert.notEqual(firstDivergence(got.rows, tampered), null)
})

finish()
