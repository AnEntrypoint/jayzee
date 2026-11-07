import { gate, finish } from './lib/gate.mjs'
import { ConstraintLimitError, swingTwistLimits, hingeLimits } from '../src/motion-pure/constraintLimits.js'

const PI = Math.PI

const refuses = (fn, reasonCode, field) => {
  try {
    fn()
  } catch (error) {
    if (!(error instanceof ConstraintLimitError)) throw new Error(`not a ConstraintLimitError: ${error && error.message}`)
    if (error.reasonCode !== reasonCode) throw new Error(`reasonCode ${error.reasonCode}, expected ${reasonCode}`)
    if (error.field !== field) throw new Error(`field ${error.field}, expected ${field}`)
    return
  }
  throw new Error(`accepted, expected refusal ${reasonCode} on ${field}`)
}
const accepts = (fn) => {
  try {
    fn()
  } catch (error) {
    throw new Error(`refused: ${error && error.message}`)
  }
}
const is = (a, b, what) => {
  if (!Object.is(a, b)) throw new Error(`${what}: expected ${b}, got ${a}`)
}

gate('swing-twist defaults: cone is PI, twist spans [-PI, PI], no spring', () => {
  const s = swingTwistLimits()
  is(s.cone, PI, 'default cone')
  is(s.twistMin, -PI, 'default twistMin')
  is(s.twistMax, PI, 'default twistMax')
  is(s.spring, null, 'default spring')
})
gate('swing-twist defaults: a given cone replaces the PI default (negative control)', () => {
  is(swingTwistLimits({ cone: 0.5 }).cone, 0.5, 'explicit cone')
})

gate('cone: 0 and PI are accepted at the boundaries', () => {
  is(swingTwistLimits({ cone: 0 }).cone, 0, 'cone 0')
  is(swingTwistLimits({ cone: PI }).cone, PI, 'cone PI')
})
gate('cone: a negative cone is refused as angle-out-of-range on cone', () => {
  refuses(() => swingTwistLimits({ cone: -0.1 }), 'angle-out-of-range', 'cone')
})
gate('cone: a cone above PI is refused (negative control)', () => {
  refuses(() => swingTwistLimits({ cone: PI + 0.001 }), 'angle-out-of-range', 'cone')
})
gate('cone: NaN, Infinity, a string and null are refused', () => {
  refuses(() => swingTwistLimits({ cone: NaN }), 'angle-out-of-range', 'cone')
  refuses(() => swingTwistLimits({ cone: Infinity }), 'angle-out-of-range', 'cone')
  refuses(() => swingTwistLimits({ cone: '1' }), 'angle-out-of-range', 'cone')
  refuses(() => swingTwistLimits({ cone: null }), 'angle-out-of-range', 'cone')
})

gate('twist: a valid pair is returned as min and max', () => {
  const s = swingTwistLimits({ twist: [-1, 1] })
  is(s.twistMin, -1, 'twistMin')
  is(s.twistMax, 1, 'twistMax')
})
gate('twist: an equal pair is accepted, an inverted pair is refused (negative control)', () => {
  accepts(() => swingTwistLimits({ twist: [0.5, 0.5] }))
  refuses(() => swingTwistLimits({ twist: [1, -1] }), 'twist-inverted', 'twist')
})
gate('twist: the full range [-PI, PI] is accepted at its boundaries', () => {
  const s = swingTwistLimits({ twist: [-PI, PI] })
  is(s.twistMin, -PI, 'full twistMin')
  is(s.twistMax, PI, 'full twistMax')
})
gate('twist: a value outside [-PI, PI] is refused as angle-out-of-range on twist', () => {
  refuses(() => swingTwistLimits({ twist: [-4, 0] }), 'angle-out-of-range', 'twist')
  refuses(() => swingTwistLimits({ twist: [0, 4] }), 'angle-out-of-range', 'twist')
})
gate('twist: a non-pair is refused as twist-not-pair', () => {
  refuses(() => swingTwistLimits({ twist: { 0: -1, 1: 1 } }), 'twist-not-pair', 'twist')
  refuses(() => swingTwistLimits({ twist: [-1, 0, 1] }), 'twist-not-pair', 'twist')
  refuses(() => swingTwistLimits({ twist: null }), 'twist-not-pair', 'twist')
})

