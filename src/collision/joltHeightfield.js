const LAYER_STATIC = 0
const DEFAULT_BLOCK_SIZE = 2
const DEFAULT_BITS_PER_SAMPLE = 8
const RAY_MARGIN_M = 1

const wholeSide = (samples) => {
  const side = Math.round(Math.sqrt(samples.length))
  if (side < 2 || side * side !== samples.length) throw new RangeError('a heightfield needs a square grid of at least 2 by 2 samples, got ' + samples.length + ' samples')
  return side
}

export const createJoltHeightfieldBackend = (host, { originX = 0, originZ = 0, blockSize = DEFAULT_BLOCK_SIZE, bitsPerSample = DEFAULT_BITS_PER_SAMPLE } = {}) => {
  if (!host || typeof host.addBody !== 'function' || typeof host.castRay !== 'function') throw new TypeError('createJoltHeightfieldBackend needs the Jolt host from createJoltHost')
  if (!Number.isInteger(blockSize) || blockSize < 2 || blockSize > 8) throw new RangeError('blockSize must be a whole number from 2 to 8')
  if (!Number.isInteger(bitsPerSample) || bitsPerSample < 1 || bitsPerSample > 8) throw new RangeError('bitsPerSample must be a whole number from 1 to 8')
  const J = host.Jolt
  const usedBytes = () => J.JoltInterface.prototype.sGetTotalMemory() - J.JoltInterface.prototype.sGetFreeMemory()
  let built = null

  const buildHeightfield = (samples, cellM) => {
    if (built !== null) throw new RangeError('this backend already holds a heightfield; make a new backend for another one')
    if (!(cellM > 0) || !Number.isFinite(cellM)) throw new RangeError('cellM must be a positive finite number')
    const side = wholeSide(samples)
    let low = Infinity
    let high = -Infinity
    for (let i = 0; i < samples.length; i++) {
      const h = samples[i]
      if (!Number.isFinite(h)) throw new RangeError('sample ' + i + ' is not a finite height')
      if (h < low) low = h
      if (h > high) high = h
    }
    const usedBefore = usedBytes()
    const settings = new J.HeightFieldShapeSettings()
    const offset = new J.Vec3(0, 0, 0)
    const scale = new J.Vec3(cellM, 1, cellM)
    settings.set_mOffset(offset)
    settings.set_mScale(scale)
    settings.set_mSampleCount(side)
    settings.set_mBlockSize(blockSize)
    settings.set_mBitsPerSample(bitsPerSample)
    const heights = settings.get_mHeightSamples()
    heights.resize(samples.length)
    new Float32Array(J.HEAPF32.buffer, J.getPointer(heights.data()), samples.length).set(samples)
    const result = settings.Create()
    J.destroy(offset)
    J.destroy(scale)
    if (!result.IsValid()) {
      const reason = result.GetError().c_str()
      J.destroy(settings)
      throw new RangeError('Jolt refused the heightfield: ' + reason)
    }
    const bodyId = host.addBody(result.Get(), [originX, 0, originZ], J.EMotionType_Static, LAYER_STATIC)
    J.destroy(settings)
    built = { bodyId, side, cellM, top: high + RAY_MARGIN_M, reach: high - low + 2 * RAY_MARGIN_M, residentBytes: usedBytes() - usedBefore, sampleBytes: samples.byteLength }
    return built
  }

  const raycastDown = (x, z) => {
    if (built === null) throw new RangeError('raycastDown needs a built heightfield')
    const hit = host.castRay([x, built.top, z], [0, -1, 0], built.reach)
    return hit.hit && hit.bodyId === built.bodyId ? built.top - hit.distance : null
  }

  return { buildHeightfield, raycastDown, built: () => built }
}
