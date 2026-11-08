import { canon } from './canon.mjs'

const DT = 1 / 60

const WHEELS = [
  { position: [-0.8, -0.35, 1.2], steer: true, drive: true, maxSteerAngle: 0.6, suspensionSpring: { frequency: 1.5, damping: 0.4 }, tyre: { longitudinal: [[0, 0], [0.1, 1], [0.3, 1.2]], lateral: [[0, 0], [0.2, 1.5]] } },
  { position: [0.8, -0.35, 1.2], steer: true, maxSteerAngle: 0.6 },
  { position: [-0.8, -0.35, -1.2], drive: true, suspensionMin: 0.25, suspensionMax: 0.55 },
  { position: [0.8, -0.35, -1.2], drive: true, maxBrakeTorque: 1200 },
]

const TRACK_WHEELS = [
  { position: [-0.9, -0.35, 1.1], side: 'left', driven: true, width: 0.3 },
  { position: [-0.9, -0.35, -1.1], side: 'left' },
  { position: [0.9, -0.35, 1.1], side: 'right', driven: true, width: 0.3 },
  { position: [0.9, -0.35, -1.1], side: 'right' },
]

const WHEELED_OPTS = { engine: { maxTorque: 500, maxRPM: 6000, minRPM: 1000 } }
const TRACKED_OPTS = { engine: { maxTorque: 800, maxRPM: 5000, minRPM: 800 }, tracks: { left: { maxBrakeTorque: 2000 } } }

export const VEHICLE_CASE_LABELS = [
  'ground and wheeled chassis are created',
  'settle with no input',
  'drive forward for one second',
  'brake for half a second',
  'steer right while driving',
  'entity turret aim toward the front right',
  'remove the wheeled vehicle',
  'a second remove of the same vehicle is refused',
  'chassis after removal, stepped for 10 ticks',
  'a wheeled vehicle with no chassis is refused',
  'a wheeled vehicle with no wheels is refused',
  'a wheeled vehicle with a one-point tyre curve is refused',
  'a wheeled vehicle with a zero-frequency spring is refused',
  'a tracked vehicle with no chassis is refused',
  'a tracked vehicle with no wheels is refused',
  'tracked chassis and wheels are created',
  'tracked settle with no input',
  'tracked drive forward for one second',
  'tracked pivot turn for half a second',
  'remove the tracked vehicle',
  'queries on an unknown vehicle id',
  'turret aim straight ahead',
  'turret aim with a chassis yawed 90 degrees',
  'turret aim clamped to a yaw limit',
  'turret aim with a zero direction is refused',
]

