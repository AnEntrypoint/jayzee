import { createSimLink } from './simTransport.js'

const inFlight = (link) => {
  const stats = link.getStats()
  return stats.sent - stats.dropped - stats.delivered
}

export function createSimSocketPair({ now, seed = 1, profile = {} } = {}) {
  if (typeof now !== 'function') throw new TypeError('[simSocketPair] now must be a clock function in milliseconds')
  const toServer = createSimLink({ seed, profile })
  const toClient = createSimLink({ seed: seed + 1, profile })

  const makeEnd = (outbound) => {
    const end = {
      onMessage: null,
      onClose: null,
      open: true,
      get isOpen() { return end.open },
      send(bytes) {
        if (!end.open) return false
        if (!(bytes instanceof Uint8Array)) throw new TypeError('[simSocketPair] send takes a Uint8Array')
        return outbound.send(Uint8Array.from(bytes), now())
      },
      close() {
        if (!end.open) return
        end.open = false
        if (end.onClose) end.onClose()
      },
    }
    return end
  }

  const client = makeEnd(toServer)
  const server = makeEnd(toClient)

  const deliver = (link, end) => {
    let count = 0
    for (const entry of link.advance(now())) {
      if (!end.open) continue
      if (end.onMessage) end.onMessage(entry.payload)
      count++
    }
    return count
  }

  const hangUp = (closedEnd, link, peer) => {
    if (closedEnd.open || !peer.open || inFlight(link) > 0) return
    peer.close()
  }

  const pump = () => {
    const count = deliver(toServer, server) + deliver(toClient, client)
    hangUp(client, toServer, server)
    hangUp(server, toClient, client)
    if (!client.open && !server.open) {
      toServer.close()
      toClient.close()
    }
    return count
  }

  return { client, server, pump, stats: () => ({ toServer: toServer.getStats(), toClient: toClient.getStats() }) }
}
