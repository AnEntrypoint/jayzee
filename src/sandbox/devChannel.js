import { COEP_VALUE, resolveWithinRoot } from './paths.js'

export const COOP_VALUE = 'same-origin'
export const CORP_VALUE = 'same-origin'
export const ISOLATION_HEADERS = Object.freeze({
  'Cross-Origin-Opener-Policy': COOP_VALUE,
  'Cross-Origin-Embedder-Policy': COEP_VALUE,
  'Cross-Origin-Resource-Policy': CORP_VALUE,
})

export const DIAG_LEVELS = Object.freeze(['debug', 'info', 'warn', 'error'])
export const CMD_PENDING = 'pending'
export const CMD_SENT = 'sent'
export const CMD_DONE = 'done'

const DEFAULT_DIAG_CAPACITY = 256
const DEFAULT_CMD_CAPACITY = 64
const DEFAULT_MAX_BODY_BYTES = 16384
const MAX_PAGE = 256
const JSON_TYPE = 'application/json; charset=utf-8'

export class DevChannelError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`)
    this.name = 'DevChannelError'
    this.code = code
  }
}

function wholeCapacity(name, value) {
  if (!Number.isInteger(value) || value < 1) throw new DevChannelError('dev-channel-capacity-not-whole', `${name} must be a positive integer, got ${value}`)
  return value
}

function splitTarget(target) {
  const text = typeof target === 'string' ? target : ''
  const mark = text.indexOf('?')
  const path = mark < 0 ? text : text.slice(0, mark)
  const query = {}
  if (mark >= 0) {
    for (const pair of text.slice(mark + 1).split('&')) {
      if (pair === '') continue
      const eq = pair.indexOf('=')
      query[eq < 0 ? pair : pair.slice(0, eq)] = eq < 0 ? '' : pair.slice(eq + 1)
    }
  }
  return { path, query }
}

function wholeQuery(query, name, fallback) {
  if (query[name] === undefined) return fallback
  const value = Number(query[name])
  return Number.isInteger(value) && value >= 0 ? value : null
}

export function createDevChannel(opts = {}) {
  const now = opts.now
  if (typeof now !== 'function') throw new TypeError('createDevChannel needs a now() clock')
  const diagCapacity = wholeCapacity('diagCapacity', opts.diagCapacity ?? DEFAULT_DIAG_CAPACITY)
  const cmdCapacity = wholeCapacity('cmdCapacity', opts.cmdCapacity ?? DEFAULT_CMD_CAPACITY)
  const maxBodyBytes = wholeCapacity('maxBodyBytes', opts.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES)
  const diagRing = new Array(diagCapacity).fill(null)
  const cmdRing = new Array(cmdCapacity).fill(null)
  let diagSeq = 0
  let cmdSeq = 0
  let cmdOpen = 0

  function diag(level, msg, data = null) {
    if (!DIAG_LEVELS.includes(level)) throw new DevChannelError('diag-level-unknown', `level must be one of ${DIAG_LEVELS.join(', ')}, got ${JSON.stringify(level ?? null)}`)
    if (typeof msg !== 'string' || msg === '') throw new DevChannelError('diag-msg-not-text', 'msg must be a non-empty string')
    diagSeq++
    diagRing[(diagSeq - 1) % diagCapacity] = { seq: diagSeq, t: now(), level, msg, data }
    return diagSeq
  }

  function diagSince(since = 0, limit = MAX_PAGE) {
    const oldest = Math.max(1, diagSeq - diagCapacity + 1)
    const first = Math.max(since + 1, oldest)
    const entries = []
    for (let seq = first; seq <= diagSeq && entries.length < limit; seq++) entries.push(diagRing[(seq - 1) % diagCapacity])
    const next = entries.length > 0 ? entries[entries.length - 1].seq : Math.max(since, Math.min(diagSeq, oldest - 1))
    return { entries, next, dropped: Math.max(0, oldest - 1 - since), latest: diagSeq }
  }

  function slotOf(id) {
    const entry = cmdRing[(id - 1) % cmdCapacity]
    return entry !== null && entry.id === id ? entry : null
  }

  function send(cmd, args = null) {
    if (typeof cmd !== 'string' || cmd === '') throw new DevChannelError('cmd-not-text', 'cmd must be a non-empty string')
    if (cmdOpen === cmdCapacity) throw new DevChannelError('cmd-queue-full', `${cmdCapacity} commands are waiting for a result, the queue takes no more`)
    let id = cmdSeq + 1
    while (cmdRing[(id - 1) % cmdCapacity] !== null && cmdRing[(id - 1) % cmdCapacity].state !== CMD_DONE) id++
    cmdSeq = id
    cmdRing[(id - 1) % cmdCapacity] = { id, t: now(), cmd, args, state: CMD_PENDING, ok: null, result: null }
    cmdOpen++
    return id
  }

  function take(limit = MAX_PAGE) {
    const commands = []
    const open = []
    for (let i = 0; i < cmdCapacity; i++) if (cmdRing[i] !== null && cmdRing[i].state === CMD_PENDING) open.push(cmdRing[i])
    open.sort((a, b) => a.id - b.id)
    for (const entry of open) {
      if (commands.length === limit) break
      entry.state = CMD_SENT
      commands.push({ id: entry.id, cmd: entry.cmd, args: entry.args })
    }
    return commands
  }

  function complete(id, ok, result = null) {
    const entry = slotOf(id)
    if (entry === null) throw new DevChannelError('cmd-unknown', `no command with id ${id}`)
    if (entry.state === CMD_DONE) throw new DevChannelError('cmd-already-done', `command ${id} already has a result`)
    if (entry.state === CMD_PENDING) throw new DevChannelError('cmd-not-taken', `command ${id} was never handed to the page`)
    entry.state = CMD_DONE
    entry.ok = ok === true
    entry.result = result
    cmdOpen--
    return entry
  }

  function resultOf(id) {
    const entry = slotOf(id)
    return entry === null ? null : { id: entry.id, cmd: entry.cmd, state: entry.state, ok: entry.ok, result: entry.result }
  }

  const reply = (status, body) => ({ status, headers: { ...ISOLATION_HEADERS, 'Content-Type': JSON_TYPE, 'Cache-Control': 'no-store' }, body: JSON.stringify(body) })
  const refuse = (status, code, message) => reply(status, { ok: false, code, message })

  function parsed(body, oversize) {
    if (oversize === true) return { error: refuse(413, 'body-too-large', `the body is over ${maxBodyBytes} bytes`) }
    if (typeof body !== 'string' || body === '') return { error: refuse(400, 'body-missing', 'a JSON body is required') }
    if (body.length > maxBodyBytes) return { error: refuse(413, 'body-too-large', `the body is over ${maxBodyBytes} bytes`) }
    try {
      const value = JSON.parse(body)
      if (value === null || typeof value !== 'object') return { error: refuse(400, 'body-not-object', 'the body must be a JSON object or array') }
      return { value }
    } catch {
      return { error: refuse(400, 'body-not-json', 'the body is not JSON') }
    }
  }

  function guarded(fn) {
    try {
      return fn()
    } catch (error) {
      if (!(error instanceof DevChannelError)) throw error
      const status = error.code === 'cmd-queue-full' ? 429 : error.code === 'cmd-unknown' ? 404 : error.code === 'cmd-already-done' || error.code === 'cmd-not-taken' ? 409 : 400
      return refuse(status, error.code, error.message)
    }
  }

  function handleDiag(method, query, body, oversize) {
    if (method === 'GET') {
      const since = wholeQuery(query, 'since', 0)
      const limit = wholeQuery(query, 'limit', MAX_PAGE)
      if (since === null || limit === null || limit < 1) return refuse(400, 'query-not-whole', 'since and limit must be whole numbers')
      return reply(200, { ok: true, ...diagSince(since, Math.min(limit, MAX_PAGE)) })
    }
    if (method !== 'POST') return refuse(405, 'method-not-allowed', '/diag takes GET and POST')
    const { value, error } = parsed(body, oversize)
    if (error) return error
    const batch = Array.isArray(value) ? value : [value]
    if (batch.length === 0) return refuse(400, 'body-empty', 'an empty batch records nothing')
    for (const entry of batch) {
      if (entry === null || typeof entry !== 'object' || !DIAG_LEVELS.includes(entry.level ?? 'info') || typeof entry.msg !== 'string' || entry.msg === '') return refuse(400, 'diag-entry-malformed', 'each entry needs a msg and a level of ' + DIAG_LEVELS.join(', '))
    }
    let seq = 0
    for (const entry of batch) seq = diag(entry.level ?? 'info', entry.msg, entry.data ?? null)
    return reply(200, { ok: true, seq, recorded: batch.length })
  }

  function handleCmd(method, query, body, oversize) {
    if (method === 'GET') {
      const limit = wholeQuery(query, 'limit', MAX_PAGE)
      if (limit === null || limit < 1) return refuse(400, 'query-not-whole', 'limit must be a whole number')
      return reply(200, { ok: true, commands: take(Math.min(limit, MAX_PAGE)) })
    }
    if (method !== 'POST') return refuse(405, 'method-not-allowed', '/cmd takes GET and POST')
    const { value, error } = parsed(body, oversize)
    if (error) return error
    return guarded(() => reply(200, { ok: true, id: send(value.cmd, value.args ?? null) }))
  }

  function handleResult(method, query, body, oversize) {
    if (method === 'GET') {
      const id = wholeQuery(query, 'id', null)
      if (id === null || id < 1) return refuse(400, 'query-not-whole', 'id must be a whole number')
      const found = resultOf(id)
      return found === null ? refuse(404, 'cmd-unknown', `no command with id ${id}`) : reply(200, { ok: true, command: found })
    }
    if (method !== 'POST') return refuse(405, 'method-not-allowed', '/cmd/result takes GET and POST')
    const { value, error } = parsed(body, oversize)
    if (error) return error
    if (!Number.isInteger(value.id)) return refuse(400, 'result-id-not-whole', 'a result names the command id')
    return guarded(() => {
      const entry = complete(value.id, value.ok, value.result ?? null)
      return reply(200, { ok: true, id: entry.id, state: entry.state })
    })
  }

  function handle(request) {
    const method = request && typeof request.method === 'string' ? request.method.toUpperCase() : ''
    const { path, query } = splitTarget(request ? request.path : '')
    if (path === '/diag') return handleDiag(method, query, request.body, request.oversize)
    if (path === '/cmd') return handleCmd(method, query, request.body, request.oversize)
    if (path === '/cmd/result') return handleResult(method, query, request.body, request.oversize)
    return null
  }

  return {
    handle,
    diag,
    diagSince,
    send,
    take,
    complete,
    resultOf,
    maxBodyBytes,
    get stats() { return { diagWritten: diagSeq, diagHeld: Math.min(diagSeq, diagCapacity), cmdIssued: cmdSeq, cmdOpen } },
  }
}

const CONTENT_TYPES = Object.freeze({ html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: JSON_TYPE, wasm: 'application/wasm', png: 'image/png', svg: 'image/svg+xml', glb: 'model/gltf-binary', txt: 'text/plain; charset=utf-8' })

export function contentTypeOf(path) {
  const dot = path.lastIndexOf('.')
  const ext = dot < 0 ? '' : path.slice(dot + 1).toLowerCase()
  return CONTENT_TYPES[ext] ?? 'application/octet-stream'
}

export function createDevServer({ channel, root, readFile, createServer, indexFile = 'index.html' }) {
  if (!channel || typeof channel.handle !== 'function') throw new TypeError('createDevServer needs a dev channel')
  if (typeof readFile !== 'function') throw new TypeError('createDevServer needs a readFile(path) function')
  if (typeof createServer !== 'function') throw new TypeError('createDevServer needs a createServer(listener) function')
  if (typeof root !== 'string' || root === '') throw new TypeError('createDevServer needs a root directory')

  function serveFile(method, target) {
    if (method !== 'GET' && method !== 'HEAD') return { status: 405, headers: { ...ISOLATION_HEADERS, 'Content-Type': JSON_TYPE }, body: JSON.stringify({ ok: false, code: 'method-not-allowed', message: 'files are read only' }) }
    const mark = target.indexOf('?')
    let relative
    try {
      relative = decodeURIComponent(mark < 0 ? target : target.slice(0, mark))
    } catch {
      relative = null
    }
    if (relative !== null && relative.endsWith('/')) relative += indexFile
    const full = relative === null || relative.includes('\0') ? null : resolveWithinRoot(root, '.' + (relative.startsWith('/') ? relative : '/' + relative))
    if (full === null) return { status: 403, headers: { ...ISOLATION_HEADERS, 'Content-Type': JSON_TYPE }, body: JSON.stringify({ ok: false, code: 'path-outside-root', message: 'the path leaves the served root' }) }
    let bytes
    try {
      bytes = readFile(full)
    } catch {
      bytes = null
    }
    if (bytes === null || bytes === undefined) return { status: 404, headers: { ...ISOLATION_HEADERS, 'Content-Type': JSON_TYPE }, body: JSON.stringify({ ok: false, code: 'not-found', message: 'no such file' }) }
    return { status: 200, headers: { ...ISOLATION_HEADERS, 'Content-Type': contentTypeOf(full), 'Cache-Control': 'no-store' }, body: method === 'HEAD' ? '' : bytes }
  }

  function respond(request) {
    return channel.handle(request) ?? serveFile(request.method, request.path)
  }

  function listener(req, res) {
    const chunks = []
    let size = 0
    let over = false
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > channel.maxBodyBytes) over = true
      else chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'))
    })
    req.on('end', () => {
      const out = respond({ method: req.method, path: req.url, body: over ? '' : chunks.join(''), oversize: over })
      res.writeHead(out.status, out.headers)
      res.end(out.body)
    })
  }

  const server = createServer(listener)
  return { server, respond, listener }
}
