import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { availableParallelism } from 'node:os'

export const LOADAVG_PATH = '/proc/loadavg'
export const CPU_DIR = '/sys/devices/system/cpu'
export const NVIDIA_SMI_QUERY = ['--query-gpu=utilization.gpu,power.draw,clocks.sm,temperature.gpu', '--format=csv,noheader,nounits']

export function parseLoadavg(text) {
  const fields = String(text).trim().split(/\s+/)
  if (fields.length < 4) throw new TypeError('loadavg needs at least four fields, got ' + fields.length)
  const [one, five, fifteen] = fields.slice(0, 3).map(Number)
  const [runnable, threads] = fields[3].split('/').map(Number)
  if (![one, five, fifteen, runnable, threads].every(Number.isFinite)) throw new TypeError('loadavg has a field that is not a number')
  return { loadavg: [one, five, fifteen], runnable, threads }
}

export function parseCpuFreqKhz(values) {
  const freqs = values.map((v) => Number(String(v).trim()))
  if (freqs.length === 0 || !freqs.every((v) => Number.isFinite(v) && v > 0)) return null
  return freqs.reduce((a, b) => a + b, 0) / freqs.length
}

export function readCpuFreqKhz(dir = CPU_DIR) {
  try {
    const cpus = readdirSync(dir).filter((name) => /^cpu\d+$/.test(name))
    const values = cpus.map((cpu) => readFileSync(dir + '/' + cpu + '/cpufreq/scaling_cur_freq', 'utf8'))
    return parseCpuFreqKhz(values)
  } catch {
    return null
  }
}

export function parseNvidiaSmi(text) {
  const fields = String(text).trim().split(',').map((v) => Number(v.trim()))
  if (fields.length !== 4 || !fields.every(Number.isFinite)) return null
  const [utilizationPct, powerW, smMHz, tempC] = fields
  return { utilizationPct, powerW, smMHz, tempC }
}

export function readGpu(run = () => execFileSync('nvidia-smi', NVIDIA_SMI_QUERY, { encoding: 'utf8', timeout: 5000 })) {
  try {
    return parseNvidiaSmi(run())
  } catch {
    return null
  }
}

export function stampLoad({ read = () => readFileSync(LOADAVG_PATH, 'utf8'), now = () => Date.now(), cpus = availableParallelism(), cpuFreq = readCpuFreqKhz, gpu = readGpu } = {}) {
  return { wallMs: now(), cpus, ...parseLoadavg(read()), cpuFreqKhz: cpuFreq(), gpu: gpu() }
}

export function mergeLoad(result, before, after) {
  if (!before || !after) throw new TypeError('a timed result needs a load stamp before and after the run')
  return { ...result, load: { before, after } }
}
