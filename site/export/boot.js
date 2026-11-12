import { createBrowserServerClient } from './src/transport/browserServer.js'
import { MSG } from './src/protocol/messages.js'
import { pack, unpack } from './src/protocol/msgpack.js'
import { SnapshotEncoder } from './src/snapshot-lod-pure/snapshotEncoder.js'

const status = document.getElementById('status')
const canvas = document.getElementById('field')
const context = canvas.getContext('2d')
const SCALE = 12
const keys = new Set()
let sequence = 0
let latest = null

const say = (text) => { status.textContent = text }

const draw = () => {
  context.clearRect(0, 0, canvas.width, canvas.height)
  if (latest === null) return
  const cx = canvas.width / 2
  const cy = canvas.height / 2
  context.fillStyle = '#88c0d0'
  for (const entity of latest.entities) context.fillRect(cx + entity.position[0] * SCALE - 3, cy + entity.position[2] * SCALE - 3, 6, 6)
  context.fillStyle = '#ebcb8b'
  for (const player of latest.players) {
    context.beginPath()
    context.arc(cx + player.position[0] * SCALE, cy + player.position[2] * SCALE, 5, 0, Math.PI * 2)
    context.fill()
  }
}

try {
  const manifest = await (await fetch('./manifest.json')).json()
  const apps = {}
  for (const name of Object.keys(manifest.apps)) apps[name] = new URL(manifest.apps[name], location.href).href
  const worker = new Worker(new URL('./server-worker.js', import.meta.url), { type: 'module' })
  const client = createBrowserServerClient({ worker, config: manifest.config, apps, setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: (handle) => clearTimeout(handle) })
  client.transport.onMessage = (bytes) => {
    const message = unpack(bytes)
    if (message.type !== MSG.SNAPSHOT) return
    latest = SnapshotEncoder.decode(message.payload)
    say('tick ' + latest.tick + '  players ' + latest.players.length + '  entities ' + latest.entities.length)
  }
  const info = await client.ready
  say('server ready at ' + info.tickRate + ' Hz')
  client.transport.send(pack({ type: MSG.HANDSHAKE, payload: { name: 'player' } }))
  addEventListener('keydown', (event) => keys.add(event.code))
  addEventListener('keyup', (event) => keys.delete(event.code))
  const stepMs = 1000 / info.tickRate
  let due = performance.now()
  const frame = () => {
    const now = performance.now()
    if (now >= due) {
      due = Math.max(due + stepMs, now)
      sequence += 1
      client.transport.send(pack({ type: MSG.INPUT, payload: { seq: sequence, input: { forward: keys.has('KeyW'), backward: keys.has('KeyS'), left: keys.has('KeyA'), right: keys.has('KeyD'), jump: keys.has('Space'), yaw: 0 } } }))
    }
    draw()
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
} catch (error) {
  say('boot refused: ' + error.message)
  throw error
}
