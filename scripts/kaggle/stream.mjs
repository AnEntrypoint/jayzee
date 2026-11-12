import { spawn } from 'node:child_process'
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const STREAM_STOP_MS = 5000
export const COLD_START_S = 100

const exitOf = (child) => new Promise((done) => (child.exitCode !== null || child.signalCode !== null ? done() : child.once('exit', done)))

export const startLogStream = ({ command, args, path, env = process.env, cwd = process.cwd() }) => {
  mkdirSync(dirname(path), { recursive: true })
  closeSync(openSync(path, 'w'))
  let child = null
  let starts = 0
  let stopped = false
  const partOf = (n) => path + '.' + n
  const sizeOf = (file) => (existsSync(file) ? statSync(file).size : 0)
  const fullest = () => {
    let best = 1
    for (let n = 2; n <= starts; n++) if (sizeOf(partOf(n)) > sizeOf(partOf(best))) best = n
    return partOf(best)
  }
  const publish = () => {
    if (sizeOf(fullest()) >= sizeOf(path)) copyFileSync(fullest(), path)
    return sizeOf(path)
  }
  const guard = spawn('sh', ['-c', 'while read -r pid; do last=$pid; done; kill "$last" 2>/dev/null'], { stdio: ['pipe', 'ignore', 'ignore'] })
  const start = () => {
    starts += 1
    const out = openSync(partOf(starts), 'w')
    child = spawn(command, args, { cwd, env, stdio: ['ignore', out, out] })
    closeSync(out)
    guard.stdin.write(child.pid + '\n')
  }
  start()
  const running = () => child.exitCode === null && child.signalCode === null
  return {
    pid: () => child.pid,
    guardPid: guard.pid,
    starts: () => starts,
    bytes: publish,
    keepRunning: () => {
      if (!stopped && !running()) start()
    },
    stop: async () => {
      stopped = true
      const pid = child.pid
      if (running()) child.kill('SIGTERM')
      const timer = setTimeout(() => running() && child.kill('SIGKILL'), STREAM_STOP_MS)
      await exitOf(child)
      clearTimeout(timer)
      guard.stdin.end()
      await exitOf(guard)
      const bytes = publish()
      for (let n = 1; n <= starts; n++) rmSync(partOf(n), { force: true })
      return { pid, guardPid: guard.pid, starts, bytes }
    },
  }
}

export const streamRows = (text) => {
  const rows = []
  for (const line of text.split('\n')) {
    const at = line.indexOf('ROW {')
    if (at < 0) continue
    const open = at + 4
    let close = line.lastIndexOf('}')
    while (close > open) {
      try {
        rows.push(JSON.parse(line.slice(open, close + 1).replaceAll('\\"', '"')))
        break
      } catch {
        close = line.lastIndexOf('}', close - 1)
      }
    }
  }
  return rows
}

export const coldStartOf = (rows, { bodies, workers }) => {
  const same = rows.filter((row) => Number.isFinite(row.maxMs) && row.bodies === bodies && row.workers === workers && row.warm !== false && (row.variant === 'base' || row.variant === 'reference'))
  const worst = (list) => list.map((row) => row.maxMs)
  const early = same.filter((row) => row.atS < COLD_START_S)
  const late = same.filter((row) => row.atS >= COLD_START_S)
  const most = (list) => (list.length === 0 ? null : Math.max(...worst(list)))
  const median = (list) => (list.length === 0 ? null : worst(list).sort((a, b) => a - b)[Math.floor(list.length / 2)])
  return { coldStartS: COLD_START_S, earlyRows: early.length, lateRows: late.length, earlyWorstMs: most(early), lateWorstMs: most(late), earlyMedianWorstMs: median(early), lateMedianWorstMs: median(late), earlyCounted: early.reduce((sum, row) => sum + (row.overBudget - (row.overBudgetHost ?? 0)), 0), lateCounted: late.reduce((sum, row) => sum + (row.overBudget - (row.overBudgetHost ?? 0)), 0) }
}

