import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gate, finish } from './lib/gate.mjs'
import { createFluid, FluidError, FLUID_REFUSAL } from '../src/behaviours/fluid.js'
import { createSoftbody, addSoftbodyBox, addSoftbodyRope, SoftbodyError, SOFTBODY_REFUSAL } from '../src/behaviours/softbody.js'

const codeOf = (fn, kind) => {
  try {
    fn()
  } catch (error) {
    return error instanceof kind ? error.code : 'other: ' + error.message
  }
  return 'no refusal'
}

const TANK = { min: [0, 0, 0], max: [0.3, 1, 0.3] }
const WIDE = { min: [0, 0, 0], max: [0.8, 1, 0.3] }

const column = (options = {}) => {
  const fluid = createFluid({ capacity: 600, bounds: TANK, ...options })
  fluid.spawnBlock([0.025, 0.025, 0.025], [0.275, 0.4, 0.275])
  return fluid
}

const meanDensity = (fluid) => {
  fluid.refreshDensity()
  let sum = 0
  for (let i = 0; i < fluid.count; i++) sum += fluid.densityOf(i)
  return sum / fluid.count
}

const settledColumn = column()
for (let t = 0; t < 600; t++) settledColumn.step()

gate('a 288-particle column settles in a tank: after 5 s its mean density is within 5 percent of the 1000 rest density', () => {
  assert.equal(settledColumn.count, 288)
  const mean = meanDensity(settledColumn)
  assert.ok(Math.abs(mean - 1000) < 50, 'mean density ' + mean)
})

gate('the settled column keeps its volume: the centre of mass sits near half the 0.4 m fill height', () => {
  const y = settledColumn.centreOfMass()[1]
  assert.ok(y > 0.17 && y < 0.25, 'centre of mass height ' + y)
})

gate('the settled column is at rest: its kinetic energy is below 0.2 J for 35 kg of fluid', () => {
  assert.ok(settledColumn.kineticEnergy() < 0.2, 'kinetic energy ' + settledColumn.kineticEnergy())
})

gate('pressure is hydrostatic: the mean pressure of the bottom quarter is above that of the top quarter', () => {
  settledColumn.refreshDensity()
  const order = Array.from({ length: settledColumn.count }, (_, i) => i).sort((a, b) => settledColumn.position(a)[1] - settledColumn.position(b)[1])
  const quarter = Math.floor(order.length / 4)
  const mean = (list) => list.reduce((sum, i) => sum + settledColumn.pressureOf(i), 0) / list.length
  const bottom = mean(order.slice(0, quarter))
  const top = mean(order.slice(-quarter))
  assert.ok(bottom > top + 500, 'bottom ' + bottom + ' Pa, top ' + top + ' Pa')
})

gate('every particle stays inside the tank bounds through the whole run', () => {
  for (let i = 0; i < settledColumn.count; i++) {
    const p = settledColumn.position(i)
    assert.ok(p[0] >= 0 && p[0] <= 0.3 && p[1] >= 0 && p[1] <= 1 && p[2] >= 0 && p[2] <= 0.3, 'particle ' + i + ' at ' + p)
  }
})

gate('the grid neighbour search gives the same density as a scan over every particle, for all 288', () => {
  settledColumn.refreshDensity()
  for (let i = 0; i < settledColumn.count; i++) {
    const brute = settledColumn.bruteDensityOf(i)
    assert.ok(Math.abs(settledColumn.densityOf(i) - brute) <= 1e-9 * brute, 'particle ' + i + ': grid ' + settledColumn.densityOf(i) + ', scan ' + brute)
  }
})

gate('no two settled particles share a position: the closest pair is more than a tenth of the spacing apart', () => {
  let closest = Infinity
  for (let i = 0; i < settledColumn.count; i++) {
    const a = settledColumn.position(i)
    for (let j = i + 1; j < settledColumn.count; j++) {
      const b = settledColumn.position(j)
      const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
      if (d < closest) closest = d
    }
  }
  assert.ok(closest > 0.005, 'closest pair ' + closest)
})

