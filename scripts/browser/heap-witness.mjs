export const heapUsedAfterGc = async (cdp) => {
  await cdp.send('HeapProfiler.collectGarbage')
  const { usedSize } = await cdp.send('Runtime.getHeapUsage')
  return usedSize
}

export const summariseSnapshot = (text) => {
  const { snapshot, nodes } = JSON.parse(text)
  const fields = snapshot.meta.node_fields
  const types = snapshot.meta.node_types[0]
  const width = fields.length
  const typeAt = fields.indexOf('type')
  const sizeAt = fields.indexOf('self_size')
  let bytes = 0
  let objects = 0
  let codeBytes = 0
  for (let i = 0; i < nodes.length; i += width) {
    const type = types[nodes[i + typeAt]]
    if (type === 'native' || type === 'synthetic') continue
    if (type === 'code') {
      codeBytes += nodes[i + sizeAt]
      continue
    }
    bytes += nodes[i + sizeAt]
    objects += 1
  }
  return { objects, bytes, codeBytes }
}

export const liveObjectBytes = async (cdp) => {
  await cdp.send('HeapProfiler.collectGarbage')
  const chunks = []
  const onChunk = (event) => { chunks.push(event.chunk) }
  cdp.on('HeapProfiler.addHeapSnapshotChunk', onChunk)
  try {
    await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false })
  } finally {
    cdp.off('HeapProfiler.addHeapSnapshotChunk', onChunk)
  }
  return summariseSnapshot(chunks.join(''))
}

export const sampleWindow = async ({ cdp, isStarted, isDone, frames, intervalMs = 200, maxMs = 1200000 }) => {
  const end = Date.now() + maxMs
  while (!(await isStarted()) && Date.now() < end) await new Promise((done) => setTimeout(done, intervalMs))
  const warmed = await isStarted()
  const samples = [{ t: Date.now(), usedBytes: await heapUsedAfterGc(cdp) }]
  const before = await liveObjectBytes(cdp)
  while (!(await isDone()) && Date.now() < end) {
    await new Promise((done) => setTimeout(done, intervalMs))
    samples.push({ t: Date.now(), usedBytes: await heapUsedAfterGc(cdp) })
  }
  const after = await liveObjectBytes(cdp)
  samples.push({ t: Date.now(), usedBytes: await heapUsedAfterGc(cdp) })
  return { forcedGc: true, warmed, frames, retained: { before, after }, samples }
}
