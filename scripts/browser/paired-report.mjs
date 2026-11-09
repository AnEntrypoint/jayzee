import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { attributeStalls, framesFromResult, parseThrottleLog } from './stall-attribution.mjs'

const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length

export function pairRounds(runs) {
  const byRound = new Map()
  for (const run of runs) {
    const slot = byRound.get(run.round) ?? {}
    if (slot[run.condition]) throw new RangeError('round ' + run.round + ' has two ' + run.condition + ' runs')
    slot[run.condition] = run
    byRound.set(run.round, slot)
  }
  return [...byRound.keys()].sort((a, b) => a - b).map((round) => {
    const slot = byRound.get(round)
    if (!slot.G0 || !slot.G1) throw new RangeError('round ' + round + ' is missing ' + (slot.G0 ? 'G1' : 'G0'))
    return { round, g0: slot.G0, g1: slot.G1 }
  })
}

export function summarizeRun(run, { samples, result }) {
  const { startMs, endMs } = run.sampler
  const inWindow = samples.filter((s) => s.t >= startMs && s.t <= endMs)
  if (inWindow.length < 2) throw new RangeError(run.label + ': the sampler has fewer than two rows in its window')
  const first = inWindow[0]
  const last = inWindow[inWindow.length - 1]
  const frames = framesFromResult(result).filter((f) => f.startMs >= startMs && f.startMs <= endMs)
  const attribution = attributeStalls(frames, samples)
  return {
    label: run.label,
    condition: run.condition,
    round: run.round,
    throttleDeltaUs: last.throttledUs - first.throttledUs,
    fullDeltaMs: (last.fullUs - first.fullUs) / 1000,
    frames: frames.length,
    medianFrameMs: attribution.medianMs,
    stallCount: attribution.stallCount,
    counts: attribution.counts,
    streamerP99Ms: run.streamer.p99Ms,
    streamerSamples: run.streamer.samples,
  }
}

export function verdict(pairs) {
  if (pairs.length < 2) return 'insufficient'
  const raised = pairs.filter((p) => p.g1.stallCount > p.g0.stallCount).length
  const notRaised = pairs.filter((p) => p.g1.stallCount <= p.g0.stallCount).length
  if (raised === pairs.length) return 'supported'
  if (notRaised === pairs.length) return 'not-supported'
  return 'mixed'
}

export function report(pairs) {
  const starvationRatio = mean(pairs.map((p) => p.g1.fullDeltaMs)) / mean(pairs.map((p) => p.g0.fullDeltaMs))
  return {
    pairs: pairs.map((p) => ({ round: p.round, g0: p.g0, g1: p.g1 })),
    verdict: verdict(pairs),
    starvationRatio: Number.isFinite(starvationRatio) ? starvationRatio : null,
  }
}

if (process.argv[1] && process.argv[1].endsWith('/browser/paired-report.mjs')) {
  const dir = process.argv[2]
  const runs = readdirSync(dir).filter((f) => f.endsWith('.run.json')).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')))
  const summaries = runs.map((run) => {
    const samples = parseThrottleLog(readFileSync(run.sampler.file, 'utf8'))
    const result = JSON.parse(readFileSync(join(dir, run.label + '.page.json'), 'utf8'))
    return { run, summary: summarizeRun(run, { samples, result }) }
  })
  const byLabel = new Map(summaries.map((s) => [s.run.label, s]))
  const pairs = pairRounds(runs).map(({ round, g0, g1 }) => ({
    round,
    g0: byLabel.get(g0.label).summary,
    g1: byLabel.get(g1.label).summary,
  }))
  console.log(JSON.stringify(report(pairs), null, 2))
}
