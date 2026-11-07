import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { World } from '../src/world/World.js'
import { findContacts } from '../src/physics-pure/contacts.js'
import { createIslands } from '../src/physics-pure/islands.js'
import { createSettler } from '../src/physics-pure/settler.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sourceDir = join(root, 'src', 'physics-pure')
const RADIUS = 0.35
const SLEEP_TICK = 15

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}
const same = (actual, expected, label = 'value') => {
  assert(actual === expected, label + ' is ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected))
}
const near = (actual, expected, label, tolerance = 1e-9) => {
  assert(Math.abs(actual - expected) <= tolerance, label + ' is ' + actual + ', expected ' + expected)
}
const mustReject = (check) => {
  let rejected = false
  try {
    check()
  } catch (_) {
    rejected = true
  }
  assert(rejected, 'negative control was accepted')
}
const dist = (world, a, b) => {
  const p = world.position(a)
  const q = world.position(b)
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])
}
const makeWorld = ({ capacity = 16, gravity = -18, solverIterations = 8 } = {}) =>
  new World({ capacity, tickRate: 64, gravity, drag: 0.1, radius: RADIUS, restitution: 0.2, solverIterations })

gate('findContacts: a pair closer than twice the radius is a contact, normal from the first body to the second', () => {
  const contacts = findContacts([0, 5, 0, 0.6, 5, 0, 3, 5, 0], 3, RADIUS)
  same(contacts.length, 1, 'contacts')
  same(contacts[0].i, 0, 'first body')
  same(contacts[0].j, 1, 'second body')
  near(contacts[0].nx, 1, 'normal x')
  near(contacts[0].depth, 0.1, 'depth', 1e-12)
  mustReject(() => same(contacts.length, 2, 'contacts'))
})

gate('findContacts: a coincident pair takes the up normal, and a pair at exactly twice the radius is not a contact without a skin', () => {
  const coincident = findContacts([1, 5, 1, 1, 5, 1], 2, RADIUS)
  near(coincident[0].ny, 1, 'coincident normal y')
  same(findContacts([0, 5, 0, 0.7, 5, 0], 2, RADIUS).length, 0, 'touching pair without skin')
  same(findContacts([0, 5, 0, 0.71, 5, 0], 2, RADIUS, 0.02).length, 1, 'pair inside the skin')
  same(findContacts([0, 5, 0, 0.75, 5, 0], 2, RADIUS, 0.02).length, 0, 'pair outside the skin')
  mustReject(() => same(findContacts([0, 5, 0, 0.75, 5, 0], 2, RADIUS, 0.02).length, 1, 'pair beyond the skin'))
})

gate('one kernel step separates an overlapping pair to twice the radius and leaves a distant body alone', () => {
  const world = makeWorld({ gravity: 0, solverIterations: 8 })
  const a = world.spawn([0, 5, 0])
  const b = world.spawn([0.5, 5, 0])
  const c = world.spawn([3, 5, 0])
  const settler = createSettler(world, { radius: RADIUS })
  settler.step()
  assert(dist(world, a, b) >= 2 * RADIUS - 1e-9, 'overlapping pair left at ' + dist(world, a, b))
  same(JSON.stringify(world.position(c)), JSON.stringify([3, 5, 0]), 'distant body position')
  mustReject(() => assert(dist(world, a, b) >= 0.9, 'pair separated to 0.9'))
})

gate('a resting pair is a persistent contact after two ticks, and drops out of the cache once apart', () => {
  const world = makeWorld({ gravity: 0 })
  world.spawn([0, 5, 0])
  world.spawn([2 * RADIUS, 5, 0])
  const settler = createSettler(world, { radius: RADIUS })
  settler.step()
  same(settler.persistent, 0, 'persistent after first tick')
  settler.step()
  same(settler.persistent, 1, 'persistent after second tick')
  same(settler.cachedPairs, 1, 'cached pairs')
  world.setPosition(1, [5, 5, 0])
  settler.step()
  same(settler.cachedPairs, 0, 'cached pairs after separation')
})

gate('without a skin a resting pair at exactly twice the radius is never a contact', () => {
  const world = makeWorld({ gravity: 0 })
  world.spawn([0, 5, 0])
  world.spawn([2 * RADIUS, 5, 0])
  const settler = createSettler(world, { radius: RADIUS, skin: 0 })
  for (let t = 0; t < 4; t++) settler.step()
  same(settler.cachedPairs, 0, 'cached pairs with no skin')
  const withSkin = makeWorld({ gravity: 0 })
  withSkin.spawn([0, 5, 0])
  withSkin.spawn([2 * RADIUS, 5, 0])
  const skinned = createSettler(withSkin, { radius: RADIUS })
  for (let t = 0; t < 4; t++) skinned.step()
  mustReject(() => same(skinned.cachedPairs, 0, 'cached pairs with the default skin'))
})

const column = (warmStart) => {
  const world = makeWorld({ solverIterations: 1 })
  const ids = [0, 1, 2, 3].map((k) => world.spawn([0, RADIUS + k * 2 * RADIUS * 0.9, 0]))
  const settler = createSettler(world, { radius: RADIUS, warmStart })
  let worst = 0
  for (let t = 0; t < 300; t++) {
    settler.step()
    if (t > 150) {
      for (let k = 0; k < 3; k++) worst = Math.max(worst, 2 * RADIUS - dist(world, ids[k], ids[k + 1]))
    }
  }
  return { worst, cached: settler.cachedPairs }
}

