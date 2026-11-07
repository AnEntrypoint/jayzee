import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import {
  shaderTime, uvSet, audioLevelOf, spectrumFrequency, instancedArray,
  atomicAdd, atomicSub, atomicMax, atomicMin, atomicAnd, atomicOr, atomicXor, atomicStore, atomicLoad,
  dispatchGroups, namedOnly, TSL_NAMED_ONLY,
} from '../src/upstream-builtins/tsl.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sectionPath = join(root, 'scripts', 'fixtures', 'upstream', 'tome', 'sections', 'builtin-tsl.md')
const section = readFileSync(sectionPath, 'utf8')

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}
const same = (actual, expected, label = 'value') => {
  assert(actual === expected, label + ' is ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected))
}
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

gate('the upstream section states the time formula, the uv sets, the spectrum ends and the atomic return value this module carries', () => {
  same(section.includes('Shader time is seconds: (ctx.now() / 1000) % 3600.'), true, 'time sentence')
  same(section.includes('uv() reads the first UV set; uv(1) through uv(3) select later sets.'), true, 'uv sentence')
  same(section.includes('x runs from 20 Hz at 0 to 20 kHz at 1.'), true, 'spectrum sentence')
  same(section.includes('each 0 to 1'), true, 'audio range sentence')
  same(section.includes('The atomics act on an int or uint instancedArray element inside a compute body.'), true, 'atomics sentence')
  same(section.includes("return the element's previous value."), true, 'previous value sentence')
  same(section.includes('compute(count, workgroupSize = 64)'), true, 'workgroup default')
})

gate('every named-only tsl name appears in the section, so the refusals name real upstream names', () => {
  same(TSL_NAMED_ONLY.length >= 40, true, 'named-only count')
  for (const name of TSL_NAMED_ONLY) {
    assert(section.includes(name), name + ' is not in the section')
  }
})

gate('shader time is (now / 1000) modulo 3600 seconds, and a negative or non-finite now is refused', () => {
  same(shaderTime(0), 0, 'time at zero')
  same(shaderTime(1234), 1.234, 'time at 1234 ms')
  same(shaderTime(3600 * 1000 + 500), 0.5, 'time wraps at 3600 s')
  mustThrow(() => shaderTime(-1), 'zero or more milliseconds')
  mustThrow(() => shaderTime(Number.NaN), 'now is a finite number')
})

gate('uv sets are 0 to 3 whole numbers; uv() with no argument is the first set', () => {
  same(uvSet(), 0, 'default set')
  same(uvSet(3), 3, 'last set')
  mustThrow(() => uvSet(4), 'uv set is 0 to 3')
  mustThrow(() => uvSet(1.5), 'uv set is 0 to 3')
  mustThrow(() => uvSet(-1), 'uv set is 0 to 3')
})

gate('audio levels are 0 to 1 and are refused outside it, not clamped', () => {
  same(audioLevelOf(0.5), 0.5, 'mid level')
  mustThrow(() => audioLevelOf(1.2), 'not clamped')
  mustThrow(() => audioLevelOf(-0.1), 'not clamped')
  mustThrow(() => audioLevelOf(Number.NaN), 'audio level is a finite number')
})

gate('the spectrum runs from 20 Hz at 0 to 20 kHz at 1; an interior position is a scoped negative', () => {
  same(spectrumFrequency(0), 20, 'low end')
  same(spectrumFrequency(1), 20000, 'high end')
  mustThrow(() => spectrumFrequency(0.5), 'upstream states the ends only')
  mustThrow(() => spectrumFrequency(2), 'spectrum position is 0 to 1')
})

gate('instancedArray takes a count or a typed array of the named type, and float is the default type', () => {
  const floats = instancedArray(4)
  same(floats instanceof Float32Array, true, 'default float')
  same(floats.length, 4, 'count')
  same(instancedArray(4, 'int') instanceof Int32Array, true, 'int type')
  const uints = new Uint32Array(3)
  same(instancedArray(uints, 'uint'), uints, 'data kept')
  mustThrow(() => instancedArray(new Float32Array(3), 'int'), 'the data is a Int32Array for type int')
  mustThrow(() => instancedArray(4, 'vec3'), 'instancedArray type is float, int or uint')
  mustThrow(() => instancedArray(4, 'constructor'), 'instancedArray type is float, int or uint')
  mustThrow(() => instancedArray(0), 'count is a whole number of at least 1')
})

gate('each atomic returns the previous value and stores the result', () => {
  const add = new Int32Array([5])
  same(atomicAdd(add, 0, 3), 5, 'add previous')
  same(add[0], 8, 'add stored')
  same(atomicSub(add, 0, 2), 8, 'sub previous')
  same(add[0], 6, 'sub stored')
  const low = new Int32Array([4])
  same(atomicMin(low, 0, -1), 4, 'min previous')
  same(low[0], -1, 'min stored')
  const high = new Uint32Array([1])
  same(atomicMax(high, 0, 9), 1, 'max previous')
  same(high[0], 9, 'max stored')
  const bits = new Int32Array([6])
  same(atomicAnd(bits, 0, 3), 6, 'and previous')
  same(bits[0], 2, 'and stored')
  same(atomicOr(bits, 0, 4), 2, 'or previous')
  same(bits[0], 6, 'or stored')
  same(atomicXor(bits, 0, 5), 6, 'xor previous')
  same(bits[0], 3, 'xor stored')
  atomicStore(bits, 0, 9)
  same(atomicLoad(bits, 0), 9, 'store then load')
})

gate('atomic arithmetic wraps as the element type wraps: int32 overflows to negative, uint32 underflows to the top', () => {
  const signed = new Int32Array([2147483647])
  same(atomicAdd(signed, 0, 1), 2147483647, 'overflow previous')
  same(signed[0], -2147483648, 'overflow wraps')
  const unsigned = new Uint32Array([0])
  same(atomicSub(unsigned, 0, 1), 0, 'underflow previous')
  same(unsigned[0], 4294967295, 'underflow wraps')
})

gate('scoped negatives: atomics refuse float arrays, bad indices, fractional or out-of-type operands', () => {
  mustThrow(() => atomicAdd(new Float32Array(2), 0, 1), 'atomics act on an int or uint array')
  mustThrow(() => atomicAdd(new Int32Array(2), 2, 1), 'element 2 is past the 2 elements')
  mustThrow(() => atomicAdd(new Int32Array(2), 0, 1.5), 'outside the element type')
  mustThrow(() => atomicAdd(new Int32Array(2), 0, 2147483648), 'outside the element type')
  mustThrow(() => atomicSub(new Uint32Array(2), 0, -1), 'outside the element type')
  mustThrow(() => atomicStore(new Int32Array(2), -1, 1), 'element index is a whole number')
  mustThrow(() => atomicLoad(new Uint32Array(2), 0.5), 'element index is a whole number')
})

gate('dispatch groups round the count up to whole workgroups of 64 by default', () => {
  same(dispatchGroups(64), 1, 'exact fit')
  same(dispatchGroups(65), 2, 'one over')
  same(dispatchGroups(128, 32), 4, 'explicit size')
  mustThrow(() => dispatchGroups(0), 'compute count is a whole number of at least 1')
  mustThrow(() => dispatchGroups(8, 0), 'workgroup size is a whole number of at least 1')
})

gate('scoped negatives: the nodes, textures, workgroup and compute names are named, then refused', () => {
  mustThrow(() => namedOnly('select'), 'tsl select has no documented headless behaviour')
  mustThrow(() => namedOnly('textureLoad'), 'scoped negative')
  mustThrow(() => namedOnly('bogus'), 'bogus is not a named-only tsl name')
})

finish()
