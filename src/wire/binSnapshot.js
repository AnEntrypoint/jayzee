import {
  refuse,
  quantize,
  readInt16,
  readInt32,
  readUint16,
  readUint32,
  writeUint16,
  writeUint32,
  WIRE_UNITS_PER_METER,
  POSITION_UNITS_LIMIT,
  VELOCITY_UNITS_LIMIT,
  SCALE_UNITS_LIMIT
} from './quantize.js'

export const ENTITY_RECORD_BYTES = 29
export const PLAYER_RECORD_BYTES = 22

const POSITION_AT = [0, 4, 8]
const VELOCITY_AT = [12, 14, 16]
const ROTATION_AT = 18
const SCALE_AT = [22, 24, 26]
const FLAGS_AT = 28

const QUAT_WORD_MAX = 0xffffffff
const UNIT_QUATERNION_TOLERANCE = 2e-4
const SMALLEST_THREE_FIELD_LEVELS = 1022
const SMALLEST_THREE_STEPS_PER_UNIT = 511 * Math.SQRT2
const SMALLEST_THREE_FIELD_SPAN = 1024
const SMALLEST_THREE_LARGEST_SHIFT = 2 ** 30
const SMALLEST_THREE_HIGH_FIELD_SHIFT = 2 ** 20

const triple = (field, value) => {
  if (!Array.isArray(value) || value.length !== 3) refuse(field + ' must be an array of three numbers')
  return value
}

const quatWord = (value) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) refuse('rotation is ' + String(value) + ', which is not a finite number the wire can carry')
  if (!Number.isInteger(value) || value < 0 || value > QUAT_WORD_MAX) refuse('rotation ' + value + ' is not an integer in [0, ' + QUAT_WORD_MAX + '], the only rotation words the wire can carry')
  return value
}

const recordBytesOf = (input, size) => {
  const bytes = input instanceof DataView ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength) : input
  if (!(bytes instanceof Uint8Array)) refuse('record must be a Uint8Array or a DataView')
  if (bytes.length !== size) refuse('record holds ' + bytes.length + ' bytes, expected ' + size + (bytes.length < size ? ' (truncated)' : ''))
  return bytes
}

const writeKinematics = (bytes, position, velocity, rotationWord) => {
  triple('position', position)
  triple('velocity', velocity)
  for (let axis = 0; axis < 3; axis++) {
    writeUint32(bytes, POSITION_AT[axis], quantize('position[' + axis + ']', position[axis], -POSITION_UNITS_LIMIT, POSITION_UNITS_LIMIT))
  }
  for (let axis = 0; axis < 3; axis++) {
    writeUint16(bytes, VELOCITY_AT[axis], quantize('velocity[' + axis + ']', velocity[axis], -VELOCITY_UNITS_LIMIT, VELOCITY_UNITS_LIMIT))
  }
  writeUint32(bytes, ROTATION_AT, quatWord(rotationWord))
}

const readPosition = (bytes) => POSITION_AT.map((at) => readInt32(bytes, at) / WIRE_UNITS_PER_METER)

const readVelocity = (bytes) => VELOCITY_AT.map((at) => readInt16(bytes, at) / WIRE_UNITS_PER_METER)

export const encodePlayerRecord = ({ position, rotationWord, velocity }, into = new Uint8Array(PLAYER_RECORD_BYTES)) => {
  const bytes = recordBytesOf(into, PLAYER_RECORD_BYTES)
  writeKinematics(bytes, position, velocity, rotationWord)
  return bytes
}

export const decodePlayerRecord = (input) => {
  const bytes = recordBytesOf(input, PLAYER_RECORD_BYTES)
  return {
    position: readPosition(bytes),
    rotationWord: readUint32(bytes, ROTATION_AT),
    velocity: readVelocity(bytes)
  }
}

export const encodeEntityRecord = ({ position, rotationWord, velocity, scale, flags }, into = new Uint8Array(ENTITY_RECORD_BYTES)) => {
  const bytes = recordBytesOf(into, ENTITY_RECORD_BYTES)
  writeKinematics(bytes, position, velocity, rotationWord)
  triple('scale', scale)
  for (let axis = 0; axis < 3; axis++) {
    writeUint16(bytes, SCALE_AT[axis], quantize('scale[' + axis + ']', scale[axis], 0, SCALE_UNITS_LIMIT))
  }
  if (!Number.isInteger(flags) || flags < 0 || flags > 0xff) refuse('flags ' + String(flags) + ' is not a byte')
  bytes[FLAGS_AT] = flags
  return bytes
}

