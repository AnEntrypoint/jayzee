import { readFileSync } from 'node:fs'
import { gate, finish } from './lib/gate.mjs'
import { BEHAVIOUR_NAMES, createBehaviourFactories, lookupBehaviour, validateBehaviourSpec } from '../src/apps/appBehaviours.js'
import { MAX_FOOTPRINT_INTRUSION_M, footprintBlockers } from '../src/apps/AppGameplay.js'
import * as health from '../src/behaviours/health.js'
import * as combat from '../src/behaviours/combat.js'
import * as checkpoint from '../src/behaviours/checkpoint.js'
import * as pickup from '../src/behaviours/pickup.js'
import * as steering from '../src/behaviours/steering.js'
import * as teams from '../src/behaviours/teams.js'
import * as buffs from '../src/behaviours/buffs.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/spoint/app-behaviours.json', import.meta.url), 'utf8'))

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const assertThrows = (fn, pattern) => {
  let message = null
  try {
    fn()
  } catch (error) {
    message = error && error.message ? error.message : String(error)
  }
  assert(message !== null, `expected a throw matching ${pattern}`)
  assert(pattern.test(message), `threw "${message}", expected ${pattern}`)
}

const stubs = Object.fromEntries(BEHAVIOUR_NAMES.map((name) => [name, function stub(spec) { return { name, spec } }]))
const withoutKey = (key) => {
  const copy = { ...stubs }
  delete copy[key]
  return copy
}

const JAYZEE_EXPORTS = {
  health: ['health', 'createHealth'],
  checkpoint: ['checkpoint', 'defineCheckpoint'],
  pickup: ['pickup', 'definePickup'],
  steering: ['steering', 'defineSteering'],
  buffs: ['buffs', 'createBuffStack'],
}
const MODULES = { health, combat, checkpoint, pickup, steering, teams, buffs }

gate('registry names follow spoint BEHAVIOUR_FACTORIES key order', () => {
  assert(JSON.stringify(BEHAVIOUR_NAMES) === JSON.stringify(fixture.order), `got ${JSON.stringify(BEHAVIOUR_NAMES)}`)
  assert(Object.isFrozen(BEHAVIOUR_NAMES), 'BEHAVIOUR_NAMES must be frozen')
})

const SPOINT_FACTORY_NAMES = {
  health: 'defineHealth',
  combat: 'defineCombat',
  checkpoint: 'defineCheckpoint',
  pickup: 'definePickup',
  steering: 'defineSteering',
  teams: 'defineTeams',
  buffs: 'createBuffStack',
}

gate('fixture maps all seven spoint names to spoint define functions', () => {
  assert(JSON.stringify(Object.keys(fixture.factoryNames)) === JSON.stringify(fixture.order), 'fixture keys differ from order')
  assert(JSON.stringify(fixture.factoryNames) === JSON.stringify(SPOINT_FACTORY_NAMES), 'fixture factory names differ from spoint AppBehaviours.js lines 10 to 16')
})

gate('createBehaviourFactories keeps the injected function for every name and freezes the registry', () => {
  const registry = createBehaviourFactories(stubs)
  for (const name of BEHAVIOUR_NAMES) assert(registry[name] === stubs[name], `identity lost for ${name}`)
  assert(Object.isFrozen(registry), 'registry must be frozen')
  assert(Object.keys(registry).length === BEHAVIOUR_NAMES.length, 'registry must hold exactly the seven names')
})

gate('createBehaviourFactories refuses a missing factory and names it', () => {
  for (const name of BEHAVIOUR_NAMES) {
    assertThrows(() => createBehaviourFactories(withoutKey(name)), new RegExp(`behaviour "${name}" needs a factory function`))
  }
})

gate('createBehaviourFactories refuses a factory that is not a function', () => {
  for (const bad of ['defineTeams', null, undefined, 7, {}]) {
    assertThrows(() => createBehaviourFactories({ ...stubs, teams: bad }), /behaviour "teams" needs a factory function/)
  }
})

gate('createBehaviourFactories refuses an unknown factory name', () => {
  assertThrows(() => createBehaviourFactories({ ...stubs, fire: stubs.health }), /unknown behaviour factory "fire"/)
  assertThrows(() => createBehaviourFactories({ ...stubs, Health: stubs.health }), /unknown behaviour factory "Health"/)
})

