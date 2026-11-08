const BARE_TILDE = /~(?![0-9a-f]{2})/
const HEX = '0123456789abcdef'

export const decodeName = (name) => {
  if (typeof name !== 'string') throw new TypeError('encoded name must be a string')
  if (BARE_TILDE.test(name)) throw new RangeError('encoded name has a tilde that is not followed by two hex digits: ' + name)
  return name.replace(/~([0-9a-f]{2})/g, (_, hex) => {
    const code = parseInt(hex, 16)
    if (code > 0x7f) throw new RangeError('encoded name uses a non-ASCII escape ~' + hex)
    return String.fromCharCode(code)
  })
}

const isLiteralByte = (byte) => (byte >= 97 && byte <= 122) || (byte >= 48 && byte <= 57) || byte === 46 || byte === 45 || byte === 95

export const encodeName = (name) => {
  if (typeof name !== 'string') throw new TypeError('name must be a string')
  return [...new TextEncoder().encode(name)]
    .map((byte) => (isLiteralByte(byte) ? String.fromCharCode(byte) : '~' + HEX[byte >> 4] + HEX[byte & 15]))
    .join('')
}
