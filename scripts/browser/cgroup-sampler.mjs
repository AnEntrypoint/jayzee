import { writeFileSync } from 'node:fs'

const CPU_STAT = '/sys/fs/cgroup/cpu.stat'

export function readCpuStat(text) {
  const pick = (key) => {
    const match = text.match(new RegExp('^' + key + ' (\\d+)$', 'm'))
    if (!match) throw new TypeError('cpu.stat has no ' + key)
    return Number(match[1])
  }
  return { throttledUs: pick('throttled_usec'), usageUs: pick('usage_usec') }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

if (process.argv[1] && process.argv[1].endsWith('cgroup-sampler.mjs')) {
  const [outPath, durationArg, intervalArg] = process.argv.slice(2)
  const durationMs = Number(durationArg)
  const intervalMs = Number(intervalArg ?? 2)
  const { readFileSync } = await import('node:fs')
  const lines = []
  const end = Date.now() + durationMs
  while (Date.now() < end) {
    const sample = readCpuStat(readFileSync(CPU_STAT, 'utf8'))
    lines.push(`${Date.now()} ${sample.throttledUs} ${sample.usageUs}`)
    await sleep(intervalMs)
  }
  writeFileSync(outPath, lines.join('\n') + '\n')
  console.log(JSON.stringify({ outPath, samples: lines.length, startMs: Number(lines[0]?.split(' ')[0] ?? null), endMs: Number(lines[lines.length - 1]?.split(' ')[0] ?? null) }))
}
