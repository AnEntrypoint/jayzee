import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runRenderWitness } from './render-witness.mjs'

export const CONDITIONS = ['LIVE', 'PAUSED']
export const PAGE_QUERY = 'phase=10&tier=1024&timed=1'
export const MAX_PAUSED_BUSY = 0.2
export const PIN_SCAN_MS = 100
export const DEFAULT_DURATION_MS = 120000
const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const CGROUP_SAMPLER = new URL('./cgroup-sampler.mjs', import.meta.url).pathname
const THREAD_SAMPLER = new URL('./thread-cpu-sampler.mjs', import.meta.url).pathname
const PROFILE = join(ROOT, '.playwriter', 'browser-profile')
const PAGE_PORT = 8843
const SAMPLER_CPUS = '15'
const STOP_TRIES = 25
const STOP_STEP_MS = 40
const WINDOW_MS = 1000
const LABEL = /^[A-Za-z0-9._-]+$/
const delay = (ms) => new Promise((done) => setTimeout(done, ms))
const exited = (child) => new Promise((done) => child.once('exit', done))

export const parseCpuList = (text) => {
  if (!/^\d+(-\d+)?(,\d+(-\d+)?)*$/.test(text)) throw new TypeError('a CPU list is ranges such as 0-7 or 0-3,8: ' + text)
  const cpus = new Set()
  for (const part of text.split(',')) {
    const [first, last = first] = part.split('-').map(Number)
    if (last < first) throw new TypeError('a CPU range runs backwards: ' + part)
    for (let cpu = first; cpu <= last; cpu += 1) cpus.add(cpu)
  }
  return [...cpus].sort((a, b) => a - b)
}

export const sameCpus = (listText, wanted) => {
  const a = parseCpuList(listText)
  const b = parseCpuList(wanted)
  return a.length === b.length && a.every((cpu, i) => cpu === b[i])
}

export const pinPlan = ({ condition, pin = '', pauseList = [], selfPid, parentPid }) => {
  if (!CONDITIONS.includes(condition)) throw new TypeError('condition must be LIVE or PAUSED: ' + condition)
  if (pin !== '') parseCpuList(pin)
  if (!Array.isArray(pauseList) || pauseList.some((pid) => !Number.isInteger(pid) || pid < 2)) throw new TypeError('the pause list is whole pids above 1')
  if (new Set(pauseList).size !== pauseList.length) throw new TypeError('the pause list repeats a pid')
  if (pauseList.includes(selfPid) || pauseList.includes(parentPid)) throw new TypeError('refusing to pause this job or its parent')
  if (condition === 'PAUSED' && pauseList.length === 0) throw new TypeError('PAUSED needs the pids to pause')
  if (condition === 'LIVE' && pauseList.length > 0) throw new TypeError('LIVE pauses nothing')
  return { condition, pin: pin === '' ? null : pin, pauseList: [...pauseList] }
}

export const parseStatState = (text) => {
  const at = String(text).lastIndexOf(')')
  if (at < 0) throw new TypeError('stat text has no closing parenthesis')
  const state = String(text).slice(at + 2).split(' ')[0]
  if (!/^[A-Za-z]$/.test(state)) throw new TypeError('stat text has no state letter')
  return state
}

export const parseAllowedList = (text) => {
  const line = String(text).split('\n').find((row) => row.startsWith('Cpus_allowed_list:'))
  if (line === undefined) throw new TypeError('status text has no Cpus_allowed_list')
  return line.slice('Cpus_allowed_list:'.length).trim()
}

export const isProfileRenderer = (cmdline, profile) => cmdline.includes('--type=renderer') && cmdline.includes('--user-data-dir=' + profile)

export const parseProcStatCpu = (text) => {
  const row = String(text).split('\n').find((line) => line.startsWith('cpu '))
  if (row === undefined) throw new TypeError('proc stat has no aggregate cpu row')
  const values = row.trim().split(/\s+/).slice(1, 9).map(Number)
  if (values.length < 8 || !values.every(Number.isFinite)) throw new TypeError('the cpu row needs eight numbers')
  const total = values.reduce((sum, value) => sum + value, 0)
  return { busy: total - values[3] - values[4], total }
}

