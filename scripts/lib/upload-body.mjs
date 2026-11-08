export const UPLOAD_BOUNDARY = 'BND'
export const UPLOAD_CONTENT_TYPE = 'multipart/form-data; boundary=' + UPLOAD_BOUNDARY

export const payloadBytes = (part) => {
  const head = Buffer.from(part.head || '', 'latin1')
  const length = part.length === undefined ? head.length : part.length
  const out = Buffer.alloc(length, 0x41)
  head.copy(out, 0, 0, Math.min(head.length, length))
  return out
}

export const buildBody = (spec) => {
  if (spec.raw !== undefined) return Buffer.from(spec.raw, 'latin1')
  const pieces = []
  for (const part of spec.parts) {
    const disposition = part.filename === undefined
      ? 'form-data; name="' + part.name + '"'
      : 'form-data; name="' + part.name + '"; filename="' + part.filename + '"'
    pieces.push(Buffer.from('--' + UPLOAD_BOUNDARY + '\r\nContent-Disposition: ' + disposition + '\r\nContent-Type: application/octet-stream\r\n\r\n', 'latin1'))
    pieces.push(payloadBytes(part))
    pieces.push(Buffer.from('\r\n', 'latin1'))
  }
  pieces.push(Buffer.from('--' + UPLOAD_BOUNDARY + '--\r\n', 'latin1'))
  return Buffer.concat(pieces)
}

export const writeChunks = (body, chunkSize) => {
  if (!chunkSize) return [body]
  const out = []
  for (let offset = 0; offset < body.length; offset += chunkSize) out.push(body.subarray(offset, offset + chunkSize))
  return out
}
