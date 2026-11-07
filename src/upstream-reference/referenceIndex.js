const TOTALS_LINE = /(\d+) indexed files: ([^.]*)\./
const BUCKET_PAIR = /([a-z-]+) (\d+)/g
const CLI_TYPES = 'types'

export function parseReadmeTotals(text) {
  const match = TOTALS_LINE.exec(text)
  if (!match) throw new Error('README has no indexed-files total line')
  const buckets = {}
  for (const pair of match[2].replace(/\([^)]*\)/g, '').matchAll(BUCKET_PAIR)) buckets[pair[1]] = Number(pair[2])
  return { total: Number(match[1]), buckets }
}

export function bucketOf(path) {
  const parts = path.split('/')
  if (parts.length === 3) return 'top-level'
  if (parts[2] === 'cli' && parts[3] === CLI_TYPES) return 'cli-types'
  return parts[2]
}

export function countBuckets(paths) {
  const counts = {}
  for (const path of paths) {
    const bucket = bucketOf(path)
    counts[bucket] = (counts[bucket] ?? 0) + 1
  }
  return counts
}

export function sumOf(counts, names) {
  return names.reduce((sum, name) => sum + (counts[name] ?? 0), 0)
}
