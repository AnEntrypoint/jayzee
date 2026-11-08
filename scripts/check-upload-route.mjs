import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { UPLOAD_CONTENT_TYPE, buildBody, payloadBytes, writeChunks } from './lib/upload-body.mjs'
import { UPLOAD_PATH, createUploadRoute } from '../src/sdk/UploadRoute.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = mkdtempSync(join(tmpdir(), 'jayzee-upload-route-'))
const TOKEN = 'gate-token-0123456789abcdef'
const WRONG = 'gate-token-wrong-0000000000'
const GLB = { name: 'model', filename: 'a.glb', head: 'glTF', length: 40 }
const UUID_GLB = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.glb$/
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
const bearer = (token) => 'Bearer ' + token

let caseCount = 0
const caseRoute = (env) => {
  caseCount += 1
  const dir = join(root, 'case-' + caseCount)
  return { dir, route: createUploadRoute({ modelsDir: dir, env }) }
}

const send = (route, dir, { method = 'POST', authorization } = {}) => new Promise((done, reject) => {
  const req = new EventEmitter()
  req.method = method
  req.url = UPLOAD_PATH
  req.headers = { 'content-type': UPLOAD_CONTENT_TYPE }
  if (authorization !== undefined) req.headers.authorization = authorization
  req.destroy = () => {}
  const timer = setTimeout(() => reject(new Error('no response from the upload route')), 15000)
  const res = {
    status: 0,
    headers: {},
    writeHead(status, headers = {}) {
      this.status = status
      this.headers = headers
    },
    end(message = '') {
      clearTimeout(timer)
      done({ status: this.status, headers: this.headers, body: message, dir, files: readdirSync(dir) })
    },
  }
  route(req, res)
  void (async () => {
    for (const chunk of writeChunks(buildBody({ parts: [GLB] }), 4096)) {
      req.emit('data', chunk)
      await new Promise((r) => setImmediate(r))
    }
    req.emit('end')
  })()
})

const attempt = (env, options) => {
  const { dir, route } = caseRoute(env)
  return send(route, dir, options)
}

const results = {
  noHeader: await attempt({ UPLOAD_TOKEN: TOKEN }, {}),
  basic: await attempt({ UPLOAD_TOKEN: TOKEN }, { authorization: 'Basic ' + Buffer.from('user:' + TOKEN).toString('base64') }),
  wrong: await attempt({ UPLOAD_TOKEN: TOKEN }, { authorization: bearer(WRONG) }),
  prefix: await attempt({ UPLOAD_TOKEN: TOKEN }, { authorization: bearer(TOKEN.slice(0, -1)) }),
  right: await attempt({ UPLOAD_TOKEN: TOKEN }, { authorization: bearer(TOKEN) }),
  lowerScheme: await attempt({ UPLOAD_TOKEN: TOKEN }, { authorization: 'bearer ' + TOKEN }),
  getRequest: await attempt({ UPLOAD_TOKEN: TOKEN }, { method: 'GET', authorization: bearer(TOKEN) }),
  unsetRight: await attempt({}, { authorization: bearer(TOKEN) }),
  unsetNone: await attempt({}, {}),
  emptyRight: await attempt({ UPLOAD_TOKEN: '' }, { authorization: bearer(TOKEN) }),
}

const live = {}
const liveCase = caseRoute(live)
const liveBefore = await send(liveCase.route, liveCase.dir, { authorization: bearer(TOKEN) })
live.UPLOAD_TOKEN = TOKEN
const liveAfter = await send(liveCase.route, liveCase.dir, { authorization: bearer(TOKEN) })

const savedToken = process.env.UPLOAD_TOKEN
const processCase = caseRoute(undefined)
let processUnset
let processSet
try {
  delete process.env.UPLOAD_TOKEN
  processUnset = await send(processCase.route, processCase.dir, { authorization: bearer(TOKEN) })
  process.env.UPLOAD_TOKEN = TOKEN
  processSet = await send(processCase.route, processCase.dir, { authorization: bearer(TOKEN) })
} finally {
  if (savedToken === undefined) delete process.env.UPLOAD_TOKEN
  else process.env.UPLOAD_TOKEN = savedToken
}

const refused = (result, status) => {
  assert.equal(result.status, status)
  assert.deepEqual(result.files, [], 'a refused upload must leave no file behind')
}

const stored = (result) => {
  assert.equal(result.status, 200)
  assert.equal(result.files.length, 1)
  assert.match(result.files[0], UUID_GLB)
  const bytes = readFileSync(join(result.dir, result.files[0]))
  assert.equal(bytes.length, GLB.length)
  assert.equal(sha256(bytes), sha256(payloadBytes(GLB)))
}

gate('upload route: a POST with no Authorization header is refused 401 and stores no file', () => {
  refused(results.noHeader, 401)
})

gate('upload route: a Basic credential is refused 401 and stores no file', () => {
  refused(results.basic, 401)
})

gate('upload route: a wrong token of the same length is refused 401 and stores no file', () => {
  refused(results.wrong, 401)
})

gate('upload route: a prefix of the right token is refused 401 and stores no file', () => {
  refused(results.prefix, 401)
})

gate('upload route: the right token stores the file, with the same length and sha256', () => {
  stored(results.right)
})

gate('upload route: the Bearer scheme is matched without regard to case', () => {
  stored(results.lowerScheme)
})

gate('upload route: a non-POST request is refused 405 and stores no file', () => {
  refused(results.getRequest, 405)
})

gate('upload route: an unset UPLOAD_TOKEN refuses every request with 503 and stores no file', () => {
  refused(results.unsetRight, 503)
  refused(results.unsetNone, 503)
  assert.match(results.unsetRight.body, /UPLOAD_TOKEN/)
})

gate('upload route: an empty UPLOAD_TOKEN refuses every request with 503 and stores no file', () => {
  refused(results.emptyRight, 503)
})

gate('upload route: UPLOAD_TOKEN is read on each request, so a token set after the route is made takes effect', () => {
  refused(liveBefore, 503)
  stored(liveAfter)
})

gate('upload route: with no env argument it reads process.env.UPLOAD_TOKEN on each request', () => {
  refused(processUnset, 503)
  stored(processSet)
})

gate('upload route: a 401 says what to send and sets the Bearer challenge', () => {
  assert.equal(results.noHeader.headers['WWW-Authenticate'], 'Bearer')
  assert.match(results.noHeader.body, /Bearer/)
})

gate('the example env file carries the placeholder token and nothing else', () => {
  assert.equal(readFileSync(join(here, '..', '.env.example'), 'utf8'), 'UPLOAD_TOKEN=replace-with-a-long-random-token\n')
})

gate('.env is ignored by git, so the real token never reaches a commit', () => {
  assert.ok(readFileSync(join(here, '..', '.gitignore'), 'utf8').split('\n').includes('.env'))
})

rmSync(root, { recursive: true, force: true })
finish()
