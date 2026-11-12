import { readFileSync } from 'node:fs'

export const WAIT_SAMPLE_MS = 5
export const WAIT_REFRESH_TICKS = 50

export const readMainThreadSchedstat = (pid) => {
  try {
    const [runNs, waitNs] = readFileSync('/proc/' + pid + '/task/' + pid + '/schedstat', 'utf8').split(' ')
    return { runNs: Number(runNs), waitNs: Number(waitNs) }
  } catch {
    return null
  }
}

export const monotonicUs = () => Number(process.hrtime.bigint() / 1000n)

export const createWaitSampler = ({ listPids, readThread = readMainThreadSchedstat, nowUs = monotonicUs, refreshTicks = WAIT_REFRESH_TICKS }) => {
  const threads = new Map()
  let pids = []
  let ticks = 0
  const tick = () => {
    if (ticks % refreshTicks === 0) pids = listPids()
    ticks += 1
    const at = nowUs()
    for (const pid of pids) {
      const read = readThread(pid)
      if (read === null) continue
      let thread = threads.get(pid)
      if (thread === undefined) {
        thread = { pid, tid: pid, samples: 0, atUs: [], runNs: [], waitNs: [] }
        threads.set(pid, thread)
      }
      thread.atUs.push(at)
      thread.runNs.push(read.runNs)
      thread.waitNs.push(read.waitNs)
      thread.samples += 1
    }
  }
  return { tick, threadOf: (pid) => threads.get(pid) ?? null, pids: () => [...threads.keys()] }
}

export const startWaitSampler = (spec, periodMs = WAIT_SAMPLE_MS) => {
  const sampler = createWaitSampler(spec)
  sampler.tick()
  const timer = setInterval(sampler.tick, periodMs)
  return { ...sampler, stop: () => clearInterval(timer) }
}