export const busyShare = (before, after) => {
  const total = after.total - before.total
  if (!(total > 0)) throw new RangeError('no CPU time between the two reads')
  return (after.busy - before.busy) / total
}

const readText = (path) => {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

const stateOf = (pid) => {
  const text = readText('/proc/' + pid + '/stat')
  return text === null ? null : parseStatState(text)
}

const cmdlineOf = (pid) => {
  const text = readText('/proc/' + pid + '/cmdline')
  return text === null ? null : text.split('\0').join(' ')
}

const allowedOf = (pid) => {
  let tids
  try {
    tids = readdirSync('/proc/' + pid + '/task')
  } catch {
    return []
  }
  return tids.map((tid) => {
    const text = readText('/proc/' + pid + '/task/' + tid + '/status')
    return text === null ? null : parseAllowedList(text)
  }).filter((list) => list !== null)
}

const renderersOf = () => readdirSync('/proc').filter((name) => /^\d+$/.test(name)).map(Number).filter((pid) => {
  const cmd = cmdlineOf(pid)
  return cmd !== null && isProfileRenderer(cmd, PROFILE)
})

const stopOne = async (pid) => {
  const stateBefore = stateOf(pid)
  if (stateBefore === null || stateBefore === 'T') return { pid, stateBefore, stopped: false, stateAfter: stateBefore }
  try {
    process.kill(pid, 'SIGSTOP')
  } catch {
    return { pid, stateBefore, stopped: false, stateAfter: stateOf(pid) }
  }
  for (let i = 0; i < STOP_TRIES && stateOf(pid) !== 'T'; i += 1) await delay(STOP_STEP_MS)
  return { pid, stateBefore, stopped: true, stateAfter: stateOf(pid) }
}

const resumeOne = async (entry) => {
  if (!entry.stopped) return entry
  try {
    process.kill(entry.pid, 'SIGCONT')
  } catch {
    entry.stateResumed = null
    return entry
  }
  for (let i = 0; i < STOP_TRIES && stateOf(entry.pid) === 'T'; i += 1) await delay(STOP_STEP_MS)
  entry.stateResumed = stateOf(entry.pid)
  return entry
}

export async function runControlled({ label, round, condition, pin = '', pauseList = [], out, durationMs = DEFAULT_DURATION_MS, port = PAGE_PORT, query = PAGE_QUERY, root = ROOT }) {
  if (typeof label !== 'string' || !LABEL.test(label)) throw new TypeError('label must be letters, digits, dot, dash or underscore')
  if (!Number.isInteger(round) || round < 1) throw new TypeError('round must be a whole number from 1')
  if (typeof out !== 'string' || out === '') throw new TypeError('out must name a directory')
  if (!Number.isFinite(durationMs) || durationMs <= 0) throw new TypeError('duration must be a positive number of ms')
  const plan = pinPlan({ condition, pin, pauseList, selfPid: process.pid, parentPid: process.ppid })
  mkdirSync(out, { recursive: true })
  const base = join(out, label)
  const files = { cgroup: base + '.cgroup.txt', threads: base + '.threads.txt', page: base + '.page.json', run: base + '.run.json' }
  const paused = []
  const onSignal = (signal) => {
    for (const entry of paused) {
      if (entry.stopped) {
        try {
          process.kill(entry.pid, 'SIGCONT')
        } catch {
        }
      }
    }
    process.exit(signal === 'SIGINT' ? 130 : 143)
  }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)
  const loadBefore = readFileSync('/proc/loadavg', 'utf8').trim()
  let failure = null
  let externalBusy = null
  let startMs = null
  let endMs = null
  let page = null
  let pinned = null
  try {
    for (const pid of plan.pauseList) paused.push(await stopOne(pid))
    const cpuBefore = parseProcStatCpu(readFileSync('/proc/stat', 'utf8'))
    await delay(WINDOW_MS)
    externalBusy = busyShare(cpuBefore, parseProcStatCpu(readFileSync('/proc/stat', 'utf8')))
    if (plan.condition === 'PAUSED' && externalBusy > MAX_PAUSED_BUSY) throw new RangeError('host is busy with other work: ' + externalBusy.toFixed(3) + ' of CPU time after pausing, above ' + MAX_PAUSED_BUSY)
    startMs = Date.now()
    const cgroup = spawn('taskset', ['-c', SAMPLER_CPUS, process.execPath, CGROUP_SAMPLER, files.cgroup, String(durationMs), '2'], { stdio: 'ignore' })
    const threads = spawn('taskset', ['-c', SAMPLER_CPUS, process.execPath, THREAD_SAMPLER, files.threads, '50', PROFILE], { stdio: 'ignore' })
    const cgroupDone = exited(cgroup)
    const threadsDone = exited(threads)
    const selfCpus = parseAllowedList(readFileSync('/proc/self/status', 'utf8'))
    const pins = new Map()
    const pinTick = () => {
      for (const pid of renderersOf()) {
        if (pins.has(pid)) continue
        const status = spawnSync('taskset', ['-a', '-p', '-c', plan.pin, String(pid)], { encoding: 'utf8' })
        pins.set(pid, { exitStatus: status.status, afterPin: allowedOf(pid) })
      }
    }
    const pinTimer = plan.pin === null ? null : setInterval(pinTick, PIN_SCAN_MS)
    const witness = await runRenderWitness({ root, port, query })
    endMs = Date.now()
    if (pinTimer !== null) clearInterval(pinTimer)
    page = witness.result ?? { error: witness.error ?? 'the page returned no result', errors: witness.errors ?? [] }
    writeFileSync(files.page, JSON.stringify(page, null, 1) + '\n')
    if (plan.pin !== null) {
      pinned = [...pins.keys()].filter((pid) => stateOf(pid) !== null).map((pid) => {
        const entry = pins.get(pid)
        const atEnd = allowedOf(pid)
        spawnSync('taskset', ['-a', '-p', '-c', selfCpus, String(pid)])
        return { pid, exitStatus: entry.exitStatus, afterPin: entry.afterPin, atEnd }
      })
    }
    cgroup.kill('SIGTERM')
    threads.kill('SIGTERM')
    await cgroupDone
    await threadsDone
  } catch (error) {
    failure = error
  } finally {
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
    for (const entry of paused) await resumeOne(entry)
  }
  if (failure !== null) throw failure
  const pinApplied = pinned === null ? null : pinned.length > 0 && pinned.every((entry) => entry.exitStatus === 0 && entry.afterPin.length > 0 && entry.afterPin.every((list) => sameCpus(list, plan.pin)) && entry.atEnd.every((list) => sameCpus(list, plan.pin)))
  const run = {
    label, round, condition: plan.condition, pin: plan.pin, pauseList: plan.pauseList, paused,
    externalBusy: { windowMs: WINDOW_MS, share: externalBusy }, loadBefore,
    loadAfter: readFileSync('/proc/loadavg', 'utf8').trim(), window: { startMs, endMs },
    files: { cgroup: basename(files.cgroup), threads: basename(files.threads), page: basename(files.page) },
    pinned, pinApplied, page: { error: page.error ?? null, frames: Array.isArray(page.rows) ? page.rows.length : 0 },
  }
  writeFileSync(files.run, JSON.stringify(run, null, 2) + '\n')
  return run
}

export const parseFlags = (argv) => Object.fromEntries(argv.map((arg) => {
  const match = /^--([a-z]+)=(.*)$/.exec(arg)
  if (match === null) throw new TypeError('expected --name=value, got ' + arg)
  return [match[1], match[2]]
}))

if (process.argv[1] && process.argv[1].endsWith('/browser/controlled-run.mjs')) {
  const flags = parseFlags(process.argv.slice(2))
  try {
    const run = await runControlled({
      label: flags.label,
      round: Number(flags.round),
      condition: flags.condition,
      pin: flags.pin ?? '',
      pauseList: flags.pause ? flags.pause.split(',').map(Number) : [],
      out: flags.out,
      durationMs: Number(flags.duration ?? DEFAULT_DURATION_MS),
      port: Number(flags.port ?? PAGE_PORT),
      query: flags.query ?? PAGE_QUERY,
    })
    console.log(JSON.stringify({ label: run.label, condition: run.condition, pin: run.pin, externalBusy: run.externalBusy.share, pinApplied: run.pinApplied, page: run.page }))
    if (run.page.error !== null) process.exitCode = 1
  } catch (error) {
    console.error(error.message)
    process.exitCode = 2
  }
}
