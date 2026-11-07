import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import {
  VEC3_NAMES,
  add,
  cross,
  directionFromYawPitch,
  distance,
  dot,
  eulerFromRotation,
  length,
  normalize,
  rotate,
  rotationFromDirection,
  rotationFromEuler,
  scale,
  sub,
  toVec,
} from '../src/upstream-builtins/vec3.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sectionPath = join(root, 'scripts', 'fixtures', 'upstream', 'tome', 'sections', 'builtin-vec3.md')

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}
const same = (actual, expected, label = 'value') => {
  assert(actual === expected, label + ' is ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected))
}
const near = (actual, expected, label, tolerance = 1e-9) => {
  assert(Math.abs(actual - expected) <= tolerance, label + ' is ' + actual + ', expected ' + expected)
}
const nearVec = (actual, expected, label, tolerance = 1e-9) => {
  assert(actual.length === 3 && expected.every((e, i) => Math.abs(actual[i] - e) <= tolerance), label + ' is ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected))
}
const mustThrow = (check) => {
  let thrown = false
  try {
    check()
  } catch (_) {
    thrown = true
  }
  assert(thrown, 'negative control was accepted')
}

gate('the names and the stated Euler convention are the ones upstream documents', () => {
  const section = readFileSync(sectionPath, 'utf8')
  same(section.includes('Euler order is yaw, pitch, roll about +Y, +X, +Z'), true, 'Euler order text')
  same(section.includes('Yaw 0 faces -Z'), true, 'yaw 0 text')
  same(section.includes('rotationFromDirection defaults to the -z axis'), true, 'default axis text')
  same(VEC3_NAMES.length, 13, 'exported names')
})

gate('vector arithmetic accepts {x, y, z} and [x, y, z], and is the standard algebra', () => {
  nearVec(add([1, 2, 3], { x: 1, y: 1, z: 1 }), [2, 3, 4], 'add')
  nearVec(sub({ x: 5, y: 5, z: 5 }, [1, 2, 3]), [4, 3, 2], 'sub')
  nearVec(scale([1, -2, 3], 2), [2, -4, 6], 'scale')
  near(dot([1, 2, 3], [4, 5, 6]), 32, 'dot')
  near(length([3, 4, 0]), 5, 'length')
  nearVec(cross([1, 0, 0], [0, 1, 0]), [0, 0, 1], 'cross x y')
  near(distance([0, 0, 0], [0, 3, 4]), 5, 'distance')
  nearVec(normalize([0, 0, -5]), [0, 0, -1], 'normalize')
  mustThrow(() => nearVec(add([1, 2, 3], [1, 2, 3]), [0, 0, 0], 'add'))
})

gate('a vector with a non-finite or missing component is refused, and zero cannot be normalised', () => {
  mustThrow(() => toVec([1, 2]))
  mustThrow(() => toVec([1, Number.NaN, 3]))
  mustThrow(() => toVec({ x: 1, y: 2 }))
  mustThrow(() => normalize([0, 0, 0]))
  mustThrow(() => scale([1, 2, 3], Number.POSITIVE_INFINITY))
})

gate('yaw 0 faces -Z, and yaw turns the facing about +Y', () => {
  nearVec(directionFromYawPitch(0, 0), [0, 0, -1], 'yaw 0')
  nearVec(directionFromYawPitch(90, 0), [-1, 0, 0], 'yaw 90')
  nearVec(rotate(90, [0, 0, -1]), [-1, 0, 0], 'a bare number is yaw')
  mustThrow(() => nearVec(directionFromYawPitch(90, 0), [1, 0, 0], 'yaw 90'))
})

gate('pitch tilts the facing about +X; the sign is the right-handed one, which upstream does not state', () => {
  const up = directionFromYawPitch(0, 30)
  near(up[1], 0.5, 'pitch 30 rises', 1e-9)
  nearVec(up, [0, 0.5, -Math.sqrt(0.75)], 'pitch 30 facing')
})

gate('the Euler order is yaw about +Y, then pitch about +X, then roll about +Z, as a product of the three rotations', () => {
  const euler = { yaw: 30, pitch: 20, roll: 10 }
  const v = [0.3, -0.7, 1.1]
  const q = rotationFromEuler(euler)
  const rx = rotationFromEuler({ pitch: 20 })
  const ry = rotationFromEuler({ yaw: 30 })
  const rz = rotationFromEuler({ roll: 10 })
  nearVec(rotate(q, v), rotate(ry, rotate(rx, rotate(rz, v))), 'yaw then pitch then roll applied to a vector')
  mustThrow(() => nearVec(rotate(q, v), rotate(rz, rotate(rx, rotate(ry, v))), 'reversed order'))
})

gate('eulerFromRotation recovers yaw, pitch and roll away from the pitch-90 lock', () => {
  for (const euler of [{ yaw: 30, pitch: 20, roll: 10 }, { yaw: -120, pitch: -35, roll: 75 }, { yaw: 0, pitch: 0, roll: 45 }]) {
    const back = eulerFromRotation(rotationFromEuler(euler))
    near(back.yaw, euler.yaw, 'yaw', 1e-7)
    near(back.pitch, euler.pitch, 'pitch', 1e-7)
    near(back.roll, euler.roll, 'roll', 1e-7)
  }
  mustThrow(() => near(eulerFromRotation(rotationFromEuler({ yaw: 30 })).pitch, 30, 'pitch'))
})

gate('rotationFromDirection defaults to the -z axis, and aims that axis at the given direction', () => {
  const aim = rotationFromDirection([1, 0, 0])
  nearVec(rotate(aim, [0, 0, -1]), [1, 0, 0], 'default axis aimed at +x')
  const back = rotationFromDirection([0, 0, 1])
  nearVec(rotate(back, [0, 0, -1]), [0, 0, 1], 'opposite direction')
  const xAxis = rotationFromDirection([1, 0, 0], 'x')
  nearVec(rotate(xAxis, [1, 0, 0]), [1, 0, 0], 'x axis aimed at itself')
  mustThrow(() => rotationFromDirection([1, 0, 0], 'w'))
})

gate('the dot product of a unit length and the cross product stay perpendicular', () => {
  const a = normalize([1, 2, 3])
  const b = normalize([-2, 0.5, 1])
  near(dot(cross(a, b), a), 0, 'cross perpendicular to a', 1e-12)
  near(length(sub(add(a, [0, 0, 0]), a)), 0, 'sub inverts add')
})

finish()
