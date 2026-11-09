import { appendFileSync, readdirSync, readFileSync } from 'node:fs'
import { parsePressureTotal, parseSchedStat, parseStat, processType } from './thread-sampling.mjs'

const [out, periodArg, profile] = process.argv.slice(2)
const period = Number(periodArg ?? 50)
const renderers = new Map()
const last = new Map()
const selfPid = process.pid

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
  renderers.clear()
  for (const name of readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue
    let cmd
    try {
      cmd = readFileSync('/proc/' + name + '/cmdline', 'utf8').split('\0').join(' ')
    } catch {
      continue
    }
    const type = processType(cmd)
    if (Number(name) !== selfPid && type === 'renderer' && cmd.includes('--user-data-dir=' + profile)) renderers.set(Number(name), type)
  }
}

const sampleOnce = (ts) => {
  const self = parseSchedStat(readOr('/proc/' + selfPid + '/task/' + selfPid + '/schedstat', '0 0 0'))
  appendFileSync(out + '.ticks', [ts, pressureOr('/sys/fs/cgroup/memory.pressure'), pressureOr('/sys/fs/cgroup/io.pressure'), self.runNs, self.waitNs].join(' ') + '\n')
  for (const [pid, type] of renderers) {
    const task = '/proc/' + pid + '/task/' + pid
    let stat
    let sched
    try {
      stat = readFileSync(task + '/stat', 'utf8')
      sched = parseSchedStat(readFileSync(task + '/schedstat', 'utf8'))
    } catch {
      continue
    }
    const { comm, jiffies, minflt, majflt } = parseStat(stat)
    const wchan = readOr(task + '/wchan', '0').trim() || '0'
    appendFileSync(out + '.sched', [ts, pid, sched.runNs, sched.waitNs, sched.slices, minflt, majflt, wchan].join(' ') + '\n')
    if (last.get(pid) === jiffies) continue
    last.set(pid, jiffies)
    appendFileSync(out, ts + ' ' + pid + ' ' + type + ' ' + pid + ' ' + jiffies + ' ' + comm + '\n')
  }
}

let ticks = 0
scan()
setInterval(() => {
  if (ticks % 100 === 0) scan()
  ticks += 1
  sampleOnce(Date.now())
}, period)
