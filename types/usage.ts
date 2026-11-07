import { World, encodeInputs, decodeInputs, encodeSnapshot, decodeSnapshot } from 'jayzee'

const world = new World({ tickRate: 64, gravity: -18, radius: 0.35, boxes: [[-2, 0, -2, 2, 1, 2]] })
const hero: number = world.spawn([0, 4, 0])
const steps: number = world.advance(1 / 64)
const [x, y, z]: [number, number, number] = world.position(hero)
const packet: ArrayBuffer = encodeInputs([{ sequence: 1, moveX: 0.5, moveZ: 0, yaw: 0, buttons: 1 }])
const records = decodeInputs(packet)
const frame = decodeSnapshot(encodeSnapshot(world.snapshot()))
const digest: number = world.hash()

export { steps, x, y, z, records, frame, digest }
