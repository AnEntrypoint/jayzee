import { createWriteStream, existsSync, mkdirSync, renameSync, unlinkSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { extname, resolve } from 'node:path'

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

export function createUploadHandler({ modelsDir }) {
  const dir = resolve(modelsDir)
  mkdirSync(dir, { recursive: true })

  return function handleUpload(req, res) {
    const boundary = uploadBoundary(req.headers['content-type'])
    if (boundary === null) { res.writeHead(400); res.end('no boundary'); return }

    const tmpPath = resolve(dir, randomUUID() + '.part')
    const removeTmp = () => { if (existsSync(tmpPath)) unlinkSync(tmpPath) }
    const upload = { finished: false, size: 0, filename: null, writeStream: null, head: Buffer.alloc(0), headChecked: false }
    const parser = new MultipartUploadParser(boundary)

    const fail = (status, message) => {
      if (upload.finished) return
      upload.finished = true
      const reply = () => { res.writeHead(status); res.end(message); req.destroy() }
      if (upload.writeStream && !upload.writeStream.closed) {
        upload.writeStream.once('close', () => { removeTmp(); reply() })
        upload.writeStream.destroy()
      } else {
        removeTmp()
        reply()
      }
    }

    parser.onFileStart = (name) => {
      upload.filename = name
      if (uploadExtension(name) === null) { fail(400, 'invalid type'); return }
      upload.writeStream = createWriteStream(tmpPath)
      upload.writeStream.on('error', () => fail(500, 'error'))
    }
    parser.onFileData = (chunk) => {
      if (upload.finished || !upload.writeStream) return
      upload.size += chunk.length
      if (uploadTooLarge(upload.size)) { fail(413, 'too large'); return }
      if (!upload.headChecked) {
        upload.head = Buffer.concat([upload.head, chunk])
        if (upload.head.length >= MAGIC_SNIFF_BYTES || parser.fileEnded) {
          upload.headChecked = true
          if (!uploadHeadAccepted(uploadExtension(upload.filename), upload.head)) { fail(400, 'invalid file content'); return }
        }
      }
      upload.writeStream.write(chunk)
    }

    req.on('data', (chunk) => {
      if (upload.finished) return
      try { parser.write(chunk) } catch { fail(400, 'malformed multipart body') }
    })
    req.on('end', () => {
      if (upload.finished) return
      if (upload.filename === null) { fail(400, 'no file'); return }
      if (!upload.headChecked && !uploadHeadAccepted(uploadExtension(upload.filename), upload.head)) { fail(400, 'invalid file content'); return }
      upload.writeStream.end(() => {
        if (upload.finished) return
        upload.finished = true
        const name = randomUUID() + uploadExtension(upload.filename)
        try {
          renameSync(tmpPath, resolve(dir, name))
        } catch {
          removeTmp()
          res.writeHead(500)
          res.end('error')
          return
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ url: '/data/models/' + name }))
      })
    })
    req.on('error', () => fail(500, 'error'))
  }
}
