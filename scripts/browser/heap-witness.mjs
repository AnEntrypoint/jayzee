export const heapUsedAfterGc = async (cdp) => {
  await cdp.send('HeapProfiler.collectGarbage')
  const { usedSize } = await cdp.send('Runtime.getHeapUsage')
  return usedSize
}

export const sampleWindow = async ({ cdp, isStarted, isDone, frames, intervalMs = 200, maxMs = 1200000 }) => {
  const end = Date.now() + maxMs
  while (!(await isStarted()) && Date.now() < end) await new Promise((done) => setTimeout(done, intervalMs))
  const warmed = await isStarted()
  const samples = [{ t: Date.now(), usedBytes: await heapUsedAfterGc(cdp) }]
  while (!(await isDone()) && Date.now() < end) {
    await new Promise((done) => setTimeout(done, intervalMs))
    samples.push({ t: Date.now(), usedBytes: await heapUsedAfterGc(cdp) })
  }
  samples.push({ t: Date.now(), usedBytes: await heapUsedAfterGc(cdp) })
  return { forcedGc: true, warmed, frames, samples }
}
