export const random = (seed) => {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
}

export const insideBox = (point, box, radius) => {
  let gap2 = 0
  for (let a = 0; a < 3; a++) {
    const outside = point[a] < box[a] ? box[a] - point[a] : point[a] > box[a + 3] ? point[a] - box[a + 3] : 0
    gap2 += outside * outside
  }
  return gap2 < radius * radius - 1e-12
}
