export const repeatedSpikes = (spikeTicksPerRun) => {
  if (!Array.isArray(spikeTicksPerRun) || spikeTicksPerRun.length === 0) throw new RangeError('at least one run is needed')
  const needed = Math.ceil(spikeTicksPerRun.length / 2)
  const seen = new Map()
  for (const ticks of spikeTicksPerRun) for (const tick of new Set(ticks)) seen.set(tick, (seen.get(tick) ?? 0) + 1)
  return [...seen].filter(([, runs]) => runs >= needed).map(([tick]) => tick).sort((a, b) => a - b)
}
