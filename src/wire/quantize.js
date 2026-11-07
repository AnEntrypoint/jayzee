export const WIRE_UNITS_PER_METER = 100
export const POSITION_UNITS_LIMIT = 2147483647
export const VELOCITY_UNITS_LIMIT = 32767
export const SCALE_UNITS_LIMIT = 65535

export const refuse = (message) => {
  throw new RangeError('[wire] ' + message)
}

export const quantize = (field, value, minUnits, maxUnits) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) refuse(field + ' is ' + String(value) + ', which is not a finite number the wire can carry')
  const units = Math.round(value * WIRE_UNITS_PER_METER)
  if (units < minUnits || units > maxUnits) refuse(field + ' ' + value + ' quantizes to ' + units + ' wire units, outside [' + minUnits + ', ' + maxUnits + ']')
  return units
}

export const writeUint16 = (bytes, offset, value) => {
  bytes[offset] = value & 0xff
  bytes[offset + 1] = (value >>> 8) & 0xff
}

export const readUint16 = (bytes, offset) => bytes[offset] | (bytes[offset + 1] << 8)

export const writeUint32 = (bytes, offset, value) => {
  bytes[offset] = value & 0xff
  bytes[offset + 1] = (value >>> 8) & 0xff
  bytes[offset + 2] = (value >>> 16) & 0xff
  bytes[offset + 3] = (value >>> 24) & 0xff
}

export const readInt32 = (bytes, offset) => bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)

export const readUint32 = (bytes, offset) => readInt32(bytes, offset) >>> 0

export const readInt16 = (bytes, offset) => ((bytes[offset] | (bytes[offset + 1] << 8)) << 16) >> 16
