export const readFrames = (bytes) => {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('frames must be read from a Uint8Array or Buffer')
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const frames = []
  let offset = 0
  while (offset < buffer.length) {
    if (offset + 4 > buffer.length) throw new RangeError('frame header truncated at byte ' + offset)
    const length = buffer.readUInt32BE(offset)
    const end = offset + 4 + length
    if (end > buffer.length) throw new RangeError('frame at byte ' + offset + ' overruns the input by ' + (end - buffer.length) + ' bytes')
    frames.push(buffer.subarray(offset + 4, end))
    offset = end
  }
  return frames
}
