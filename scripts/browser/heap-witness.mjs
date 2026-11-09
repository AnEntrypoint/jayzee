export const heapUsedAfterGc = async (cdp) => {
  await cdp.send('HeapProfiler.collectGarbage')
  const { usedSize } = await cdp.send('Runtime.getHeapUsage')
  return usedSize
}

export const sampleWindow = async ({ cdp, isDone, frames, intervalMs = 200, maxMs = 1200000 }) => {
  const samples = [{ t: Date.now(), usedBytes: await heapUsedAfterGc(cdp) }]
  const end = Date.now() + maxMs
  while (!(await isDone()) && Date.now() < end) {
    await new Promise((done) => setTimeout(done, intervalMs))
    samples.push({ t: Date.now(), usedBytes: await heapUsedAfterGc(cdp) })
  }
  samples.push({ t: Date.now(), usedBytes: await heapUsedAfterGc(cdp) })
  return { forcedGc: true, frames, samples }
}