export const followsOf = (rows, { bodies, workers }) => {
  const groups = { afterOtherBuild: { rows: 0, counted: 0, worstMs: 0, rowsWithCounted: 0 }, afterSameBuild: { rows: 0, counted: 0, worstMs: 0, rowsWithCounted: 0 } }
  let before = null
  for (const row of rows) {
    const judged = Number.isFinite(row.maxMs) && row.bodies === bodies && row.workers === workers && row.warm !== false && (row.variant === 'base' || row.variant === 'reference')
    if (judged && before !== null) {
      const group = before === row.variant ? groups.afterSameBuild : groups.afterOtherBuild
      const counted = row.overBudget - (row.overBudgetHost ?? 0)
      group.rows += 1
      group.counted += counted
      group.rowsWithCounted += counted > 0 ? 1 : 0
      group.worstMs = Math.max(group.worstMs, row.maxMs)
    }
    before = row.variant === 'base' || row.variant === 'reference' ? row.variant : null
  }
  return groups
}

export const describeFollows = (groups) => 'rows of the gate configuration that ran straight after a row of the other build: ' + groups.afterOtherBuild.rows + ', ' + groups.afterOtherBuild.rowsWithCounted + ' with a counted tick over budget (' + groups.afterOtherBuild.counted + ' ticks, worst tick ' + groups.afterOtherBuild.worstMs + ' ms); straight after a row of the same build: ' + groups.afterSameBuild.rows + ', ' + groups.afterSameBuild.rowsWithCounted + ' with a counted tick (' + groups.afterSameBuild.counted + ' ticks, worst tick ' + groups.afterSameBuild.worstMs + ' ms)'

export const rowsOfResults = (results) => results.configs.filter((c) => c.kind === 'tick').map((c) => ({ atS: Number((c.startedAtEpochS - results.startedAtEpochS).toFixed(1)), role: c.role, variant: c.variant, knobs: c.knobs, bodies: c.bodies, workers: c.workers, warm: c.warm, activeMeanMs: c.activeMeanMs, maxMs: c.maxMs, overBudget: c.overBudget, overBudgetHost: c.overBudgetHost }))

export const describeColdStart = (cold) => 'rows of the gate configuration started in the first ' + cold.coldStartS + ' s of the session: ' + cold.earlyRows + ', worst tick ' + cold.earlyWorstMs + ' ms, median worst ' + cold.earlyMedianWorstMs + ' ms, ' + cold.earlyCounted + ' counted over budget; later rows: ' + cold.lateRows + ', worst tick ' + cold.lateWorstMs + ' ms, median worst ' + cold.lateMedianWorstMs + ' ms, ' + cold.lateCounted + ' counted over budget'

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [path, bodiesArg = '131072', workersArg = '4'] = process.argv.slice(2)
  if (!path) throw new TypeError('usage: node scripts/kaggle/stream.mjs <kaggle-stream.log> [bodies] [workers]')
  const rows = streamRows(readFileSync(path, 'utf8'))
  for (const row of rows) console.log(String(row.atS).padStart(7) + ' s  ' + String(row.role).padEnd(14) + String(row.variant ?? row.kind).padEnd(10) + String(row.knobs ?? '').padEnd(16) + ' mean ' + row.activeMeanMs + ' worst ' + row.maxMs + ' over ' + row.overBudget + ' host ' + row.overBudgetHost + (row.over && row.over.length ? ' ticks ' + row.over.map((tick) => tick[0] + ':' + tick[1] + (tick[2] ? 'h' : '')).join(' ') : ''))
  console.log('ROWS ' + rows.length)
  console.log('COLD ' + describeColdStart(coldStartOf(rows, { bodies: Number(bodiesArg), workers: Number(workersArg) })))
  console.log('FOLLOWS ' + describeFollows(followsOf(rows, { bodies: Number(bodiesArg), workers: Number(workersArg) })))
}
