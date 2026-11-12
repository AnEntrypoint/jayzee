export class HizError extends Error {
  constructor(code, message) {
    super(code + ': ' + message)
    this.name = 'HizError'
    this.code = code
  }
}

const refuse = (code, message) => {
  throw new HizError(code, message)
}

export const HIZ_MAX_TEXELS_PER_AXIS = 2

export function hizMipCount(width, height) {
  let count = 1
  let w = width, h = height
  while (w > 1 || h > 1) {
    w = Math.max(1, Math.ceil(w / 2))
    h = Math.max(1, Math.ceil(h / 2))
    count++
  }
  return count
}

export function createHizPyramid(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) refuse('hiz-size', 'width and height must be integers of at least 1, got ' + String(width) + ' by ' + String(height))
  const mipCount = hizMipCount(width, height)
  const widths = new Int32Array(mipCount)
  const heights = new Int32Array(mipCount)
  const starts = new Int32Array(mipCount + 1)
  let w = width, h = height
  for (let m = 0; m < mipCount; m++) {
    widths[m] = w
    heights[m] = h
    starts[m + 1] = starts[m] + w * h
    w = Math.max(1, Math.ceil(w / 2))
    h = Math.max(1, Math.ceil(h / 2))
  }
  const texels = new Float32Array(starts[mipCount])
  const stats = { builds: 0, tests: 0, occluded: 0 }
  let built = false

  function build(depth) {
    if (!(depth instanceof Float32Array) || depth.length !== width * height) refuse('hiz-depth', 'the depth buffer must be a Float32Array of ' + width * height + ' values')
    texels.set(depth, 0)
    for (let m = 1; m < mipCount; m++) {
      const pw = widths[m - 1], ph = heights[m - 1], ps = starts[m - 1]
      const mw = widths[m], mh = heights[m], ms = starts[m]
      for (let y = 0; y < mh; y++) {
        const y0 = y * 2
        const y1 = y0 + 1 < ph ? y0 + 1 : y0
        for (let x = 0; x < mw; x++) {
          const x0 = x * 2
          const x1 = x0 + 1 < pw ? x0 + 1 : x0
          const a = texels[ps + y0 * pw + x0], b = texels[ps + y0 * pw + x1]
          const c = texels[ps + y1 * pw + x0], d = texels[ps + y1 * pw + x1]
          const ab = a > b ? a : b
          const cd = c > d ? c : d
          texels[ms + y * mw + x] = ab > cd ? ab : cd
        }
      }
    }
    built = true
    stats.builds++
  }

  function mipFor(minX, minY, maxX, maxY) {
    let m = 0
    while (m + 1 < mipCount && ((maxX >> m) - (minX >> m) + 1 > HIZ_MAX_TEXELS_PER_AXIS || (maxY >> m) - (minY >> m) + 1 > HIZ_MAX_TEXELS_PER_AXIS)) m++
    return m
  }

  function farthestIn(minX, minY, maxX, maxY) {
    const m = mipFor(minX, minY, maxX, maxY)
    const mw = widths[m], ms = starts[m]
    const x0 = minX >> m, x1 = maxX >> m, y0 = minY >> m, y1 = maxY >> m
    let farthest = -Infinity
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const value = texels[ms + y * mw + x]
        if (value > farthest) farthest = value
      }
    }
    return farthest
  }

  function isOccluded(minX, minY, maxX, maxY, nearestDepth) {
    if (!built) refuse('hiz-not-built', 'the pyramid holds no depth yet: build it from a depth buffer first')
    if (!Number.isFinite(nearestDepth)) refuse('hiz-depth', 'nearestDepth must be a finite number')
    stats.tests++
    let x0 = Math.floor(minX), y0 = Math.floor(minY), x1 = Math.floor(maxX), y1 = Math.floor(maxY)
    if (x1 < 0 || y1 < 0 || x0 >= width || y0 >= height || x1 < x0 || y1 < y0) return false
    if (x0 < 0) x0 = 0
    if (y0 < 0) y0 = 0
    if (x1 >= width) x1 = width - 1
    if (y1 >= height) y1 = height - 1
    const hidden = nearestDepth > farthestIn(x0, y0, x1, y1)
    if (hidden) stats.occluded++
    return hidden
  }

  return {
    width,
    height,
    mipCount,
    widths,
    heights,
    starts,
    texels,
    build,
    mipFor,
    farthestIn,
    isOccluded,
    getStats() { return { ...stats } },
  }
}

export function projectViewSphereRect(lens, viewCentre, radius, width, height, out) {
  const depth = -viewCentre[2]
  const nearest = depth - radius
  if (!(nearest > lens.near)) return false
  const farthest = depth + radius
  const left = viewCentre[0] - radius, right = viewCentre[0] + radius
  const bottom = viewCentre[1] - radius, top = viewCentre[1] + radius
  const ndcLeft = lens.focalX * left / (left >= 0 ? farthest : nearest)
  const ndcRight = lens.focalX * right / (right >= 0 ? nearest : farthest)
  const ndcBottom = lens.focalY * bottom / (bottom >= 0 ? farthest : nearest)
  const ndcTop = lens.focalY * top / (top >= 0 ? nearest : farthest)
  out.minX = (ndcLeft + 1) * 0.5 * width
  out.maxX = (ndcRight + 1) * 0.5 * width
  out.minY = (1 - ndcTop) * 0.5 * height
  out.maxY = (1 - ndcBottom) * 0.5 * height
  out.nearestDepth = nearest
  return true
}