gate('softness: a valid spring is returned as frequency and damping only', () => {
  const s = swingTwistLimits({}, { frequency: 2, damping: 0.1, extra: 9 })
  is(s.spring.frequency, 2, 'spring frequency')
  is(s.spring.damping, 0.1, 'spring damping')
  is('extra' in s.spring, false, 'spring extra key')
})
gate('softness: zero damping is accepted (negative control: an extra key is dropped, not kept)', () => {
  accepts(() => swingTwistLimits({}, { frequency: 1, damping: 0 }))
  is('extra' in swingTwistLimits({}, { frequency: 1, damping: 0, extra: 1 }).spring, false, 'extra key dropped')
})
gate('softness: undefined and null mean no spring', () => {
  is(swingTwistLimits({}, undefined).spring, null, 'undefined softness')
  is(swingTwistLimits({}, null).spring, null, 'null softness')
})
gate('softness: a frequency that is zero, negative, NaN, infinite or missing is refused on softness.frequency', () => {
  refuses(() => swingTwistLimits({}, { frequency: 0, damping: 0 }), 'softness-frequency', 'softness.frequency')
  refuses(() => swingTwistLimits({}, { frequency: -1, damping: 0 }), 'softness-frequency', 'softness.frequency')
  refuses(() => swingTwistLimits({}, { frequency: NaN, damping: 0 }), 'softness-frequency', 'softness.frequency')
  refuses(() => swingTwistLimits({}, { frequency: Infinity, damping: 0 }), 'softness-frequency', 'softness.frequency')
  refuses(() => swingTwistLimits({}, { damping: 0 }), 'softness-frequency', 'softness.frequency')
})
gate('softness: a negative, NaN, infinite or missing damping is refused on softness.damping (negative control: zero is fine)', () => {
  refuses(() => swingTwistLimits({}, { frequency: 1, damping: -0.1 }), 'softness-damping', 'softness.damping')
  refuses(() => swingTwistLimits({}, { frequency: 1, damping: NaN }), 'softness-damping', 'softness.damping')
  refuses(() => swingTwistLimits({}, { frequency: 1, damping: Infinity }), 'softness-damping', 'softness.damping')
  refuses(() => swingTwistLimits({}, { frequency: 1 }), 'softness-damping', 'softness.damping')
})

gate('hinge defaults: min is -PI, max is PI, no spring', () => {
  const h = hingeLimits()
  is(h.min, -PI, 'default min')
  is(h.max, PI, 'default max')
  is(h.spring, null, 'default spring')
})
gate('hinge: a valid range is returned and an equal range is accepted', () => {
  const h = hingeLimits({ min: -1, max: 1 })
  is(h.min, -1, 'hinge min')
  is(h.max, 1, 'hinge max')
  accepts(() => hingeLimits({ min: 0.5, max: 0.5 }))
})
gate('hinge: an inverted range is refused as hinge-inverted on max (negative control)', () => {
  refuses(() => hingeLimits({ min: 1, max: -1 }), 'hinge-inverted', 'max')
  accepts(() => hingeLimits({ min: -1, max: 1 }))
})
gate('hinge: a min or max outside [-PI, PI] is refused as angle-out-of-range on its own field', () => {
  refuses(() => hingeLimits({ min: -4 }), 'angle-out-of-range', 'min')
  refuses(() => hingeLimits({ max: 4 }), 'angle-out-of-range', 'max')
})
gate('hinge: a softness spring is validated and attached, and a bad frequency is refused', () => {
  is(hingeLimits({}, { frequency: 1, damping: 0.2 }).spring.damping, 0.2, 'hinge spring damping')
  refuses(() => hingeLimits({}, { frequency: 0, damping: 0 }), 'softness-frequency', 'softness.frequency')
})

gate('error: ConstraintLimitError is an Error with name, reasonCode, field and a tagged message', () => {
  const e = new ConstraintLimitError('twist-inverted', 'twist')
  if (!(e instanceof Error)) throw new Error('not an Error')
  is(e.name, 'ConstraintLimitError', 'name')
  is(e.reasonCode, 'twist-inverted', 'reasonCode')
  is(e.field, 'twist', 'field')
  is(e.message, '[constraint-limits] twist-inverted: twist', 'message')
})
gate('error: a plain Error is not a ConstraintLimitError (negative control)', () => {
  if (new Error('x') instanceof ConstraintLimitError) throw new Error('plain Error matched')
})

finish()
