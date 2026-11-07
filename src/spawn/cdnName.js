const BARE_TILDE = /~(?![0-9a-f]{2})/

export const decodeName = (name) => {
  if (typeof name !== 'string') throw new TypeError('encoded name must be a string')
  if (BARE_TILDE.test(name)) throw new RangeError('encoded name has a tilde that is not followed by two hex digits: ' + name)
  return name.replace(/~([0-9a-f]{2})/g, (_, hex) => {
    const code = parseInt(hex, 16)
    if (code > 0x7f) throw new RangeError('encoded name uses a non-ASCII escape ~' + hex)
    return String.fromCharCode(code)
  })
}
