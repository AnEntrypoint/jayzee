import { appendFileSync, readdirSync, readFileSync } from 'node:fs'

const [out, periodArg, profile] = process.argv.slice(2)
const period = Number(periodArg ?? 50)
const pids = new Map()
const last = new Map()

const processType = (cmd) => {
  const match = /--type=([\w-]+)/.exec(cmd)
  return match ? match[1] : 'browser'
}

const scan = () => {
  pids.clear()
  for (const name of readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue
    let cmd
    try {
      cmd = readFileSync('/proc/' + name + '/cmdline', 'utf8').split('\0').join(' ')
    } catch {
      continue
    }
    if (Number(name) !== process.pid && cmd.includes('--user-data-dir=' + profile)) pids.set(Number(name), processType(cmd))
  }
}

const sampleOnce = (ts, tick) => {
  for (const [pid, type] of pids) {
    if (type !== 'renderer' && tick % 20 !== 0) continue
    let tids
    try {
      tids = readdirSync('/proc/' + pid + '/task')
    } catch {
      continue
    }
    for (const tid of tids) {
      let stat
      try {
        stat = readFileSync('/proc/' + pid + '/task/' + tid + '/stat', 'utf8')
      } catch {
        continue
      }
      const open = stat.indexOf('(')
      const close = stat.lastIndexOf(')')
      const comm = stat.slice(open + 1, close)
      const fields = stat.slice(close + 2).split(' ')
      const jiffies = Number(fields[11]) + Number(fields[12])
      if (last.get(tid) === jiffies) continue
      last.set(tid, jiffies)
      appendFileSync(out, ts + ' ' + pid + ' ' + type + ' ' + tid + ' ' + jiffies + ' ' + comm + '\n')
    }
  }
}

let ticks = 0
scan()
setInterval(() => {
  if (ticks % 100 === 0) scan()
  ticks += 1
  sampleOnce(Date.now(), ticks)
}, period)
