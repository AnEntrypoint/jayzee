import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { buildBody, writeChunks } from './lib/upload-body.mjs'
import { MultipartUploadParser, UPLOAD_MAX_BYTES, uploadBoundary, uploadExtension, uploadHeadAccepted, uploadTooLarge } from '../src/sdk/UploadHandler.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = JSON.parse(readFileSync(join(here, 'fixtures', 'spoint', 'upload-handler.json'), 'utf8'))
const MAGIC_SNIFF_BYTES = 16
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

const verdictOf = (contentType, body, chunkSize) => {
  const boundary = uploadBoundary(contentType)
  if (boundary === null) return { status: 400, body: 'no boundary' }
  const parser = new MultipartUploadParser(boundary)
  const seen = { name: null, ext: null, refusal: null, size: 0, head: Buffer.alloc(0), headChecked: false, stored: [] }
  parser.onFileStart = (name) => {
    seen.name = name
    seen.ext = uploadExtension(name)
    if (seen.ext === null) seen.refusal = { status: 400, body: 'invalid type' }
  }
  parser.onFileData = (chunk) => {
    if (seen.refusal) return
    seen.size += chunk.length
    if (uploadTooLarge(seen.size)) {
      seen.refusal = { status: 413, body: 'too large' }
      return
    }
    seen.stored.push(Buffer.from(chunk))
    if (seen.headChecked) return
    seen.head = Buffer.concat([seen.head, chunk])
    if (seen.head.length >= MAGIC_SNIFF_BYTES || parser.fileEnded) {
      seen.headChecked = true
      if (!uploadHeadAccepted(seen.ext, seen.head)) seen.refusal = { status: 400, body: 'invalid file content' }
    }
  }
  for (const chunk of writeChunks(body, chunkSize)) parser.write(chunk)
  if (seen.refusal) return seen.refusal
  if (seen.name === null) return { status: 400, body: 'no file' }
  if (!seen.headChecked && !uploadHeadAccepted(seen.ext, seen.head)) return { status: 400, body: 'invalid file content' }
  const stored = Buffer.concat(seen.stored)
  return { status: 200, ext: seen.ext, sha256: sha256(stored), length: stored.length }
}

gate('the size cap is 50 MiB, and the first byte over it is too large', () => {
  assert.equal(UPLOAD_MAX_BYTES, 50 * 1024 * 1024)
  assert.equal(uploadTooLarge(UPLOAD_MAX_BYTES), false)
  assert.equal(uploadTooLarge(UPLOAD_MAX_BYTES + 1), true)
})

gate('the pure refusals match: no boundary, an executable extension and a JSON body given as GLB', () => {
  assert.equal(uploadBoundary('multipart/form-data'), null)
  assert.equal(uploadExtension('tool.exe'), null)
  assert.equal(uploadHeadAccepted('.glb', Buffer.from('{"asset":{}}')), false)
})

gate('the fixture holds accepted uploads, invalid-content refusals and the 413 size refusal', () => {
  assert.ok(fixture.cases.some((item) => item.expect.status === 200))
  assert.ok(fixture.cases.some((item) => item.expect.status === 400))
  assert.ok(fixture.cases.some((item) => item.expect.status === 413))
})

for (const item of fixture.cases) {
  gate('upload: ' + item.label, () => {
    const body = buildBody(item)
    assert.deepEqual(verdictOf(item.contentType, body, item.chunkSize), item.expect, 'verdict differs from spoint')
  })
}

gate('parser names only the first file part and emits its bytes whole at one byte per chunk', () => {
  const body = buildBody({ parts: [{ name: 'model', filename: 'a.glb', head: 'glTF', length: 40 }, { name: 'other', filename: 'b.glb', head: 'glTF', length: 40 }] })
  const names = []
  const chunks = []
  const parser = new MultipartUploadParser('BND')
  parser.onFileStart = (name) => names.push(name)
  parser.onFileData = (chunk) => chunks.push(Buffer.from(chunk))
  for (const chunk of writeChunks(body, 1)) parser.write(chunk)
  assert.deepEqual(names, ['a.glb'])
  const data = Buffer.concat(chunks)
  assert.equal(data.length, 40)
  assert.ok(data.subarray(0, 4).equals(Buffer.from('glTF')))
})

gate('parser refuses nothing itself: a body under another boundary starts no file', () => {
  const names = []
  const parser = new MultipartUploadParser('XYZ')
  parser.onFileStart = (name) => names.push(name)
  parser.write(buildBody({ parts: [{ name: 'model', filename: 'a.glb', head: 'glTF', length: 40 }] }))
  assert.deepEqual(names, [])
})

gate('negative control: the same body starts its file under its own boundary, so the refusal above is not vacuous', () => {
  const names = []
  const parser = new MultipartUploadParser('BND')
  parser.onFileStart = (name) => names.push(name)
  parser.write(buildBody({ parts: [{ name: 'model', filename: 'a.glb', head: 'glTF', length: 40 }] }))
  assert.deepEqual(names, ['a.glb'])
})

finish()
