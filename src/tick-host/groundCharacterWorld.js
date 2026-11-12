const MARCH_STEP_M = 0.25
const BISECT_ROUNDS = 24
const UP = Object.freeze([0, 1, 0])

const finiteTriple = (v) => Array.isArray(v) && v.length === 3 && Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2])

export function createGroundCharacterWorld({ heightAt = () => 0, crouchHalfHeight = 0.45 } = {}) {
  if (typeof heightAt !== 'function') throw new TypeError('heightAt must be a function of x and z')
  const characters = new Map()
  let nextId = 1
  let steps = 0

  const groundAt = (x, z) => {
    const y = heightAt(x, z)
    return typeof y === 'number' && Number.isFinite(y) ? y : null
  }

  const get = (id) => {
    const c = characters.get(id)
    if (!c) throw new RangeError('no character ' + id)
    return c
  }

  const footOffset = (c) => (c.crouch ? Math.min(c.halfHeight, crouchHalfHeight) : c.halfHeight) + c.radius

  const settle = (c) => {
    const ground = groundAt(c.position[0], c.position[2])
    if (ground === null) {
      c.grounded = false
      return
    }
    const floor = ground + footOffset(c)
    if (c.position[1] <= floor) {
      c.position[1] = floor
      if (c.velocity[1] < 0) c.velocity[1] = 0
      c.grounded = c.velocity[1] <= 0
    } else {
      c.grounded = false
    }
  }

  const raycast = (origin, direction, maxDistance = 1000) => {
    if (!finiteTriple(origin) || !finiteTriple(direction)) throw new TypeError('a ray needs a finite origin and direction')
    const length = Math.hypot(direction[0], direction[1], direction[2])
    if (!(length > 0) || !(maxDistance > 0)) throw new RangeError('a ray needs a nonzero direction and a reach above zero')
    const dx = direction[0] / length, dy = direction[1] / length, dz = direction[2] / length
    const above = (t) => {
      const ground = groundAt(origin[0] + dx * t, origin[2] + dz * t)
      return ground === null ? null : origin[1] + dy * t - ground
    }
    const hitAt = (t) => ({ hit: true, distance: t, position: [origin[0] + dx * t, origin[1] + dy * t, origin[2] + dz * t], normal: [UP[0], UP[1], UP[2]], bodyId: null })
    const miss = { hit: false, distance: maxDistance, position: null, normal: null, bodyId: null }
    if (dx === 0 && dz === 0) {
      const gap = above(0)
      if (gap === null || dy > 0 || gap < 0 || gap > maxDistance) return miss
      return hitAt(gap)
    }
    let previous = 0
    let previousGap = above(0)
    for (let t = Math.min(MARCH_STEP_M, maxDistance); ; t = Math.min(t + MARCH_STEP_M, maxDistance)) {
      const gap = above(t)
      if (previousGap !== null && gap !== null && previousGap >= 0 && gap < 0) {
        let lo = previous, hi = t
        for (let i = 0; i < BISECT_ROUNDS; i++) {
          const mid = (lo + hi) / 2
          if (above(mid) >= 0) lo = mid
          else hi = mid
        }
        return hitAt(hi)
      }
      previous = t
      previousGap = gap
      if (t >= maxDistance) return miss
    }
  }

  return {
    _charMgr: { crouchHalfHeight },
    terrainHeightAt: (x, z) => groundAt(x, z),
    addPlayerCharacter(radius, halfHeight, position, mass) {
      if (!(radius > 0) || !(halfHeight > 0) || !finiteTriple(position)) throw new RangeError('a character needs a radius and half height above zero and a finite position')
      const id = nextId++
      characters.set(id, { radius, halfHeight, mass, position: [position[0], position[1], position[2]], velocity: [0, 0, 0], grounded: false, crouch: false })
      return id
    },
    removeCharacter(id) { characters.delete(id) },
    setCharacterVelocity(id, v) {
      const c = get(id)
      c.velocity[0] = v[0]; c.velocity[1] = v[1]; c.velocity[2] = v[2]
    },
    updateCharacter(id, dt) {
      const c = get(id)
      c.position[0] += c.velocity[0] * dt
      c.position[1] += c.velocity[1] * dt
      c.position[2] += c.velocity[2] * dt
      settle(c)
    },
    setCharacterPosition(id, p) {
      const c = get(id)
      c.position[0] = p[0]; c.position[1] = p[1]; c.position[2] = p[2]
      c.grounded = false
    },
    getCharacterPosition(id) {
      const c = get(id)
      return [c.position[0], c.position[1], c.position[2]]
    },
    readCharacterPosition(id, out) {
      const c = get(id)
      out[0] = c.position[0]; out[1] = c.position[1]; out[2] = c.position[2]
      return out
    },
    readCharacterVelocity(id, out) {
      const c = get(id)
      out[0] = c.velocity[0]; out[1] = c.velocity[1]; out[2] = c.velocity[2]
      return out
    },
    getCharacterGroundState(id) { return get(id).grounded },
    setCharacterCrouch(id, crouch) { get(id).crouch = !!crouch },
    raycast,
    step() { steps++ },
    get stepCount() { return steps },
    get characterCount() { return characters.size },
  }
}
