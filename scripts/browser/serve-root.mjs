import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const port = Number(process.argv[2] ?? 8765)
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.css': 'text/css' }

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  const path = normalize(join(root, decodeURIComponent(url.pathname)))
  if (!path.startsWith(root)) {
    res.writeHead(403).end()
    return
  }
  try {
    const body = await readFile(path)
    res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream', 'cache-control': 'no-store', 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp' }).end(body)
  } catch {
    res.writeHead(404).end()
  }
}).listen(port, '127.0.0.1', () => console.log('serving ' + root + ' on ' + port))
