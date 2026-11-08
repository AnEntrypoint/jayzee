import { readSlipCurve, readSuspensionSpring } from '../motion-pure/vehicleTuning.js'

const LAYER_DYNAMIC = 1
const LEFT_TRACK = 0
const RIGHT_TRACK = 1

function applyTyreCurves(ws, tyre) {
  const write = (curve, points) => { curve.Clear(); for (const [slip, force] of points) curve.AddPoint(slip, force) }
  if (tyre.longitudinal) write(ws.mLongitudinalFriction, readSlipCurve(tyre.longitudinal, 'longitudinal'))
  if (tyre.lateral) write(ws.mLateralFriction, readSlipCurve(tyre.lateral, 'lateral'))
}

function applySuspensionSpring(J, ws, spring) {
  const { frequency, damping } = readSuspensionSpring(spring)
  ws.mSuspensionSpring.mMode = J.ESpringMode_FrequencyAndDamping
  ws.mSuspensionSpring.mFrequency = frequency
  ws.mSuspensionSpring.mDamping = damping
}

export function solveTurretAim(chassisRotation, targetDirection, limits = {}) {
  const [qx, qy, qz, qw] = chassisRotation
  const [dx0, dy0, dz0] = targetDirection
  const len = Math.hypot(dx0, dy0, dz0)
  if (!(len > 0)) return null
  const dx = dx0 / len, dy = dy0 / len, dz = dz0 / len
  const ux = -qx, uy = -qy, uz = -qz
  const cx = uy * dz - uz * dy, cy = uz * dx - ux * dz, cz = ux * dy - uy * dx
  const c2x = uy * cz - uz * cy, c2y = uz * cx - ux * cz, c2z = ux * cy - uy * cx
  const lx = dx + 2 * qw * cx + 2 * c2x
  const ly = dy + 2 * qw * cy + 2 * c2y
  const lz = dz + 2 * qw * cz + 2 * c2z
  const yawRaw = Math.atan2(lx, lz)
  const pitchRaw = Math.atan2(ly, Math.hypot(lx, lz))
  const yaw = Math.min(Math.max(yawRaw, limits.minYaw ?? -Infinity), limits.maxYaw ?? Infinity)
  const pitch = Math.min(Math.max(pitchRaw, limits.minPitch ?? -Infinity), limits.maxPitch ?? Infinity)
  return { yaw, pitch, clamped: yaw !== yawRaw || pitch !== pitchRaw }
}

