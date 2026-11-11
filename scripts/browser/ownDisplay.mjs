import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { seedWebgpuLabs } from './webgpu-profile.mjs'

export const FIRST_DISPLAY = 90
export const DISPLAY_TRIES = 64
export const STOP_GRACE_MS = 4000
const READY_TRIES = 150
const READY_GAP_MS = 100
const DEFAULT_CHROMIUM = '/usr/bin/chromium'
export const RENDER_NODE = '/dev/dri/renderD128'
const X_EXTENSIONS = ['COMPOSITE', 'DAMAGE', 'GLX', 'RANDR', 'RENDER', 'MIT-SHM', 'XFIXES']

export const xvfbArgs = ({ display, width, height, renderNode = existsSync(RENDER_NODE) ? RENDER_NODE : null }) => [
  ':' + display,
  '-screen', '0', width + 'x' + height + 'x24',
  '-nolisten', 'tcp',
  ...X_EXTENSIONS.flatMap((name) => ['+extension', name]),
  '+iglx', '+render', '-shmem',
  ...(renderNode ? ['-glamor', '-dri', renderNode] : []),
]

const pause = (ms) => new Promise((done) => setTimeout(done, ms))

export const displayTaken = (number) => existsSync('/tmp/.X11-unix/X' + number) || existsSync('/tmp/.X' + number + '-lock')

export const freeDisplay = (taken = displayTaken, from = FIRST_DISPLAY, tries = DISPLAY_TRIES) => {
  for (let number = from; number < from + tries; number++) {
    if (!taken(number)) return number
  }
  throw new Error('no free X display from :' + from + ' to :' + (from + tries - 1))
}

export const chromiumFlags = ({ debugPort, profileDir, width, height }) => [
  '--enable-unsafe-webgpu',
  '--enable-features=Vulkan,WebGPUService',
  '--use-vulkan',
  '--ignore-gpu-blocklist',
  '--no-first-run',
  '--no-default-browser-check',
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--password-store=basic',
  '--window-position=0,0',
  '--window-size=' + width + ',' + height,
  '--user-data-dir=' + profileDir,
  '--remote-debugging-port=' + debugPort,
  'about:blank',
]

export const freePort = () => new Promise((resolvePort, reject) => {
  const probe = createServer()
  probe.once('error', reject)
  probe.listen(0, '127.0.0.1', () => {
    const { port } = probe.address()
    probe.close(() => resolvePort(port))
  })
})

const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const groupAlive = (pgid) => {
  try {
    process.kill(-pgid, 0)
    return true
  } catch {
    return false
  }
}

const signalGroup = (pgid, signal) => {
  try {
    process.kill(-pgid, signal)
  } catch {}
}

export const processesNaming = (text, self = process.pid) => readdirSync('/proc').filter((name) => /^\d+$/.test(name)).map(Number).filter((pid) => {
  if (pid === self) return false
  try {
    return readFileSync('/proc/' + pid + '/cmdline', 'utf8').includes(text)
  } catch {
    return false
  }
})

export const stopTree = async (child, graceMs = STOP_GRACE_MS) => {
  const pgid = child.pid
  if (pgid === undefined) return { pgid: null, forced: false }
  signalGroup(pgid, 'SIGTERM')
  const deadline = Date.now() + graceMs
  while (groupAlive(pgid) && Date.now() < deadline) await pause(50)
  const forced = groupAlive(pgid)
  if (forced) signalGroup(pgid, 'SIGKILL')
  const killDeadline = Date.now() + graceMs
  while (groupAlive(pgid) && Date.now() < killDeadline) await pause(50)
  return { pgid, forced, left: groupAlive(pgid) }
}

const stopByPid = async (pids, graceMs = STOP_GRACE_MS) => {
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {}
  }
  const deadline = Date.now() + graceMs
  while (pids.some(alive) && Date.now() < deadline) await pause(50)
  return pids.filter(alive)
}

export const startOwnBrowser = async ({ root, width = 1280, height = 800, chromium = process.env.WEBGPU_CHROMIUM ?? DEFAULT_CHROMIUM }) => {
  const display = freeDisplay()
  const xvfb = spawn('Xvfb', xvfbArgs({ display, width, height }), { detached: true, stdio: 'ignore' })
  let browser = null
  let profileDir = null
  const stop = async () => {
    const stopped = { display, browser: browser ? await stopTree(browser) : null, strays: [], xvfb: await stopTree(xvfb) }
    if (profileDir) {
      stopped.strays = await stopByPid(processesNaming(profileDir))
      rmSync(profileDir, { recursive: true, force: true })
    }
    return stopped
  }
  try {
    let up = false
    for (let i = 0; i < READY_TRIES && !up; i++) {
      up = existsSync('/tmp/.X11-unix/X' + display)
      if (!up) await pause(READY_GAP_MS)
    }
    if (!up || xvfb.exitCode !== null) throw new Error('Xvfb did not open display :' + display)
    mkdirSync(join(root, 'build'), { recursive: true })
    profileDir = mkdtempSync(join(root, 'build', 'witness-profile-'))
    seedWebgpuLabs(profileDir)
    const debugPort = await freePort()
    browser = spawn(chromium, chromiumFlags({ debugPort, profileDir, width, height }), { detached: true, stdio: 'ignore', env: { ...process.env, DISPLAY: ':' + display } })
    let answering = false
    for (let i = 0; i < READY_TRIES && !answering; i++) {
      answering = await fetch('http://127.0.0.1:' + debugPort + '/json/version').then((response) => response.status === 200, () => false)
      if (!answering) await pause(READY_GAP_MS * 2)
    }
    if (!answering) throw new Error('the witness browser did not answer on port ' + debugPort + ' on display :' + display)
    return { debugPort, display, profileDir, browserPid: browser.pid, xvfbPid: xvfb.pid, stop }
  } catch (error) {
    await stop()
    throw error
  }
}

export const witnessBrowser = async (root) => {
  if (process.env.WITNESS_BROWSER === 'project') return { debugPort: undefined, display: null, stop: async () => ({ display: null }) }
  return startOwnBrowser({ root })
}
