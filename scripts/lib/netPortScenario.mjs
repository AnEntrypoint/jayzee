import { createHash } from 'node:crypto'
import { makeScenarios } from './playerCollisionScenario.mjs'

const digestOf = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16)

export const LAG_FRAMES = 40

export function runLaggedCollisions(api) {
  return makeScenarios().map((scenario) => {
    const grid = new Map()
    const gridCells = new Map()
    const calls = []
    const physicsIntegration = { setPlayerPosition: (id, pos) => calls.push([id, [...pos]]) }
    const players = scenario.players.map((p) => ({ id: p.id, state: { position: [...p.position], velocity: [...p.velocity] } }))
    const frames = []
    for (let f = 0; f < LAG_FRAMES; f++) {
      calls.length = 0
      api.plan(players, grid, gridCells, scenario.cellSz, scenario.minDist * scenario.minDist, scenario.minDist, scenario.dt)
      for (const player of players) api.advance(player, physicsIntegration)
      if (f === 20 && players.length > 2) api.reset(players[1])
      frames.push({
        calls: calls.length,
        callDigest: digestOf(calls),
        state: digestOf(players.map((p) => [p.id, [...p.state.position], [...p.state.velocity]])),
        window: f % 13 === 0 ? digestOf(api.window(players[0])) : null,
      })
      for (const p of players) for (let k = 0; k < 3; k++) p.state.position[k] += p.state.velocity[k] * scenario.dt
    }
    return { index: scenario.index, frames }
  })
}

export function runBridgeProxy(createWorkerBridgeProxy) {
  const posts = []
  const events = []
  const proxy = createWorkerBridgeProxy({ localPubkey: 'me', roster: ['me', 'b', 'c'], post: (message) => posts.push(message) })
  for (const name of ['data', 'peer-close']) proxy.data.addEventListener(name, (event) => events.push([name, event.detail.peerPubkey, event.detail.data ?? null]))
  const steps = []
  const note = (label, value) => steps.push([label, value])
  note('pubkey', proxy.pubkey)
  note('peers', [...proxy.data.peers].map(([pk, peer]) => [pk, peer.dc.readyState]))
  note('broadcast', proxy.data.broadcast('frame-1'))
  note('send', proxy.data.send('b', 'frame-2'))
  proxy.deliver('b', 'hello')
  proxy.deliver('c', 'world')
  proxy.peerLeft('c')
  note('peers after c left', [...proxy.data.peers].map(([pk, peer]) => [pk, peer.dc.readyState]))
  note('broadcast after c left', proxy.data.broadcast('frame-3'))
  const listener = () => events.push(['removed-listener-heard'])
  proxy.data.addEventListener('data', listener)
  proxy.data.removeEventListener('data', listener)
  proxy.deliver('b', 'again')
  return { steps, posts, events }
}

export function coalescedCases() {
  let seed = 7
  const random = () => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed / 0x7fffffff }
  const cases = []
  for (let round = 0; round < 40; round++) {
    const count = 1 + Math.floor(random() * 6)
    cases.push(Array.from({ length: count }, () => Array.from({ length: Math.floor(random() * 30) }, () => Math.floor(random() * 256))))
  }
  cases.push([[0xff, 1, 2]], [[0xff], [0xff, 0xff]], [[], [], []], [[]])
  return cases
}

export function runCoalesced(api) {
  const hex = (bytes) => Buffer.from(bytes).toString('hex')
  return coalescedCases().map((buffers) => {
    const framed = api.frame(buffers.map((b) => Uint8Array.from(b)))
    const isBatch = buffers.length > 1
    const parts = isBatch ? api.split(framed).map(hex) : null
    const torn = isBatch ? [framed.length - 1, 3, 1].filter((cut) => cut > 0 && cut < framed.length).map((cut) => api.split(framed.subarray(0, cut)).map(hex)) : null
    return { framed: hex(framed), parts, torn }
  })
}
