import { respond } from './respond.js'

export const resolveGround = (pos, vel, count, radius, restitution) => {
  for (let i = 0; i < count; i++) {
    const o = i * 3
    if (pos[o + 1] < radius) respond(pos, vel, o, 0, 1, 0, radius - pos[o + 1], restitution)
  }
}

export const resolveBoxes = (pos, vel, count, radius, boxes, boxCount, restitution) => {
  for (let i = 0; i < count; i++) {
    const o = i * 3
    for (let b = 0; b < boxCount; b++) {
      const k = b * 6
      const px = pos[o]
      const py = pos[o + 1]
      const pz = pos[o + 2]
      const qx = px < boxes[k] ? boxes[k] : px > boxes[k + 3] ? boxes[k + 3] : px
      const qy = py < boxes[k + 1] ? boxes[k + 1] : py > boxes[k + 4] ? boxes[k + 4] : py
      const qz = pz < boxes[k + 2] ? boxes[k + 2] : pz > boxes[k + 5] ? boxes[k + 5] : pz
      const dx = px - qx
      const dy = py - qy
      const dz = pz - qz
      const d2 = dx * dx + dy * dy + dz * dz
      if (d2 > 0) {
        if (d2 < radius * radius) {
          const d = Math.sqrt(d2)
          respond(pos, vel, o, dx / d, dy / d, dz / d, radius - d, restitution)
        }
      } else {
        let axis = 0
        let sign = 1
        let escape = Infinity
        for (let a = 0; a < 3; a++) {
          const toLo = pos[o + a] - boxes[k + a]
          const toHi = boxes[k + 3 + a] - pos[o + a]
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
        respond(pos, vel, o, axis === 0 ? sign : 0, axis === 1 ? sign : 0, axis === 2 ? sign : 0, escape + radius, restitution)
      }
    }
  }
}