export function runVehiclesScenario(adapter) {
  const rows = []
  const record = (label, value) => rows.push(canon({ label, value }))
  const phase = (label, fn) => {
    try { record(label, fn()) } catch (error) { record(label, { threw: error.message }) }
  }
  const run = (n, input) => {
    for (let t = 0; t < n; t++) {
      if (input) input()
      adapter.step(DT, 2)
    }
  }
  const wheels = (vid, count) => Array.from({ length: count }, (_, i) => ({
    transform: adapter.wheelTransform(vid, i),
    speed: adapter.wheelSpeed(vid, i),
    grounded: adapter.wheelGrounded(vid, i),
  }))
  const s = {}

  phase(VEHICLE_CASE_LABELS[0], () => {
    s.ground = adapter.addBox([50, 0.5, 50], [0, -0.5, 0], false)
    s.chassis = adapter.addBox([1, 0.3, 2], [0, 1.2, 0], true)
    s.vid = adapter.createWheeled(s.chassis, WHEELS, WHEELED_OPTS)
    return { ground: s.ground, chassis: s.chassis, vid: s.vid, chassisState: adapter.chassisState(s.chassis) }
  })
  phase(VEHICLE_CASE_LABELS[1], () => { run(30); return { chassis: adapter.chassisState(s.chassis), wheels: wheels(s.vid, WHEELS.length) } })
  phase(VEHICLE_CASE_LABELS[2], () => { run(60, () => adapter.driveWheeled(s.vid, 1, 0, 0, 0)); return { chassis: adapter.chassisState(s.chassis), wheels: wheels(s.vid, WHEELS.length) } })
  phase(VEHICLE_CASE_LABELS[3], () => { run(30, () => adapter.driveWheeled(s.vid, 0, 0, 1, 0)); return { chassis: adapter.chassisState(s.chassis), wheels: wheels(s.vid, WHEELS.length) } })
  phase(VEHICLE_CASE_LABELS[4], () => { run(30, () => adapter.driveWheeled(s.vid, 1, 1, 0, 0)); return { chassis: adapter.chassisState(s.chassis), wheels: wheels(s.vid, WHEELS.length) } })
  phase(VEHICLE_CASE_LABELS[5], () => adapter.entityAim(s.vid, [1, 0, 1], { minYaw: -0.5, maxYaw: 0.5 }))
  phase(VEHICLE_CASE_LABELS[6], () => adapter.removeVehicle(s.vid))
  phase(VEHICLE_CASE_LABELS[7], () => adapter.removeVehicle(s.vid))
  phase(VEHICLE_CASE_LABELS[8], () => { run(10); return adapter.chassisState(s.chassis) })
  phase(VEHICLE_CASE_LABELS[9], () => adapter.createWheeled(999999, WHEELS, WHEELED_OPTS))
  phase(VEHICLE_CASE_LABELS[10], () => adapter.createWheeled(s.chassis, [], WHEELED_OPTS))
  phase(VEHICLE_CASE_LABELS[11], () => adapter.createWheeled(s.chassis, [{ ...WHEELS[0], tyre: { longitudinal: [[0, 0]] } }], WHEELED_OPTS))
  phase(VEHICLE_CASE_LABELS[12], () => adapter.createWheeled(s.chassis, [{ ...WHEELS[0], suspensionSpring: { frequency: 0, damping: 0.5 } }], WHEELED_OPTS))
  phase(VEHICLE_CASE_LABELS[13], () => adapter.createTracked(999999, TRACK_WHEELS, TRACKED_OPTS))
  phase(VEHICLE_CASE_LABELS[14], () => adapter.createTracked(s.chassis, [], TRACKED_OPTS))
  phase(VEHICLE_CASE_LABELS[15], () => {
    s.chassis2 = adapter.addBox([1, 0.3, 2], [20, 1.2, 0], true)
    s.tid = adapter.createTracked(s.chassis2, TRACK_WHEELS, TRACKED_OPTS)
    return { chassis2: s.chassis2, tid: s.tid }
  })
  phase(VEHICLE_CASE_LABELS[16], () => { run(30); return { chassis: adapter.chassisState(s.chassis2), wheels: wheels(s.tid, TRACK_WHEELS.length) } })
  phase(VEHICLE_CASE_LABELS[17], () => { run(60, () => adapter.driveTracked(s.tid, 1, 1, 1, 0)); return { chassis: adapter.chassisState(s.chassis2), wheels: wheels(s.tid, TRACK_WHEELS.length) } })
  phase(VEHICLE_CASE_LABELS[18], () => { run(30, () => adapter.driveTracked(s.tid, 0, 1, -1, 0)); return { chassis: adapter.chassisState(s.chassis2), wheels: wheels(s.tid, TRACK_WHEELS.length) } })
  phase(VEHICLE_CASE_LABELS[19], () => adapter.removeVehicle(s.tid))
  phase(VEHICLE_CASE_LABELS[20], () => ({
    drive: adapter.driveWheeled(424242, 1, 0, 0, 0),
    wheelTransform: adapter.wheelTransform(424242, 0),
    wheelSpeed: adapter.wheelSpeed(424242, 0),
    wheelGrounded: adapter.wheelGrounded(424242, 0),
    removed: adapter.removeVehicle(424242),
  }))
  phase(VEHICLE_CASE_LABELS[21], () => adapter.aim([0, 0, 0, 1], [0, 0, 1], {}))
  phase(VEHICLE_CASE_LABELS[22], () => adapter.aim([0, Math.SQRT1_2, 0, Math.SQRT1_2], [1, 0, 0.2], {}))
  phase(VEHICLE_CASE_LABELS[23], () => adapter.aim([0, 0, 0, 1], [1, 0, 1], { minYaw: -0.3, maxYaw: 0.3 }))
  phase(VEHICLE_CASE_LABELS[24], () => adapter.aim([0, 0, 0, 1], [0, 0, 0], {}))

  adapter.destroy()
  return { rows }
}
