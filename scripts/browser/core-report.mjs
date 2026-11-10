import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { framesFromResult } from './stall-attribution.mjs'
import { parseThreadLog } from './stall-probe.mjs'
import { EXPERIMENTS } from './controlled-run.mjs'
import { analyseDir, median } from './controlled-report.mjs'

export const CLOCK_PAD_MS = 100
export const CLUSTER_RATIO = 2
export const NO_CLUSTER_RATIO = 1.5
export const MIN_STALLS = 3
export const MIN_RUNS = 3

const sum = (values) => values.reduce((total, value) => total + value, 0)

export const parseClockLog = (text) => String(text).split('\n').filter((line) => line !== '').map((line) => {
  const parts = line.split(' ').map(Number)
  if (parts.length !== 4 || !parts.every(Number.isFinite)) throw new TypeError('clock line needs t pid cpu kHz: ' + line)
  const [t, pid, cpu, kHz] = parts
  return { t, pid, cpu, kHz }
})

export const frequencyChanges = (rows, pid) => {
  const mine = rows.filter((row) => row.pid === pid && row.kHz > 0).sort((a, b) => a.t - b.t)
  const changes = []
  for (let i = 1; i < mine.length; i += 1) {
    if (mine[i].kHz !== mine[i - 1].kHz) changes.push(mine[i].t)
  }
  return changes
}

const within = (times, startMs, endMs, pad) => times.some((t) => t >= startMs - pad && t <= endMs + pad)

export const clusterStats = ({ stallWindows, frameWindows, changes, pad = CLOCK_PAD_MS }) => {
  const stallsNear = stallWindows.filter((w) => within(changes, w.startMs, w.startMs + w.totalMs, pad)).length
  const framesNear = frameWindows.filter((w) => within(changes, w.startMs, w.startMs + w.totalMs, pad)).length
  const stallShare = stallWindows.length ? stallsNear / stallWindows.length : null
  const frameShare = frameWindows.length ? framesNear / frameWindows.length : null
  return {
    stalls: stallWindows.length, stallsNear, frames: frameWindows.length, framesNear, changes: changes.length,
    stallShare, frameShare, ratio: stallShare !== null && frameShare > 0 ? stallShare / frameShare : null,
  }
}

export const clockDuringStalls = (rows, pid, stallWindows) => {
  const mine = rows.filter((row) => row.pid === pid && row.kHz > 0)
  const inStalls = mine.filter((row) => stallWindows.some((w) => row.t >= w.startMs && row.t <= w.startMs + w.totalMs)).map((row) => row.kHz)
  const stallMedianKHz = median(inStalls)
  const runMedianKHz = median(mine.map((row) => row.kHz))
  return { stallMedianKHz, runMedianKHz, lower: stallMedianKHz !== null && runMedianKHz !== null ? stallMedianKHz < runMedianKHz : null }
}

export const clockRunStats = ({ analysis, page, clockRows }) => {
  const frameWindows = framesFromResult(page).map((frame) => ({ startMs: frame.startMs, totalMs: frame.totalMs }))
  const changes = frequencyChanges(clockRows, analysis.rendererPid)
  return { ...clusterStats({ stallWindows: analysis.stallWindows, frameWindows, changes }), ...clockDuringStalls(clockRows, analysis.rendererPid, analysis.stallWindows) }
}

const stallsAt = (rows, round) => sum(rows.filter((r) => r.round === round).map((r) => r.stallCount))

