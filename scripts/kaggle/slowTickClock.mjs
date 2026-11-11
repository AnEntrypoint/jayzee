import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const SLOW_TICK_MS = 18
export const PERIOD_S = 10
export const NEAR_S = 0.75
export const MOST_ROWS_APART = 4
const BOOT_TICKS = 2
const round = (value) => Number(value.toFixed(2))

export const CANARY_STALL_MS = 4
export const SEEN_WAIT_MS = 1

export const slowTickTimes = (results, slowMs = SLOW_TICK_MS) => {
  const events = []
  const originS = results.startedAtEpochS ?? 0
  let rowStartS = 0
  results.configs.forEach((row, index) => {
    if (row.kind === 'tick' && Array.isArray(row.traceMs)) {
      const stamped = Number.isFinite(row.loopStartedEpochMs)
      const loopStartS = stamped ? row.loopStartedEpochMs / 1000 - originS : rowStartS + ((row.warmMs ?? 0) + (row.loadMs ?? 0) + (row.setupMs ?? 0)) / 1000
      let loopMs = 0
      row.traceMs.forEach((ms, tick) => {
        if (tick >= BOOT_TICKS && ms > slowMs) events.push({ row: index, tick, ms, atS: round(loopStartS + loopMs / 1000), clock: stamped ? 'stamped' : 'estimated' })
        loopMs += ms
      })
    }
    rowStartS += row.runS ?? 0
  })
  return events
}

export const canaryStalls = (results, stallMs = CANARY_STALL_MS) => {
  const originS = results.startedAtEpochS ?? 0
  const stalls = []
  results.configs.forEach((row, index) => {
    if (row.kind !== 'canary' || !Array.isArray(row.gaps)) return
    for (const gap of row.gaps) {
      if (gap.gapMs >= stallMs) stalls.push({ row: index, threads: row.threads, thread: gap.thread, ms: gap.gapMs, runQueueMs: gap.runQueueMs, unseen: gap.runQueueMs < SEEN_WAIT_MS, atS: round(gap.epochMs / 1000 - originS) })
    }
  })
  return stalls
}

export const PHASE_BIN_S = 0.5
export const FULL_WORKERS = 4

export const overBudgetTimes = (results, workers = FULL_WORKERS) => {
  const originS = results.startedAtEpochS ?? 0
  const events = []
  results.configs.forEach((row, index) => {
    if (row.kind !== 'tick' || row.workers !== workers || !Array.isArray(row.overTicks)) return
    for (const tick of row.overTicks) {
      if (Number.isFinite(tick.epochMs)) events.push({ row: index, role: row.role, tick: tick.tick, ms: tick.ms, host: tick.host === true, atS: round(tick.epochMs / 1000 - originS) })
    }
  })
  return events
}

export const densestPhase = (events, periodS = PERIOD_S, binS = PHASE_BIN_S) => {
  if (events.length === 0) return null
  const bins = new Array(Math.round(periodS / binS)).fill(0)
  for (const event of events) bins[Math.floor((((event.atS % periodS) + periodS) % periodS) / binS) % bins.length] += 1
  let best = 0
  for (let i = 1; i < bins.length; i++) {
    if (bins[i] > bins[best]) best = i
  }
  return round(best * binS + binS / 2)
}

export const nearPhase = (events, phaseS, periodS = PERIOD_S, nearS = NEAR_S) => {
  if (phaseS === null) return { events: events.length, near: 0, phaseS: null, chanceShare: round((2 * nearS) / periodS) }
  const off = (atS) => {
    const d = (((atS - phaseS) % periodS) + periodS) % periodS
    return Math.min(d, periodS - d)
  }
  return { events: events.length, near: events.filter((event) => off(event.atS) <= nearS).length, phaseS, chanceShare: round((2 * nearS) / periodS) }
}

export const phaseShare = (events, periodS = PERIOD_S, nearS = NEAR_S) => {
  if (events.length === 0) return { events: 0, near: 0, phaseS: null, chanceShare: round((2 * nearS) / periodS) }
  let x = 0
  let y = 0
  for (const event of events) {
    const angle = (2 * Math.PI * event.atS) / periodS
    x += Math.cos(angle)
    y += Math.sin(angle)
  }
  const phaseS = ((Math.atan2(y, x) / (2 * Math.PI)) * periodS + periodS) % periodS
  const off = (atS) => {
    const d = (((atS - phaseS) % periodS) + periodS) % periodS
    return Math.min(d, periodS - d)
  }
  return { events: events.length, near: events.filter((event) => off(event.atS) <= nearS).length, phaseS: round(phaseS), chanceShare: round((2 * nearS) / periodS) }
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
    const stalls = canaryStalls(results)
    const unseen = stalls.filter((stall) => stall.unseen)
    console.log('CANARY ' + JSON.stringify({ rows: results.configs.filter((row) => row.kind === 'canary').map((row) => ({ threads: row.threads, seconds: row.seconds, gapCount: row.gapCount, over5Ms: row.over5Ms, over5MsUnseen: row.over5MsUnseen, widestMs: row.widestMs })), stalls: stalls.length, unseen: unseen.length, unseenPhase: phaseShare(unseen), benchPhase: phaseShare(events.filter((event) => event.clock === 'stamped')), bothPhase: phaseShare([...unseen, ...events.filter((event) => event.clock === 'stamped')]) }))
    for (const stall of unseen.slice(0, 40)) console.log('STALL ' + JSON.stringify(stall))
    const full = stalls.filter((stall) => stall.threads >= FULL_WORKERS)
    const phaseS = densestPhase(full)
    const over = overBudgetTimes(results)
    console.log('LATTICE ' + JSON.stringify({ periodS: PERIOD_S, phaseFromCanaryS: phaseS, canaryStallsOnFullThreads: nearPhase(full, phaseS), canaryStallsOnOneThread: stalls.filter((stall) => stall.threads === 1).length, benchTicksOverBudget: nearPhase(over, phaseS), benchTicksOverBudgetOffThePhase: over.filter((event) => nearPhase([event], phaseS).near === 0).map((event) => ({ row: event.row, role: event.role, tick: event.tick, ms: event.ms, host: event.host, atS: event.atS })) }))
  }
}
