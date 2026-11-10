import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const exited = (child) => new Promise((resolve) => child.once('exit', resolve))

const parseCpuList = (list) => list.split(',').flatMap((part) => {
  const [first, last = first] = part.split('-').map(Number)
  return Array.from({ length: last - first + 1 }, (_, i) => first + i)
})

export const allowedCpus = () => {
  const line = readFileSync('/proc/self/status', 'utf8').split('\n').find((text) => text.startsWith('Cpus_allowed_list:'))
  return parseCpuList(line.slice('Cpus_allowed_list:'.length).trim())
}

export const cpusExcept = (excluded) => {
  const skip = new Set(parseCpuList(excluded))
  return allowedCpus().filter((cpu) => !skip.has(cpu)).join(',')
}

export const quotaCores = (cpuMaxText, cpus) => {
  const [quota, period] = String(cpuMaxText).trim().split(/\s+/)
  if (quota === 'max') return cpus
  const cores = Number(quota) / Number(period)
  if (!(cores > 0)) throw new TypeError('cpu.max is not a quota and a period: ' + cpuMaxText)
  return cores
}

export async function burn({ workers, durationMs, now = () => Date.now(), cpus = '' }) {
  const requestedEnd = now() + durationMs
  const start = now()
  const code = `const e=${requestedEnd}; while (Date.now() < e);`
  const children = Array.from({ length: workers }, () =>
    cpus === ''
      ? spawn(process.execPath, ['-e', code], { stdio: 'ignore' })
      : spawn('taskset', ['-c', cpus, process.execPath, '-e', code], { stdio: 'ignore' }),
  )
  await Promise.all(children.map(exited))
  return { workers, requestedDurationMs: durationMs, cpus: cpus === '' ? null : cpus, startMs: start, endMs: now() }
}

if (process.argv[1] && process.argv[1].endsWith('cpu-load.mjs')) {
  const [workersArg, durationArg, outPath, cpusArg = ''] = process.argv.slice(2)
  const record = await burn({ workers: Number(workersArg), durationMs: Number(durationArg), cpus: cpusArg })
  writeFileSync(outPath, JSON.stringify(record) + '\n')
  console.log(JSON.stringify(record))
}
