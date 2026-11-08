import { gate, finish } from './lib/gate.mjs'
import { JoltLimitsError, DEFAULT_JOLT_LIMITS, joltReservationBytes, resolveJoltLimits } from '../src/motion-pure/joltLimits.js'

const is = (a, b, what) => {
  if (!Object.is(a, b)) throw new Error(`${what}: expected ${b}, got ${a}`)
}
const refuses = (fn, code) => {
  try {
    fn()
  } catch (error) {
    if (!(error instanceof JoltLimitsError)) throw new Error(`not a JoltLimitsError: ${error && error.message}`)
    if (error.code !== code) throw new Error(`code ${error.code}, expected ${code}`)
    return
  }
  throw new Error(`accepted, expected refusal ${code}`)
}

gate('the default reservation is the fixed block plus 33, 88 and 336 bytes per body, pair and contact, as spoint sizes it', () => {
  is(joltReservationBytes(DEFAULT_JOLT_LIMITS), 20191016, 'default reservation bytes')
})
gate('the reservation grows with each limit, and a zero-size reservation is the fixed block alone', () => {
  is(joltReservationBytes({ maxBodies: 1, maxBodyPairs: 1, maxContactConstraints: 1 }), 10645288 + 33 + 88 + 336, 'one of each')
  is(joltReservationBytes({ maxBodies: 0, maxBodyPairs: 0, maxContactConstraints: 0 }), 10645288, 'no bodies')
})
gate('the defaults are frozen, so a caller cannot change the sizing they start from', () => {
  is(Object.isFrozen(DEFAULT_JOLT_LIMITS), true, 'frozen defaults')
})
gate('no spec and no fallback resolves to null, so no Jolt sizing is requested', () => {
  is(resolveJoltLimits(undefined), null, 'undefined spec')
  is(resolveJoltLimits(null), null, 'null spec')
})
gate('a spec takes precedence over the fallback, and the fallback is used only when the spec is missing', () => {
  const fallback = { maxBodies: 5, maxBodyPairs: 6, maxContactConstraints: 7 }
  const spec = { maxBodies: 1, maxBodyPairs: 2, maxContactConstraints: 3 }
  is(resolveJoltLimits(spec, fallback).maxBodies, 1, 'spec wins')
  is(resolveJoltLimits(undefined, fallback).maxBodyPairs, 6, 'fallback used')
})
gate('the resolved limits keep only the three limit keys, copied out of the spec', () => {
  const spec = { maxBodies: 4, maxBodyPairs: 8, maxContactConstraints: 12, extra: 'dropped' }
  const out = resolveJoltLimits(spec)
  if (out === spec) throw new Error('resolved limits alias the spec')
  if (Object.keys(out).join(',') !== 'maxBodies,maxBodyPairs,maxContactConstraints') throw new Error('keys ' + Object.keys(out).join(','))
  is(out.maxContactConstraints, 12, 'maxContactConstraints')
})
gate('a missing, zero, negative, fractional, NaN or string limit is refused as jolt-limits-invalid', () => {
  refuses(() => resolveJoltLimits({ maxBodies: 1, maxBodyPairs: 1 }), 'jolt-limits-invalid')
  refuses(() => resolveJoltLimits({ maxBodies: 0, maxBodyPairs: 1, maxContactConstraints: 1 }), 'jolt-limits-invalid')
  refuses(() => resolveJoltLimits({ maxBodies: -1, maxBodyPairs: 1, maxContactConstraints: 1 }), 'jolt-limits-invalid')
  refuses(() => resolveJoltLimits({ maxBodies: 1.5, maxBodyPairs: 1, maxContactConstraints: 1 }), 'jolt-limits-invalid')
  refuses(() => resolveJoltLimits({ maxBodies: NaN, maxBodyPairs: 1, maxContactConstraints: 1 }), 'jolt-limits-invalid')
  refuses(() => resolveJoltLimits({ maxBodies: '1', maxBodyPairs: 1, maxContactConstraints: 1 }), 'jolt-limits-invalid')
})

finish()
