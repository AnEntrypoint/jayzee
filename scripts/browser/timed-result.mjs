import { readFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'

export const LOADAVG_PATH = '/proc/loadavg'

export function parseLoadavg(text) {
  const fields = String(text).trim().split(/\s+/)
  if (fields.length < 4) throw new TypeError('loadavg needs at least four fields, got ' + fields.length)
  const [one, five, fifteen] = fields.slice(0, 3).map(Number)
  const [runnable, threads] = fields[3].split('/').map(Number)
  if (![one, five, fifteen, runnable, threads].every(Number.isFinite)) throw new TypeError('loadavg has a field that is not a number')
  return { loadavg: [one, five, fifteen], runnable, threads }
}

export function stampLoad({ read = () => readFileSync(LOADAVG_PATH, 'utf8'), now = () => Date.now(), cpus = availableParallelism() } = {}) {
  return { wallMs: now(), cpus, ...parseLoadavg(read()) }
}

export function mergeLoad(result, before, after) {
  if (!before || !after) throw new TypeError('a timed result needs a load stamp before and after the run')
  return { ...result, load: { before, after } }
}