gate('a dam break spreads: a block released at one end of a 0.8 m tank moves its centre of mass from x 0.15 to past x 0.3 and drops it', () => {
  const fluid = createFluid({ capacity: 600, bounds: WIDE })
  fluid.spawnBlock([0.025, 0.025, 0.025], [0.275, 0.5, 0.275])
  const start = fluid.centreOfMass()
  for (let t = 0; t < 480; t++) fluid.step()
  const end = fluid.centreOfMass()
  assert.ok(Math.abs(start[0] - 0.15) < 1e-9, 'start x ' + start[0])
  assert.ok(end[0] > 0.3, 'end x ' + end[0])
  assert.ok(end[1] < start[1] * 0.6, 'height ' + start[1] + ' to ' + end[1])
})

gate('two runs of the same scene give the same position hash, and a run with one more particle gives another', () => {
  const run = (extra) => {
    const fluid = column()
    if (extra) fluid.spawn(0.15, 0.6, 0.15)
    for (let t = 0; t < 60; t++) fluid.step()
    return fluid.hash()
  }
  assert.equal(run(false), run(false))
  assert.notEqual(run(false), run(true))
})

gate('pair forces are equal and opposite: with no gravity and no wall in reach, a compressed block keeps its momentum within 1e-9', () => {
  const fluid = createFluid({ capacity: 200, bounds: { min: [-3, -3, -3], max: [3, 3, 3] }, gravity: [0, 0, 0] })
  fluid.spawnBlock([-0.09, -0.09, -0.09], [0.09, 0.09, 0.09], 0.045)
  for (let i = 0; i < fluid.count; i++) fluid.setVelocity(i, 0.4, -0.1, 0.2)
  const before = fluid.momentum()
  const energyBefore = fluid.kineticEnergy()
  for (let t = 0; t < 30; t++) fluid.step()
  const after = fluid.momentum()
  assert.ok(fluid.kineticEnergy() > energyBefore * 1.01, 'the compressed block did not push itself apart')
  for (let i = 0; i < fluid.count; i++) assert.ok(Math.abs(fluid.position(i)[0]) < 2.8, 'particle ' + i + ' reached a wall')
  for (let axis = 0; axis < 3; axis++) assert.ok(Math.abs(after[axis] - before[axis]) < 1e-9, 'axis ' + axis + ': ' + before[axis] + ' to ' + after[axis])
})

gate('negative control: with stiffness 0 nothing resists compression and the same column packs to more than 1.5 times rest density', () => {
  const fluid = column({ stiffness: 0 })
  for (let t = 0; t < 300; t++) fluid.step()
  const mean = meanDensity(fluid)
  assert.ok(mean > 1500, 'mean density ' + mean)
})

gate('an injected collider keeps particles out of a solid: no particle ends inside a sphere placed on the tank floor', () => {
  const centre = [0.15, 0.1, 0.15]
  const radius = 0.08
  const sphere = (x, y, z, normal) => {
    const dx = x - centre[0], dy = y - centre[1], dz = z - centre[2]
    const d = Math.hypot(dx, dy, dz) || 1e-9
    normal[0] = dx / d; normal[1] = dy / d; normal[2] = dz / d
    return d - radius
  }
  const fluid = createFluid({ capacity: 600, bounds: TANK, collider: sphere })
  fluid.spawnBlock([0.025, 0.3, 0.025], [0.275, 0.5, 0.275])
  for (let t = 0; t < 240; t++) fluid.step()
  let lowest = Infinity
  for (let i = 0; i < fluid.count; i++) {
    const p = fluid.position(i)
    const d = Math.hypot(p[0] - centre[0], p[1] - centre[1], p[2] - centre[2])
    assert.ok(d >= radius - 1e-9, 'particle ' + i + ' is ' + d + ' from the sphere centre')
    if (p[1] < lowest) lowest = p[1]
  }
  assert.ok(lowest < 0.05, 'the fluid did not reach the floor around the sphere: lowest ' + lowest)
})

