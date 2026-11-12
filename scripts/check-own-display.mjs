import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BATCH_EVENT, describeBatches, threadTime } from './browser/gpuBatch.mjs'
import { finish, gate } from './lib/gate.mjs'
import { FIRST_DISPLAY, chromiumFlags, freeDisplay, freePort, processesNaming, stopTree, xvfbArgs } from './browser/ownDisplay.mjs'

const OWNER_SCRIPT = (guarded) => [
  "import { spawn } from 'node:child_process'",
  "import { guardGroups } from './scripts/browser/ownDisplay.mjs'",
  "const tree = spawn('sh', ['-c', 'sleep 300 & sleep 301 & wait'], { detached: true, stdio: 'ignore' })",
  guarded ? 'guardGroups([tree.pid], 1)' : '',
  "console.log('PGID ' + tree.pid)",
  'setInterval(() => {}, 1000)',
].join('\n')

const ownerWithTree = async (guarded) => {
  const owner = spawn(process.execPath, ['--input-type=module', '-e', OWNER_SCRIPT(guarded)], { cwd: new URL('..', import.meta.url), stdio: ['ignore', 'pipe', 'inherit'] })
  const pgid = await new Promise((done, fail) => {
    let text = ''
    owner.stdout.on('data', (chunk) => {
      text += chunk
      const found = /PGID (\d+)/.exec(text)
      if (found) done(Number(found[1]))
    })
    owner.once('exit', () => fail(new Error('the owner exited before it reported its tree')))
  })
  return { owner, pgid }
}

const MARK = 'own-display-gate-' + process.pid
const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
const groupMembers = (pgid) => readdirSync('/proc').filter((name) => /^\d+$/.test(name)).map(Number).filter((pid) => {
  try {
    const stat = readFileSync('/proc/' + pid + '/stat', 'utf8')
    return Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[2]) === pgid
  } catch {
    return false
  }
})
const until = async (probe, tries = 100) => {
  for (let i = 0; i < tries; i++) {
    if (probe()) return true
    await new Promise((done) => setTimeout(done, 20))
  }
  return false
}

gate('the first free display is the first one not taken, and a full range is refused', () => {
  assert.equal(freeDisplay(() => false), FIRST_DISPLAY)
  assert.equal(freeDisplay((number) => number < FIRST_DISPLAY + 3), FIRST_DISPLAY + 3)
  assert.throws(() => freeDisplay(() => true), /no free X display/)
})

