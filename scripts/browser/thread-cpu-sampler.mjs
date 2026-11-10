import { openSync, readdirSync, readFileSync, writeSync } from 'node:fs'
import { parsePressureTotal, parseSchedStat, processType } from './thread-sampling.mjs'

const [out, periodArg, profile] = process.argv.slice(2)
const period = Number(periodArg ?? 50)
const selfPid = process.pid
const renderers = new Map()
const seen = new Set()
const last = new Map()
const comms = new Map()
const files = {
  threads: openSync(out, 'a'),
  sched: openSync(out + '.sched', 'a'),
  ticks: openSync(out + '.ticks', 'a'),
}

const readOr = (path, fallback) => {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return fallback
  }
}

const pressureOr = (path) => {
  const text = readOr(path, null)
  return text === null ? -1 : parsePressureTotal(text)
}

const scan = () => {
  for (const name of readdirSync('/proc')) {
    if (!/^\d+$/.test(name) || seen.has(name)) continue
    seen.add(name)
    const pid = Number(name)
    if (pid === selfPid) continue
    const cmd = readOr('/proc/' + name + '/cmdline', '').split('\0').join(' ')
    const type = processType(cmd)
    if (type === 'renderer' && cmd.includes('--user-data-dir=' + profile)) renderers.set(pid, type)
  }
}

const sampleOnce = (ts) => {
  const began = Date.now()
  const self = parseSchedStat(readOr('/proc/' + selfPid + '/task/' + selfPid + '/schedstat', '0 0 0'))
  let threadText = ''
  let schedText = ''
  for (const [pid, type] of renderers) {
    const task = '/proc/' + pid + '/task/' + pid
    let sched
    try {
      sched = parseSchedStat(readFileSync(task + '/schedstat', 'utf8'))
    } catch {
      renderers.delete(pid)
      continue
    }
    const wchan = readOr(task + '/wchan', '0').trim() || '0'
    schedText += [ts, pid, sched.runNs, sched.waitNs, sched.slices, -1, -1, wchan].join(' ') + '\n'
    const jiffies = Math.floor(sched.runNs / 1e7)
    if (last.get(pid) === jiffies) continue
    last.set(pid, jiffies)
    if (!comms.has(pid)) comms.set(pid, readOr(task + '/comm', '?').trim())
    threadText += [ts, pid, type, pid, jiffies, comms.get(pid)].join(' ') + '\n'
  }
  const work = Date.now() - began
  writeSync(files.ticks, [ts, pressureOr('/sys/fs/cgroup/memory.pressure'), pressureOr('/sys/fs/cgroup/io.pressure'), self.runNs, self.waitNs, work].join(' ') + '\n')
  if (schedText !== '') writeSync(files.sched, schedText)
  if (threadText !== '') writeSync(files.threads, threadText)
}

let ticks = 0
scan()
setInterval(() => {
  if (ticks % 10 === 0) scan()
  ticks += 1
  sampleOnce(Date.now())
}, period)
