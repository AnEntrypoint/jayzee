import { appendFileSync, readdirSync, readFileSync } from 'node:fs'
import { parseStat, processType } from './thread-sampling.mjs'

const [out, periodArg, profile] = process.argv.slice(2)
const period = Number(periodArg ?? 50)
const renderers = new Map()
const last = new Map()

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
    if (Number(name) !== process.pid && type === 'renderer' && cmd.includes('--user-data-dir=' + profile)) renderers.set(Number(name), type)
  }
}

const sampleOnce = (ts) => {
  appendFileSync(out + '.ticks', ts + '\n')
  for (const [pid, type] of renderers) {
    let stat
    try {
      stat = readFileSync('/proc/' + pid + '/stat', 'utf8')
    } catch {
      continue
    }
    const { comm, jiffies } = parseStat(stat)
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