gate('the fluid holds its capacity: a spawn past it returns -1, is counted, and the count stays', () => {
  const fluid = createFluid({ capacity: 3, bounds: TANK })
  assert.deepEqual([fluid.spawn(0.1, 0.1, 0.1), fluid.spawn(0.2, 0.1, 0.1), fluid.spawn(0.1, 0.2, 0.1), fluid.spawn(0.2, 0.2, 0.1)], [0, 1, 2, -1])
  assert.equal(fluid.count, 3)
  assert.equal(fluid.refusedSpawns, 1)
})

gate('the substep count comes from the stiffness: a stiffer fluid takes more substeps for the same tick', () => {
  const soft = createFluid({ bounds: TANK, stiffness: 20 })
  const stiff = createFluid({ bounds: TANK, stiffness: 2000 })
  assert.ok(stiff.substeps > soft.substeps, soft.substeps + ' and ' + stiff.substeps)
  assert.ok(Math.abs(stiff.substeps * stiff.substepSeconds - 1 / 120) < 1e-12)
})

gate('fluid refusals name the cause: no bounds, inverted bounds, a bad capacity, a NaN spawn, an index past the count', () => {
  assert.equal(codeOf(() => createFluid({}), FluidError), FLUID_REFUSAL.BOUNDS)
  assert.equal(codeOf(() => createFluid({ bounds: { min: [0, 0, 0], max: [1, 0, 1] } }), FluidError), FLUID_REFUSAL.BOUNDS)
  assert.equal(codeOf(() => createFluid({ bounds: TANK, capacity: 0 }), FluidError), FLUID_REFUSAL.OPTION)
  assert.equal(codeOf(() => createFluid({ bounds: TANK, collider: 5 }), FluidError), FLUID_REFUSAL.OPTION)
  const fluid = createFluid({ bounds: TANK, capacity: 4 })
  assert.equal(codeOf(() => fluid.spawn(NaN, 0, 0), FluidError), FLUID_REFUSAL.POSITION)
  assert.equal(codeOf(() => fluid.position(0), FluidError), FLUID_REFUSAL.INDEX)
})

const hangingRope = (options = {}) => {
  const body = createSoftbody({ particleCapacity: 32, constraintCapacity: 64, iterations: 4, ...options })
  const rope = addSoftbodyRope(body, { from: [0, 2, 0], to: [1, 2, 0], segments: 10, mass: 1 })
  return { body, rope }
}

gate('a rope pinned at one end swings down and hangs: after 12 s its free end is within 2 percent of straight below the pin', () => {
  const { body, rope } = hangingRope({ damping: 1 })
  for (let t = 0; t < 720; t++) body.step()
  const end = body.position(rope.last)
  assert.deepEqual(body.position(rope.first), [0, 2, 0])
  assert.ok(Math.abs(end[0]) < 0.05, 'free end x ' + end[0])
  assert.ok(Math.abs(end[1] - 1) < 0.02, 'free end y ' + end[1])
})

gate('the rope keeps its length while it swings: no segment strains more than 1 percent at any tick', () => {
  const { body } = hangingRope()
  let worst = 0
  for (let t = 0; t < 240; t++) {
    body.step()
    worst = Math.max(worst, body.maxStrain())
  }
  assert.ok(worst < 0.01, 'worst strain ' + worst)
})

gate('a softer rope stretches more: compliance 0, 1e-3 and 1e-2 give rising hang lengths', () => {
  const lengthAt = (compliance) => {
    const body = createSoftbody({ particleCapacity: 32, constraintCapacity: 64, damping: 2 })
    const rope = addSoftbodyRope(body, { from: [0, 2, 0], to: [0, 1, 0], segments: 10, mass: 1, compliance })
    for (let t = 0; t < 600; t++) body.step()
    return 2 - body.position(rope.last)[1]
  }
  const stiff = lengthAt(0), medium = lengthAt(1e-3), soft = lengthAt(1e-2)
  assert.ok(Math.abs(stiff - 1) < 0.005, 'stiff length ' + stiff)
  assert.ok(medium > stiff + 0.002 && soft > medium + 0.02, stiff + ', ' + medium + ', ' + soft)
})

