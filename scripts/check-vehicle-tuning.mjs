import { gate, finish } from './lib/gate.mjs'
import { readSlipCurve, readSuspensionSpring } from '../src/motion-pure/vehicleTuning.js'

const refuses = (fn, fragment) => {
  try {
    fn()
  } catch (error) {
    if (!error.message.includes(fragment)) throw new Error(`message "${error.message}" lacks "${fragment}"`)
    return
  }
  throw new Error(`accepted, expected refusal containing "${fragment}"`)
}
const is = (a, b, what) => {
  if (!Object.is(a, b)) throw new Error(`${what}: expected ${b}, got ${a}`)
}

gate('a slip curve of two or more points with slip strictly increasing and force >= 0 is returned as given', () => {
  const curve = [[0, 0], [0.1, 1], [0.3, 0.8]]
  is(readSlipCurve(curve, 'lateral'), curve, 'returned curve')
})
gate('a slip curve with zero force is accepted, and a curve with fewer than two points is refused', () => {
  readSlipCurve([[0, 0], [1, 0]], 'lateral')
  refuses(() => readSlipCurve([[0, 1]], 'longitudinal'), 'longitudinal needs at least 2 points')
  refuses(() => readSlipCurve(null, 'longitudinal'), 'needs at least 2 points')
})
gate('a slip curve whose slip does not strictly increase is refused (equal slips included)', () => {
  refuses(() => readSlipCurve([[0.2, 1], [0.2, 1]], 'lateral'), 'slip strictly increasing')
  refuses(() => readSlipCurve([[0.5, 1], [0.1, 1]], 'lateral'), 'slip strictly increasing')
})
gate('a slip curve with a negative force, a point that is not a pair, or a non-finite value is refused', () => {
  refuses(() => readSlipCurve([[0, -1], [1, 1]], 'lateral'), 'force >= 0')
  refuses(() => readSlipCurve([[0, 1, 2], [1, 1]], 'lateral'), 'force >= 0')
  refuses(() => readSlipCurve([[0, NaN], [1, 1]], 'lateral'), 'force >= 0')
  refuses(() => readSlipCurve([[0, 1], [Infinity, 1]], 'lateral'), 'force >= 0')
})

gate('a spring with a positive frequency and a damping in [0, 1] is returned, and both boundaries of damping are accepted', () => {
  is(readSuspensionSpring({ frequency: 2, damping: 0 }).damping, 0, 'damping 0')
  is(readSuspensionSpring({ frequency: 2, damping: 1 }).damping, 1, 'damping 1')
  is(readSuspensionSpring({ frequency: 2, damping: 0.5 }).frequency, 2, 'frequency')
})
gate('a spring with frequency 0 or below, or damping outside [0, 1], is refused', () => {
  refuses(() => readSuspensionSpring({ frequency: 0, damping: 0.5 }), 'frequency must be > 0')
  refuses(() => readSuspensionSpring({ frequency: -1, damping: 0.5 }), 'frequency must be > 0')
  refuses(() => readSuspensionSpring({ frequency: 2, damping: 1.5 }), 'damping within [0, 1]')
  refuses(() => readSuspensionSpring({ frequency: 2, damping: -0.1 }), 'damping within [0, 1]')
})
gate('a spring with a non-finite frequency or damping is refused', () => {
  refuses(() => readSuspensionSpring({ frequency: NaN, damping: 0.5 }), 'frequency must be > 0')
  refuses(() => readSuspensionSpring({ frequency: 2, damping: NaN }), 'damping within [0, 1]')
  refuses(() => readSuspensionSpring({ frequency: '2', damping: 0.5 }), 'frequency must be > 0')
})

finish()