export const decodeEntityRecord = (input) => {
  const bytes = recordBytesOf(input, ENTITY_RECORD_BYTES)
  return {
    position: readPosition(bytes),
    rotationWord: readUint32(bytes, ROTATION_AT),
    velocity: readVelocity(bytes),
    scale: SCALE_AT.map((at) => readUint16(bytes, at) / WIRE_UNITS_PER_METER),
    flags: bytes[FLAGS_AT]
  }
}

const quantizeSmallestThreeField = (value) => {
  const level = Math.round((value + Math.SQRT1_2) * SMALLEST_THREE_STEPS_PER_UNIT)
  return Math.max(0, Math.min(SMALLEST_THREE_FIELD_LEVELS, level))
}

const assertUnitQuaternion = (components) => {
  for (let i = 0; i < 4; i++) {
    const value = components[i]
    if (typeof value !== 'number' || !Number.isFinite(value)) refuse('rotation[' + i + '] is ' + String(value) + ', which is not a finite number the wire can carry')
  }
  const sumSquares = components.reduce((sum, value) => sum + value * value, 0)
  if (Math.abs(sumSquares - 1) > UNIT_QUATERNION_TOLERANCE) refuse('rotation [' + components.join(', ') + '] has |q|^2 ' + sumSquares + ', which is not a unit quaternion the wire can carry')
}

export const encodeSmallestThree = (components) => {
  assertUnitQuaternion(components)
  let largest = 0
  for (let i = 1; i < 4; i++) {
    if (Math.abs(components[i]) > Math.abs(components[largest])) largest = i
  }
  const sign = components[largest] < 0 ? -1 : 1
  let word = largest
  for (let i = 0; i < 4; i++) {
    if (i === largest) continue
    word = word * SMALLEST_THREE_FIELD_SPAN + quantizeSmallestThreeField(components[i] * sign)
  }
  return word
}

export const decodeSmallestThree = (word) => {
  quatWord(word)
  const largest = Math.floor(word / SMALLEST_THREE_LARGEST_SHIFT)
  const fields = [
    Math.floor(word / SMALLEST_THREE_HIGH_FIELD_SHIFT) % SMALLEST_THREE_FIELD_SPAN,
    Math.floor(word / SMALLEST_THREE_FIELD_SPAN) % SMALLEST_THREE_FIELD_SPAN,
    word % SMALLEST_THREE_FIELD_SPAN
  ].map((level) => level / SMALLEST_THREE_STEPS_PER_UNIT - Math.SQRT1_2)
  const sumSquares = fields.reduce((sum, value) => sum + value * value, 0)
  if (sumSquares > 1) refuse('word ' + word + ' stores |three|^2 ' + sumSquares + ', which no unit quaternion can have')
  const components = []
  let next = 0
  for (let i = 0; i < 4; i++) {
    components.push(i === largest ? Math.sqrt(1 - sumSquares) : fields[next++])
  }
  return components
}

export const msgpackArrayHeader = (count) => {
  if (!Number.isInteger(count) || count < 0 || count > 0xffffffff) refuse('array length ' + String(count) + ' is not a uint32')
  if (count < 16) return Uint8Array.of(0x90 | count)
  if (count < 0x10000) return Uint8Array.of(0xdc, count >>> 8, count & 0xff)
  return Uint8Array.of(0xdd, (count >>> 24) & 0xff, (count >>> 16) & 0xff, (count >>> 8) & 0xff, count & 0xff)
}

export const frameRecordArray = (records) => {
  for (const record of records) {
    if (!(record instanceof Uint8Array)) refuse('every framed record must be a Uint8Array')
  }
  const header = msgpackArrayHeader(records.length)
  const total = records.reduce((sum, record) => sum + record.length, header.length)
  const framed = new Uint8Array(total)
  framed.set(header, 0)
  let offset = header.length
  for (const record of records) {
    framed.set(record, offset)
    offset += record.length
  }
  return framed
}
