import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { buildBody, writeChunks } from './lib/upload-body.mjs'
import { createUploadHandler } from '../src/sdk/UploadHandler.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = JSON.parse(readFileSync(join(here, 'fixtures', 'spoint', 'upload-handler.json'), 'utf8'))
const root = mkdtempSync(join(tmpdir(), 'jayzee-upload-writes-'))
const NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(glb|gltf|vrm)$/
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

const runCase = (item, index) => new Promise((done, reject) => {
  const dir = join(root, 'case-' + index)
  const handler = createUploadHandler({ modelsDir: dir })
  const req = new EventEmitter()
  req.headers = { 'content-type': item.contentType }
  req.destroy = () => {}
  const timer = setTimeout(() => reject(new Error('no response: ' + item.label)), 15000)
  const res = {
    writeHead(status) { this.status = status },
    end(body) {
      clearTimeout(timer)
      done({ status: this.status, body, files: readdirSync(dir), dir })
    },
  }
  handler(req, res)
  void (async () => {
    for (const chunk of writeChunks(buildBody(item), item.chunkSize)) {
      req.emit('data', chunk)
      await new Promise((r) => setImmediate(r))
    }
    req.emit('end')
  })()
})

const results = []
for (const [index, item] of fixture.cases.entries()) results.push(await runCase(item, index))

const check = (item, result) => {
  if (item.expect.status !== 200) {
    assert.equal(result.status, item.expect.status)
    assert.equal(result.body, item.expect.body)
    assert.deepEqual(result.files, [], 'a refused upload must leave no file behind')
    return
  }
  assert.equal(result.status, 200)
  const { url } = JSON.parse(result.body)
  const name = url.slice('/data/models/'.length)
  assert.match(name, NAME)
  assert.equal(name.slice(name.lastIndexOf('.')), item.expect.ext)
  assert.deepEqual(result.files, [name])
  const stored = readFileSync(join(result.dir, name))
  assert.equal(sha256(stored), item.expect.sha256)
  assert.equal(stored.length, item.expect.length)
}

fixture.cases.forEach((item, index) => gate('upload write: ' + item.label, () => check(item, results[index])))

gate('the fixture holds an accepted write that leaves one file, and a refusal that leaves none', () => {
  assert.ok(results.some((result) => result.status === 200 && result.files.length === 1))
  assert.ok(results.some((result) => result.status === 400 && result.files.length === 0))
})

gate('the handler creates its models directory when it is made', () => {
  const dir = join(root, 'fresh', 'models')
  createUploadHandler({ modelsDir: dir })
  assert.equal(existsSync(dir), true)
})

rmSync(root, { recursive: true, force: true })
finish()
