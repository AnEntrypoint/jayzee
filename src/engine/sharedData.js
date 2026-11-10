export const F32 = 4
export const TRANSFORM_STRIDE_FLOATS = 16
export const TRANSFORM_POSITION_OFFSET = 12

export const createSharedHeightStore = ({ patchCount, patchSide, cellM }) => {
  if (!Number.isInteger(patchCount) || patchCount < 1) throw new RangeError('patchCount must be a whole number at least 1')
  if (!Number.isInteger(patchSide) || patchSide < 2) throw new RangeError('patchSide must be a whole number at least 2')
  if (!(cellM > 0) || !Number.isFinite(cellM)) throw new RangeError('cellM must be a positive finite number')
  const perPatch = patchSide * patchSide
  const heights = new Float32Array(patchCount * perPatch)
  const normals = new Float32Array(patchCount * perPatch * 3)
  return {
    heights,
    normals,
    patchCount,
    patchSide,
    cellM,
    renderView: () => ({ heights, normals }),
    physicsView: () => ({ heights, normals }),
    normalsFromHeights: () => {
      for (let p = 0; p < patchCount; p++) {
        const base = p * perPatch
        for (let j = 0; j < patchSide; j++) {
          for (let i = 0; i < patchSide; i++) {
            const at = (x, y) => heights[base + Math.min(patchSide - 1, Math.max(0, y)) * patchSide + Math.min(patchSide - 1, Math.max(0, x))]
            const dx = (at(i + 1, j) - at(i - 1, j)) / (2 * cellM)
            const dz = (at(i, j + 1) - at(i, j - 1)) / (2 * cellM)
            const len = Math.hypot(dx, 1, dz)
            const o = (base + j * patchSide + i) * 3
            normals[o] = (0 - dx) / len
            normals[o + 1] = 1 / len
            normals[o + 2] = (0 - dz) / len
          }
        }
      }
    },
  }
}

export const transformStream = (count) => {
  if (!Number.isInteger(count) || count < 0) throw new RangeError('count must be a whole number at zero or more')
  const data = new Float32Array(count * TRANSFORM_STRIDE_FLOATS)
  for (let i = 0; i < count; i++) data[i * TRANSFORM_STRIDE_FLOATS + 15] = 1
  return {
    data,
    count,
    renderView: () => data,
    physicsPosition: (i) => data.subarray(i * TRANSFORM_STRIDE_FLOATS + TRANSFORM_POSITION_OFFSET, i * TRANSFORM_STRIDE_FLOATS + TRANSFORM_POSITION_OFFSET + 3),
  }
}

export const copyAccounting = ({ patches, patchBytes, instances }) => {
  if (!Number.isInteger(patches) || patches < 0) throw new RangeError('patches must be a whole number at zero or more')
  if (!Number.isInteger(instances) || instances < 0) throw new RangeError('instances must be a whole number at zero or more')
  if (!(patchBytes >= 0)) throw new RangeError('patchBytes must be at zero or more')
  const transformBytes = TRANSFORM_STRIDE_FLOATS * F32
  const positionBytes = 3 * F32
  const renderBytes = patches * patchBytes + instances * transformBytes
  const physicsBytesIfCopied = patches * patchBytes + instances * positionBytes
  const sharedBytes = renderBytes
  return {
    renderBytes,
    physicsBytesIfCopied,
    sharedBytes,
    bytesSaved: physicsBytesIfCopied,
    copiesSaved: patches + instances,
  }
}
