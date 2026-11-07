const FEED_FIELDS = ['world', 'adventure', 'name', 'creator', 'app', 'sort']
const FEED_LIMIT_CAP = 44
const FEED_STEP = 22
const FEED_EMPTY_PAGES_TO_STOP = 2
const FEED_MAX_PAGES = 100000

export const normalizeFeedEntry = (entry) => {
  if (entry === null || typeof entry !== 'object') throw new TypeError('feed entry must be an object')
  const out = {}
  for (const field of FEED_FIELDS) {
    if (typeof entry[field] !== 'string' || entry[field] === '') throw new TypeError('feed entry field ' + field + ' must be a non-empty string')
    out[field] = entry[field]
  }
  return out
}

export const walkFeed = async (fetchPage, { step = FEED_STEP, limit = FEED_LIMIT_CAP, emptyPagesToStop = FEED_EMPTY_PAGES_TO_STOP, maxPages = FEED_MAX_PAGES } = {}) => {
  const seen = new Map()
  let offset = 0
  let empty = 0
  let pages = 0
  while (empty < emptyPagesToStop) {
    if (pages >= maxPages) throw new RangeError('feed walk exceeded ' + maxPages + ' pages')
    const page = await fetchPage({ offset, limit: Math.min(limit, FEED_LIMIT_CAP) })
    pages += 1
    if (page.length === 0) {
      empty += 1
    } else {
      empty = 0
      for (const raw of page) {
        const entry = normalizeFeedEntry(raw)
        if (!seen.has(entry.world)) seen.set(entry.world, entry)
      }
    }
    offset += step
  }
  return { entries: [...seen.values()], pages }
}
