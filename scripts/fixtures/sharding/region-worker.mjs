import { createRegionWorker } from '../../../src/sharding/regionRouterRuntime.js'

const port = { send: (msg) => process.send(msg), onMessage: (fn) => process.on('message', fn) }
let nextLocal = 0
const carried = new Map()
const worker = createRegionWorker({
  port,
  hooks: {
    init(msg) {
      if (process.env.JZ_REFUSE_REGION === msg.regionId) {
        const error = new Error('no world for region ' + msg.regionId)
        error.code = 'world-missing'
        throw error
      }
    },
    join(routerPlayerId, handoff) {
      carried.set(routerPlayerId, handoff ? handoff.state : null)
      return { localPlayerId: nextLocal++, sessionToken: null }
    },
    message(routerPlayerId, data) {
      if (typeof data === 'string' && data.startsWith('goto:')) worker.requestHandoff(routerPlayerId, data.slice(5), { hp: 42, from: worker.regionId })
      else worker.send(routerPlayerId, { region: worker.regionId, local: worker.localIdOf(routerPlayerId), carried: carried.get(routerPlayerId), echo: data })
    },
    leave(routerPlayerId) {
      carried.delete(routerPlayerId)
    },
    handoffRefused(routerPlayerId, code) {
      worker.send(routerPlayerId, { region: worker.regionId, refused: code })
    },
  },
})
