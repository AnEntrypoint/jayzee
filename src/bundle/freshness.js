import { createHash } from 'node:crypto'

const STAMP_VERSION = 1
const FRESH = Object.freeze({ fresh: true })

const digestOf = (content) => createHash('sha256').update(content).digest('hex')

const stale = (file, reason) => ({ fresh: false, file, reason })

const byPath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)

const orderedSources = (sources) => {
  if (!Array.isArray(sources) || sources.length === 0) throw new RangeError('a freshness check needs at least one source')
  const seen = new Set()
  for (const source of sources) {
    if (typeof source.path !== 'string' || source.path === '') throw new TypeError('a source needs a non-empty path')
    if (source.content === undefined || source.content === null) throw new RangeError('missing source ' + source.path)
    if (seen.has(source.path)) throw new RangeError('duplicate source ' + source.path)
    seen.add(source.path)
  }
  return [...sources].sort(byPath)
}

const recordedEntries = (stamp) => {
  if (stamp === null || typeof stamp !== 'object' || stamp.v !== STAMP_VERSION || !Array.isArray(stamp.sources)) {
    throw new RangeError('stamp is not a version ' + STAMP_VERSION + ' freshness stamp')
  }
  return stamp.sources
}

export const createStamp = (sources) => ({
  v: STAMP_VERSION,
  sources: orderedSources(sources).map(({ path, content }) => ({ path, sha256: digestOf(content) })),
})

export const checkFreshness = (sources, stamp) => {
  const current = createStamp(sources).sources
  const recorded = recordedEntries(stamp)
  const recordedDigest = new Map(recorded.map((entry) => [entry.path, entry.sha256]))
  for (const { path, sha256 } of current) {
    if (!recordedDigest.has(path)) return stale(path, 'added')
    if (recordedDigest.get(path) !== sha256) return stale(path, 'changed')
  }
  const currentPaths = new Set(current.map((entry) => entry.path))
  for (const { path } of recorded) {
    if (!currentPaths.has(path)) return stale(path, 'removed')
  }
  return FRESH
}
