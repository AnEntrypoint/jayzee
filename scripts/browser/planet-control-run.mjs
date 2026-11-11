import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runRenderWitness } from './render-witness.mjs'
import { PLANET_RUNS, planetQuery } from '../../src/engine/planetWitness.js'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const [label, extra = '', framesArg = '600', portArg = '8851'] = process.argv.slice(2)
const [tierText, backend] = label.split('-')
const config = PLANET_RUNS.find((run) => String(run.tier) === tierText && run.backend === backend)
if (!config) throw new RangeError('unknown configuration ' + label)
const query = planetQuery(config, Number(framesArg)) + (extra ? '&' + extra : '')
const traced = process.env.TRACE === '1'
const run = await runRenderWitness({ root, port: Number(portArg), query, trace: traced, gpuTrace: traced, timeoutMs: 240000 })
if (run.error || !run.result) {
  console.log(JSON.stringify({ label, extra, error: run.error ?? 'no result' }))
  process.exitCode = 1
} else {
  const r = run.result
  const intervals = r.wallIntervalsMs ?? []
  console.log(JSON.stringify({
    label,
    extra,
    frames: r.frames,
    adapter: r.adapter?.description ?? null,
    wallIntervalMaxMs: r.wallIntervalMaxMs,
    intervalsOver25: intervals.filter((ms) => ms > 25).length,
    intervalsOver18: intervals.filter((ms) => ms > 18).length,
    frameTimeMedianMs: r.frameTimeMedianMs,
    frameTimeP99Ms: r.frameTimeP99Ms,
    tickMedianMs: r.tickMedianMs,
    workerTick: r.workerTick ?? null,
    physicsWarm: r.physicsWarm ?? null,
    memoryBytes: r.memoryBytes ?? null,
    memoryLargest: r.memoryLargest ?? null,
    errors: r.errors ?? [],
  }))
}
