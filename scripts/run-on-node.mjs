import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const [majorArg, ...names] = process.argv.slice(2)
const major = Number(majorArg)
if (!Number.isInteger(major) || major < 18 || names.length === 0) throw new TypeError('usage: node scripts/run-on-node.mjs <node major> <npm script name>...')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
for (const name of names) if (typeof pkg.scripts[name] !== 'string') throw new RangeError(name + ' is not a script in package.json')
const ARCH = { x64: 'x64', arm64: 'arm64' }[process.arch]
if (process.platform !== 'linux' || ARCH === undefined) throw new Error('run-on-node fetches the linux x64 or arm64 build only')

const base = 'https://nodejs.org/dist/latest-v' + major + '.x/'
const home = join(root, 'build', 'node')
mkdirSync(home, { recursive: true })
const fetched = async (url) => {
  const response = await fetch(url)
  if (!response.ok) throw new Error(url + ' answered ' + response.status)
  return Buffer.from(await response.arrayBuffer())
}
const sums = (await fetched(base + 'SHASUMS256.txt')).toString('utf8')
const line = sums.split('\n').find((row) => row.endsWith('-linux-' + ARCH + '.tar.xz'))
if (line === undefined) throw new Error('no linux ' + ARCH + ' archive is listed at ' + base)
const [sha256, archive] = line.trim().split(/\s+/)
const dir = join(home, archive.replace(/\.tar\.xz$/, ''))
if (!existsSync(join(dir, 'bin', 'node'))) {
  const bytes = await fetched(base + archive)
  const got = createHash('sha256').update(bytes).digest('hex')
  if (got !== sha256) throw new Error(archive + ' has sha256 ' + got + ', and SHASUMS256.txt lists ' + sha256)
  writeFileSync(join(home, archive), bytes)
  execFileSync('tar', ['-xJf', join(home, archive), '-C', home])
}
const version = execFileSync(join(dir, 'bin', 'node'), ['--version'], { encoding: 'utf8' }).trim()
console.log('node ' + version + ' from ' + base + archive + ' sha256 ' + sha256)

let failed = 0
for (const name of names) {
  const started = performance.now()
  const run = spawnSync(pkg.scripts[name], { cwd: root, shell: true, encoding: 'utf8', maxBuffer: 1 << 28, env: { ...process.env, PATH: join(dir, 'bin') + ':' + join(root, 'node_modules', '.bin') + ':' + process.env.PATH } })
  const text = (run.stdout ?? '') + (run.stderr ?? '')
  const lines = text.split('\n')
  if (run.status !== 0) failed += 1
  console.log((run.status === 0 ? 'ok   ' : 'FAIL ') + name + ' on node ' + version + ', ' + Math.round(performance.now() - started) + ' ms, ' + lines.filter((row) => row.startsWith('PASS ')).length + ' PASS, ' + lines.filter((row) => row.startsWith('FAIL ')).length + ' FAIL')
  if (run.status !== 0) console.log(lines.filter((row) => !row.startsWith('PASS ')).slice(-30).join('\n'))
}
console.log(failed === 0 ? 'RESULT: PASS' : 'RESULT: FAIL')
process.exit(failed === 0 ? 0 : 1)
