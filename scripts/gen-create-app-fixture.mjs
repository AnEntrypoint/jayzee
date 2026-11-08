import { mkdtempSync, readdirSync, readFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const spointRoot = resolve(process.argv[2] ?? '/workspace/spoint')
const outFile = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'spoint', 'create-app.json')
const NAME = 'my-app'
const TEMPLATES = ['simple', 'physics', 'interactive', 'spawner', 'fsm-game']

function listFiles(root) {
  const out = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else out.push(relative(root, path).split(sep).join('/'))
    }
  }
  walk(root)
  return out.sort()
}

const cases = []
for (const template of TEMPLATES) {
  const cwd = mkdtempSync(join(tmpdir(), 'jz-spoint-create-app-'))
  try {
    const run = spawnSync(process.execPath, [join(spointRoot, 'bin', 'create-app.js'), '--template', template, NAME], { cwd, encoding: 'utf8' })
    if (run.status !== 0) throw new Error('spoint create-app exited ' + run.status + ': ' + run.stderr)
    const files = {}
    for (const rel of listFiles(cwd)) files[rel] = readFileSync(join(cwd, rel), 'utf8')
    cases.push({ template, files })
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
}

const fixture = {
  generatedFrom: 'spoint bin/create-app.js run in a temp directory for each template by scripts/gen-create-app-fixture.mjs',
  name: NAME,
  cases,
}
mkdirSync(dirname(outFile), { recursive: true })
writeFileSync(outFile, JSON.stringify(fixture, null, 2) + '\n')
console.log('wrote ' + outFile + ' with ' + cases.length + ' cases')