gate('a box in free fall follows the ballistic curve: after 0.5 s its centroid has dropped 0.5 * 9.81 * 0.25 within 1 percent', () => {
  const body = createSoftbody({ damping: 0 })
  addSoftbodyBox(body, { min: [0, 10, 0], max: [1, 11, 1], cells: [2, 2, 2], mass: 8 })
  const start = body.centroid()[1]
  for (let t = 0; t < 30; t++) body.step()
  const drop = start - body.centroid()[1]
  assert.ok(Math.abs(drop - 0.5 * 9.81 * 0.25) < 0.0125, 'drop ' + drop)
  assert.ok(body.maxStrain() < 1e-9, 'strain in free fall ' + body.maxStrain())
})

gate('an impulse on one corner leaves the total momentum equal to the impulse: internal constraints add none', () => {
  const body = createSoftbody({ gravity: [0, 0, 0], damping: 0 })
  const box = addSoftbodyBox(body, { min: [0, 0, 0], max: [1, 1, 1], cells: [2, 2, 2], mass: 27 })
  body.applyImpulse(box.at(0, 0, 0), 3, 0, 0)
  for (let t = 0; t < 60; t++) body.step()
  let momentum = 0
  for (let i = 0; i < body.particleCount; i++) momentum += body.velocity(i)[0]
  assert.ok(Math.abs(momentum - 3) < 1e-9, 'momentum ' + momentum)
  assert.ok(Math.abs(body.centroid()[0] - (0.5 + 3 / 27)) < 1e-9, 'centroid x ' + body.centroid()[0])
})

gate('a box dropped on the ground comes to rest on it and keeps its shape: 1 m tall within 3 percent, no particle below the ground', () => {
  const body = createSoftbody({ groundY: 0 })
  addSoftbodyBox(body, { min: [0, 2, 0], max: [1, 3, 1], cells: [2, 2, 2], mass: 8 })
  for (let t = 0; t < 600; t++) body.step()
  const extent = body.extent()
  assert.ok(Math.abs(extent[1] - 1) < 0.03, 'height ' + extent[1])
  assert.ok(body.kineticEnergy() < 1e-3, 'kinetic energy ' + body.kineticEnergy())
  for (let i = 0; i < body.particleCount; i++) assert.ok(body.position(i)[1] >= 0, 'particle ' + i + ' below the ground')
  assert.ok(Math.abs(body.centroid()[1] - 0.5) < 0.03, 'centroid height ' + body.centroid()[1])
})

gate('a compliant box squashes under its own weight more than a stiff one, and both recover no more than their rest height', () => {
  const heightAt = (compliance) => {
    const body = createSoftbody({ groundY: 0, damping: 2 })
    addSoftbodyBox(body, { min: [0, 0, 0], max: [1, 1, 1], cells: [2, 2, 2], mass: 8, compliance })
    for (let t = 0; t < 600; t++) body.step()
    return body.extent()[1]
  }
  const stiff = heightAt(0), soft = heightAt(2e-2)
  assert.ok(stiff <= 1 + 1e-9 && soft < stiff - 0.02, 'stiff ' + stiff + ', soft ' + soft)
})

gate('negative control: with 0 solver iterations the same dropped box collapses flat onto the ground', () => {
  const body = createSoftbody({ groundY: 0, iterations: 0 })
  addSoftbodyBox(body, { min: [0, 2, 0], max: [1, 3, 1], cells: [2, 2, 2], mass: 8 })
  for (let t = 0; t < 600; t++) body.step()
  assert.ok(body.extent()[1] < 0.01, 'height ' + body.extent()[1])
})

gate('ground friction stops a sliding box: a box pushed sideways on the ground travels a bounded distance and stops', () => {
  const body = createSoftbody({ groundY: 0 })
  const box = addSoftbodyBox(body, { min: [0, 0, 0], max: [1, 1, 1], cells: [1, 1, 1], mass: 8 })
  for (let i = 0; i < box.count; i++) body.applyImpulse(box.first + i, 2, 0, 0)
  for (let t = 0; t < 300; t++) body.step()
  const x = body.centroid()[0]
  assert.ok(x > 0.5 && x < 3, 'centroid x ' + x)
  assert.ok(body.kineticEnergy() < 1e-3, 'kinetic energy ' + body.kineticEnergy())
})

