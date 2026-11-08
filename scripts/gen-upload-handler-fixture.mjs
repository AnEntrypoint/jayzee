import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { UPLOAD_CONTENT_TYPE, buildBody, payloadBytes, writeChunks } from './lib/upload-body.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const spointRoot = process.argv[2] || '/workspace/spoint'
const source = readFileSync(join(spointRoot, 'src', 'sdk', 'UploadHandler.js'), 'utf8')
const PROGRESSIVE_IMPORT = "import { getProgressive } from '../static/ProgressiveBake.js'"
if (source.split(PROGRESSIVE_IMPORT).length !== 2) throw new Error('ProgressiveBake import not found once')

const work = mkdtempSync(join(tmpdir(), 'spoint-upload-'))
const modulePath = join(work, 'UploadHandler.mjs')
writeFileSync(modulePath, source.replace(PROGRESSIVE_IMPORT, 'const getProgressive = () => null'))
const { createUploadHandler } = await import(pathToFileURL(modulePath).href)
process.chdir(work)
const handler = createUploadHandler(null, null, null)

const GLB = 'glTF\u0002\u0000\u0000\u0000'
const JSON_HEAD = '{"asset":{}}'
const MiB = 1024 * 1024
const single = (filename, head, length) => [{ name: 'model', filename, head, length }]
const twoFiles = (firstLength, secondLength) => [
  { name: 'model', filename: 'a.glb', head: GLB, length: firstLength },
  { name: 'other', filename: 'b.glb', head: GLB, length: secondLength },
]

const CASES = [
  { label: 'a GLB with the GLB magic is stored at one byte per chunk', chunkSize: 1, parts: single('a.glb', GLB, 40) },
  { label: 'a quoted boundary is read', contentType: 'multipart/form-data; boundary="BND"', chunkSize: 7, parts: single('a.glb', GLB, 40) },
  { label: 'an upper case GLB extension is stored under its lower case extension', chunkSize: 65536, parts: single('Model.GLB', GLB, 40) },
  { label: 'a GLTF that opens with the GLB magic is refused as invalid content', chunkSize: 7, parts: single('scene.gltf', GLB, 40) },
  { label: 'a GLTF that opens with a JSON brace after whitespace is stored', chunkSize: 1, parts: single('scene.gltf', '  \n' + JSON_HEAD, 40) },
  { label: 'a VRM that opens with a JSON brace is stored', chunkSize: 65536, parts: single('avatar.vrm', JSON_HEAD, 40) },
  { label: 'an executable is refused by its extension', chunkSize: 7, parts: single('tool.exe', 'MZ\u0090\u0000', 40) },
  { label: 'a file with no extension is refused by its extension', chunkSize: 7, parts: single('model', GLB, 40) },
  { label: 'a GLB whose bytes are JSON is refused as invalid content', chunkSize: 7, parts: single('a.glb', JSON_HEAD, 40) },
  { label: 'a GLB shorter than four bytes is refused as invalid content', chunkSize: 1, parts: single('a.glb', 'glT', 3) },
  { label: 'an empty GLB is refused as invalid content', chunkSize: 1, parts: single('a.glb', '', 0) },
  { label: 'a body with no file part is refused as no file', chunkSize: 7, parts: [{ name: 'note', head: 'value' }] },
  { label: 'a body whose content type has no boundary is refused before parsing', contentType: 'multipart/form-data', chunkSize: 7, parts: single('a.glb', GLB, 40) },
  { label: 'a file part with no header terminator starts no file and is refused as no file', chunkSize: 7, raw: '--BND\r\nContent-Disposition: form-data; name="model"; filename="a.glb"\r\n' },
  { label: 'a body cut off before its closing boundary keeps all but its last bytes', chunkSize: 1, raw: '--BND\r\nContent-Disposition: form-data; name="model"; filename="a.glb"\r\nContent-Type: model/gltf-binary\r\n\r\n' + GLB + 'A'.repeat(40) },
  { label: 'the first file part is stored and a second is ignored, at one byte per chunk', chunkSize: 1, parts: twoFiles(40, 40) },
  { label: 'the first file part is stored and a second is ignored, at seven bytes per chunk', chunkSize: 7, parts: twoFiles(40, 40) },
  { label: 'the first file part is stored and a second is ignored, in one write', chunkSize: 0, parts: twoFiles(40, 40) },
  { label: 'a 50 MiB GLB is stored, so the cap is inclusive', chunkSize: 65536, parts: single('a.glb', GLB, 50 * MiB) },
  { label: 'a GLB one byte over 50 MiB is refused as too large', chunkSize: 65536, parts: single('a.glb', GLB, 50 * MiB + 1) },
  { label: 'the cap counts file bytes only, so a 50 MiB GLB followed by a field is stored', chunkSize: 65536, parts: [{ name: 'model', filename: 'a.glb', head: GLB, length: 50 * MiB }, { name: 'note', head: 'x'.repeat(1000) }] },
  { label: 'the cap applies to the first file part only, so a second file over 50 MiB is ignored', chunkSize: 65536, parts: twoFiles(MiB, 50 * MiB + 1) },
]

const settle = async (expected) => {
  const dir = join(work, 'data', 'models')
  let last = null
  let stable = 0
  for (let i = 0; i < 400; i++) {
    await new Promise((r) => setTimeout(r, 25))
    const names = readdirSync(dir).filter((n) => n.endsWith('.part'))
    if (names.length === 0) {
      if (i >= 3) return
      continue
    }
    const size = statSync(join(dir, names[0])).size
    if (expected !== undefined && size === expected) return
    stable = size === last ? stable + 1 : 0
    last = size
    if (expected === undefined && stable >= 3) return
  }
}

const expectedStored = (spec) => {
  const first = spec.raw === undefined && spec.parts ? spec.parts.find((part) => part.filename !== undefined) : undefined
  return first ? payloadBytes(first).length : undefined
}

const runSpoint = (spec) => new Promise((resolve, reject) => {
  const req = new EventEmitter()
  req.headers = { 'content-type': spec.contentType }
  req.destroy = () => {}
  const timer = setTimeout(() => reject(new Error('no response')), 60000)
  const res = {
    writeHead(status) { this.status = status },
    end(text) {
      clearTimeout(timer)
      if (this.status !== 200) return resolve({ status: this.status, body: text })
      const url = JSON.parse(text).url
      const stored = readFileSync(join(work, 'data', 'models', basename(url)))
      resolve({ status: 200, ext: extname(url), sha256: createHash('sha256').update(stored).digest('hex'), length: stored.length })
    },
  }
  handler(req, res)
  void (async () => {
    for (const chunk of writeChunks(buildBody(spec), spec.chunkSize)) {
      req.emit('data', chunk)
      await new Promise((r) => setImmediate(r))
    }
    await settle(expectedStored(spec))
    req.emit('end')
  })()
})

const cases = []
for (const item of CASES) {
  const spec = { contentType: item.contentType || UPLOAD_CONTENT_TYPE, chunkSize: item.chunkSize, parts: item.parts, raw: item.raw }
  const expect = await runSpoint(spec)
  cases.push({ label: item.label, contentType: spec.contentType, chunkSize: spec.chunkSize, parts: spec.parts, raw: spec.raw, expect })
  console.log(expect.status, item.label)
}
rmSync(work, { recursive: true, force: true })
writeFileSync(join(here, 'fixtures', 'spoint', 'upload-handler.json'), JSON.stringify({ source: 'spoint src/sdk/UploadHandler.js createUploadHandler, driven through a fake request with ProgressiveBake.js stubbed', cases }, null, 2) + '\n')
console.log('wrote', cases.length, 'cases')
