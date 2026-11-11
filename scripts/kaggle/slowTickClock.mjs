import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const SLOW_TICK_MS = 18
export const PERIOD_S = 10
export const NEAR_S = 0.75
export const MOST_ROWS_APART = 4
const BOOT_TICKS = 2
const round = (value) => Number(value.toFixed(2))

export const slowTickTimes = (results, slowMs = SLOW_TICK_MS) => {
  const events = []
  let rowStartS = 0
  results.configs.forEach((row, index) => {
    if (row.kind === 'tick' && Array.isArray(row.traceMs)) {
      const beforeLoopS = ((row.warmMs ?? 0) + (row.loadMs ?? 0) + (row.setupMs ?? 0)) / 1000
      let loopMs = 0
      row.traceMs.forEach((ms, tick) => {
        if (tick >= BOOT_TICKS && ms > slowMs) events.push({ row: index, tick, ms, atS: round(rowStartS + beforeLoopS + loopMs / 1000) })
        loopMs += ms
      })
    }
    rowStartS += row.runS ?? 0
  })
  return events
}

export const periodFit = (events, periodS = PERIOD_S, nearS = NEAR_S, mostRowsApart = MOST_ROWS_APART) => {
  const gaps = []
  for (let i = 1; i < events.length; i++) {
    const gapS = events[i].atS - events[i - 1].atS
    if (events[i].row === events[i - 1].row && gapS < periodS / 2) continue
    if (events[i].row - events[i - 1].row > mostRowsApart) continue
    const periods = Math.max(1, Math.round(gapS / periodS))
    gaps.push({ fromRow: events[i - 1].row, toRow: events[i].row, gapS: round(gapS), periods, offS: round(gapS - periods * periodS) })
  }
  const near = gaps.filter((gap) => Math.abs(gap.offS) <= nearS).length
  return { periodS, nearS, gaps, near, chanceShare: round((2 * nearS) / periodS) }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const paths = process.argv.slice(2)
  if (paths.length === 0) throw new TypeError('usage: slowTickClock.mjs <results.json>...')
  for (const path of paths) {
    const results = JSON.parse(readFileSync(resolve(path), 'utf8'))
    const events = slowTickTimes(results)
    const fit = periodFit(events)
    console.log('SLOW ' + JSON.stringify({ file: path, slowTicks: events.length, gapsJudged: fit.gaps.length, nearAMultipleOfPeriod: fit.near, periodS: fit.periodS, nearS: fit.nearS, shareExpectedByChance: fit.chanceShare }))
    for (const gap of fit.gaps) console.log('GAP ' + JSON.stringify(gap))
  }
}
