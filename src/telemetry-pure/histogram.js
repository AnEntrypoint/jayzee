export const TICK_MS_BUCKETS = [0.5, 1, 2, 5, 10, 16.7, 25, 50, 100, 250, 500]
export const SNAP_BYTES_BUCKETS = [16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384]

export function escapeLabelValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
}

export function formatLabels(labels) {
  if (!labels || Object.keys(labels).length === 0) return ''
  const parts = []
  for (const key in labels) parts.push(`${key}="${escapeLabelValue(labels[key])}"`)
  return `{${parts.join(',')}}`
}

export function createHistogram(name, help, boundaries) {
  const bucketCount = boundaries.length
  const counts = new Float64Array(bucketCount)
  let sum = 0
  let count = 0

  const renderBody = (labels) => {
    const base = labels || {}
    const lines = []
    let cumulative = 0
    for (let i = 0; i < bucketCount; i++) {
      cumulative += counts[i]
      lines.push(`${name}_bucket${formatLabels({ ...base, le: boundaries[i] })} ${cumulative}`)
    }
    lines.push(`${name}_bucket${formatLabels({ ...base, le: '+Inf' })} ${count}`)
    lines.push(`${name}_sum${formatLabels(base)} ${sum}`)
    lines.push(`${name}_count${formatLabels(base)} ${count}`)
    return lines.join('\n')
  }

  return {
    name,
    help,
    type: 'histogram',
    observe(value) {
      sum += value
      count++
      let i = 0
      while (i < bucketCount && value > boundaries[i]) i++
      if (i < bucketCount) counts[i]++
    },
    reset() {
      counts.fill(0)
      sum = 0
      count = 0
    },
    renderBody,
    render(labels) {
      return `# HELP ${name} ${help}\n# TYPE ${name} histogram\n${renderBody(labels)}`
    },
  }
}

export function createCounter(name, help) {
  let value = 0
  return {
    name,
    help,
    type: 'counter',
    inc(amount = 1) {
      value += amount
    },
    get value() {
      return value
    },
    render(labels) {
      return `# HELP ${name} ${help}\n# TYPE ${name} counter\n${name}${formatLabels(labels)} ${value}`
    },
  }
}