export function createVehicleBackend(host) {
  const J = host.Jolt
  const vehicles = new Map()
  let nextVehicleId = 0
  let lastError = null

  function createWheeledVehicle(chassisBodyId, wheelDefs, opts = {}) {
    const chassis = host.bodies.get(chassisBodyId); if (!chassis) return null
    if (!Array.isArray(wheelDefs) || wheelDefs.length === 0) return null
    let vcs = null, constraint = null, tester = null, stepListener = null
    try {
      vcs = new J.VehicleConstraintSettings()
      const up = opts.up || [0, 1, 0], fwd = opts.forward || [0, 0, 1]
      vcs.mUp = new J.Vec3(up[0], up[1], up[2])
      vcs.mForward = new J.Vec3(fwd[0], fwd[1], fwd[2])
      if (opts.maxPitchRollAngle != null) vcs.mMaxPitchRollAngle = opts.maxPitchRollAngle

      const wheelsArr = vcs.mWheels
      const driveIdxL = [], driveIdxR = []
      for (let i = 0; i < wheelDefs.length; i++) {
        const w = wheelDefs[i] || {}
        const ws = new J.WheelSettingsWV()
        const p = w.position || [0, 0, 0]
        ws.mPosition = new J.Vec3(p[0], p[1], p[2])
        if (w.suspensionDirection) { const sd = w.suspensionDirection; ws.mSuspensionDirection = new J.Vec3(sd[0], sd[1], sd[2]) }
        ws.mRadius = w.radius ?? 0.35
        ws.mWidth = w.width ?? 0.25
        ws.mSuspensionMinLength = w.suspensionMin ?? 0.3
        ws.mSuspensionMaxLength = w.suspensionMax ?? 0.5
        ws.mMaxSteerAngle = w.steer ? (w.maxSteerAngle ?? 0.6) : 0
        ws.mMaxBrakeTorque = w.maxBrakeTorque ?? 1500
        ws.mMaxHandBrakeTorque = w.maxHandBrakeTorque ?? 0
        if (w.suspensionSpring) applySuspensionSpring(J, ws, w.suspensionSpring)
        if (w.tyre) applyTyreCurves(ws, w.tyre)
        wheelsArr.push_back(ws)
        if (w.drive) { if (p[0] < 0) driveIdxL.push(i); else driveIdxR.push(i) }
      }
      vcs.mWheels = wheelsArr

      const controllerSettings = new J.WheeledVehicleControllerSettings()
      const diffs = controllerSettings.mDifferentials
      if (Array.isArray(opts.differentials) && opts.differentials.length) {
        for (const d of opts.differentials) {
          const vd = new J.VehicleDifferentialSettings()
          vd.mLeftWheel = d.leftWheel ?? -1; vd.mRightWheel = d.rightWheel ?? -1
          if (d.differentialRatio != null) vd.mDifferentialRatio = d.differentialRatio
          if (d.limitedSlipRatio != null) vd.mLimitedSlipRatio = d.limitedSlipRatio
          if (d.engineTorqueRatio != null) vd.mEngineTorqueRatio = d.engineTorqueRatio
          diffs.push_back(vd)
        }
      } else {
        const n = Math.max(driveIdxL.length, driveIdxR.length)
        for (let i = 0; i < n; i++) {
          const vd = new J.VehicleDifferentialSettings()
          vd.mLeftWheel = driveIdxL[i] ?? -1; vd.mRightWheel = driveIdxR[i] ?? -1
          vd.mEngineTorqueRatio = 1 / n
          diffs.push_back(vd)
        }
      }
      controllerSettings.mDifferentials = diffs
      if (opts.engine) {
        if (opts.engine.maxTorque != null) controllerSettings.mEngine.mMaxTorque = opts.engine.maxTorque
        if (opts.engine.maxRPM != null) controllerSettings.mEngine.mMaxRPM = opts.engine.maxRPM
        if (opts.engine.minRPM != null) controllerSettings.mEngine.mMinRPM = opts.engine.minRPM
      }
      vcs.mController = controllerSettings

      constraint = new J.VehicleConstraint(chassis, vcs)
      tester = new J.VehicleCollisionTesterRay(LAYER_DYNAMIC, new J.Vec3(up[0], up[1], up[2]))
      constraint.SetVehicleCollisionTester(tester)
      host.physicsSystem.AddConstraint(constraint)
      stepListener = new J.VehicleConstraintStepListener(constraint)
      host.physicsSystem.AddStepListener(stepListener)

      const controller = J.castObject(constraint.GetController(), J.WheeledVehicleController)
      const vid = ++nextVehicleId
      vehicles.set(vid, { constraint, controller, tester, stepListener, chassisBodyId, wheelCount: wheelDefs.length })
      return vid
    } catch (error) {
      lastError = error?.message || error
      console.error('[physics] createWheeledVehicle failed:', lastError)
      return null
    } finally {
      if (vcs) J.destroy(vcs)
    }
  }

  function setVehicleDriverInput(vehicleId, forward, right, brake = 0, handbrake = 0) {
    const v = vehicles.get(vehicleId); if (!v) return false
    if ((forward || right || handbrake) && host.bodyInterface.ActivateBody) {
      const chassis = host.bodies.get(v.chassisBodyId)
      if (chassis && !chassis.IsActive()) host.bodyInterface.ActivateBody(chassis.GetID())
    }
    v.controller.SetDriverInput(forward, right, brake, handbrake)
    return true
  }

  function getVehicleWheelTransform(vehicleId, wheelIndex) {
    const v = vehicles.get(vehicleId); if (!v) return null
    const ax = { right: new J.Vec3(1, 0, 0), up: new J.Vec3(0, 1, 0) }
    const t = v.constraint.GetWheelWorldTransform(wheelIndex, ax.right, ax.up)
    const pos = t.GetTranslation(), rot = t.GetQuaternion()
    const out = { position: [pos.GetX(), pos.GetY(), pos.GetZ()], rotation: [rot.GetX(), rot.GetY(), rot.GetZ(), rot.GetW()] }
    J.destroy(t)
    return out
  }

  function getVehicleWheelSpeed(vehicleId, wheelIndex) {
    const v = vehicles.get(vehicleId); if (!v) return 0
    const w = v.constraint.GetWheel(wheelIndex)
    return w ? w.GetAngularVelocity() : 0
  }

  function isVehicleWheelGrounded(vehicleId, wheelIndex) {
    const v = vehicles.get(vehicleId); if (!v) return false
    const w = v.constraint.GetWheel(wheelIndex)
    return w ? w.HasContact() : false
  }

  function removeVehicle(vehicleId) {
    const v = vehicles.get(vehicleId); if (!v) return false
    try {
      host.physicsSystem.RemoveStepListener(v.stepListener)
      J.destroy(v.stepListener)
      host.physicsSystem.RemoveConstraint(v.constraint)
    } catch (error) {
      console.error('[physics] removeVehicle cleanup error:', error?.message || error)
    }
    vehicles.delete(vehicleId)
    return true
  }

  function createTrackedVehicle(chassisBodyId, wheelDefs, opts = {}) {
    const chassis = host.bodies.get(chassisBodyId); if (!chassis) return null
    if (!Array.isArray(wheelDefs) || wheelDefs.length === 0) return null
    let vcs = null, constraint = null, tester = null, stepListener = null
    try {
      vcs = new J.VehicleConstraintSettings()
      const up = opts.up || [0, 1, 0], fwd = opts.forward || [0, 0, 1]
      vcs.mUp = new J.Vec3(up[0], up[1], up[2])
      vcs.mForward = new J.Vec3(fwd[0], fwd[1], fwd[2])
      if (opts.maxPitchRollAngle != null) vcs.mMaxPitchRollAngle = opts.maxPitchRollAngle

      const wheelsArr = vcs.mWheels
      const leftIdx = [], rightIdx = [], leftDrivenIdx = [], rightDrivenIdx = []
      for (let i = 0; i < wheelDefs.length; i++) {
        const w = wheelDefs[i] || {}
        const ws = new J.WheelSettingsTV()
        const p = w.position || [0, 0, 0]
        ws.mPosition = new J.Vec3(p[0], p[1], p[2])
        if (w.suspensionDirection) { const sd = w.suspensionDirection; ws.mSuspensionDirection = new J.Vec3(sd[0], sd[1], sd[2]) }
        ws.mRadius = w.radius ?? 0.35
        ws.mWidth = w.width ?? 0.4
        ws.mSuspensionMinLength = w.suspensionMin ?? 0.3
        ws.mSuspensionMaxLength = w.suspensionMax ?? 0.5
        if (w.maxBrakeTorque != null) ws.mMaxBrakeTorque = w.maxBrakeTorque
        wheelsArr.push_back(ws)
        const side = w.side || (p[0] < 0 ? 'left' : 'right')
        if (side === 'left') { leftIdx.push(i); if (w.driven) leftDrivenIdx.push(i) }
        else { rightIdx.push(i); if (w.driven) rightDrivenIdx.push(i) }
      }
      vcs.mWheels = wheelsArr

      const controllerSettings = new J.TrackedVehicleControllerSettings()
      if (opts.engine) {
        if (opts.engine.maxTorque != null) controllerSettings.mEngine.mMaxTorque = opts.engine.maxTorque
        if (opts.engine.maxRPM != null) controllerSettings.mEngine.mMaxRPM = opts.engine.maxRPM
        if (opts.engine.minRPM != null) controllerSettings.mEngine.mMinRPM = opts.engine.minRPM
      }
      const buildTrack = (trackIndex, idxList, drivenList, override) => {
        const t = controllerSettings.get_mTracks(trackIndex)
        const wv = t.mWheels
        const list = (override && Array.isArray(override.wheels)) ? override.wheels : idxList
        for (const wi of list) wv.push_back(wi)
        t.mWheels = wv
        const drivenWheel = override && override.drivenWheel != null ? override.drivenWheel : (drivenList[0] ?? idxList[0] ?? 0)
        t.mDrivenWheel = drivenWheel
        if ((override && override.maxBrakeTorque != null)) t.mMaxBrakeTorque = override.maxBrakeTorque
        if ((override && override.differentialRatio != null)) t.mDifferentialRatio = override.differentialRatio
        return t
      }
      const leftOverride = opts.tracks && opts.tracks.left
      const rightOverride = opts.tracks && opts.tracks.right
      controllerSettings.set_mTracks(LEFT_TRACK, buildTrack(LEFT_TRACK, leftIdx, leftDrivenIdx, leftOverride))
      controllerSettings.set_mTracks(RIGHT_TRACK, buildTrack(RIGHT_TRACK, rightIdx, rightDrivenIdx, rightOverride))
      vcs.mController = controllerSettings

      constraint = new J.VehicleConstraint(chassis, vcs)
      tester = new J.VehicleCollisionTesterRay(LAYER_DYNAMIC, new J.Vec3(up[0], up[1], up[2]))
      constraint.SetVehicleCollisionTester(tester)
      host.physicsSystem.AddConstraint(constraint)
      stepListener = new J.VehicleConstraintStepListener(constraint)
      host.physicsSystem.AddStepListener(stepListener)

      const controller = J.castObject(constraint.GetController(), J.TrackedVehicleController)
      const vid = ++nextVehicleId
      vehicles.set(vid, { constraint, controller, tester, stepListener, chassisBodyId, wheelCount: wheelDefs.length, tracked: true })
      return vid
    } catch (error) {
      lastError = error?.message || error
      console.error('[physics] createTrackedVehicle failed:', lastError)
      return null
    } finally {
      if (vcs) J.destroy(vcs)
    }
  }

  function setTrackedVehicleDriverInput(vehicleId, forward, leftRatio, rightRatio, brake = 0) {
    const v = vehicles.get(vehicleId); if (!v || !v.tracked) return false
    if (forward || leftRatio || rightRatio || brake) {
      const chassis = host.bodies.get(v.chassisBodyId)
      if (chassis) host.bodyInterface.ActivateBody(chassis.GetID())
    }
    v.controller.SetDriverInput(forward, leftRatio, rightRatio, brake)
    return true
  }

  function solveEntityTurretAim(vehicleId, targetDirection, limits) {
    const v = vehicles.get(vehicleId); if (!v) return null
    const chassis = host.bodies.get(v.chassisBodyId); if (!chassis) return null
    const r = chassis.GetRotation()
    const aim = solveTurretAim([r.GetX(), r.GetY(), r.GetZ(), r.GetW()], targetDirection, limits)
    J.destroy(r)
    return aim
  }

  return {
    createWheeledVehicle,
    setVehicleDriverInput,
    getVehicleWheelTransform,
    getVehicleWheelSpeed,
    isVehicleWheelGrounded,
    removeVehicle,
    createTrackedVehicle,
    setTrackedVehicleDriverInput,
    solveTurretAim,
    solveEntityTurretAim,
    get lastError() { return lastError },
  }
}
