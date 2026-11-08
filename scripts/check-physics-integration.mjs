import { readFileSync } from 'node:fs'
import { gate, finish } from './lib/gate.mjs'
import { PhysicsIntegration } from '../src/netcode/PhysicsIntegration.js'
import { runPhysicsScenarios, comparePhysics } from './lib/physicsIntegrationScenarios.mjs'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/spoint/physics-integration.json', import.meta.url), 'utf8'))
const scenarios = runPhysicsScenarios(PhysicsIntegration)
const byName = new Map(scenarios.map((s) => [s.name, s]))

for (const result of comparePhysics(fixture, scenarios)) {
  gate('physics-integration ' + result.name + ' matches spoint', () => {
    if (result.difference) throw new Error(result.difference)
  })
}

gate('physics-integration the jolt path keeps the spawned character in the injected world', () => {
  const described = byName.get('jolt-fall-and-jump').trace.find((x) => x.label === 'describe').value
  if (described.length !== 1 || described[0].id !== 1) throw new Error(JSON.stringify(described))
})

gate('physics-integration a half-submerged player is marked swimming', () => {
  const first = byName.get('swim-with-characters').trace[0].value
  if (first.swimming !== true) throw new Error('swimming=' + first.swimming)
})

gate('physics-integration a player below the kill depth is reset to the kill plane', () => {
  const kill = byName.get('jolt-kill-plane').trace[0].value
  if (kill.position[1] !== -100 || kill.velocity.some((x) => x !== 0)) throw new Error(JSON.stringify(kill))
})

gate('physics-integration a character with a non-positive radius falls back to 0.4', () => {
  const described = byName.get('jolt-crouch-and-config').trace.find((x) => x.label === 'describe').value
  if (!described.some((c) => c.radius === 0.4) || described.some((c) => c.radius <= 0)) throw new Error(JSON.stringify(described))
})

finish();
