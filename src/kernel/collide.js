import { pos, boxes } from './state.js'
import { respond } from './respond.js'

export const resolveGround = (count, radius, restitution) => {
  const words = count * 3
  for (let o = 0; o < words; o += 3) {
    const y = pos[o + 1]
    if (y < radius) respond(o, 0, 1, 0, radius - y, restitution)
  }
}

export const resolveBoxes = (count, radius, boxCount, restitution) => {
  const radius2 = radius * radius
  const words = count * 3
  const boxWords = boxCount * 6
  for (let o = 0; o < words; o += 3) {
    for (let k = 0; k < boxWords; k += 6) {
      const px = pos[o]
      const py = pos[o + 1]
      const pz = pos[o + 2]
      const lx = boxes[k]
      const ly = boxes[k + 1]
      const lz = boxes[k + 2]
      const hx = boxes[k + 3]
      const hy = boxes[k + 4]
      const hz = boxes[k + 5]
      const qx = px < lx ? lx : px > hx ? hx : px
      const qy = py < ly ? ly : py > hy ? hy : py
      const qz = pz < lz ? lz : pz > hz ? hz : pz
      const dx = px - qx
      const dy = py - qy
      const dz = pz - qz
      const d2 = dx * dx + dy * dy + dz * dz
      if (d2 > 0) {
        if (d2 < radius2) {
          const d = Math.sqrt(d2)
          respond(o, dx / d, dy / d, dz / d, radius - d, restitution)
        }
      } else {
        let axis = 0
        let sign = 1
        let escape = Infinity
        for (let a = 0; a < 3; a++) {
          const at = pos[o + a]
          const toLo = at - boxes[k + a]
          const toHi = boxes[k + 3 + a] - at
          if (toLo < escape) {
            escape = toLo
            axis = a
            sign = -1
          }
          if (toHi < escape) {
            escape = toHi
            axis = a
            sign = 1
          }
        }
        respond(o, axis === 0 ? sign : 0, axis === 1 ? sign : 0, axis === 2 ? sign : 0, escape + radius, restitution)
      }
    }
  }
}
