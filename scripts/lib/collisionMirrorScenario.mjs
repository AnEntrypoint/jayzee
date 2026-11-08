export const MIRROR_CFG = Object.freeze({
  tileM: 16,
  marginM: 1,
  forgetRing: 2,
  gravity: [0, -9.81, 0],
  radius: 0.4,
  halfHeight: 0.9,
  crouchHalfHeight: 0.45,
  mass: 80,
  maxSlopeAngle: 0.7854,
  maxStepHeight: 0.4,
  stickToFloorDistance: 0.5,
})

const DT = 1 / 60
const GRAVITY_Y = MIRROR_CFG.gravity[1]

function floorMessage(tx, tz) {
  const x0 = tx * MIRROR_CFG.tileM, x1 = x0 + MIRROR_CFG.tileM
  const z0 = tz * MIRROR_CFG.tileM, z1 = z0 + MIRROR_CFG.tileM
  const floats = Float32Array.of(x0, 0, z0, x1, 0, z0, x1, 0, z1, x0, 0, z0, x1, 0, z1, x0, 0, z1)
  return { tx, tz, h: (tx * 31 + tz * 7) >>> 0, v: new Uint8Array(floats.buffer) }
}

export const FLOOR_TILES = [0, 1, 2].flatMap((tx) => [0, 1].map((tz) => floorMessage(tx, tz)))

function inputAt(frame) {
  if (frame < 25) return { forward: true }
  if (frame === 25) return { jump: true }
  if (frame < 50) return { crouch: true, forward: true }
  if (frame < 60) return { forward: true }
  return null
}

function record(mirror, state, frame) {
  return {
    frame,
    position: [...state.position],
    velocity: [...state.velocity],
    onGround: state.onGround,
    groundY: state.groundY ?? null,
    groundNormal: state.groundNormal ? [...state.groundNormal] : null,
    covers: mirror.covers(state.position),
  }
}

function stepOnce(mirror, state, input) {
  if (mirror.covers(state.position)) mirror.step(state, input, DT, GRAVITY_Y, state.onGround)
  else mirror.noteUncovered()
}

export async function runMirrorScenario(mirror) {
  await mirror.configure(MIRROR_CFG)
  for (const msg of FLOOR_TILES) mirror.onTile(msg)
  const state = { position: [4, 2, 4], velocity: [0, 0, 0], onGround: false }
  const out = []
  for (let frame = 0; frame < 90; frame++) {
    stepOnce(mirror, state, inputAt(frame))
    out.push(record(mirror, state, frame))
  }
  mirror.reexpress({ point(p, dst) { dst[0] = p[0] + 5; dst[1] = p[1]; dst[2] = p[2] - 3 } })
  state.position = [9, state.position[1], 1]
  for (let frame = 90; frame < 110; frame++) {
    stepOnce(mirror, state, { forward: true })
    out.push(record(mirror, state, frame))
  }
  const outside = { position: [500, 2, 500], velocity: [0, 0, 0], onGround: false }
  out.push({ outside: true, covers: mirror.covers(outside.position) })
  return out
}
