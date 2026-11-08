export const BEHAVIOUR_NAMES = Object.freeze(['health', 'combat', 'checkpoint', 'pickup', 'steering', 'teams', 'buffs'])

const knownNames = () => BEHAVIOUR_NAMES.join(', ')

export function createBehaviourFactories(factories) {
  if (factories === null || typeof factories !== 'object' || Array.isArray(factories)) {
    throw new TypeError('behaviour factories must be an object mapping behaviour names to functions')
  }
  for (const name of Object.keys(factories)) {
    if (!BEHAVIOUR_NAMES.includes(name)) throw new TypeError(`unknown behaviour factory "${name}" (known: ${knownNames()})`)
  }
  const registry = {}
  for (const name of BEHAVIOUR_NAMES) {
    if (typeof factories[name] !== 'function') throw new TypeError(`behaviour "${name}" needs a factory function`)
    registry[name] = factories[name]
  }
  return Object.freeze(registry)
}

export function lookupBehaviour(registry, name) {
  if (typeof name !== 'string' || !Object.hasOwn(registry, name)) {
    throw new TypeError(`unknown behaviour "${String(name)}" (known: ${knownNames()})`)
  }
  return registry[name]
}

export function validateBehaviourSpec(spec, where) {
  if (spec === undefined || spec === null) return null
  if (typeof spec !== 'object' || Array.isArray(spec)) {
    throw new TypeError(`${where} must be an object mapping behaviour names to their spec`)
  }
  for (const name of Object.keys(spec)) {
    if (!BEHAVIOUR_NAMES.includes(name)) throw new TypeError(`${where} names unknown behaviour "${name}" (known: ${knownNames()})`)
    const config = spec[name]
    if (config === null || typeof config !== 'object' || Array.isArray(config)) {
      const got = config === null ? 'null' : Array.isArray(config) ? 'array' : typeof config
      throw new TypeError(`${where} behaviour "${name}" config must be an object (got ${got})`)
    }
  }
  return spec
}
