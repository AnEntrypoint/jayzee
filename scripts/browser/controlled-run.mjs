import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runRenderWitness } from './render-witness.mjs'

export const CONDITIONS = ['LIVE', 'PAUSED']
export const EXPERIMENTS = ['core-shared', 'core-separate', 'core-none']
export const PAGE_QUERY = 'phase=10&tier=1024&timed=1'
export const MAX_PAUSED_BUSY = 0.2
export const PIN_SCAN_MS = 100
export const DEFAULT_DURATION_MS = 120000
const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const CGROUP_SAMPLER = new URL('./cgroup-sampler.mjs', import.meta.url).pathname
const THREAD_SAMPLER = new URL('./thread-cpu-sampler.mjs', import.meta.url).pathname
const PROFILE = join(ROOT, '.playwriter', 'browser-profile')
const PAGE_PORT = 8843
const DEFAULT_SAMPLER_CPUS = '15'
const SYS_CPU = '/sys/devices/system/cpu'
const CLOCKSOURCE = '/sys/devices/system/clocksource/clocksource0/current_clocksource'
const STOP_TRIES = 25
const STOP_STEP_MS = 40
const WINDOW_MS = 1000
const LABEL = /^[A-Za-z0-9._-]+$/
const delay = (ms) => new Promise((done) => setTimeout(done, ms))
const exited = (child) => new Promise((done) => child.once('exit', done))
const ended = (child) => (child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : exited(child))

