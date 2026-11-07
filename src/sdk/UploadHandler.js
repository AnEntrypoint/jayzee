import { extname } from 'node:path'

export const UPLOAD_MAX_BYTES = 50 * 1024 * 1024

const ALLOWED_EXTENSIONS = new Set(['.glb', '.gltf', '.vrm'])
const GLB_MAGIC = Buffer.from([0x67, 0x6c, 0x54, 0x46])
const MAGIC_SNIFF_BYTES = 16
const CRLF_BYTES = 2

const STATE_HEADERS = 0
const STATE_FILE_DATA = 1
const STATE_SKIP_FIELD = 2
const STATE_DONE = 3

export function uploadBoundary(contentType = '') {
  const match = String(contentType).match(/boundary=(?:"([^"]+)"|([^;]+))/)
  return match ? (match[1] || match[2]).trim() : null
}

export function uploadExtension(filename) {
  const extension = extname(filename || '').toLowerCase()
  return ALLOWED_EXTENSIONS.has(extension) ? extension : null
}

export function uploadHeadAccepted(extension, head) {
  if (extension === '.glb') return head.length >= 4 && head.subarray(0, 4).equals(GLB_MAGIC)
  const text = head.subarray(0, Math.min(head.length, MAGIC_SNIFF_BYTES)).toString('utf8').trimStart()
  return text.startsWith('{')
}

export function uploadTooLarge(byteCount) {
  return byteCount > UPLOAD_MAX_BYTES
}

export class MultipartUploadParser {
  constructor(boundary) {
    this.delimiter = Buffer.from('--' + boundary)
    this.state = STATE_HEADERS
    this.tail = Buffer.alloc(0)
    this.sawFile = false
    this.fileEnded = false
    this.onFileStart = null
    this.onFileData = null
    this.onFileEnd = null
  }

  write(chunk) {
    if (this.state === STATE_DONE) return
    let buf = this.tail.length ? Buffer.concat([this.tail, chunk]) : chunk
    const keepTail = this.delimiter.length + 4

    while (this.state !== STATE_DONE) {
      if (this.state === STATE_HEADERS) {
        const start = buf.indexOf(this.delimiter)
        if (start === -1) {
          this.tail = buf.subarray(Math.max(0, buf.length - keepTail))
          return
        }
        let pos = start + this.delimiter.length
        if (buf[pos] === 0x2d && buf[pos + 1] === 0x2d) {
          this.state = STATE_DONE
          this.tail = Buffer.alloc(0)
          return
        }
        if (buf[pos] === 0x0d && buf[pos + 1] === 0x0a) pos += 2
        const headerEnd = buf.indexOf('\r\n\r\n', pos)
        if (headerEnd === -1) {
          this.tail = buf.subarray(start)
          return
        }
        const disposition = buf.subarray(pos, headerEnd).toString('utf8').split('\r\n').find(line => line.toLowerCase().startsWith('content-disposition'))
        const filenameMatch = disposition && disposition.match(/filename="([^"]*)"/)
        pos = headerEnd + 4
        if (filenameMatch && filenameMatch[1] && !this.sawFile) {
          this.sawFile = true
          this.fileEnded = false
          this.state = STATE_FILE_DATA
          if (this.onFileStart) this.onFileStart(filenameMatch[1])
        } else {
          this.state = STATE_SKIP_FIELD
        }
        buf = buf.subarray(pos)
        continue
      }

      const boundaryPos = buf.indexOf(this.delimiter)
      if (boundaryPos === -1) {
        const emitLength = Math.max(0, buf.length - keepTail)
        if (emitLength > 0) {
          if (this.state === STATE_FILE_DATA && this.onFileData) this.onFileData(buf.subarray(0, emitLength))
          buf = buf.subarray(emitLength)
        }
        this.tail = buf
        return
      }
      const dataEnd = Math.max(0, boundaryPos - CRLF_BYTES)
      if (dataEnd > 0 && this.state === STATE_FILE_DATA && this.onFileData) this.onFileData(buf.subarray(0, dataEnd))
      if (this.state === STATE_FILE_DATA) {
        this.fileEnded = true
        if (this.onFileEnd) this.onFileEnd()
      }
      buf = buf.subarray(boundaryPos)
      this.state = STATE_HEADERS
    }
  }
}
