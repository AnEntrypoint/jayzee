import { gate, finish } from './lib/gate.mjs'
import { dirToLocalXZ, resolveTarget, NonFiniteElevationError } from '../src/sessions-pure/relocationTarget.js'

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}
const same = (actual, expected, label = 'value') => {
  assert(actual === expected, label + ' is ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected))
}
const mustThrow = (check, type, fragment) => {
  let error = null
  try {
    check()
  } catch (thrown) {
    error = thrown
  }
  assert(error !== null, 'negative control was accepted')
  assert(error instanceof type, 'refused with ' + (error && error.name) + ', expected ' + type.name)
  if (fragment !== undefined) assert(error.message.includes(fragment), 'refused for the wrong reason: ' + error.message)
  return error
}

const DIR = [0.5, Math.sqrt(3) / 2, 0]
const frame = (extra = {}) => ({
  up: [0, 1, 0], east: [1, 0, 0], north: [0, 0, 1],
  radius: 1000, anchorHeight: 0, offsetY: 0,
  localToDir: () => [0, 1, 0],
  ...extra,
})

gate('a finite, complete frame returns a finite local point, so the refusals below are not the only path', () => {
  const xz = dirToLocalXZ(frame(), DIR, () => 0)
  assert(Array.isArray(xz) && xz.length === 2 && xz.every(Number.isFinite), 'finite ground did not return a point')
})

gate('a direction under the usable cap still returns null, and that null is not a refusal', () => {
  same(dirToLocalXZ(frame(), [1, 0, 0], () => 0), null, 'horizontal direction')
})

gate('ground that is NaN at the seed refuses with NonFiniteElevationError at the bracket phase, not the seed point', () => {
  const error = mustThrow(() => dirToLocalXZ(frame(), DIR, () => Number.NaN), NonFiniteElevationError, 'non-finite bracket sample at 1000 m')
  same(error.phase, 'bracket', 'phase')
  same(error.distanceM, 1000, 'distance')
  same(error.name, 'NonFiniteElevationError', 'name')
})

gate('ground that stops covering the ray refuses at the first uncovered sample, not at the last good one', () => {
  const coverage = (x, z) => (Math.hypot(x, z) > 400 ? Number.NaN : 0)
  mustThrow(() => dirToLocalXZ(frame(), DIR, coverage), NonFiniteElevationError, 'non-finite bracket sample at 1000 m')
})

gate('an infinite ground height is refused the same way as NaN', () => {
  mustThrow(() => dirToLocalXZ(frame(), DIR, () => Number.POSITIVE_INFINITY), NonFiniteElevationError, 'non-finite bracket sample')
})

gate('a frame without offsetY is refused with the same named error, not solved to the seed', () => {
  const incomplete = { up: [0, 1, 0], east: [1, 0, 0], north: [0, 0, 1], radius: 1000, anchorHeight: 0, localToDir: () => [0, 1, 0] }
  mustThrow(() => dirToLocalXZ(incomplete, DIR, () => 0), NonFiniteElevationError, 'non-finite bracket sample')
})

gate('resolveTarget passes the named refusal through to its caller for a dir target', () => {
  mustThrow(() => resolveTarget({ dir: DIR }, { frame: frame(), heightAt: () => Number.NaN }), NonFiniteElevationError)
  const resolved = resolveTarget({ dir: DIR }, { frame: frame(), heightAt: () => 0 })
  assert(resolved && Number.isFinite(resolved.x) && Number.isFinite(resolved.z), 'control: finite ground resolves')
})

gate('the refusal is a RangeError, so a generic catch on RangeError still sees it', () => {
  const error = new NonFiniteElevationError('bisect', 12)
  assert(error instanceof RangeError, 'not a RangeError')
  same(error.phase, 'bisect', 'phase carried')
  same(error.distanceM, 12, 'distance carried')
})

finish()
