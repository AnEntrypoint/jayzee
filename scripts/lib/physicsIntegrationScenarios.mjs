import { attempt } from './scenarioTrace.mjs'

export function createFakePhysicsWorld({ groundY = 0, frame = null, characters = true } = {}) {
  const chars = new Map()
  let nextId = 1
  const get = (id) => {
    const c = chars.get(id)
    if (!c) throw new Error('no character ' + id)
    return c
  }
  return {
    _planetFrame: frame,
    _charMgr: { crouchHalfHeight: 0.45 },
    terrainHeightAt: () => groundY,
    addPlayerCharacter(radius, halfHeight, position, mass) {
      if (!characters) return null
      const id = nextId++
      chars.set(id, { radius, halfHeight, mass, position: [...position], velocity: [0, 0, 0], grounded: false, crouch: false, normal: [0, 1, 0], walls: [] })
      return id
    },
    removeCharacter(id) { chars.delete(id) },
    setCharacterVelocity(id, v) { const c = get(id); c.velocity = [v[0], v[1], v[2]] },
    updateCharacter(id, dt) {
      const c = get(id)
      const floor = groundY + c.halfHeight
      const before = c.position[1]
      c.position[0] += c.velocity[0] * dt
      c.position[1] += c.velocity[1] * dt
      c.position[2] += c.velocity[2] * dt
      if (before >= floor && c.position[1] <= floor) {
        c.position[1] = floor
        c.grounded = true
        if (c.velocity[1] < 0) c.velocity[1] = 0
      } else c.grounded = false
      c.walls = c.position[0] > 10 ? [[-1, 0, 0]] : []
    },
    readCharacterPosition(id, out) { const c = get(id); out[0] = c.position[0]; out[1] = c.position[1]; out[2] = c.position[2] },
    readCharacterVelocity(id, out) { const c = get(id); out[0] = c.velocity[0]; out[1] = c.velocity[1]; out[2] = c.velocity[2] },
    getCharacterPosition(id) { return [...get(id).position] },
    setCharacterPosition(id, p) { const c = get(id); c.position = [p[0], p[1], p[2]] },
    getCharacterGroundState(id) { return get(id).grounded },
    readCharacterGroundNormal(id, n) {
      const c = get(id)
      if (!c.grounded) return false
      n[0] = c.normal[0]; n[1] = c.normal[1]; n[2] = c.normal[2]
      return true
    },
    readCharacterWallNormals(id, w) { const c = get(id); w.length = 0; for (const x of c.walls) w.push([...x]) },
    setCharacterCrouch(id, on) { get(id).crouch = on },
    raycast(origin, direction, maxDistance) {
      if (direction[1] >= 0) return { hit: false, distance: maxDistance }
      const d = (groundY - origin[1]) / direction[1]
      if (d >= 0 && d <= maxDistance) return { hit: true, distance: d }
      return { hit: false, distance: maxDistance }
    },
    describe() {
      return [...chars].map(([id, c]) => ({ id, radius: c.radius, halfHeight: c.halfHeight, mass: c.mass, position: [...c.position], velocity: [...c.velocity], grounded: c.grounded, crouch: c.crouch, walls: c.walls.map((w) => [...w]) }))
    },
  }
}

const snap = (state) => ({
  position: [...state.position],
  velocity: [...state.velocity],
  onGround: state.onGround ?? null,
  swimming: state.swimming ?? null,
  groundNormal: state.groundNormal ? [...state.groundNormal] : null,
  wallNormals: state.wallNormals ? state.wallNormals.map((w) => [...w]) : null,
})

function scenario(name, body) {
  const trace = []
  const t = (label, fn) => trace.push({ label, ...attempt(fn) })
  body(t)
  return { name, trace }
}

