import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { runCameraRigScenarios } from './lib/cameraRigScenarios.mjs'

const spoint = process.argv[2] ?? '/workspace/spoint'
const { defineCameraRig } = await import(pathToFileURL(spoint + '/src/behaviours/cameraRig.js').href)
const fixture = {
  source: 'spoint src/behaviours/cameraRig.js (defineCameraRig, run by scripts/lib/cameraRigScenarios.mjs)',
  scenarios: runCameraRigScenarios(defineCameraRig),
}
writeFileSync(new URL('./fixtures/spoint/camera-rig.json', import.meta.url), JSON.stringify(fixture, null, 1) + '\n')
console.log('wrote camera-rig.json with ' + fixture.scenarios.length + ' scenarios')
