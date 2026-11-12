import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DATASET_REF, KERNEL_REF } from './plan.mjs'
import { preflight } from './preflight.mjs'
import { startLogStream, streamRows } from './stream.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const POLL_MS = 20000
const DATASET_WAIT_MS = 300000
const RUN_WAIT_MS = 3000000
export const STREAM_LOG = 'build/diag/kaggle-stream.log'
const kaggleEnv = () => ({ ...process.env, KAGGLE_CONFIG_DIR: process.env.KAGGLE_CONFIG_DIR ?? '/config/.kaggle' })

const kaggle = (args, timeout = 600000) => {
  const done = spawnSync('kaggle', args, { cwd: root, encoding: 'utf8', timeout, env: kaggleEnv() })
  return { status: done.status, text: (done.stdout ?? '') + (done.stderr ?? '') }
}
const pause = (ms) => new Promise((done) => setTimeout(done, ms))

export const runOnKaggle = async (mode, note) => {
  const dry = preflight(mode)
  if (dry.failures.length > 0) throw new Error('the dry run of the kernel failed, so nothing was uploaded: ' + dry.failures.slice(0, 6).join(' ; '))
  const packed = JSON.parse(execFileSync('node', [join(root, 'scripts/kaggle/pack.mjs'), mode], { cwd: root, encoding: 'utf8' }).trim().split('\n').pop())
  const uploaded = kaggle(['datasets', 'version', '-p', 'build/kaggle/dataset', '-m', note, '-q'])
  if (uploaded.status !== 0) throw new Error('dataset version failed: ' + uploaded.text.slice(-400))
  const datasetDeadline = Date.now() + DATASET_WAIT_MS
  for (;;) {
    const files = kaggle(['datasets', 'files', DATASET_REF]).text
    const ready = /^ready$/m.test(kaggle(['datasets', 'status', DATASET_REF]).text)
    if (ready && files.includes(' ' + packed.archiveBytes + ' ')) break
    if (Date.now() > datasetDeadline) throw new Error('dataset version was not ready with ' + packed.archiveBytes + ' bytes: ' + files.slice(-300))
    await pause(POLL_MS)
  }
  const pushedAt = new Date().toISOString()
  const pushed = kaggle(['kernels', 'push', '-p', 'build/kaggle/kernel'])
  const version = /Kernel version (\d+) successfully pushed/.exec(pushed.text)
  if (!version) throw new Error('kernel push failed: ' + pushed.text.slice(-400))
  const runDeadline = Date.now() + RUN_WAIT_MS
  let state = ''
  const stream = startLogStream({ command: 'kaggle', args: ['kernels', 'logs', '-f', KERNEL_REF], path: join(root, STREAM_LOG), env: kaggleEnv(), cwd: root })
  const streamBytesAtPolls = []
  let streamed = null
  try {
    for (;;) {
      await pause(POLL_MS)
      stream.keepRunning()
      streamBytesAtPolls.push(stream.bytes())
      state = (/KernelWorkerStatus\.(\w+)/.exec(kaggle(['kernels', 'status', KERNEL_REF]).text) ?? [])[1] ?? 'UNKNOWN'
      if (state === 'COMPLETE' || state === 'ERROR' || state === 'CANCEL_ACKNOWLEDGED') break
      if (Date.now() > runDeadline) throw new Error('kernel still ' + state + ' after ' + RUN_WAIT_MS + ' ms')
    }
  } finally {
    streamed = await stream.stop()
  }
  const liveRows = new Set(streamRows(readFileSync(join(root, STREAM_LOG), 'utf8')).map((row) => row.index)).size
  const outDir = join(root, 'build/kaggle/out-v' + version[1])
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  const fetched = kaggle(['kernels', 'output', KERNEL_REF, '-p', outDir])
  const resultsPath = join(outDir, 'results.json')
  if (!existsSync(resultsPath)) throw new Error('kernel ended ' + state + ' with no results.json: ' + fetched.text.slice(-400))
  const results = JSON.parse(readFileSync(resultsPath, 'utf8'))
  if (results.payloadSha256 !== packed.payloadSha256) throw new Error('results are for payload ' + results.payloadSha256 + ', not ' + packed.payloadSha256)
  const failedRows = results.configs.filter((row) => row.error || row.refused).map((row) => ({ script: row.script, args: row.args, error: row.error ?? null, refused: row.refused ?? null }))
  const meta = { mode, version: Number(version[1]), pushedAt, state, preflight: { rows: dry.rows, seconds: dry.seconds, mostResultBytes: dry.mostResultBytes }, failedRows, payloadSha256: packed.payloadSha256, resultsPath, stream: { path: STREAM_LOG, pid: streamed.pid, guardPid: streamed.guardPid, starts: streamed.starts, bytes: streamed.bytes, bytesAtPolls: streamBytesAtPolls, liveRows }, queueWaitS: Number((results.startedAtEpochS - Date.parse(pushedAt) / 1000).toFixed(0)), runS: results.totalS ?? null, configs: results.configs.length, plannedRuns: results.plannedRuns }
  writeFileSync(join(outDir, 'meta.json'), JSON.stringify(meta, null, 1) + '\n')
  return { meta, results }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [mode = 'matrix', note = 'run'] = process.argv.slice(2)
  const { meta } = await runOnKaggle(mode, note)
  console.log(JSON.stringify(meta))
}