const readText = (path) => {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

export const readNumber = (path) => {
  const text = readText(path)
  if (text === null) return null
  const value = Number(text.trim())
  return Number.isFinite(value) ? value : null
}

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

export const parseStatState = (text) => {
  const at = String(text).lastIndexOf(')')
  if (at < 0) throw new TypeError('stat text has no closing parenthesis')
  const state = String(text).slice(at + 2).split(' ')[0]
  if (!/^[A-Za-z]$/.test(state)) throw new TypeError('stat text has no state letter')
  return state
}

export const parseProcessor = (text) => {
  const at = String(text).lastIndexOf(')')
  if (at < 0) throw new TypeError('stat text has no closing parenthesis')
  const cpu = Number(String(text).slice(at + 2).split(' ')[36])
  if (!Number.isInteger(cpu) || cpu < 0) throw new TypeError('stat text has no processor field')
  return cpu
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

export const readTopology = (root = SYS_CPU) => {
  let names
  try {
    names = readdirSync(root)
  } catch {
    return []
  }
  return names.filter((name) => /^cpu\d+$/.test(name)).map((name) => {
    const base = root + '/' + name + '/topology/'
    const core = readNumber(base + 'core_id')
    const pkg = readNumber(base + 'physical_package_id')
    return core === null || pkg === null ? null : { cpu: Number(name.slice(3)), core, pkg }
  }).filter((entry) => entry !== null).sort((a, b) => a.cpu - b.cpu)
}

export const coreLayout = (cpus, mainCpu) => {
  const main = cpus.find((entry) => entry.cpu === Number(mainCpu))
  if (main === undefined) throw new TypeError('the main CPU ' + mainCpu + ' is not in the topology')
  const sameCoreEntries = cpus.filter((entry) => entry.cpu !== main.cpu && entry.pkg === main.pkg && entry.core === main.core)
  if (sameCoreEntries.length === 0) throw new RangeError('the main CPU ' + mainCpu + ' has no SMT sibling')
  const other = cpus.filter((entry) => entry.pkg !== main.pkg || entry.core !== main.core)
  const separate = other[0]
  if (separate === undefined) throw new RangeError('no CPU sits on another physical core')
  const third = other.find((entry) => entry.pkg !== separate.pkg || entry.core !== separate.core)
  if (third === undefined) throw new RangeError('the host has fewer than three physical cores')
  return { main: main.cpu, mainCore: main.core, sameCore: sameCoreEntries[0].cpu, separateCore: separate.cpu, separateCoreId: separate.core, thirdCore: third.cpu }
}

export const experimentSettings = (experiment, layout) => {
  if (experiment === null) return { mainCpu: '', burnWorkers: 0, burnCpus: '', samplerCpus: '' }
  if (!EXPERIMENTS.includes(experiment)) throw new TypeError('experiment must be one of ' + EXPERIMENTS.join(', ') + ': ' + experiment)
  const main = String(layout.main)
  if (experiment === 'core-shared') return { mainCpu: main, burnWorkers: 1, burnCpus: String(layout.sameCore), samplerCpus: String(layout.sameCore) }
  if (experiment === 'core-separate') return { mainCpu: main, burnWorkers: 1, burnCpus: String(layout.thirdCore), samplerCpus: String(layout.separateCore) }
  return { mainCpu: main, burnWorkers: 0, burnCpus: '', samplerCpus: String(layout.separateCore) }
}

export const readClockState = (cpus) => ({
  clocksource: readText(CLOCKSOURCE)?.trim() ?? null,
  cpus: cpus.map((cpu) => ({
    cpu,
    governor: readText(SYS_CPU + '/cpu' + cpu + '/cpufreq/scaling_governor')?.trim() ?? null,
    kHz: readNumber(SYS_CPU + '/cpu' + cpu + '/cpufreq/scaling_cur_freq'),
  })),
})

export const pinPlan = ({ condition, pin = '', pauseList = [], selfPid, parentPid, experiment = null, mainCpu = '', burnWorkers = 0, burnCpus = '', samplerCpus = '' }) => {
  if (!CONDITIONS.includes(condition)) throw new TypeError('condition must be LIVE or PAUSED: ' + condition)
  if (pin !== '') parseCpuList(pin)
  if (!Array.isArray(pauseList) || pauseList.some((pid) => !Number.isInteger(pid) || pid < 2)) throw new TypeError('the pause list is whole pids above 1')
  if (new Set(pauseList).size !== pauseList.length) throw new TypeError('the pause list repeats a pid')
  if (pauseList.includes(selfPid) || pauseList.includes(parentPid)) throw new TypeError('refusing to pause this job or its parent')
  if (condition === 'PAUSED' && pauseList.length === 0) throw new TypeError('PAUSED needs the pids to pause')
  if (condition === 'LIVE' && pauseList.length > 0) throw new TypeError('LIVE pauses nothing')
  if (experiment !== null && !EXPERIMENTS.includes(experiment)) throw new TypeError('experiment must be one of ' + EXPERIMENTS.join(', ') + ': ' + experiment)
  if (mainCpu !== '' && !/^\d+$/.test(mainCpu)) throw new TypeError('mainCpu is one CPU number: ' + mainCpu)
  if (mainCpu !== '' && pin !== '') throw new TypeError('mainCpu pins only the main thread, so it cannot be combined with pin')
  if (!Number.isInteger(burnWorkers) || burnWorkers < 0) throw new TypeError('burnWorkers is a whole number from 0')
  if (burnWorkers > 0 && burnCpus === '') throw new TypeError('burnWorkers needs burnCpus')
  if (burnCpus !== '') parseCpuList(burnCpus)
  if (samplerCpus !== '') parseCpuList(samplerCpus)
  return {
    condition, pin: pin === '' ? null : pin, pauseList: [...pauseList], experiment,
    mainCpu: mainCpu === '' ? null : mainCpu, burnWorkers, burnCpus: burnCpus === '' ? null : burnCpus, samplerCpus: samplerCpus === '' ? null : samplerCpus,
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

const mainAllowedOf = (pid) => {
  const text = readText('/proc/' + pid + '/task/' + pid + '/status')
  return text === null ? [] : [parseAllowedList(text)]
}

const renderersOf = () => readdirSync('/proc').filter((name) => /^\d+$/.test(name)).map(Number).filter((pid) => {
  const cmd = cmdlineOf(pid)
  return cmd !== null && isProfileRenderer(cmd, PROFILE)
})

const pinOnce = (plan, pins, pid) => {
  if (pins.has(pid)) return
  const all = plan.pin !== null
  const target = all ? plan.pin : plan.mainCpu
  const before = all ? allowedOf(pid) : mainAllowedOf(pid)
  const status = spawnSync('taskset', [...(all ? ['-a'] : []), '-p', '-c', target, String(pid)], { encoding: 'utf8' })
  const afterPin = all ? allowedOf(pid) : mainAllowedOf(pid)
  pins.set(pid, { mode: all ? 'all' : 'main', target, restore: before[0] ?? null, exitStatus: status.status, afterPin })
}

const scanRenderers = (plan, pins, clockRows) => {
  const t = Date.now()
  for (const pid of renderersOf()) {
    if (plan.pin !== null || plan.mainCpu !== null) pinOnce(plan, pins, pid)
    const text = readText('/proc/' + pid + '/task/' + pid + '/stat')
    if (text === null) continue
    const cpu = parseProcessor(text)
    clockRows.push(t + ' ' + pid + ' ' + cpu + ' ' + (readNumber(SYS_CPU + '/cpu' + cpu + '/cpufreq/scaling_cur_freq') ?? -1))
  }
}

const restorePins = (pins) => {
  for (const [pid, entry] of pins) {
    if (entry.restore === null || stateOf(pid) === null) continue
    spawnSync('taskset', [...(entry.mode === 'all' ? ['-a'] : []), '-p', '-c', entry.restore, String(pid)])
  }
}

export const pinOutcome = (pinned, expected) => {
  if (expected === null) return null
  const alive = pinned.filter((entry) => entry.atEnd.length > 0)
  return alive.length > 0 && alive.every((entry) => entry.exitStatus === 0 && entry.afterPin.length > 0 && entry.afterPin.every((list) => sameCpus(list, expected)) && entry.atEnd.every((list) => sameCpus(list, expected)))
}

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

export async function runControlled({ label, round, condition, pin = '', pauseList = [], out, durationMs = DEFAULT_DURATION_MS, port = PAGE_PORT, query = PAGE_QUERY, root = ROOT, experiment = null, main = '0' }) {
  if (typeof label !== 'string' || !LABEL.test(label)) throw new TypeError('label must be letters, digits, dot, dash or underscore')
  if (!Number.isInteger(round) || round < 1) throw new TypeError('round must be a whole number from 1')
  if (typeof out !== 'string' || out === '') throw new TypeError('out must name a directory')
  if (!Number.isFinite(durationMs) || durationMs <= 0) throw new TypeError('duration must be a positive number of ms')
  if (experiment !== null && !EXPERIMENTS.includes(experiment)) throw new TypeError('unknown experiment: ' + experiment)
  pinPlan({ condition, pin, pauseList, selfPid: process.pid, parentPid: process.ppid, experiment: null })
  const layout = experiment === null ? null : coreLayout(readTopology(), main)
  const settings = experimentSettings(experiment, layout)
  const plan = pinPlan({ condition, pin, pauseList, selfPid: process.pid, parentPid: process.ppid, experiment, ...settings })
  mkdirSync(out, { recursive: true })
  const base = join(out, label)
  const files = { cgroup: base + '.cgroup.txt', threads: base + '.threads.txt', page: base + '.page.json', clock: base + '.clock.txt', run: base + '.run.json' }
  const cpus = readTopology().map((entry) => entry.cpu)
  const samplerCpus = plan.samplerCpus ?? DEFAULT_SAMPLER_CPUS
  const paused = []
  const pins = new Map()
  const clockRows = []
  const burnChildren = []
  const samplers = []
  let scanTimer = null
  let failure = null
  const stopAll = () => {
    if (scanTimer !== null) clearInterval(scanTimer)
    scanTimer = null
    for (const child of [...burnChildren, ...samplers]) {
      try {
        child.kill('SIGTERM')
      } catch {
      }
    }
    restorePins(pins)
  }
  const continueSync = () => {
    for (const entry of paused) {
      if (!entry.stopped) continue
      try {
        process.kill(entry.pid, 'SIGCONT')
      } catch {
      }
    }
  }
  const onSignal = (signal) => {
    stopAll()
    continueSync()
    process.exit(signal === 'SIGINT' ? 130 : 143)
  }
  const loadBefore = readFileSync('/proc/loadavg', 'utf8').trim()
  let externalBusy = null
  let startMs = null
  let endMs = null
  let clockStart = null
  let clockEnd = null
  let burn = null
  let page = null
  let pinned = []
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)
  try {
    for (const pid of plan.pauseList) paused.push(await stopOne(pid))
    const cpuBefore = parseProcStatCpu(readFileSync('/proc/stat', 'utf8'))
    await delay(WINDOW_MS)
    externalBusy = busyShare(cpuBefore, parseProcStatCpu(readFileSync('/proc/stat', 'utf8')))
    if (plan.condition === 'PAUSED' && externalBusy > MAX_PAUSED_BUSY) throw new RangeError('host is busy with other work: ' + externalBusy.toFixed(3) + ' of CPU time after pausing, above ' + MAX_PAUSED_BUSY)
    clockStart = readClockState(cpus)
    startMs = Date.now()
    samplers.push(spawn('taskset', ['-c', samplerCpus, process.execPath, CGROUP_SAMPLER, files.cgroup, String(durationMs), '2'], { stdio: 'ignore' }))
    samplers.push(spawn('taskset', ['-c', samplerCpus, process.execPath, THREAD_SAMPLER, files.threads, '50', PROFILE], { stdio: 'ignore' }))
    const samplerDone = samplers.map(ended)
    scanTimer = setInterval(() => scanRenderers(plan, pins, clockRows), PIN_SCAN_MS)
    for (let i = 0; i < plan.burnWorkers; i += 1) burnChildren.push(spawn('taskset', ['-c', plan.burnCpus, process.execPath, '-e', 'while (true);'], { stdio: 'ignore' }))
    const witness = await runRenderWitness({ root, port, query })
    endMs = Date.now()
    clearInterval(scanTimer)
    scanTimer = null
    burn = { workers: plan.burnWorkers, cpus: plan.burnCpus, pids: burnChildren.map((child) => child.pid) }
    for (const child of burnChildren) child.kill('SIGTERM')
    await Promise.all(burnChildren.map(ended))
    clockEnd = readClockState(cpus)
    page = witness.result ?? { error: witness.error ?? 'the page returned no result' }
    writeFileSync(files.page, JSON.stringify(page, null, 1) + '\n')
    writeFileSync(files.clock, clockRows.length === 0 ? '' : clockRows.join('\n') + '\n')
    pinned = [...pins].map(([pid, entry]) => ({ pid, mode: entry.mode, target: entry.target, exitStatus: entry.exitStatus, afterPin: entry.afterPin, atEnd: entry.mode === 'all' ? allowedOf(pid) : mainAllowedOf(pid) }))
    for (const child of samplers) child.kill('SIGTERM')
    await Promise.all(samplerDone)
  } catch (error) {
    failure = error
  } finally {
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
    stopAll()
    for (const entry of paused) await resumeOne(entry)
  }
  if (failure !== null) throw failure
  const expected = plan.pin ?? plan.mainCpu
  const pinApplied = pinOutcome(pinned, expected)
  const run = {
    label, round, experiment, layout, condition: plan.condition, pin: plan.pin, mainCpu: plan.mainCpu, pauseList: plan.pauseList, paused,
    externalBusy: { windowMs: WINDOW_MS, share: externalBusy }, loadBefore,
    loadAfter: readFileSync('/proc/loadavg', 'utf8').trim(), window: { startMs, endMs },
    files: { cgroup: basename(files.cgroup), threads: basename(files.threads), page: basename(files.page), clock: basename(files.clock) },
    burn, pinned, pinApplied,
    clock: { start: clockStart, end: clockEnd, samples: clockRows.length },
    page: { error: page.error ?? null, frames: Array.isArray(page.rows) ? page.rows.length : 0 },
  }
  writeFileSync(files.run, JSON.stringify(run, null, 2) + '\n')
  return run
}

export const parseFlags = (argv) => Object.fromEntries(argv.map((arg) => {
  const match = /^--([a-z]+)=(.*)$/.exec(arg)
  if (match === null) throw new TypeError('expected --name=value, got ' + arg)
  return [match[1], match[2]]
}))

export const coreFlagValues = (flags) => ({
  experiment: flags.experiment === undefined || flags.experiment === '' ? null : flags.experiment,
  main: flags.main ?? '0',
})

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
      ...coreFlagValues(flags),
    })
    console.log(JSON.stringify({ label: run.label, condition: run.condition, experiment: run.experiment, pin: run.pin, mainCpu: run.mainCpu, externalBusy: run.externalBusy.share, pinApplied: run.pinApplied, page: run.page }))
    if (run.page.error !== null) process.exitCode = 1
  } catch (error) {
    console.error(error.message)
    process.exitCode = 2
  }
}
