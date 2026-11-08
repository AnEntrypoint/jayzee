import { World } from './src/world/World.js'
import { loadKernel } from './src/kernel/load.js'
import { createSettler } from './src/physics-pure/settler.js'
import { locateSiteWorld, worldRequestOf } from './src/site/worldName.js'

try {
  locateSiteWorld(worldRequestOf(location.search, location.hash))
} catch (error) {
  document.getElementById('status').textContent = 'world refused: ' + error.message
  throw error
}

const RADIUS = 0.35
const TICK_RATE = 64
const MAX_BODIES = 48
const MAX_TICKS_PER_FRAME = 8
const AUTO_FIRE_TICKS = 1.5 * TICK_RATE
const SCALE = 40
const ORIGIN_X = 40
const ORIGIN_Y = 440
const MUZZLE = [-1, 1.5, 0]
const WALL = { min: [8, 0, -5], max: [8.1, 6, 5] }
const SLOW_SPEED = 10
const FAST_SPEED = 60
const CLICK_SPEED = 40
const FAST_EVERY = 3

const canvas = document.getElementById('field')
const context = canvas.getContext('2d')
const status = document.getElementById('status')

try {
  loadKernel(await (await fetch('./kernel.wasm')).arrayBuffer())
} catch (error) {
  status.textContent = 'kernel did not load: ' + error.message
  throw error
}

const world = new World({ capacity: MAX_BODIES, tickRate: TICK_RATE, gravity: -18, drag: 0.1, radius: RADIUS, restitution: 0.2, solverIterations: 8 })
let settler = null
const ids = []
let tick = 0
let shots = 0
let nextAutoFireTick = 0
let accumulator = 0
let last = null

const fire = (velocity) => {
  if (ids.length >= MAX_BODIES) return
  ids.push(world.spawn(MUZZLE, velocity))
  settler = createSettler(world, { radius: RADIUS, boxes: [WALL] })
}

const autoFire = () => {
  shots += 1
  const fast = shots % FAST_EVERY === 0
  fire([fast ? FAST_SPEED : SLOW_SPEED, fast ? 0 : 2, 0])
}

const stepTo = (seconds) => {
  accumulator += seconds
  let steps = 0
  while (accumulator >= 1 / TICK_RATE && steps < MAX_TICKS_PER_FRAME) {
    if (tick >= nextAutoFireTick) {
      autoFire()
      nextAutoFireTick += AUTO_FIRE_TICKS
    }
    if (settler === null) world.step()
    else settler.step()
    tick += 1
    accumulator -= 1 / TICK_RATE
    steps += 1
  }
  if (steps === MAX_TICKS_PER_FRAME) accumulator = 0
}

const toScreen = (x, y) => [ORIGIN_X + x * SCALE, ORIGIN_Y - y * SCALE]

const draw = () => {
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.strokeStyle = '#5e81ac'
  context.beginPath()
  context.moveTo(0, ORIGIN_Y)
  context.lineTo(canvas.width, ORIGIN_Y)
  context.stroke()
  const [wallLeft, wallTop] = toScreen(WALL.min[0], WALL.max[1])
  context.fillStyle = '#88c0d0'
  context.fillRect(wallLeft, wallTop, (WALL.max[0] - WALL.min[0]) * SCALE, (WALL.max[1] - WALL.min[1]) * SCALE)
  context.fillStyle = '#ebcb8b'
  for (const id of ids) {
    const [cx, cy] = toScreen(...world.position(id))
    context.beginPath()
    context.arc(cx, cy, RADIUS * SCALE, 0, Math.PI * 2)
    context.fill()
  }
  status.textContent = 'tick ' + tick + '  time ' + (tick / TICK_RATE).toFixed(2) + ' s  bodies ' + ids.length + ' of ' + MAX_BODIES + '\nclick the field to fire a body at the click point'
  document.documentElement.dataset.tick = String(tick)
}

const frame = (now) => {
  const seconds = last === null ? 0 : Math.min((now - last) / 1000, 0.25)
  last = now
  stepTo(seconds)
  draw()
  requestAnimationFrame(frame)
}

canvas.addEventListener('click', (event) => {
  const rect = canvas.getBoundingClientRect()
  const x = (event.clientX - rect.left) * (canvas.width / rect.width)
  const y = (event.clientY - rect.top) * (canvas.height / rect.height)
  const dx = (x - ORIGIN_X) / SCALE - MUZZLE[0]
  const dy = (ORIGIN_Y - y) / SCALE - MUZZLE[1]
  const length = Math.hypot(dx, dy) || 1
  fire([(dx / length) * CLICK_SPEED, (dy / length) * CLICK_SPEED, 0])
})

window.jayzee = {
  world,
  get settler() {
    return settler
  },
  state: () => ({ tick, bodies: ids.map((id) => world.position(id)) }),
}

requestAnimationFrame(frame)
