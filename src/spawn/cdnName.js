const BARE_TILDE = /~(?![0-9a-f]{2})/
const HEX = '0123456789abcdef'

const UTF8 = new TextDecoder('utf-8', { fatal: true })

export const decodeName = (name) => {
  if (typeof name !== 'string') throw new TypeError('encoded name must be a string')
  if (BARE_TILDE.test(name)) throw new RangeError('encoded name has a tilde that is not followed by two hex digits: ' + name)
  const bytes = new Uint8Array(name.length)
  let length = 0
  let wide = false
  for (let i = 0; i < name.length; i++) {
    const code = name.charCodeAt(i)
    if (code === 126) {
      const byte = parseInt(name.slice(i + 1, i + 3), 16)
      if (byte > 0x7f) wide = true
      bytes[length++] = byte
      i += 2
      continue
    }
    if (code > 0x7f) throw new RangeError('encoded name holds a character outside ASCII at index ' + i + ': ' + name)
    bytes[length++] = code
  }
  if (!wide) return String.fromCharCode(...bytes.subarray(0, length))
  try {
    return UTF8.decode(bytes.subarray(0, length))
  } catch {
    throw new RangeError('encoded name has escapes that are not valid UTF-8: ' + name)
  }
}

const isLiteralByte = (byte) => (byte >= 97 && byte <= 122) || (byte >= 48 && byte <= 57) || byte === 46 || byte === 45 || byte === 95

export const encodeName = (name) => {
  if (typeof name !== 'string') throw new TypeError('name must be a string')
  return [...new TextEncoder().encode(name)]
    .map((byte) => (isLiteralByte(byte) ? String.fromCharCode(byte) : '~' + HEX[byte >> 4] + HEX[byte & 15]))
    .join('')
}