gate('an injected collider holds a body up: a box dropped on a sphere ends with every particle outside it', () => {
  const sphere = (x, y, z, normal) => {
    const d = Math.hypot(x - 0.5, y, z - 0.5) || 1e-9
    normal[0] = (x - 0.5) / d; normal[1] = y / d; normal[2] = (z - 0.5) / d
    return d - 1
  }
  const body = createSoftbody({ collider: sphere, groundY: -1 })
  addSoftbodyBox(body, { min: [0, 1.5, 0], max: [1, 2.5, 1], cells: [2, 2, 2], mass: 8 })
  for (let t = 0; t < 120; t++) body.step()
  for (let i = 0; i < body.particleCount; i++) {
    const p = body.position(i)
    assert.ok(Math.hypot(p[0] - 0.5, p[1], p[2] - 0.5) >= 1 - 1e-9, 'particle ' + i + ' inside the sphere')
  }
  assert.ok(body.centroid()[1] > 1.2, 'centroid height ' + body.centroid()[1])
})

gate('a pinned particle that is moved drags the body after it', () => {
  const { body, rope } = hangingRope({ damping: 1 })
  for (let t = 0; t < 600; t++) body.step()
  body.movePinned(rope.first, 3, 2, 0)
  for (let t = 0; t < 900; t++) body.step()
  assert.ok(Math.abs(body.position(rope.last)[0] - 3) < 0.1, 'free end x ' + body.position(rope.last)[0])
})

gate('two runs of the same body give the same hash, and one changed mass gives another', () => {
  const run = (mass) => {
    const body = createSoftbody({ groundY: 0 })
    addSoftbodyBox(body, { min: [0, 2, 0], max: [1, 3, 1], cells: [2, 2, 2], mass })
    body.applyImpulse(0, 0.3, 0, 0.1)
    for (let t = 0; t < 120; t++) body.step()
    return body.hash()
  }
  assert.equal(run(8), run(8))
  assert.notEqual(run(8), run(9))
})

gate('softbody refusals name the cause: capacity used up, a self constraint, a zero rest length, a bad index, moving an unpinned particle', () => {
  const body = createSoftbody({ particleCapacity: 2, constraintCapacity: 1 })
  body.addParticle(0, 0, 0)
  body.addParticle(1, 0, 0)
  assert.equal(codeOf(() => body.addParticle(2, 0, 0), SoftbodyError), SOFTBODY_REFUSAL.FULL)
  assert.equal(codeOf(() => body.addConstraint(0, 0), SoftbodyError), SOFTBODY_REFUSAL.DEGENERATE)
  assert.equal(codeOf(() => body.addConstraint(0, 1, 0, 0), SoftbodyError), SOFTBODY_REFUSAL.DEGENERATE)
  assert.equal(codeOf(() => body.addConstraint(0, 5), SoftbodyError), SOFTBODY_REFUSAL.INDEX)
  body.addConstraint(0, 1)
  assert.equal(codeOf(() => body.addConstraint(0, 1), SoftbodyError), SOFTBODY_REFUSAL.FULL)
  assert.equal(codeOf(() => body.movePinned(0, 1, 1, 1), SoftbodyError), SOFTBODY_REFUSAL.VALUE)
  assert.equal(codeOf(() => createSoftbody({ substeps: 0 }), SoftbodyError), SOFTBODY_REFUSAL.OPTION)
})

gate('neither module imports anything, reads a host clock or random source, or carries a comment', () => {
  for (const name of ['fluid.js', 'softbody.js']) {
    const source = readFileSync(new URL('../src/behaviours/' + name, import.meta.url), 'utf8')
    assert.equal(source.includes('import '), false, name + ' imports')
    assert.equal(source.includes('//') || source.includes('/*'), false, name + ' has a comment')
    for (const host of ['Date', 'performance', 'process', 'console', 'globalThis', 'Math.random']) assert.equal(source.includes(host), false, name + ' reads ' + host)
  }
})

finish()
