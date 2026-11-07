export function mat4Identity() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
}

export function mat4TRS(translation, rotation, scale) {
  const [qx, qy, qz, qw] = rotation
  const [sx, sy, sz] = scale
  const x2 = qx + qx
  const y2 = qy + qy
  const z2 = qz + qz
  const xx = qx * x2
  const xy = qx * y2
  const xz = qx * z2
  const yy = qy * y2
  const yz = qy * z2
  const zz = qz * z2
  const wx = qw * x2
  const wy = qw * y2
  const wz = qw * z2
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    translation[0], translation[1], translation[2], 1,
  ]
}

export function mat4Mul(a, b) {
  const out = new Array(16)
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      let sum = 0
      for (let k = 0; k < 4; k++) sum += a[row + k * 4] * b[k + col * 4]
      out[row + col * 4] = sum
    }
  }
  return out
}

export function applyTransformMatrix(vertices, m) {
  const count = vertices.length / 3
  const out = new Float32Array(vertices.length)
  for (let i = 0; i < count; i++) {
    const x = vertices[i * 3]
    const y = vertices[i * 3 + 1]
    const z = vertices[i * 3 + 2]
    out[i * 3] = m[0] * x + m[4] * y + m[8] * z + m[12]
    out[i * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13]
    out[i * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14]
  }
  return out
}

export function localNodeMatrix(node) {
  if (node.matrix) return node.matrix.slice()
  return mat4TRS(node.translation || [0, 0, 0], node.rotation || [0, 0, 0, 1], node.scale || [1, 1, 1])
}

export function buildNodeTransforms(json) {
  const nodes = json.nodes || []
  const matrices = new Array(nodes.length).fill(null)
  const parentOf = new Map()
  for (let i = 0; i < nodes.length; i++) {
    const children = nodes[i].children
    if (!children) continue
    for (const child of children) if (!parentOf.has(child)) parentOf.set(child, i)
  }

  const worldMatrixOf = (nodeIndex) => {
    if (matrices[nodeIndex] !== null) return matrices[nodeIndex]
    let local = localNodeMatrix(nodes[nodeIndex])
    if (parentOf.has(nodeIndex)) local = mat4Mul(worldMatrixOf(parentOf.get(nodeIndex)), local)
    matrices[nodeIndex] = local
    return local
  }

  for (let i = 0; i < nodes.length; i++) worldMatrixOf(i)
  return matrices
}
