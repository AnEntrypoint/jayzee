import { canon } from './canon.mjs'

export const WHEEL = { position: [-0.8, -0.35, 1.2], steer: true, drive: true, maxSteerAngle: 0.6, suspensionSpring: { frequency: 1.5, damping: 0.4 }, tyre: { longitudinal: [[0, 0], [0.1, 1], [0.3, 1.2]], lateral: [[0, 0], [0.2, 1.5]] } }
const TRACK_WHEELS = [
  { position: [-0.9, -0.35, 1.1], side: 'left', driven: true, width: 0.3 },
  { position: [0.9, -0.35, 1.1], side: 'right', driven: true, width: 0.3 },
]
export const WHEELED_OPTS = { engine: { maxTorque: 500, maxRPM: 6000, minRPM: 1000 } }
const TRACKED_OPTS = { engine: { maxTorque: 800, maxRPM: 5000, minRPM: 800 }, tracks: { left: { maxBrakeTorque: 2000 } } }

export const REFUSAL_CASE_LABELS = [
  'wheeled build with a missing chassis',
  'wheeled build with no wheels',
  'wheeled build with a one-point tyre curve',
  'wheeled build with a zero-frequency spring',
  'tracked build with a missing chassis',
  'tracked build with no wheels',
  'tracked build with null options',
]

export function captureErrors() {
  const calls = []
  const original = console.error
  console.error = (...args) => { calls.push(args) }
  return {
    take: () => calls.splice(0),
    restore: () => { console.error = original },
  }
}

export function runRefusalScenario(adapter, capture) {
  const chassis = adapter.addBox([1, 0.3, 2], [0, 1.2, 0], true)
  const cases = [
    () => adapter.createWheeled(999999, [WHEEL], WHEELED_OPTS),
    () => adapter.createWheeled(chassis, [], WHEELED_OPTS),
    () => adapter.createWheeled(chassis, [{ ...WHEEL, tyre: { longitudinal: [[0, 0]] } }], WHEELED_OPTS),
    () => adapter.createWheeled(chassis, [{ ...WHEEL, suspensionSpring: { frequency: 0, damping: 0.5 } }], WHEELED_OPTS),
    () => adapter.createTracked(999999, TRACK_WHEELS, TRACKED_OPTS),
    () => adapter.createTracked(chassis, [], TRACKED_OPTS),
    () => adapter.createTracked(chassis, TRACK_WHEELS, null),
  ]
  const rows = cases.map((run, i) => {
    capture.take()
    let value
    try { value = run() } catch (error) { value = { threw: error.message } }
    return canon({ label: REFUSAL_CASE_LABELS[i], value, logged: capture.take() })
  })
  adapter.destroy()
  return { rows }
}
