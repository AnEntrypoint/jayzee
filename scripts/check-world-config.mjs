import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { World } from '../src/world/World.js'
import { DEFAULT_MOVEMENT } from '../src/motion-pure/movement.js'

const here = dirname(fileURLToPath(import.meta.url))
const config = JSON.parse(readFileSync(join(here, 'fixtures', 'spoint', 'world-config.json'), 'utf8'))

const runFall = (world, steps) => {
  const id = world.spawn([0, 50, 0])
  for (let i = 0; i < steps; i++) world.step()
  return world.position(id)
}

gate('the default World tick is the spoint README tickRate', () => {
  assert.equal(new World().stepSeconds, 1 / config.tickRate)
})

gate('the README tickRate is a whole number of ticks per second that World accepts', () => {
  assert.equal(Number.isInteger(config.tickRate), true)
  assert.equal(new World({ tickRate: config.tickRate }).stepSeconds, 1 / config.tickRate)
})

gate('the README gravity vector is vertical, so the scalar gravity expresses it', () => {
  assert.deepEqual([config.gravity[0], config.gravity[2]], [0, 0])
  assert.equal(config.gravity.length, 3)
})

gate('the default World gravity is the README gravity y, bit for bit over 128 steps', () => {
  const defaults = runFall(new World(), 128)
  const explicit = runFall(new World({ gravity: config.gravity[1], tickRate: config.tickRate }), 128)
  assert.deepEqual(defaults.map((v) => Object.is(v, -0) ? 0 : v), explicit.map((v) => Object.is(v, -0) ? 0 : v))
})

gate('negative control: a World with another gravity falls differently, so the gravity pin is not vacuous', () => {
  const defaults = runFall(new World(), 128)
  const other = runFall(new World({ gravity: -9.81 }), 128)
  assert.notEqual(defaults[1], other[1])
})

gate('the README jumpImpulse matches the movement module default', () => {
  assert.equal(DEFAULT_MOVEMENT.jumpImpulse, config.movement.jumpImpulse)
})

for (const key of Object.keys(config.movement)) {
  if (!(key in DEFAULT_MOVEMENT)) {
    console.log(`OPEN movement.${key}: the README value ${config.movement[key]} has no movement module default (owner question)`)
    continue
  }
  if (DEFAULT_MOVEMENT[key] !== config.movement[key]) {
    console.log(`OPEN movement.${key}: README ${config.movement[key]}, movement module default ${DEFAULT_MOVEMENT[key]} (owner question)`)
  }
}

finish()
