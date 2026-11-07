export function cubeFaceOf(dx, dy, dz) {
  const ax = Math.abs(dx), ay = Math.abs(dy), az = Math.abs(dz)
  if (ax >= ay && ax >= az) return dx >= 0 ? 0 : 1
  if (ay >= az) return dy >= 0 ? 2 : 3
  return dz >= 0 ? 4 : 5
}