export function runPhysicsScenarios(PhysicsIntegration) {
  const frame = { offsetY: 2, anchorHeight: 0 }
  return [
    scenario('fallback-falls', (t) => {
      const pi = new PhysicsIntegration({ gravity: [0, -9.81, 0] })
      pi.addPlayerCollider('p', 0.5)
      const state = { position: [0, 5, 0], velocity: [2, 0, -1], onGround: false }
      for (let i = 0; i < 8; i++) t('step-' + i, () => snap(pi.updatePlayerPhysics('p', state, 0.25)))
      t('position', () => pi.getPlayerPosition('p'))
      t('validate-far', () => pi.validateMovement('p', [3, 0, 0], [0, 0, 0]))
      t('validate-near', () => pi.validateMovement('p', [1, 0, 0], [0, 0, 0]))
      t('raycast-no-world', () => pi.raycast([0, 0, 0], [0, -1, 0], 10))
      t('standing-centre', () => pi.standingCentreY(2))
      t('remove', () => { pi.removePlayerCollider('p'); return pi.getPlayerPosition('p') })
      t('after-remove-step', () => snap(pi.updatePlayerPhysics('p', state, 0.25)))
    }),
    scenario('fallback-kill-plane', (t) => {
      const pi = new PhysicsIntegration({ gravity: [0, -9.81, 0] })
      pi.addPlayerCollider('k', 0.5)
      const state = { position: [0, -150, 0], velocity: [0, -3, 0], onGround: false }
      t('kill', () => snap(pi.updatePlayerPhysics('k', state, 0.1)))
      const nanState = { position: [NaN, 2, 1], velocity: [0, 0, 0], onGround: false }
      t('nan-x', () => snap(pi.updatePlayerPhysics('k', nanState, 0.1)))
    }),
    scenario('jolt-fall-and-jump', (t) => {
      const fake = createFakePhysicsWorld({ groundY: 0 })
      const pi = new PhysicsIntegration({ gravity: [0, -9.81, 0], physicsWorld: fake })
      pi.addPlayerCollider('p', 0.4)
      const state = { position: [0, 3, 0], velocity: [0, 0, 0], onGround: false }
      for (let i = 0; i < 40; i++) {
        t('step-' + i, () => {
          state._jumpHeld = i >= 10 && i < 13
          return snap(pi.updatePlayerPhysics('p', state, 1 / 64))
        })
      }
      t('set-position', () => { pi.setPlayerPosition('p', [12, 0.9, 0]); return pi.getPlayerPosition('p') })
      t('wall-step', () => snap(pi.updatePlayerPhysics('p', state, 1 / 64)))
      t('resync', () => { pi.resyncPlayerFromPhysics('p', state); return snap(state) })
      t('describe', () => fake.describe())
    }),
    scenario('jolt-crouch-and-config', (t) => {
      const fake = createFakePhysicsWorld({ groundY: 0 })
      const pi = new PhysicsIntegration({ physicsWorld: fake })
      pi.addPlayerCollider('c', 0.4)
      pi.addPlayerCollider('d', -1)
      t('crouch-on', () => { pi.setCrouch('c', true); return [...pi.snapshotCrouchStates()] })
      t('crouch-on-again', () => { pi.setCrouch('c', true); return [...pi.snapshotCrouchStates()] })
      t('crouch-off', () => { pi.setCrouch('c', false); return [...pi.snapshotCrouchStates()] })
      t('restore', () => { pi.restoreCrouchStates([['c', true], ['d', false]]); return [...pi.snapshotCrouchStates()] })
      t('apply-config', () => {
        pi.applyPlayerConfig({ capsuleRadius: 0.5, capsuleHalfHeight: 1, crouchHalfHeight: 0.3, mass: 90 })
        return { config: pi.config, physicalHalfHeight: pi._physicalHalfHeight, charMgr: fake._charMgr }
      })
      t('apply-bad-config', () => {
        pi.applyPlayerConfig({ capsuleHalfHeight: -2, ankleClearance: NaN, mass: 0 })
        return { config: pi.config, physicalHalfHeight: pi._physicalHalfHeight }
      })
      t('describe', () => fake.describe())
      t('remove-c', () => { pi.removePlayerCollider('c'); return [...pi.snapshotCrouchStates()] })
      t('position-after-remove', () => pi.getPlayerPosition('c'))
      t('describe-after-remove', () => fake.describe())
    }),
    scenario('swim-with-characters', (t) => {
      const fake = createFakePhysicsWorld({ groundY: -20, frame })
      const pi = new PhysicsIntegration({ gravity: [0, -9.81, 0], physicsWorld: fake })
      pi.addPlayerCollider('s', 0.4)
      const state = { position: [0, 1, 0], velocity: [0, -1, 0], onGround: false }
      for (let i = 0; i < 30; i++) {
        t('step-' + i, () => {
          state._jumpHeld = i >= 20
          return snap(pi.updatePlayerPhysics('s', state, 1 / 64))
        })
      }
    }),
    scenario('swim-fallback-without-character', (t) => {
      const fake = createFakePhysicsWorld({ frame, characters: false })
      const pi = new PhysicsIntegration({ gravity: [0, -9.81, 0], physicsWorld: fake })
      pi.addPlayerCollider('f', 0.4)
      const state = { position: [0, 1, 0], velocity: [0, 0, 0], onGround: false }
      for (let i = 0; i < 6; i++) {
        t('step-' + i, () => {
          state._jumpHeld = i === 3
          return snap(pi.updatePlayerPhysics('f', state, 1 / 32))
        })
      }
    }),
    scenario('jolt-kill-plane', (t) => {
      const fake = createFakePhysicsWorld({ groundY: 0 })
      const pi = new PhysicsIntegration({ gravity: [0, -9.81, 0], physicsWorld: fake })
      pi.addPlayerCollider('k', 0.4)
      pi.setPlayerPosition('k', [0, -300, 0])
      const state = { position: [0, -300, 0], velocity: [0, 0, 0], onGround: false }
      t('kill', () => snap(pi.updatePlayerPhysics('k', state, 1 / 64)))
      t('describe', () => fake.describe())
    }),
    scenario('wall-and-ground-normals', (t) => {
      const fake = createFakePhysicsWorld({ groundY: 0 })
      const pi = new PhysicsIntegration({ gravity: [0, -9.81, 0], physicsWorld: fake })
      pi.addPlayerCollider('w', 0.4)
      pi.setPlayerPosition('w', [11, 1.2, 0])
      const state = { position: [11, 1.2, 0], velocity: [1, 0, 0], onGround: false }
      for (let i = 0; i < 3; i++) t('step-' + i, () => snap(pi.updatePlayerPhysics('w', state, 1 / 64)))
    }),
    scenario('no-character-and-raycast', (t) => {
      const fake = createFakePhysicsWorld({ groundY: 0 })
      const pi = new PhysicsIntegration({})
      t('set-no-world', () => { pi.setPlayerPosition('nobody', [1, 2, 3]); return pi.getPlayerPosition('nobody') })
      t('crouch-no-world', () => { pi.setCrouch('nobody', true); return [...pi.snapshotCrouchStates()] })
      pi.setPhysicsWorld(fake)
      t('raycast-up', () => pi.raycast([0, 5, 0], [0, 1, 0], 10))
      t('raycast-short', () => pi.raycast([0, 5, 0], [0, -1, 0], 3))
      t('raycast-hit', () => pi.raycast([0, 5, 0], [0, -1, 0], 10))
      t('set-world-unknown-char', () => { pi.setPlayerPosition('nobody', [1, 2, 3]); return pi.getPlayerPosition('nobody') })
    }),
  ]
}

export function comparePhysics(fixture, scenarios) {
  return fixture.scenarios.map((expected, index) => {
    const actual = JSON.parse(JSON.stringify(scenarios[index]))
    let difference = null
    if (actual.name !== expected.name) difference = 'name ' + actual.name + ' != ' + expected.name
    else if (expected.trace.length !== actual.trace.length) difference = 'step count ' + actual.trace.length + ' != spoint ' + expected.trace.length
    else {
      for (let i = 0; i < expected.trace.length; i++) {
        const want = JSON.stringify(expected.trace[i]), got = JSON.stringify(actual.trace[i])
        if (want !== got) { difference = 'step ' + i + ' (' + expected.trace[i].label + '): jayzee ' + got + ' spoint ' + want; break }
      }
    }
    return { name: expected.name, difference }
  })
}
