import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { runPhysicsScenarios } from './lib/physicsIntegrationScenarios.mjs'

const spoint = process.argv[2] ?? '/workspace/spoint'
const { PhysicsIntegration } = await import(pathToFileURL(spoint + '/src/netcode/PhysicsIntegration.js').href)
const fixture = {
  source: 'spoint src/netcode/PhysicsIntegration.js (run by scripts/lib/physicsIntegrationScenarios.mjs with its scripted physics world)',
  scenarios: runPhysicsScenarios(PhysicsIntegration),
}
writeFileSync(new URL('./fixtures/spoint/physics-integration.json', import.meta.url), JSON.stringify(fixture, null, 1) + '\n')
console.log('wrote physics-integration.json with ' + fixture.scenarios.length + ' scenarios')
