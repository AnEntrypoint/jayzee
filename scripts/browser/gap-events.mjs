import { readFileSync } from 'node:fs'

const TOP = 12
const MIN_OUTER_US = 2000
const MIN_INNER_US = 200

const [path] = process.argv.slice(2)
if (!path) {
  console.error('usage: node scripts/browser/gap-events.mjs <dumps/<label>-frame<N>.trace.json>')
  process.exit(2)
}
const dump = JSON.parse(readFileSync(path, 'utf8'))
const events = dump.traceEvents
const names = new Map()
for (const event of events) {
  if (event.ph !== 'M') continue
  if (event.name === 'process_name') names.set('p' + event.pid, event.args.name)
  if (event.name === 'thread_name') names.set('t' + event.pid + ':' + event.tid, event.args.name)
}
const where = (event) => (names.get('p' + event.pid) ?? 'pid ' + event.pid) + ' / ' + (names.get('t' + event.pid + ':' + event.tid) ?? 'tid ' + event.tid)
const fires = events.filter((event) => event.name === 'FireAnimationFrame' && event.ph === 'X')
const counts = new Map()
for (const fire of fires) counts.set(fire.pid, (counts.get(fire.pid) ?? 0) + 1)
const pagePid = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
const callbacks = fires.filter((fire) => fire.pid === pagePid).sort((a, b) => a.ts - b.ts)
const line = (event, overlapUs) => [
  (overlapUs / 1000).toFixed(2).padStart(8) + ' ms in window',
  where(event),
  event.name + ' [' + event.cat + ']',
  'ts ' + event.ts,
  'dur ' + event.dur,
  'tdur ' + (event.tdur ?? '-'),
  'off-cpu ' + (event.tdur === undefined ? '-' : event.dur - event.tdur),
  JSON.stringify(event.args ?? {}).slice(0, 140),
].join(' | ')

console.log(JSON.stringify({ cases: dump.frameCases.length, events: events.length, pagePid, callbacks: callbacks.length }))
for (const frameCase of dump.frameCases) {
  const current = callbacks[frameCase.frameIndex]
  const previous = callbacks[frameCase.frameIndex - 1]
  console.log('\nframe ' + frameCase.frameIndex + ' ' + JSON.stringify({ intervalMs: frameCase.intervalMs, workMs: frameCase.workMs, joltStepMs: frameCase.joltStepMs, mainThreadBusyMs: frameCase.mainThreadBusyMs, gcMs: frameCase.gcMs, gpuTaskMs: frameCase.gpuTaskMs, host: frameCase.hostCpuInFrame }))
  if (!current || !previous) {
    console.log('no aligned callbacks for this frame')
    continue
  }
  const inWork = frameCase.workMs > frameCase.intervalMs / 2
  const from = inWork ? current.ts : previous.ts + (previous.dur ?? 0)
  const to = inWork ? current.ts + (current.dur ?? 0) : current.ts
  console.log((inWork ? 'work' : 'gap') + ' window ts ' + from + ' to ' + to + ', ' + ((to - from) / 1000).toFixed(2) + ' ms')
  const overlap = (event) => Math.min(to, event.ts + event.dur) - Math.max(from, event.ts)
  const outer = events.filter((event) => event.ph === 'X' && event.dur >= MIN_OUTER_US && event.ts < to && event.ts + event.dur > from).sort((a, b) => overlap(b) - overlap(a))
  for (const event of outer.slice(0, TOP)) console.log(line(event, overlap(event)))
  const holder = outer.filter((event) => event.pid !== pagePid || event.tid !== current.tid).sort((a, b) => overlap(b) - overlap(a) || a.dur - b.dur)[0]
  if (!holder) continue
  const inner = events.filter((event) => event.ph === 'X' && event.pid === holder.pid && event.tid === holder.tid && event !== holder && event.ts >= holder.ts && event.ts + event.dur <= holder.ts + holder.dur && event.dur >= MIN_INNER_US && event.dur < holder.dur * 0.98).sort((a, b) => b.dur - a.dur)
  console.log('inside the innermost holder ' + holder.name + ' on its own thread: ' + inner.length + ' events of ' + MIN_INNER_US + ' us or more')
  for (const event of inner.slice(0, TOP)) console.log(line(event, event.dur))
}
