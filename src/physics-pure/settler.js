import { createContactCache, findContacts } from './contacts.js'
import { createIslands } from './islands.js'

const readBodies = (world, count, read) => {
  const out = new Float64Array(count * 3)
  for (let i = 0; i < count; i++) out.set(world[read](i), i * 3)
  return out
}

export const createSettler = (world, { radius, skin = radius * 0.05, linearThreshold, timeToSleep, warmStart = true } = {}) => {
  if (!(typeof radius === 'number' && radius > 0)) throw new RangeError('radius must be a positive number, the world radius')
  if (!(skin >= 0)) throw new RangeError('skin must be zero or above')
  const count = world.count
  const islands = createIslands({ count, linearThreshold, timeToSleep })
  const cache = createContactCache()
  const dt = world.stepSeconds

  const assertCount = () => {
    if (world.count !== count) throw new RangeError('settler was made for ' + count + ' bodies, world holds ' + world.count)
  }

  const writeVelocities = (vel) => {
    for (let i = 0; i < count; i++) world.setVelocity(i, [vel[i * 3], vel[i * 3 + 1], vel[i * 3 + 2]])
  }

  const freezeAsleep = (frozen) => {
    for (let i = 0; i < count; i++) {
      if (!islands.isAsleep(i)) continue
      const o = i * 3
      world.setPosition(i, [frozen[o], frozen[o + 1], frozen[o + 2]])
      world.setVelocity(i, [0, 0, 0])
    }
  }

  return {
    step() {
      assertCount()
      const pos = readBodies(world, count, 'position')
      const before = readBodies(world, count, 'velocity')
      const contacts = findContacts(pos, count, radius, skin)
      islands.update(before, contacts, dt)
      if (warmStart) {
        const seeded = Float64Array.from(before)
        cache.seed(contacts, seeded)
        writeVelocities(seeded)
      }
      world.step()
      const after = readBodies(world, count, 'velocity')
      cache.record(contacts, before, after)
      freezeAsleep(pos)
      return islands.sleeping
    },
    isAsleep: (id) => islands.isAsleep(id),
    get sleeping() {
      return islands.sleeping
    },
    get persistent() {
      return cache.persistent
    },
    get cachedPairs() {
      return cache.size
    },
    impulseOf: (i, j) => cache.impulseOf(i, j),
  }
}
