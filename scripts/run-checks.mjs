import { spawn, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const chain = JSON.parse(readFileSync(join(root, 'scripts', 'test-chain.json'), 'utf8'))
const outDir = join(root, 'build', 'checks')
const cachePath = join(outDir, 'passed.json')
const timingsPath = join(outDir, 'timings.json')
const TREE_KEY_IGNORED = ['docs/PENDING_VALIDATION.md', 'docs/CHECK_TIMES.md']
const SERIAL = new Set(JSON.parse(readFileSync(join(root, 'scripts', 'test-serial.json'), 'utf8')))
const CACHE_TREES_KEPT = 8

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const valueOf = (name, fallback) => {
  const at = args.indexOf(name)
  return at === -1 ? fallback : args[at + 1]
}
const jobs = Number(valueOf('--jobs', process.env.CHECK_JOBS ?? '4'))
if (!Number.isInteger(jobs) || jobs < 1) throw new RangeError('--jobs takes a whole number of at least 1')
const filters = args.filter((arg, at) => !arg.startsWith('--') && args[at - 1] !== '--jobs')

const git = (argv, env = {}) => execFileSync('git', argv, { cwd: root, encoding: 'utf8', env: { ...process.env, ...env }, maxBuffer: 1 << 28 }).trim()

const builtArtifactsKey = () => {
  const dir = join(root, 'engine', 'out')
  if (!existsSync(dir)) return 'none'
  const hash = createHash('sha256')
  for (const name of readdirSync(dir).sort()) {
    const stat = statSync(join(dir, name))
    hash.update(name + ':' + stat.size + ':' + Math.round(stat.mtimeMs) + '\n')
  }
  return hash.digest('hex')
}

const treeKey = () => {
  const index = join(outDir, 'tree.index')
  const realIndex = join(root, git(['rev-parse', '--git-path', 'index']))
  try {
    if (existsSync(realIndex)) copyFileSync(realIndex, index)
    const env = { GIT_INDEX_FILE: index }
    git(['add', '-A', '.'], env)
    git(['rm', '-q', '--cached', '--ignore-unmatch', ...TREE_KEY_IGNORED], env)
    return createHash('sha256').update(git(['write-tree'], env) + '\n' + builtArtifactsKey() + '\n' + process.version).digest('hex')
  } catch {
    return null
  } finally {
    rmSync(index, { force: true })
  }
}

const matches = (name) => filters.length === 0 || filters.some((filter) => name.includes(filter) || pkg.scripts[name].includes(filter))
const BUILD = 'build:kernel'
const selected = chain.filter((name) => name !== BUILD && matches(name))
for (const name of chain) if (typeof pkg.scripts[name] !== 'string') throw new Error(name + ' is in scripts/test-chain.json and not in package.json')

if (flag('--write-times')) {
  const recorded = JSON.parse(readFileSync(timingsPath, 'utf8'))
  const rows = Object.entries(recorded).sort((x, y) => y[1] - x[1])
  const reasons = JSON.parse(readFileSync(join(root, 'scripts', 'test-slow-reasons.json'), 'utf8'))
  const total = rows.reduce((sum, row) => sum + row[1], 0)
  const lines = ['# Check times', '', 'Written by \`npm test -- --write-times\` from \`build/checks/timings.json\`, the last wall time of each check on this host. A check over 2 s carries its reason from \`scripts/test-slow-reasons.json\`.', '', 'Sum of the checks: ' + (total / 1000).toFixed(1) + ' s across ' + rows.length + ' entries. The checks run four at a time, so the wall time of a full run is lower; the runner prints it.', '', '| check | wall ms | serial | reason when over 2 s |', '|---|---|---|---|']
  for (const [name, ms] of rows) lines.push('| \`' + name + '\` | ' + ms + ' | ' + (SERIAL.has(name) ? 'yes' : '') + ' | ' + (ms > 2000 ? (reasons[name] ?? 'NO REASON RECORDED') : '') + ' |')
  const kaggleRecord = join(root, 'scripts', 'kaggle', 'record.md')
  if (existsSync(kaggleRecord)) lines.push('', readFileSync(kaggleRecord, 'utf8').trimEnd())
  writeFileSync(join(root, 'docs', 'CHECK_TIMES.md'), lines.join('\n') + '\n')
  console.log('docs/CHECK_TIMES.md: ' + rows.length + ' rows')
  process.exit(0)
}
if (flag('--list')) {
  for (const name of selected) console.log(name + '  ' + pkg.scripts[name])
  process.exit(0)
}
if (selected.length === 0) {
  console.log('no check in the chain matches ' + filters.join(' '))
  process.exit(1)
}

mkdirSync(outDir, { recursive: true })
const key = flag('--force') ? null : treeKey()
const cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : { trees: [] }
const passedHere = key === null ? {} : (cache.trees.find((tree) => tree.key === key)?.passed ?? {})

const run = (name) => new Promise((done) => {
  const started = performance.now()
  const child = spawn(pkg.scripts[name], { cwd: root, shell: true, env: { ...process.env, PATH: join(root, 'node_modules', '.bin') + ':' + process.env.PATH } })
  const chunks = []
  child.stdout.on('data', (chunk) => chunks.push(chunk))
  child.stderr.on('data', (chunk) => chunks.push(chunk))
  child.on('close', (code) => {
    const text = Buffer.concat(chunks).toString('utf8')
    writeFileSync(join(outDir, name.replace(/[^a-z0-9-]/gi, '_') + '.log'), text)
    done({ name, code, ms: Math.round(performance.now() - started), text, pass: (text.match(/^PASS /gm) ?? []).length, fail: (text.match(/^FAIL /gm) ?? []).length })
  })
})

const report = (result) => {
  console.log((result.code === 0 ? 'ok   ' : 'FAIL ') + result.name + ' ' + result.ms + ' ms, ' + result.pass + ' PASS' + (result.fail ? ', ' + result.fail + ' FAIL' : ''))
  if (result.code !== 0) console.log(result.text.split('\n').filter((line) => !line.startsWith('PASS ')).slice(-40).join('\n'))
}

const wallStarted = performance.now()
const build = await run(BUILD)
console.log(build.text.trim())
if (build.code !== 0) {
  report(build)
  process.exit(1)
}

const known = existsSync(timingsPath) ? JSON.parse(readFileSync(timingsPath, 'utf8')) : {}
const todo = selected.filter((name) => passedHere[name] === undefined).sort((a, b) => (known[b] ?? 0) - (known[a] ?? 0))
const skipped = selected.length - todo.length
const results = []
const runPool = async (names, width) => {
  const queue = names.slice()
  await Promise.all(Array.from({ length: Math.min(width, queue.length) }, async () => {
    while (queue.length > 0) {
      const result = await run(queue.shift())
      results.push(result)
      report(result)
    }
  }))
}
await runPool(todo.filter((name) => !SERIAL.has(name)), jobs)
await runPool(todo.filter((name) => SERIAL.has(name)), 1)

const failed = results.filter((result) => result.code !== 0)
if (key !== null) {
  const passed = { ...passedHere }
  for (const result of results) if (result.code === 0) passed[result.name] = result.ms
  cache.trees = [{ key, passed }, ...cache.trees.filter((tree) => tree.key !== key)].slice(0, CACHE_TREES_KEPT)
  writeFileSync(cachePath, JSON.stringify(cache) + '\n')
}
const timings = known
for (const result of results) timings[result.name] = result.ms
timings[BUILD] = build.ms
writeFileSync(timingsPath, JSON.stringify(timings, null, 1) + '\n')

const wallMs = Math.round(performance.now() - wallStarted)
const slowest = results.slice().sort((a, b) => b.ms - a.ms).slice(0, 8).map((result) => result.name + ' ' + result.ms + ' ms').join(', ')
console.log('checks: ' + results.length + ' run, ' + skipped + ' already passed on this tree, ' + failed.length + ' failed, ' + results.reduce((sum, result) => sum + result.pass, 0) + ' PASS lines, wall ' + wallMs + ' ms, jobs ' + jobs)
if (results.length > 0) console.log('slowest: ' + slowest)
if (failed.length > 0) console.log('failed: ' + failed.map((result) => result.name).join(' ') + '\nrerun one alone with: npm test -- ' + failed[0].name)
console.log(failed.length === 0 ? 'RESULT: PASS' : 'RESULT: FAIL')
process.exit(failed.length === 0 ? 0 : 1)
