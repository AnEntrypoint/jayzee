import { spawn } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'

const argv = process.argv.slice(2)
const split = argv.indexOf('--')
if (split < 0 || split === argv.length - 1) throw new TypeError('usage: measure-memory.mjs [--match <text>] [--interval <ms>] -- <command> [args]')
const options = argv.slice(0, split)
const optionValue = (name, fallback) => (options.includes(name) ? options[options.indexOf(name) + 1] : fallback)
const match = optionValue('--match', null)
const intervalMs = Number(optionValue('--interval', '500'))
const SETTLE_MS = 1500
const TOP = 5
const MB = 1024 * 1024
const PAGE_BYTES = 4096

const readText = (path) => {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}
const processRows = () => {
  const rows = []
  for (const name of readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue
    const stat = readText('/proc/' + name + '/stat')
    if (stat === null) continue
    const close = stat.lastIndexOf(')')
    const fields = stat.slice(close + 2).split(' ')
    rows.push({ pid: Number(name), comm: stat.slice(stat.indexOf('(') + 1, close), ppid: Number(fields[1]), session: Number(fields[3]), start: fields[19] })
  }
  return rows
}
const heldBytes = (pid) => {
  const rollup = readText('/proc/' + pid + '/smaps_rollup')
  const pss = rollup === null ? null : /^Pss:\s+(\d+) kB/m.exec(rollup)
  if (pss) return Number(pss[1]) * 1024
  const statm = readText('/proc/' + pid + '/statm')
  return statm === null ? 0 : Number(statm.split(' ')[1]) * PAGE_BYTES
}
const argsOf = (pid) => (readText('/proc/' + pid + '/cmdline') ?? '').split('\0').join(' ').trim()
const round = (bytes) => Number((bytes / MB).toFixed(1))

const started = performance.now()
const child = spawn(argv[split + 1], argv.slice(split + 2), { stdio: 'inherit', detached: true })
const tracked = new Map([[child.pid, null]])
const matchedBefore = match === null ? new Set() : new Set(processRows().filter((row) => argsOf(row.pid).includes(match)).map((row) => row.pid))
const peak = { treeBytes: 0, atS: 0, top: [], processes: 0, matchedBytes: 0, matchedProcesses: 0 }

const sample = () => {
  const rows = processRows()
  let grew = true
  while (grew) {
    grew = false
    for (const row of rows) {
      if (!tracked.has(row.pid) && row.session === child.pid) {
        tracked.set(row.pid, row.start)
        grew = true
      } else if (!tracked.has(row.pid) && tracked.has(row.ppid) && (tracked.get(row.ppid) === null || rows.some((parent) => parent.pid === row.ppid && parent.start === tracked.get(row.ppid)))) {
        tracked.set(row.pid, row.start)
        grew = true
      }
    }
  }
  const alive = rows.filter((row) => tracked.has(row.pid) && (tracked.get(row.pid) === null || tracked.get(row.pid) === row.start))
  const held = alive.map((row) => ({ pid: row.pid, comm: row.comm, bytes: heldBytes(row.pid) }))
  const treeBytes = held.reduce((sum, row) => sum + row.bytes, 0)
  if (treeBytes > peak.treeBytes) {
    peak.treeBytes = treeBytes
    peak.atS = Number(((performance.now() - started) / 1000).toFixed(1))
    peak.processes = held.length
    peak.top = held.sort((a, b) => b.bytes - a.bytes).slice(0, TOP).map((row) => ({ pid: row.pid, comm: row.comm, mb: round(row.bytes) }))
  }
  if (match !== null) {
    const matched = rows.filter((row) => argsOf(row.pid).includes(match) && row.pid !== process.pid)
    const matchedBytes = matched.reduce((sum, row) => sum + heldBytes(row.pid), 0)
    if (matchedBytes > peak.matchedBytes) {
      peak.matchedBytes = matchedBytes
      peak.matchedProcesses = matched.length
    }
  }
  return alive
}

const timer = setInterval(sample, intervalMs)
sample()
child.on('exit', (code, signal) => {
  clearInterval(timer)
  const wallS = Number(((performance.now() - started) / 1000).toFixed(1))
  setTimeout(() => {
    const survivors = sample().filter((row) => row.pid !== child.pid).map((row) => ({ pid: row.pid, comm: row.comm, mb: round(heldBytes(row.pid)), args: argsOf(row.pid).slice(0, 160) }))
    const matchedAfter = match === null ? [] : processRows().filter((row) => argsOf(row.pid).includes(match) && row.pid !== process.pid)
    console.log('MEMORY ' + JSON.stringify({
      command: argv.slice(split + 1).join(' ').slice(0, 200),
      exitCode: code,
      signal,
      wallS,
      peakTreeMb: round(peak.treeBytes),
      peakAtS: peak.atS,
      peakProcesses: peak.processes,
      peakTop: peak.top,
      survivors,
      matched: match === null ? null : { text: match, runningBefore: matchedBefore.size, peakMb: round(peak.matchedBytes), peakProcesses: peak.matchedProcesses, runningAfter: matchedAfter.length, afterMb: round(matchedAfter.reduce((sum, row) => sum + heldBytes(row.pid), 0)), startedByThisCommand: matchedAfter.filter((row) => !matchedBefore.has(row.pid)).length },
    }))
    process.exit(code ?? 1)
  }, SETTLE_MS)
})
