function refusal(reasonCode, message, field = null) {
  const err = new TypeError(`[define-spec] ${message}`)
  err.reasonCode = reasonCode
  err.field = field
  return err
}

function matchesRule(rule, value, partial) {
  if (rule.nullable && value === null) return true
  let base = false
  switch (rule.type) {
    case 'number':
      base = typeof value === 'number' && Number.isFinite(value)
        && (rule.min === undefined || (rule.exclusiveMin ? value > rule.min : value >= rule.min))
        && (rule.max === undefined || value <= rule.max)
      break
    case 'boolean': base = typeof value === 'boolean'; break
    case 'string': base = typeof value === 'string' && (!rule.nonEmpty || value.length > 0); break
    case 'function': base = typeof value === 'function'; break
    case 'array': base = Array.isArray(value) && (!rule.nonEmpty || value.length > 0); break
    case 'custom': base = rule.check(value, partial) === true; break
    default: base = false
  }
  return base && (rule.check ? rule.check(value, partial) === true : true)
}

function assertSpecShape(name, spec) {
  const proto = Object.getPrototypeOf(spec)
  if (proto !== Object.prototype && proto !== null) throw refusal('define-spec-inherited-key', `${name} spec must not carry a prototype`)
  for (const key in spec) {
    if (!Object.hasOwn(spec, key)) throw refusal('define-spec-inherited-key', `${name} spec inherited key "${key}"`, key)
  }
  for (const key of Reflect.ownKeys(spec)) {
    if (typeof key === 'symbol') throw refusal('define-spec-symbol-key', `${name} spec must not use symbol keys`)
    if (!Object.prototype.propertyIsEnumerable.call(spec, key)) throw refusal('define-spec-hidden-key', `${name} spec has hidden key "${key}"`, key)
  }
}

export function parseDefineSpec(name, spec, schema) {
  if (!schema) throw refusal('define-spec-unknown-factory', `no spec schema is registered for ${name}`)
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw refusal('define-spec-invalid', `${name} spec must be a plain object`)
  assertSpecShape(name, spec)
  for (const key of Reflect.ownKeys(spec)) {
    if (!Object.hasOwn(schema, key)) throw refusal('define-spec-unknown-key', `${name} has no spec key "${key}"`, key)
  }
  const parsed = {}
  for (const [key, rule] of Object.entries(schema)) {
    const present = Object.hasOwn(spec, key)
    if (!present || spec[key] === undefined) {
      if (rule.required) throw refusal('define-spec-missing-field', `${name} requires spec.${key}`, key)
      const fallback = typeof rule.default === 'function' ? rule.default(parsed) : rule.default
      if (fallback !== undefined) parsed[key] = fallback
      continue
    }
    const value = spec[key]
    if (!matchesRule(rule, value, parsed)) throw refusal('define-spec-invalid-field', `${name}.${key} failed its ${rule.type} rule`, key)
    parsed[key] = value
  }
  return Object.freeze(parsed)
}

export const DEFINE_SPEC_SCHEMAS = Object.freeze({
  health: Object.freeze({
    max: { type: 'number', min: 0, exclusiveMin: true, required: true },
    hp: { type: 'number', min: 0, default: partial => partial.max },
    invulnMs: { type: 'number', min: 0, default: 0 },
    onDeath: { type: 'function' }, onDamage: { type: 'function' }, onRespawn: { type: 'function' },
  }),
  buffStack: Object.freeze({
    maxStack: { type: 'number' },
    decayPerSec: { type: 'number', min: 0 },
    decayTarget: { type: 'number' },
  }),
})

export const DEFINE_SPEC_KEYS = Object.freeze({
  defineHealth: Object.freeze(['hp', 'invulnMs', 'max', 'onDamage', 'onDeath', 'onRespawn']),
  defineBuffStack: Object.freeze(['decayPerSec', 'decayTarget', 'maxStack']),
  definePathOptions: Object.freeze(['closed', 'smooth', 'spacing']),
  defineGameFSM: Object.freeze(['context', 'id', 'initial', 'states']),
})

export function assertDefineSpecKeys(name, spec) {
  const keys = DEFINE_SPEC_KEYS[name]
  if (!keys) throw refusal('define-spec-unknown-factory', `no spec key list is registered for ${name}`)
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw refusal('define-spec-invalid', `${name} spec must be a plain object`)
  assertSpecShape(name, spec)
  for (const key of Reflect.ownKeys(spec)) {
    if (!keys.includes(key)) throw refusal('define-spec-unknown-key', `${name} has no spec key "${key}"`, key)
  }
  return spec
}

export function assertDefineNumber(name, key, value, { min = -Infinity, exclusiveMin = false, max = Infinity } = {}) {
  if (value === undefined || value === null) return
  const ok = typeof value === 'number' && Number.isFinite(value)
    && (exclusiveMin ? value > min : value >= min)
    && value <= max
  if (!ok) throw refusal('define-spec-invalid-field', `${name}.${key} must be a finite number in its allowed range`, key)
}