gate('warm start lowers the steady overlap of a four-body column under one solver iteration', () => {
  const cold = column(false)
  const warm = column(true)
  assert(warm.cached > 0, 'warm column cached no impulses')
  assert(warm.worst < cold.worst, 'warm overlap ' + warm.worst + ' is not below cold ' + cold.worst)
  mustReject(() => assert(warm.worst >= cold.worst, 'warm overlap ' + warm.worst + ' is not below cold ' + cold.worst))
})

gate('a body at rest on the ground sleeps at the 0.25 s tick and not before', () => {
  const world = makeWorld()
  const a = world.spawn([0, RADIUS, 0])
  const settler = createSettler(world, { radius: RADIUS })
  let first = -1
  for (let t = 0; t < 120 && first < 0; t++) {
    settler.step()
    if (settler.isAsleep(a)) first = t
  }
  same(first, SLEEP_TICK, 'first sleeping tick')
  mustReject(() => assert(first < SLEEP_TICK, 'slept early at ' + first))
})

gate('a body kept moving at 1 m/s never sleeps', () => {
  const world = makeWorld({ gravity: 0 })
  const a = world.spawn([0, 5, 0])
  const settler = createSettler(world, { radius: RADIUS })
  for (let t = 0; t < 200; t++) {
    world.setVelocity(a, [1, 0, 0])
    settler.step()
  }
  same(settler.isAsleep(a), false, 'moving body asleep')
})

gate('a sleeping body is frozen while another body moves, and a velocity given to it wakes it', () => {
  const world = makeWorld()
  const a = world.spawn([0, RADIUS, 0])
  const b = world.spawn([10, 5, 0], [2, 0, 0])
  const settler = createSettler(world, { radius: RADIUS })
  for (let t = 0; t < 40; t++) settler.step()
  assert(settler.isAsleep(a), 'body a did not sleep')
  const frozen = JSON.stringify(world.position(a))
  for (let t = 0; t < 20; t++) settler.step()
  same(JSON.stringify(world.position(a)), frozen, 'sleeping position')
  assert(world.position(b)[0] > 10, 'moving body did not move')
  world.setVelocity(a, [5, 0, 0])
  settler.step()
  assert(!settler.isAsleep(a), 'body a stayed asleep after a velocity')
  assert(world.position(a)[0] !== 0, 'woken body did not move')
})

const wakeTrace = (givenVelocity) => {
  const world = makeWorld()
  const a = world.spawn([0, RADIUS, 0])
  world.spawn([20, RADIUS, 0], givenVelocity)
  const settler = createSettler(world, { radius: RADIUS })
  let slept = false
  let wokeAfterSleep = false
  for (let t = 0; t < 400; t++) {
    settler.step()
    if (settler.isAsleep(a)) slept = true
    else if (slept) wokeAfterSleep = true
  }
  return { slept, wokeAfterSleep }
}

gate('a moving body that reaches a sleeping island wakes it, and a still neighbour does not', () => {
  const moving = wakeTrace([-8, 0, 0])
  assert(moving.slept, 'island did not sleep before the collision')
  assert(moving.wokeAfterSleep, 'moving body did not wake the island')
  const still = wakeTrace([0, 0, 0])
  assert(still.slept && !still.wokeAfterSleep, 'still neighbour woke the island')
  mustReject(() => assert(!moving.wokeAfterSleep, 'moving body woke the island'))
})

gate('the same scene gives the same world hash and the same sleeping set', () => {
  const run = () => {
    const world = makeWorld()
    world.spawn([0, RADIUS, 0])
    world.spawn([0.5, RADIUS, 0])
    world.spawn([9, 4, 0], [-1, 0, 0])
    const settler = createSettler(world, { radius: RADIUS })
    for (let t = 0; t < 180; t++) settler.step()
    return { hash: world.hash(), sleeping: settler.sleeping }
  }
  const first = run()
  const second = run()
  same(first.hash, second.hash, 'world hash')
  same(first.sleeping, second.sleeping, 'sleeping count')
})

gate('a settler refuses a body added after it was made, and an invalid radius or count or threshold', () => {
  const world = makeWorld()
  world.spawn([0, RADIUS, 0])
  const settler = createSettler(world, { radius: RADIUS })
  world.spawn([3, RADIUS, 0])
  mustReject(() => settler.step())
  mustReject(() => createSettler(makeWorld(), {}))
  mustReject(() => createIslands({ count: -1 }))
  mustReject(() => createIslands({ count: 2, linearThreshold: 0 }))
})

const hostGlobals = ['process', 'performance', 'Date', 'setTimeout', 'clearTimeout', 'setImmediate', 'setInterval', 'console', 'window', 'globalThis', 'require', 'Buffer']

const findingsIn = (source) => {
  const found = []
  if (source.includes('//') || source.includes('/*')) found.push('comment marker')
  if (source.includes('Math.random')) found.push('uses Math.random')
  for (const piece of source.split("from '").slice(1)) {
    const specifier = piece.slice(0, piece.indexOf("'"))
    if (!specifier.startsWith('.')) found.push('bare import ' + specifier)
  }
  const words = new Set(source.split(/[^A-Za-z0-9_$]/))
  for (const token of hostGlobals) {
    if (words.has(token)) found.push('uses ' + token)
  }
  return found
}

gate('src/physics-pure is comment-free, imports nothing bare, reads no host clock or random source', () => {
  const names = readdirSync(sourceDir).filter((name) => name.endsWith('.js')).sort()
  same(names.join(','), 'contacts.js,islands.js,settler.js', 'source files')
  for (const name of names) {
    const found = findingsIn(readFileSync(join(sourceDir, name), 'utf8'))
    assert(found.length === 0, name + ': ' + found.join(', '))
  }
  mustReject(() => assert(findingsIn("import fs from 'node:fs'\nconst t = performance.now() // x").length === 0, 'negative sample'))
})

finish()
