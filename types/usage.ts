import { World, Authority, Predictor, encodeInputs, decodeInputs, encodeSnapshot, decodeSnapshot, encodeState, decodeState } from 'jayzee'

const world = new World({ tickRate: 64, gravity: -18, radius: 0.35, boxes: [[-2, 0, -2, 2, 1, 2]] })
const hero: number = world.spawn([0, 4, 0])
const steps: number = world.advance(1 / 64)
const [x, y, z]: [number, number, number] = world.position(hero)
const packet: ArrayBuffer = encodeInputs([{ sequence: 1, moveX: 0.5, moveZ: 0, yaw: 0, buttons: 1 }])
const records = decodeInputs(packet)
const frame = decodeSnapshot(encodeSnapshot(world.snapshot()))
const digest: number = world.hash()

const serverWorld = new World({ capacity: 4 })
const body = serverWorld.spawn([0, 2, 0])
const authority = new Authority({ world: serverWorld, speed: 6 })
authority.addPlayer(0, body, { window: 64, maxHold: 4 })
authority.receive(0, packet)
authority.step()
const clientWorld = new World({ capacity: 4 })
clientWorld.spawn([0, 2, 0])
const predictor = new Predictor({ world: clientWorld, body: 0, speed: 6 })
const sent: ArrayBuffer = encodeInputs([predictor.predict({ moveX: 1, moveZ: 0, yaw: 0 })])
const reconciled: boolean = predictor.reconcile(decodeState(encodeState(authority.state())))
const stateBytes: number = encodeState(authority.state()).byteLength

export { steps, x, y, z, records, frame, digest, sent, reconciled, stateBytes }
