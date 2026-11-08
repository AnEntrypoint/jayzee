import { WebSocketServer } from 'ws'

const matches = (event, filter) => {
  if (Array.isArray(filter.kinds) && !filter.kinds.includes(event.kind)) return false
  for (const key of Object.keys(filter)) {
    if (!key.startsWith('#')) continue
    const letter = key.slice(1)
    const wanted = filter[key]
    if (!event.tags.some((tag) => tag[0] === letter && wanted.includes(tag[1]))) return false
  }
  return true
}

export async function startLoopbackRelay() {
  const events = []
  const clients = new Set()
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await new Promise((resolve, reject) => {
    wss.once('listening', resolve)
    wss.once('error', reject)
  })
  const port = wss.address().port
  wss.on('connection', (ws) => {
    const client = { ws, subs: new Map() }
    clients.add(client)
    ws.on('close', () => clients.delete(client))
    ws.on('message', (raw) => {
      let msg
      try { msg = JSON.parse(raw.toString()) } catch { return }
      if (!Array.isArray(msg)) return
      const [type, first, ...rest] = msg
      if (type === 'EVENT') {
        events.push(first)
        ws.send(JSON.stringify(['OK', first.id, true, '']))
        for (const other of clients) {
          for (const [subId, filters] of other.subs) {
            if (filters.some((filter) => matches(first, filter))) other.ws.send(JSON.stringify(['EVENT', subId, first]))
          }
        }
      } else if (type === 'REQ') {
        client.subs.set(first, rest)
        for (const event of events) {
          if (rest.some((filter) => matches(event, filter))) ws.send(JSON.stringify(['EVENT', first, event]))
        }
        ws.send(JSON.stringify(['EOSE', first]))
      } else if (type === 'CLOSE') {
        client.subs.delete(first)
      }
    })
  })
  return {
    url: 'ws://127.0.0.1:' + port,
    events,
    close: () => new Promise((resolve) => {
      for (const client of clients) client.ws.terminate()
      wss.close(resolve)
    }),
  }
}
