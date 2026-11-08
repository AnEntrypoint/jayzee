import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as THREE from 'three'
import { runSceneSetupScenario } from './lib/sceneSetupScenario.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const spointRoot = resolve(process.argv[2] ?? '/workspace/spoint')
const files = ['client/core/SceneSetup.js']
const sha256 = (file) => createHash('sha256').update(readFileSync(join(spointRoot, file))).digest('hex')
const commit = execFileSync('git', ['log', '-1', '--format=%h', '--', ...files], { cwd: spointRoot }).toString().trim()

const mapped = {
  three: import.meta.resolve('three'),
  'three/tsl': import.meta.resolve('three/tsl'),
  'three/webgpu': import.meta.resolve('three/webgpu'),
  '@three.ez/instanced-mesh': import.meta.resolve('@three.ez/instanced-mesh'),
}
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (Object.hasOwn(mapped, specifier)) return { url: mapped[specifier], shortCircuit: true }
    return nextResolve(specifier, context)
  },
})
const spoint = await import(pathToFileURL(join(spointRoot, 'client/core/SceneSetup.js')).href)

const host = {}
globalThis.window = host
const canvasFor = () => {
  const c = { width: 0, height: 0, drawn: false }
  c.getContext = () => ({ drawImage() { c.drawn = true } })
  return c
}
globalThis.document = { createElement: () => canvasFor() }

const { rows } = await runSceneSetupScenario({
  THREE,
  host,
  setupLights: spoint.setupLights,
  applySceneConfig: (s, scene, ambient, sun, studio, camera) => spoint.applySceneConfig(s, scene, ambient, sun, studio, camera),
  createScene: () => spoint.createScene(),
  installSkeletonUploadSkip: spoint.installSkeletonUploadSkip,
  installStuckPipelineRecovery: (renderer, scene) => spoint.installStuckPipelineRecovery(renderer, scene),
  limitTextureSize: (texture) => spoint.limitTextureSize(texture),
  waitForManifestResidence: (meshes, manifest, waitMs) => spoint.waitForManifestResidence(meshes, manifest, waitMs),
  constants: { MAX_UNMANIFESTED_WARMUP_MESHES: spoint.MAX_UNMANIFESTED_WARMUP_MESHES, MANIFEST_RESIDENCE_WAIT_MS: spoint.MANIFEST_RESIDENCE_WAIT_MS, MANIFEST_RESIDENCE_POLL_MS: spoint.MANIFEST_RESIDENCE_POLL_MS, MANIFEST_RESIDENCE_MAX_POLLS: spoint.MANIFEST_RESIDENCE_MAX_POLLS },
})

const fixture = { source: { commit, files, sha256: Object.fromEntries(files.map((f) => [f, sha256(f)])) }, rows }
const out = join(here, 'fixtures', 'spoint', 'scene-setup.json')
writeFileSync(out, JSON.stringify(fixture, null, 2) + String.fromCharCode(10))
console.log('wrote ' + out + ' with ' + rows.length + ' rows at ' + commit)
