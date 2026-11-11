import { closeSync, openSync, readFileSync, readSync, writeFileSync } from 'node:fs'

const [pidArg, tidArg, outPath, gapUsArg = '500', maxSamplesArg = '600000', othersPath = ''] = process.argv.slice(2)
if (!pidArg || !tidArg || !outPath) throw new TypeError('usage: threadSampler.mjs <pid> <tid> <out.json> [gap microseconds] [most samples] [others.json]')
const MOST_OTHER_RUNS = 3000000
const gapUs = Number(gapUsArg)
const most = Number(maxSamplesArg)
const SLICE_MS = 20
const task = '/proc/' + pidArg + '/task/' + tidArg + '/'
const open = (name) => {
  try {
    return openSync(task + name, 'r')
  } catch {
    return -1
  }
}
const schedFd = open('schedstat')
const statFd = open('stat')
const wchanFd = open('wchan')
if (schedFd < 0 || statFd < 0) throw new Error('thread ' + tidArg + ' of process ' + pidArg + ' cannot be read')
const text = Buffer.alloc(1024)
const read = (fd) => {
  try {
    return text.toString('latin1', 0, readSync(fd, text, 0, text.length, 0))
  } catch {
    return ''
  }
}
const nowUs = () => Number(process.hrtime.bigint() / 1000n)

const others = (othersPath === '' ? [] : JSON.parse(readFileSync(othersPath, 'utf8'))).map((other) => {
  try {
    return { ...other, fd: openSync('/proc/' + other.pid + '/task/' + other.tid + '/schedstat', 'r'), lastNs: -1 }
  } catch {
    return null
  }
}).filter((other) => other !== null)
const otherSample = new Uint32Array(MOST_OTHER_RUNS)
const otherIndex = new Uint16Array(MOST_OTHER_RUNS)
const otherRunNs = new Float64Array(MOST_OTHER_RUNS)
let otherRuns = 0

const sampleOthers = () => {
  for (let i = 0; i < others.length; i++) {
    const other = others[i]
    if (other.fd < 0) continue
    const sched = read(other.fd)
    if (sched === '') {
      other.fd = -1
      continue
    }
    const ns = Number(sched.slice(0, sched.indexOf(' ')))
    if (other.lastNs >= 0 && ns > other.lastNs && otherRuns < MOST_OTHER_RUNS) {
      otherSample[otherRuns] = samples
      otherIndex[otherRuns] = i
      otherRunNs[otherRuns] = ns - other.lastNs
      otherRuns += 1
    }
    other.lastNs = ns
  }
}

const atUs = new Float64Array(most)
const runNs = new Float64Array(most)
const waitNs = new Float64Array(most)
const state = new Uint8Array(most)
const minorFaults = new Float64Array(most)
const majorFaults = new Float64Array(most)
const systemTicks = new Float64Array(most)
const userTicks = new Float64Array(most)
const waitsOn = new Uint16Array(most)
const waitNames = ['']
let samples = 0
let stopped = false

const sample = () => {
  const sched = read(schedFd)
  if (sched === '') return false
  const space = sched.indexOf(' ')
  atUs[samples] = nowUs()
  runNs[samples] = Number(sched.slice(0, space))
  waitNs[samples] = Number(sched.slice(space + 1, sched.indexOf(' ', space + 1)))
  const stat = read(statFd)
  const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ', 13)
  state[samples] = fields[0].charCodeAt(0)
  minorFaults[samples] = Number(fields[7])
  majorFaults[samples] = Number(fields[9])
  userTicks[samples] = Number(fields[11])
  systemTicks[samples] = Number(fields[12])
  if (wchanFd >= 0) {
    const name = read(wchanFd).trim()
    let index = waitNames.indexOf(name === '0' ? '' : name)
    if (index < 0) index = waitNames.push(name) - 1
    waitsOn[samples] = index
  }
  sampleOthers()
  samples += 1
  return true
}

const finish = () => {
  if (stopped) return
  stopped = true
  closeSync(schedFd)
  closeSync(statFd)
  if (wchanFd >= 0) closeSync(wchanFd)
  writeFileSync(outPath, JSON.stringify({
    pid: Number(pidArg),
    tid: Number(tidArg),
    gapUs,
    samples,
    wchanReadable: wchanFd >= 0,
    waitNames,
    atUs: Array.from(atUs.subarray(0, samples)),
    runNs: Array.from(runNs.subarray(0, samples)),
    waitNs: Array.from(waitNs.subarray(0, samples)),
    state: Array.from(state.subarray(0, samples), (code) => String.fromCharCode(code)).join(''),
    waitsOn: Array.from(waitsOn.subarray(0, samples)),
    minorFaults: Array.from(minorFaults.subarray(0, samples)),
    majorFaults: Array.from(majorFaults.subarray(0, samples)),
    userTicks: Array.from(userTicks.subarray(0, samples)),
    systemTicks: Array.from(systemTicks.subarray(0, samples)),
    others: others.map(({ pid, tid, label }) => ({ pid, tid, label })),
    otherSample: Array.from(otherSample.subarray(0, otherRuns)),
    otherIndex: Array.from(otherIndex.subarray(0, otherRuns)),
    otherRunNs: Array.from(otherRunNs.subarray(0, otherRuns)),
  }))
  process.exit(0)
}

const slice = () => {
  if (stopped) return
  const until = nowUs() + SLICE_MS * 1000
  let next = nowUs()
  while (samples < most) {
    const now = nowUs()
    if (now >= until) break
    if (now < next) continue
    if (!sample()) return finish()
    next = now + gapUs
  }
  if (samples >= most) return finish()
  setImmediate(slice)
}

process.on('SIGTERM', finish)
process.stdin.on('end', finish)
process.stdin.on('close', finish)
process.stdin.resume()
console.log('SAMPLING ' + pidArg + ' ' + tidArg)
slice()
