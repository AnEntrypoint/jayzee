import zlib from 'node:zlib'

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    table[n] = c >>> 0
  }
  return table
})()

export function crc32(buf) {
  let c = 0xFFFFFFFF
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8)
  return (c ^ 0xFFFFFFFF) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

export function encodePNGGray(width, height, gray) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 0
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  const raw = Buffer.alloc((width + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0
    for (let x = 0; x < width; x++) raw[y * (width + 1) + 1 + x] = gray[y * width + x]
  }
  const idat = zlib.deflateSync(raw, { level: 9 })
  return Buffer.concat([Buffer.from(PNG_SIGNATURE), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

export function decodePNGGray(buf) {
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (buf[i] !== PNG_SIGNATURE[i]) throw new Error('png: bad signature')
  }
  let pos = PNG_SIGNATURE.length
  let header = null
  const idat = []
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    const crc = buf.readUInt32BE(pos + 8 + len)
    if (crc32(buf.subarray(pos + 4, pos + 8 + len)) !== crc) throw new Error('png: bad CRC in ' + type + ' chunk')
    if (type === 'IHDR') header = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), bitDepth: data[8], colorType: data[9], interlace: data[12] }
    else if (type === 'IDAT') idat.push(data)
    pos += 12 + len
    if (type === 'IEND') break
  }
  if (header === null) throw new Error('png: no IHDR chunk')
  if (header.bitDepth !== 8 || header.colorType !== 0 || header.interlace !== 0) throw new Error('png: only 8-bit, unfiltered grayscale is read')
  const { width, height } = header
  const raw = zlib.inflateSync(Buffer.concat(idat))
  if (raw.length !== (width + 1) * height) throw new Error('png: inflated size ' + raw.length + ' is not ' + (width + 1) * height)
  const gray = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    if (raw[y * (width + 1)] !== 0) throw new Error('png: row ' + y + ' uses filter ' + raw[y * (width + 1)])
    for (let x = 0; x < width; x++) gray[y * width + x] = raw[y * (width + 1) + 1 + x]
  }
  return { width, height, gray }
}
