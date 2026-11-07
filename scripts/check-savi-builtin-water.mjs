import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import {
  WATER_DEFAULTS, WATER_NAMES, foamSettings,
  waterRippleSlope, waterFoam, waterFoamField, waterFoamFieldLod, waterFoamCoverage,
  waterTransmittance, waterMedium, waterUnderwaterDistortion, waterRayBoxDistance,
  waterCaustics, waterCausticsAt, waterCausticsRefracted, waterFresnel,
} from '../src/savi-builtins/water.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sectionPath = join(root, 'scripts', 'fixtures', 'savi', 'tome', 'sections', 'builtin-water.md')
const sourcePath = join(root, 'src', 'savi-builtins', 'water.js')
const section = readFileSync(sectionPath, 'utf8')

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}
const same = (actual, expected, label = 'value') => {
  assert(actual === expected, label + ' is ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected))
}
const sameJson = (actual, expected, label = 'value') => same(JSON.stringify(actual), JSON.stringify(expected), label)
const mustThrow = (check, fragment) => {
  let message = null
  try {
    check()
  } catch (error) {
    message = error.message
  }
  assert(message !== null, 'negative control was accepted')
  assert(message.includes(fragment), 'refused for the wrong reason: ' + message)
}

const XZ = [1, 2]
const CALLS = {
  waterRippleSlope: [waterRippleSlope, [XZ, 0, 1, XZ, 1, 0.5]],
  waterFoam: [waterFoam, [XZ, 0, XZ, 0.5]],
  waterFoamField: [waterFoamField, [XZ, 0, XZ]],
  waterFoamFieldLod: [waterFoamFieldLod, [XZ, 0, XZ, 1, 2]],
  waterFoamCoverage: [waterFoamCoverage, [0.5, 0.5]],
  waterTransmittance: [waterTransmittance, [XZ, 1, 2]],
  waterMedium: [waterMedium, [XZ, 1, 2]],
  waterUnderwaterDistortion: [waterUnderwaterDistortion, [XZ, 0, 1, 1, 0.1]],
  waterRayBoxDistance: [waterRayBoxDistance, [XZ, XZ, XZ, XZ, 10]],
  waterCaustics: [waterCaustics, [XZ, 0]],
  waterCausticsAt: [waterCausticsAt, [XZ, 0, XZ, 0, 1, 1, 1, 0, 0.5, 0.5, 0.1]],
  waterCausticsRefracted: [waterCausticsRefracted, [XZ, 0, XZ, 0, 1, 1, 1, 0, 0.5, 0.5, 0.1]],
  waterFresnel: [waterFresnel, [0.5, 0.04]],
}

gate('the savi section names the thirteen water functions and the foam defaults this module carries', () => {
  for (const name of WATER_NAMES) {
    same(section.includes(name + '('), true, name + ' in the section')
  }
  sameJson(WATER_NAMES.length, 13, 'water names')
  same(section.includes('waterFoam(xz, t, flowVelocity, amount, scale = 1, softness = 0.08)'), true, 'foam signature with defaults')
  same(section.includes('waterFoamCoverage(amount, field, softness = 0.08)'), true, 'coverage signature with default')
  same(section.includes('waterFoamFieldLod(xz, t, flowVelocity, scale, footprint)'), true, 'lod scale is required')
})

gate('the documented defaults are scale 1 and softness 0.08, and foamSettings validates what it resolves', () => {
  sameJson(WATER_DEFAULTS, { scale: 1, softness: 0.08 }, 'defaults')
  sameJson(foamSettings(), { scale: 1, softness: 0.08 }, 'defaulted settings')
  sameJson(foamSettings(2, 0), { scale: 2, softness: 0 }, 'explicit settings')
  mustThrow(() => foamSettings(0), 'foam scale is a positive finite number')
  mustThrow(() => foamSettings(-1), 'foam scale is a positive finite number')
  mustThrow(() => foamSettings(1, -0.1), 'foam softness is zero or more')
  mustThrow(() => foamSettings(Number.NaN), 'foam scale is a positive finite number')
})

gate('every water function with its full arguments is refused by name, because savi gives names and signatures only', () => {
  for (const name of WATER_NAMES) {
    const [call, args] = CALLS[name]
    mustThrow(() => call(...args), name + ' has no documented headless behaviour')
  }
})

gate('a call with too few arguments is refused with the count it needs, so no required value is filled with undefined', () => {
  mustThrow(() => waterRippleSlope(1, 2, 3, 4, 5), 'waterRippleSlope takes 6 arguments, got 5')
  mustThrow(() => waterCausticsAt(...CALLS.waterCausticsAt[1].slice(0, 10)), 'waterCausticsAt takes 11 arguments')
  mustThrow(() => waterFoamFieldLod([1, 2], 0, [1, 2], undefined, [1, 2]), 'waterFoamFieldLod argument 3 is missing')
  mustThrow(() => waterFoam([1, 2], 0, [1, 2]), 'waterFoam takes 4 arguments, got 3')
  mustThrow(() => waterFresnel(undefined, 0.04), 'waterFresnel argument 0 is missing')
})

gate('a non-finite number anywhere in an argument is refused, and so is a value that is not a number, list or object', () => {
  mustThrow(() => waterFresnel(Number.NaN, 0.04), 'waterFresnel argument 0 is a finite number')
  mustThrow(() => waterCaustics([1, Number.POSITIVE_INFINITY], 0), 'waterCaustics argument 0 is a finite number')
  mustThrow(() => waterRayBoxDistance({ x: 1, y: { z: Number.NaN } }, XZ, XZ, XZ, 1), 'is a finite number')
  mustThrow(() => waterFresnel('0.5', 0.04), 'argument 0 is a number, a list or an object of numbers')
  mustThrow(() => waterFresnel(null, 0.04), 'argument 0 is a number, a list or an object of numbers')
})

const hostGlobals = ['process', 'performance', 'Date', 'setTimeout', 'clearTimeout', 'setImmediate', 'setInterval', 'console', 'window', 'globalThis', 'require', 'Buffer']

const withoutStrings = (source) => source.replace(/'[^'\n]*'|"[^"\n]*"|`[^`]*`/g, "''")

const findingsIn = (source) => {
  const found = []
  if (source.includes('//') || source.includes('/*')) found.push('comment marker')
  if (source.includes('Math.random')) found.push('uses Math.random')
  for (const piece of source.split("from '").slice(1)) {
    const specifier = piece.slice(0, piece.indexOf("'"))
    if (!specifier.startsWith('.')) found.push('bare import ' + specifier)
  }
  const words = new Set(withoutStrings(source).split(/[^A-Za-z0-9_$]/))
  for (const token of hostGlobals) {
    if (words.has(token)) found.push('uses ' + token)
  }
  return found
}

gate('src/savi-builtins/water.js is comment-free, imports nothing bare, reads no host global', () => {
  same(findingsIn(readFileSync(sourcePath, 'utf8')).join(','), '', 'findings')
  same(findingsIn('const t = performance.now() // x').length > 0, true, 'negative sample is caught')
})

finish()
