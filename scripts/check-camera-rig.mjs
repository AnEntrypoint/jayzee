import { readFileSync } from 'node:fs'
import { gate, finish } from './lib/gate.mjs'
import { defineCameraRig } from '../src/behaviours/cameraRig.js'
import { runCameraRigScenarios, compareCameraRig } from './lib/cameraRigScenarios.mjs'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/spoint/camera-rig.json', import.meta.url), 'utf8'))
const scenarios = runCameraRigScenarios(defineCameraRig)
const byName = new Map(scenarios.map((s) => [s.name, s]))

for (const result of compareCameraRig(fixture, scenarios)) {
  gate('camera-rig ' + result.name + ' matches spoint', () => {
    if (result.difference) throw new Error(result.difference)
  })
}

gate('camera-rig every refusal carries a reasonCode', () => {
  const missing = []
  for (const s of scenarios.filter((x) => x.name.startsWith('refuse-'))) {
    const failures = [s.build, ...s.trace].filter((x) => x && x.ok === false)
    if (failures.length === 0) missing.push(s.name + ' has no refusal')
    for (const f of failures) if (!f.reasonCode) missing.push(s.name + ' ' + (f.label ?? 'build') + ' has no reasonCode')
  }
  if (missing.length) throw new Error(missing.join('; '))
})

gate('camera-rig cutscene reports done once its span is passed', () => {
  const last = byName.get('cutscene').trace.at(-1).value
  if (last.done !== true) throw new Error('last cutscene step done=' + last.done)
})

gate('camera-rig injected camera host receives each layer output', () => {
  const step = byName.get('orbit').trace.find((x) => x.label === 'update-a').value
  if (step.applied !== 1 || step.position.length !== 3 || step.target.length !== 3 || step.layer !== 'orbit') throw new Error(JSON.stringify(step))
})

gate('camera-rig stack pops back to the layer below and the default stays', () => {
  const at = (label) => byName.get('stack').trace.find((x) => x.label === label).value
  if (at('top-after-pop') !== 'mid' || at('top-after-mid') !== 'top' || at('top-after-default-pop') !== 'mid') throw new Error('stack order wrong')
})

finish();
