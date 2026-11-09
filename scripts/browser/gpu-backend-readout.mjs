import { writeFileSync } from 'node:fs'

const port = Number(process.argv[2] ?? 10252)
const out = process.argv[3] ?? 'build/diag/gpu-text.txt'
const created = await (await fetch('http://127.0.0.1:' + port + '/json/new?chrome://gpu', { method: 'PUT' })).json()
const ws = new WebSocket(created.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let id = 0
const pending = new Map()
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
}
const send = (method, params = {}) => new Promise((res) => {
  id += 1
  pending.set(id, res)
  ws.send(JSON.stringify({ id, method, params }))
})
await new Promise((r) => setTimeout(r, 6000))
const expression = "(() => { const parts = []; const walk = (node) => { if (node.nodeType === Node.TEXT_NODE) { const t = node.textContent.trim(); if (t) parts.push(t) } if (node.shadowRoot) walk(node.shadowRoot); for (const child of node.childNodes || []) walk(child) }; walk(document.documentElement); return location.href + '\\n' + parts.join('\\n') })()"
const res = await send('Runtime.evaluate', { expression, returnByValue: true })
const text = (res.result && res.result.result && res.result.result.value) || JSON.stringify(res)
writeFileSync(out, text)
ws.close()
await fetch('http://127.0.0.1:' + port + '/json/close/' + created.id)
console.log('saved ' + text.split('\n').length + ' lines to ' + out)
