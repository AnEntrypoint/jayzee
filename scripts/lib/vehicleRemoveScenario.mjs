import { canon } from './canon.mjs'
import { WHEEL, WHEELED_OPTS } from './vehicleRefusalScenario.mjs'

const WHEELS = [
  WHEEL,
  { ...WHEEL, position: [0.8, -0.35, 1.2], steer: false },
  { ...WHEEL, position: [-0.8, -0.35, -1.2], steer: false },
  { ...WHEEL, position: [0.8, -0.35, -1.2], steer: false },
]

export const REMOVE_FAULT = 'injected constraint fault'

export const REMOVE_CASE_LABELS = [
  'create a wheeled vehicle',
  'remove it while the constraint removal throws',
  'the faulted vehicle is gone from the backend',
  'create a second vehicle and remove it cleanly',
  'remove the second vehicle again',
]

export function runVehicleRemoveScenario(adapter, capture) {
  const rows = []
  let chassis = null
  let vid = null
  let vid2 = null
  const record = (label, fn) => {
    capture.take()
    let value
    try { value = fn() } catch (error) { value = { threw: error.message } }
    rows.push(canon({ label, value, logged: capture.take() }))
  }
  record(REMOVE_CASE_LABELS[0], () => {
    chassis = adapter.addBox([1, 0.3, 2], [0, 1.2, 0], true)
    vid = adapter.createWheeled(chassis, WHEELS, WHEELED_OPTS)
    return vid
  })
  record(REMOVE_CASE_LABELS[1], () => {
    adapter.injectRemoveFault(REMOVE_FAULT)
    try { return adapter.removeVehicle(vid) } finally { adapter.clearRemoveFault() }
  })
  record(REMOVE_CASE_LABELS[2], () => ({ grounded: adapter.wheelGrounded(vid, 0), removeAgain: adapter.removeVehicle(vid) }))
  record(REMOVE_CASE_LABELS[3], () => {
    const chassis2 = adapter.addBox([1, 0.3, 2], [10, 1.2, 0], true)
    vid2 = adapter.createWheeled(chassis2, WHEELS, WHEELED_OPTS)
    return adapter.removeVehicle(vid2)
  })
  record(REMOVE_CASE_LABELS[4], () => adapter.removeVehicle(vid2))
  adapter.destroy()
  return { rows }
}
