export const INPUT_VERSION = 1
export const MAX_INPUT_RECORDS = 255

const HEADER_BYTES = 2
const RECORD_BYTES = 12
const AXIS_SCALE = 127
const YAW_STEPS = 65536
const TWO_PI = 2 * Math.PI
const UINT32_MAX = 0xffffffff

const checkUint32 = (value, name) => {
  if (!Number.isInteger(value) || value < 0 || value > UINT32_MAX) throw new RangeError(name + ' must be an integer in 0..' + UINT32_MAX)
  return value
}

const checkAxis = (value, name) => {
  if (typeof value !== 'number' || !(value >= -1 && value <= 1)) throw new RangeError(name + ' must lie in -1..1')
  return Math.round(value * AXIS_SCALE)
}

const yawToSteps = (yaw) => {
  if (typeof yaw !== 'number' || !Number.isFinite(yaw)) throw new TypeError('yaw must be a finite number of radians')
  const wrapped = ((yaw % TWO_PI) + TWO_PI) % TWO_PI
  return Math.round((wrapped / TWO_PI) * YAW_STEPS) % YAW_STEPS
}

export const encodeInputs = (records) => {
  if (!Array.isArray(records)) throw new TypeError('records must be an array')
  if (records.length === 0 || records.length > MAX_INPUT_RECORDS) throw new RangeError('a packet holds 1..' + MAX_INPUT_RECORDS + ' records')
  const view = new DataView(new ArrayBuffer(HEADER_BYTES + records.length * RECORD_BYTES))
  view.setUint8(0, INPUT_VERSION)
  view.setUint8(1, records.length)
  records.forEach((record, index) => {
    const at = HEADER_BYTES + index * RECORD_BYTES
    view.setUint32(at, checkUint32(record.sequence, 'sequence'), true)
    view.setInt8(at + 4, checkAxis(record.moveX, 'moveX'))
    view.setInt8(at + 5, checkAxis(record.moveZ, 'moveZ'))
    view.setUint16(at + 6, yawToSteps(record.yaw), true)
    view.setUint32(at + 8, checkUint32(record.buttons, 'buttons'), true)
  })
  return view.buffer
}

export const decodeInputs = (buffer) => {
  if (!(buffer instanceof ArrayBuffer)) throw new TypeError('input packet must be an ArrayBuffer')
  if (buffer.byteLength < HEADER_BYTES) throw new RangeError('input packet is truncated')
  const view = new DataView(buffer)
  if (view.getUint8(0) !== INPUT_VERSION) throw new RangeError('unsupported input packet version ' + view.getUint8(0))
  const count = view.getUint8(1)
  if (count === 0) throw new RangeError('input packet carries no records')
  if (buffer.byteLength !== HEADER_BYTES + count * RECORD_BYTES) throw new RangeError('input packet length does not match its record count')
  const records = []
  for (let index = 0; index < count; index++) {
    const at = HEADER_BYTES + index * RECORD_BYTES
    records.push({
      sequence: view.getUint32(at, true),
      moveX: view.getInt8(at + 4) / AXIS_SCALE,
      moveZ: view.getInt8(at + 5) / AXIS_SCALE,
      yaw: (view.getUint16(at + 6, true) / YAW_STEPS) * TWO_PI,
      buttons: view.getUint32(at + 8, true),
    })
  }
  return records
}