gate('createBehaviourFactories refuses a prototype key smuggled in as an own property', () => {
  const smuggled = { ...stubs }
  Object.defineProperty(smuggled, '__proto__', { value: stubs.health, enumerable: true })
  assertThrows(() => createBehaviourFactories(smuggled), /unknown behaviour factory "__proto__"/)
})

gate('createBehaviourFactories refuses a non-object input', () => {
  for (const bad of [null, undefined, [], 'health', 5]) {
    assertThrows(() => createBehaviourFactories(bad), /behaviour factories must be an object/)
  }
})

gate('lookupBehaviour returns the injected function for each name', () => {
  const registry = createBehaviourFactories(stubs)
  for (const name of BEHAVIOUR_NAMES) assert(lookupBehaviour(registry, name) === stubs[name], `lookup wrong for ${name}`)
})

gate('lookupBehaviour does not confuse two names', () => {
  const registry = createBehaviourFactories(stubs)
  assert(lookupBehaviour(registry, 'health') !== lookupBehaviour(registry, 'combat'), 'health and combat share a factory')
})

gate('lookupBehaviour refuses an unknown, prototype or non-string name', () => {
  const registry = createBehaviourFactories(stubs)
  for (const bad of ['fire', 'Health', '', 'constructor', 'toString', '__proto__', 'hasOwnProperty', 7, null, undefined]) {
    assertThrows(() => lookupBehaviour(registry, bad), /unknown behaviour/)
  }
})

gate('validateBehaviourSpec returns null for an absent spec', () => {
  assert(validateBehaviourSpec(undefined, 'spec') === null, 'undefined must give null')
  assert(validateBehaviourSpec(null, 'spec') === null, 'null must give null')
})

gate('validateBehaviourSpec returns the same object for a spec of registry names', () => {
  const spec = { health: { max: 100 }, buffs: {} }
  assert(validateBehaviourSpec(spec, 'spec') === spec, 'spec must come back unchanged')
  assert(validateBehaviourSpec({}, 'spec') !== null, 'an empty object is a valid spec')
})

gate('validateBehaviourSpec refuses an unknown behaviour name', () => {
  assertThrows(() => validateBehaviourSpec({ fire: {} }, 'app'), /app names unknown behaviour "fire"/)
})

gate('validateBehaviourSpec refuses prototype names', () => {
  assertThrows(() => validateBehaviourSpec({ constructor: {} }, 'app'), /unknown behaviour "constructor"/)
  assertThrows(() => validateBehaviourSpec({ toString: {} }, 'app'), /unknown behaviour "toString"/)
})

gate('validateBehaviourSpec refuses a non-object spec', () => {
  for (const bad of ['health', [], 5, () => {}]) {
    assertThrows(() => validateBehaviourSpec(bad, 'app'), /app must be an object mapping behaviour names/)
  }
})

gate('validateBehaviourSpec refuses a null, array or scalar config and names the type', () => {
  assertThrows(() => validateBehaviourSpec({ health: null }, 'app'), /behaviour "health" config must be an object \(got null\)/)
  assertThrows(() => validateBehaviourSpec({ health: [] }, 'app'), /behaviour "health" config must be an object \(got array\)/)
  assertThrows(() => validateBehaviourSpec({ health: 1 }, 'app'), /behaviour "health" config must be an object \(got number\)/)
})

gate('footprint intrusion constant equals spoint AppGameplay line 21', () => {
  assert(MAX_FOOTPRINT_INTRUSION_M === fixture.footprintIntrusionM, `got ${MAX_FOOTPRINT_INTRUSION_M}`)
  assert(typeof footprintBlockers === 'function', 'footprintBlockers must be exported beside the constant')
})

gate('every mapped jayzee define export exists in src/behaviours', () => {
  for (const [name, [moduleName, exportName]] of Object.entries(JAYZEE_EXPORTS)) {
    assert(typeof MODULES[moduleName][exportName] === 'function', `${name} maps to missing export ${exportName}`)
  }
})

gate('combat and teams have no jayzee define export, so the host injects them', () => {
  assert(combat.defineCombat === undefined, 'defineCombat now exists; move combat into JAYZEE_EXPORTS')
  assert(teams.defineTeams === undefined, 'defineTeams now exists; move teams into JAYZEE_EXPORTS')
  assert(typeof teams.resolveTeamColors === 'function', 'teams.js must still export the palette helper')
})

finish()
