import { EASINGS } from './easing.js'

const RELATIVE = /^\+=(-?\d+(?:\.\d+)?)$/

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value)

const positiveSeconds = (value, name) => {
  if (!isFiniteNumber(value) || value <= 0) throw new RangeError(name + ' must be a positive number of seconds')
  return value
}

const parseValue = (path, value, start) => {
  if (isFiniteNumber(value)) return value
  if (typeof value === 'string') {
    const match = RELATIVE.exec(value)
    if (!match) throw new RangeError('relative value for ' + path + ' must look like +=<number>, got ' + value)
    return start + Number(match[1])
  }
  if (Array.isArray(value)) throw new RangeError('waypoints for ' + path + ' have no documented timing in savi; refused as a scoped negative')
  throw new TypeError('keyframe for ' + path + ' must be a number, a +=<number> string or a segment object')
}

const parseSegment = (path, spec, start, defaults) => {
  if (spec && typeof spec === 'object' && !Array.isArray(spec) && 'value' in spec) {
    const duration = positiveSeconds(spec.duration ?? defaults.duration, 'duration for ' + path)
    const easing = spec.easing ?? defaults.easing
    if (!Object.prototype.hasOwnProperty.call(EASINGS, easing)) throw new RangeError('unknown easing ' + easing + ' for ' + path)
    return { to: parseValue(path, spec.value, start), duration, easing }
  }
  const duration = positiveSeconds(defaults.duration, 'duration for ' + path)
  if (!Object.prototype.hasOwnProperty.call(EASINGS, defaults.easing)) throw new RangeError('unknown easing ' + defaults.easing + ' for ' + path)
  return { to: parseValue(path, spec, start), duration, easing: defaults.easing }
}

export const createTween = ({ start, keyframes, opts = {} }) => {
  if (!start || typeof start !== 'object') throw new TypeError('start must map each dot path to its current value')
  if (!keyframes || typeof keyframes !== 'object') throw new TypeError('keyframes must map dot paths to values')
  if (opts.direction !== undefined && opts.direction !== 'normal') throw new RangeError('direction ' + opts.direction + ' has no documented timing in savi; refused as a scoped negative')
  if (opts.loop !== undefined && opts.loop !== false) throw new RangeError('loop has no documented count or timing in savi; refused as a scoped negative')
  const delay = opts.delay === undefined ? 0 : opts.delay
  if (!isFiniteNumber(delay) || delay < 0) throw new RangeError('delay must be zero or above, in seconds')
  const defaults = { duration: opts.duration, easing: opts.easing ?? 'linear' }
  const segments = {}
  for (const path of Object.keys(keyframes)) {
    if (!Object.prototype.hasOwnProperty.call(start, path)) throw new RangeError('no start value for ' + path)
    if (!isFiniteNumber(start[path])) throw new TypeError('start value for ' + path + ' must be a number')
    segments[path] = { from: start[path], ...parseSegment(path, keyframes[path], start[path], defaults) }
  }
  const total = Math.max(0, ...Object.values(segments).map((s) => s.duration)) + delay
  return {
    total,
    valueAt(seconds) {
      if (!isFiniteNumber(seconds) || seconds < 0) throw new RangeError('seconds must be zero or above')
      const out = {}
      for (const path of Object.keys(segments)) {
        const s = segments[path]
        const local = seconds - delay
        if (local <= 0) out[path] = s.from
        else if (local >= s.duration) out[path] = s.to
        else out[path] = s.from + (s.to - s.from) * EASINGS[s.easing](local / s.duration)
      }
      return out
    },
  }
}

export const TWEEN_NAME = 'animate'
