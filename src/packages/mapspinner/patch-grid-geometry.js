const DIAGONAL_HASH_MULTIPLIER = 0x45d9f3b | 0

function diagonalFlipBit(x, y) {
  let hash = (x | (y << 16)) | 0
  hash = Math.imul(hash ^ (hash >>> 16), DIAGONAL_HASH_MULTIPLIER)
  hash = Math.imul(hash ^ (hash >>> 16), DIAGONAL_HASH_MULTIPLIER)
  hash = hash ^ (hash >>> 16)
  return (hash >>> 17) & 1
}

export function buildGridGeometry(gridSize, skirt = true) {
  const paddedCells = gridSize + 2
  const paddedVertices = paddedCells + 1
  const cellStep = 1.0 / gridSize
  const vertexIndexAt = new Int32Array(paddedVertices * paddedVertices).fill(-1)
  const positions = []
  for (let y = 0; y < paddedVertices; y++) {
    for (let x = 0; x < paddedVertices; x++) {
      const onRing = x === 0 || x === paddedVertices - 1 || y === 0 || y === paddedVertices - 1
      if (!skirt && onRing) continue
      vertexIndexAt[y * paddedVertices + x] = positions.length / 3
      const u = Math.min(Math.max((x - 1) * cellStep, 0.0), 1.0)
      const v = Math.min(Math.max((y - 1) * cellStep, 0.0), 1.0)
      positions.push(u, v, onRing ? 1.0 : 0.0)
    }
  }
  const triangleIndices = []
  for (let y = 0; y < paddedCells; y++) {
    for (let x = 0; x < paddedCells; x++) {
      if (!skirt && (x === 0 || x === paddedCells - 1 || y === 0 || y === paddedCells - 1)) continue
      const a = vertexIndexAt[y * paddedVertices + x]
      const b = vertexIndexAt[y * paddedVertices + x + 1]
      const c = vertexIndexAt[(y + 1) * paddedVertices + x]
      const d = vertexIndexAt[(y + 1) * paddedVertices + x + 1]
      if (diagonalFlipBit(x, y)) triangleIndices.push(a, c, d, a, d, b)
      else triangleIndices.push(a, c, b, b, c, d)
    }
  }
  return { vertices: new Float32Array(positions), indices: new Uint32Array(triangleIndices) }
}

export function perspectiveZeroToOne(fovy, aspect, near, far, out) {
  const focal = 1 / Math.tan(fovy / 2)
  const rangeInverse = 1 / (near - far)
  const matrix = out || new Float32Array(16)
  matrix[0] = focal / aspect; matrix[1] = 0; matrix[2] = 0; matrix[3] = 0
  matrix[4] = 0; matrix[5] = focal; matrix[6] = 0; matrix[7] = 0
  matrix[8] = 0; matrix[9] = 0; matrix[10] = far * rangeInverse; matrix[11] = -1
  matrix[12] = 0; matrix[13] = 0; matrix[14] = far * near * rangeInverse; matrix[15] = 0
  return matrix
}