export const sharedCoreVerdict = (runs) => {
  const shared = runs.filter((r) => r.experiment === 'core-shared' && r.valid)
  const separate = runs.filter((r) => r.experiment === 'core-separate' && r.valid)
  if (shared.length < MIN_RUNS || separate.length < MIN_RUNS) return 'insufficient: each arm needs ' + MIN_RUNS + ' valid runs'
  const sharedTotal = sum(shared.map((r) => r.stallCount))
  const separateTotal = sum(separate.map((r) => r.stallCount))
  const rounds = [...new Set(shared.map((r) => r.round))].filter((round) => separate.some((r) => r.round === round))
  const wins = rounds.filter((round) => stallsAt(shared, round) > stallsAt(separate, round)).length
  if (sharedTotal > separateTotal && wins >= 2) return 'supported: shared-core stall frames exceed separate-core in ' + wins + ' of ' + rounds.length + ' rounds'
  if (sharedTotal <= separateTotal) return 'not supported: shared-core ' + sharedTotal + ' stall frames, separate-core ' + separateTotal
  return 'inconclusive: shared-core exceeds separate-core in total, but in ' + wins + ' of ' + rounds.length + ' rounds'
}

export const clockVerdict = (runs) => {
  const stalls = sum(runs.map((r) => r.stalls))
  const near = sum(runs.map((r) => r.stallsNear))
  const frames = sum(runs.map((r) => r.frames))
  const framesNear = sum(runs.map((r) => r.framesNear))
  if (stalls < MIN_STALLS) return 'insufficient: ' + stalls + ' stall frames, needs ' + MIN_STALLS
  if (framesNear === 0) return 'inconclusive: no frame had a frequency change nearby'
  const ratio = (near / stalls) / (framesNear / frames)
  if (ratio >= CLUSTER_RATIO) return 'clusters on frequency changes'
  if (ratio < NO_CLUSTER_RATIO) return 'does not cluster on frequency changes'
  return 'inconclusive: ratio ' + ratio.toFixed(2)
}

export const clockDropVerdict = (runs) => {
  const withStalls = runs.filter((r) => r.stalls > 0 && r.lower !== null)
  if (withStalls.length < MIN_RUNS) return 'insufficient: ' + withStalls.length + ' runs with stalls, needs ' + MIN_RUNS
  const lower = withStalls.filter((r) => r.lower).length
  return lower * 3 >= withStalls.length * 2 ? 'stalls sit at a lower clock in most runs' : 'stalls do not sit at a lower clock in most runs'
}

export function reportCoreDir(dir) {
  const analyses = analyseDir(dir).filter((row) => row.experiment)
  const runs = analyses.map((analysis) => {
    if (!analysis.valid) return analysis
    const run = JSON.parse(readFileSync(join(dir, analysis.label + '.run.json'), 'utf8'))
    const page = JSON.parse(readFileSync(join(dir, run.files.page), 'utf8'))
    const clockRows = parseClockLog(readFileSync(join(dir, run.files.clock), 'utf8'))
    const { stallWindows, ...rest } = analysis
    return { ...rest, ...clockRunStats({ analysis, page, clockRows }) }
  })
  const valid = runs.filter((r) => r.valid)
  const experiments = Object.fromEntries(EXPERIMENTS.map((name) => {
    const rows = runs.filter((r) => r.experiment === name)
    const ok = rows.filter((r) => r.valid)
    return [name, {
      runs: rows.length,
      valid: ok.length,
      totalStalls: sum(ok.map((r) => r.stallCount)),
      perRound: ok.map((r) => ({ label: r.label, round: r.round, stallCount: r.stallCount, stallMs: r.stallMs, waitShare: r.waitShare, medianMs: r.medianMs, p99Ms: r.p99Ms, stallMedianKHz: r.stallMedianKHz, runMedianKHz: r.runMedianKHz, lower: r.lower, changes: r.changes, stallsNear: r.stallsNear, framesNear: r.framesNear })),
    }]
  }))
  return {
    experiments,
    verdicts: { sharedCore: sharedCoreVerdict(runs), clusterOnChanges: clockVerdict(valid), stallsAtLowerClock: clockDropVerdict(valid) },
    runs,
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [dir, outPath = ''] = process.argv.slice(2)
  if (!dir) throw new TypeError('usage: node scripts/browser/core-report.mjs <dir> [out.json]')
  const report = reportCoreDir(dir)
  const text = JSON.stringify(report, null, 1) + '\n'
  if (outPath !== '') writeFileSync(outPath, text)
  console.log(text)
}
