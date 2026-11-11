import { closeSync, openSync, readSync, writeFileSync } from 'node:fs'

const [pidArg, tidArg, outPath, gapUsArg = '500', maxSamplesArg = '600000'] = process.argv.slice(2)
if (!pidArg || !tidArg || !outPath) throw new TypeError('usage: threadSampler.mjs <pid> <tid> <out.json> [gap microseconds] [most samples]')
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

const atUs = new Float64Array(most)
const runNs = new Float64Array(most)
const waitNs = new Float64Array(most)
const state = new Uint8Array(most)
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
  state[samples] = stat.charCodeAt(stat.lastIndexOf(')') + 2)
  if (wchanFd >= 0) {
    const name = read(wchanFd).trim()
    let index = waitNames.indexOf(name === '0' ? '' : name)
    if (index < 0) index = waitNames.push(name) - 1
    waitsOn[samples] = index
  }
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