gate('the witness browser is started with the WebGPU and Vulkan switches, its own profile and port, and no headless or SwiftShader switch', () => {
  const flags = chromiumFlags({ debugPort: 4567, profileDir: '/tmp/profile-x', width: 1280, height: 800 })
  for (const needed of ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPUService', '--use-vulkan', '--ignore-gpu-blocklist', '--user-data-dir=/tmp/profile-x', '--remote-debugging-port=4567']) assert.ok(flags.includes(needed), 'missing ' + needed)
  assert.ok(!flags.some((flag) => /headless|swiftshader/i.test(flag)), 'a headless or SwiftShader switch is present, which gives the CPU adapter')
})

gate('the display presents through the render node when there is one, and is a plain framebuffer without it', () => {
  const accelerated = xvfbArgs({ display: 93, width: 1280, height: 800, renderNode: '/dev/dri/renderD128' })
  assert.equal(accelerated[0], ':93')
  assert.ok(accelerated.includes('-glamor'))
  assert.equal(accelerated[accelerated.indexOf('-dri') + 1], '/dev/dri/renderD128')
  assert.ok(accelerated.includes('1280x800x24') && accelerated.includes('-nolisten'))
  assert.ok(!accelerated.includes('-ac'), 'access control is off')
  const plain = xvfbArgs({ display: 93, width: 1280, height: 800, renderNode: null })
  assert.ok(!plain.includes('-glamor') && !plain.includes('-dri'))
})

gate('a free port is a whole number a server can bind', async () => {
  const port = await freePort()
  assert.ok(Number.isInteger(port) && port > 1024 && port < 65536)
})

gate('stopTree ends a process and every process it started, and reports nothing left', async () => {
  const child = spawn('sh', ['-c', 'sleep 300 & sleep 301 & sh -c "sleep 302; echo ' + MARK + '" & wait'], { detached: true, stdio: 'ignore' })
  assert.ok(await until(() => groupMembers(child.pid).length >= 4), 'the tree did not start: ' + groupMembers(child.pid).length + ' processes')
  const members = groupMembers(child.pid)
  const stopped = await stopTree(child)
  assert.equal(stopped.left, false)
  assert.ok(await until(() => members.every((pid) => !alive(pid) || readFileSync('/proc/' + pid + '/stat', 'utf8').includes(') Z '))), 'still running: ' + members.filter(alive))
  assert.deepEqual(processesNaming(MARK), [])
})

gate('control: without stopTree the same tree is still running, and the gate then stops it', async () => {
  const child = spawn('sh', ['-c', 'sleep 300 & sleep 301 & wait'], { detached: true, stdio: 'ignore' })
  assert.ok(await until(() => groupMembers(child.pid).length >= 3))
  const members = groupMembers(child.pid)
  assert.ok(members.every(alive))
  const stopped = await stopTree(child)
  assert.equal(stopped.left, false)
})

gate('a slow GPU batch is split into its traced steps and the untraced time between them, and the longest piece is matched to what the thread did', () => {
  const x = (name, ts, dur, args = {}) => ({ ph: 'X', pid: 7, tid: 7, name, ts, dur, args })
  const events = [
    x(BATCH_EVENT, 1000, 300),
    x(BATCH_EVENT, 10000, 9000, { bytes: 680 }),
    x('Queue::Submit', 10100, 6000),
    x('vkQueueSubmit', 10200, 100),
    x('DawnServiceSerializer::Flush', 18900, 50),
    { ph: 'X', pid: 7, tid: 9, name: 'Other thread', ts: 10000, dur: 9000, args: {} },
  ]
  const samples = { samples: 5, atUs: [9000, 10000, 13000, 16200, 20000], runNs: [0, 1e6, 2e6, 2.5e6, 3e6], waitNs: [0, 0, 0, 4e6, 4e6], state: 'SRSSR', waitsOn: [0, 0, 1, 1, 0], waitNames: ['', 'futex_wait'], minorFaults: [5, 10, 30, 50, 50], majorFaults: [0, 0, 1, 1, 1], systemTicks: [0, 0, 1, 1, 2], userTicks: [3, 3, 3, 3, 3], others: [{ pid: 7, tid: 12, label: 'own gpu process: VizCompositor' }, { pid: 8, tid: 8, label: 'Xvfb 8: Xvfb' }], otherSample: [0, 2, 3, 4], otherIndex: [1, 0, 0, 1], otherRunNs: [9e6, 1.5e6, 2e6, 9e6] }
  const described = describeBatches(events, { samples })
  assert.equal(described.batches, 2)
  assert.equal(described.slow, 1)
  assert.deepEqual(described.steps.map((step) => [step.step, step.ms]), [['Queue::Submit', 6], ['untraced after Queue::Submit', 2.8], ['DawnServiceSerializer::Flush', 0.05]])
  assert.equal(described.untracedMs, 2.8)
  assert.equal(described.worst[0].longestStep, 'Queue::Submit')
  assert.deepEqual(described.worst[0].thread, { spanMs: 6.2, onCpuMs: 1.5, runQueueMs: 4, asleepMs: 0.7, samples: 3, states: { R: 1, S: 2 }, waits: { futex_wait: 2 }, minorFaults: 40, majorFaults: 1, systemTicks: 1, userTicks: 0, othersRanMs: { 'own gpu process: VizCompositor': 3.5 } })
  assert.equal(threadTime(samples, 100, 200), null)
  assert.equal(describeBatches([x('Other', 0, 10)]).batches, 0)
})

gate('the thread sampler records run time, run-queue wait and state of one thread and writes them when its pipe closes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'thread-sampler-'))
  const out = join(dir, 'samples.json')
  const sampler = spawn(process.execPath, [fileURLToPath(new URL('./browser/threadSampler.mjs', import.meta.url)), String(process.pid), String(process.pid), out, '500'], { stdio: ['pipe', 'pipe', 'inherit'] })
  const exited = new Promise((done) => sampler.once('exit', done))
  await new Promise((done) => sampler.stdout.once('data', done))
  const until = Date.now() + 150
  let spin = 0
  while (Date.now() < until) spin += 1
  sampler.stdin.end()
  assert.equal(await exited, 0)
  const samples = JSON.parse(readFileSync(out, 'utf8'))
  rmSync(dir, { recursive: true, force: true })
  assert.ok(spin > 0 && samples.samples > 50, 'only ' + samples.samples + ' samples in 150 ms')
  assert.equal(samples.atUs.length, samples.samples)
  const ranMs = (samples.runNs.at(-1) - samples.runNs[0]) / 1e6
  const waitedMs = (samples.waitNs.at(-1) - samples.waitNs[0]) / 1e6
  assert.ok(ranMs > 5 && ranMs + waitedMs > 75, 'the spinning thread shows ' + ranMs + ' ms of run time and ' + waitedMs + ' ms on the run queue in 150 ms')
  assert.ok(samples.state.includes('R'))
  assert.ok(samples.atUs.every((at, i) => i === 0 || at > samples.atUs[i - 1]))
})

gate('a runner killed outright still has its tree stopped, by the guard that waits on its pipe', async () => {
  const { owner, pgid } = await ownerWithTree(true)
  assert.ok(await until(() => groupMembers(pgid).length >= 3), 'the tree did not start')
  owner.kill('SIGKILL')
  assert.ok(await until(() => groupMembers(pgid).length === 0, 300), 'the tree outlived its killed runner: ' + groupMembers(pgid))
})

gate('control: without the guard the tree outlives its killed runner, and the gate then stops it', async () => {
  const { owner, pgid } = await ownerWithTree(false)
  assert.ok(await until(() => groupMembers(pgid).length >= 3))
  owner.kill('SIGKILL')
  await new Promise((done) => setTimeout(done, 1500))
  assert.ok(groupMembers(pgid).length >= 3, 'the tree stopped with no guard, so the gate above proves nothing')
  const stopped = await stopTree({ pid: pgid })
  assert.equal(stopped.left, false)
})

finish()
