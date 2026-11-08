export const CACHE_BYTE_BUDGET = 256 * 1024 * 1024

export const MAX_CACHEABLE_BYTES = 20 * 1024 * 1024

export const GZIP_EXTENSIONS = new Set(['.glb', '.vrm', '.gltf', '.js', '.mjs', '.css', '.html', '.json', '.wasm'])

export const BROTLI_QUALITY = 5

export const brotliOptions = (qualityParamKey) => ({ params: { [qualityParamKey]: BROTLI_QUALITY } })

export const makeCompress = ({ gzipSync, brotliCompressSync, brotliParamQuality }) => {
  if (typeof gzipSync !== 'function' || typeof brotliCompressSync !== 'function') throw new TypeError('makeCompress needs gzipSync and brotliCompressSync')
  const options = brotliOptions(brotliParamQuality)
  return (raw, encoding) => (encoding === 'br' ? brotliCompressSync(raw, options) : gzipSync(raw))
}

export class ByteBudgetLRU {
  constructor(budget) {
    this.budget = budget
    this.bytes = 0
    this.map = new Map()
  }

  sizeOf(entry) {
    let n = entry.raw ? entry.raw.length : 0
    if (entry.variants) for (const v of entry.variants.values()) n += v.length
    if (entry.content) n += entry.content.length
    return n
  }

  get(key) {
    const entry = this.map.get(key)
    if (!entry) return undefined
    this.map.delete(key)
    this.map.set(key, entry)
    return entry
  }

  set(key, entry) {
    const prior = this.map.get(key)
    if (prior) this.bytes -= this.sizeOf(prior)
    this.map.delete(key)
    this.map.set(key, entry)
    this.bytes += this.sizeOf(entry)
    this.evictOverBudget()
  }

  resync(key) {
    if (!this.map.has(key)) return
    let total = 0
    for (const entry of this.map.values()) total += this.sizeOf(entry)
    this.bytes = total
    this.evictOverBudget()
  }

  delete(key) {
    const entry = this.map.get(key)
    if (entry) this.bytes -= this.sizeOf(entry)
    this.map.delete(key)
  }

  evictOverBudget() {
    while (this.bytes > this.budget && this.map.size > 0) {
      const oldestKey = this.map.keys().next().value
      this.delete(oldestKey)
    }
  }
}

export const parseRange = (rangeHeader, totalSize) => {
  if (!rangeHeader || !rangeHeader.startsWith('bytes=')) return null
  const spec = rangeHeader.slice(6).split(',')[0].trim()
  const m = /^(\d*)-(\d*)$/.exec(spec)
  if (!m) return null
  let start, end
  if (m[1] === '' && m[2] === '') return null
  if (m[1] === '') {
    const suffixLen = parseInt(m[2], 10)
    if (!Number.isFinite(suffixLen) || suffixLen <= 0) return null
    start = Math.max(0, totalSize - suffixLen)
    end = totalSize - 1
  } else {
    start = parseInt(m[1], 10)
    end = m[2] === '' ? totalSize - 1 : parseInt(m[2], 10)
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start < 0 || start >= totalSize) return null
  end = Math.min(end, totalSize - 1)
  return { start, end }
}
