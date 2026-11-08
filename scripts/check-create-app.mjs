import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { gate, finish } from './lib/gate.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const bin = join(here, '..', 'bin', 'create-app.js')
const fixture = JSON.parse(readFileSync(new URL('./fixtures/spoint/create-app.json', import.meta.url), 'utf8'))
const jayzeePackage = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'))
const NAME = fixture.name

function listFiles(root) {
  if (!existsSync(root)) return []
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

function run(cwd, args) {
  return spawnSync(process.execPath, [bin, ...args], { cwd, encoding: 'utf8' })
}

const same = (got, want, what) => {
  if (got !== want) throw new Error(what + ': got ' + JSON.stringify(got).slice(0, 160) + ', expected ' + JSON.stringify(want).slice(0, 160))
}

const dirs = []
const fresh = () => {
  const dir = mkdtempSync(join(tmpdir(), 'jz-create-app-gate-'))
  dirs.push(dir)
  return dir
}

try {
  const made = fixture.cases.map((c) => {
    const cwd = fresh()
    const result = run(cwd, ['--template', c.template, NAME])
    return { c, cwd, result }
  })

  for (const { c, cwd, result } of made) {
    gate('create-app ' + c.template + ' exits 0 and writes apps/' + NAME + '/index.js byte for byte as spoint does', () => {
      if (result.status !== 0) throw new Error('exit ' + result.status + ': ' + result.stderr)
      same(readFileSync(join(cwd, NAME, 'apps', NAME, 'index.js'), 'utf8'), c.files['apps/' + NAME + '/index.js'], 'index.js')
    })
  }

  gate('the apps/ subtree holds only apps/' + NAME + '/index.js, the same path spoint writes', () => {
    for (const { c, cwd } of made) {
      const want = Object.keys(c.files).map((p) => p.slice('apps/'.length)).sort()
      same(JSON.stringify(listFiles(join(cwd, NAME, 'apps'))), JSON.stringify(want), 'apps tree for ' + c.template)
    }
  })

  gate('the project adds exactly package.json, README.md and .gitignore beside apps/', () => {
    for (const { cwd } of made) {
      const top = listFiles(join(cwd, NAME)).filter((p) => !p.startsWith('apps/'))
      same(JSON.stringify(top), JSON.stringify(['.gitignore', 'README.md', 'package.json']), 'project files')
    }
  })

  gate('package.json names the project from the argument and depends on this jayzee version', () => {
    const pkg = JSON.parse(readFileSync(join(made[0].cwd, NAME, 'package.json'), 'utf8'))
    same(pkg.name, NAME, 'name')
    same(pkg.version, '0.1.0', 'version')
    same(pkg.type, 'module', 'type')
    same(pkg.dependencies.jayzee, '^' + jayzeePackage.version, 'jayzee dependency')
    if (pkg.dependencies.spoint !== undefined) throw new Error('a spoint dependency was written')
  })

  gate('README title is the project name and no placeholder is left in any written file', () => {
    const readme = readFileSync(join(made[0].cwd, NAME, 'README.md'), 'utf8')
    same(readme.split('\n')[0], '# ' + NAME, 'README title')
    for (const { cwd } of made) {
      for (const rel of ['README.md', 'package.json', '.gitignore', 'apps/' + NAME + '/index.js']) {
        const text = readFileSync(join(cwd, NAME, rel), 'utf8')
        if (/__[A-Z_]+__/.test(text)) throw new Error('placeholder left in ' + rel)
      }
    }
  })

  gate('.gitignore ignores node_modules', () => {
    const text = readFileSync(join(made[0].cwd, NAME, '.gitignore'), 'utf8')
    if (!text.split('\n').includes('node_modules/')) throw new Error('no node_modules/ line')
  })

  gate('an invalid app name is refused and writes nothing', () => {
    for (const bad of ['../evil', 'a b', 'x/y', 'dot.name', '', 'caf\u00e9']) {
      const cwd = fresh()
      const result = run(cwd, ['--template', 'simple', bad])
      if (result.status === 0) throw new Error('accepted ' + JSON.stringify(bad))
      same(listFiles(cwd).length, 0, 'files after refusing ' + JSON.stringify(bad))
    }
  })

  gate('an unknown template is refused and writes nothing', () => {
    const cwd = fresh()
    const result = run(cwd, ['--template', 'nope', NAME])
    if (result.status !== 1) throw new Error('exit ' + result.status)
    same(listFiles(cwd).length, 0, 'files after refusing the template')
  })

  gate('an existing directory is refused and left as it was', () => {
    const cwd = fresh()
    mkdirSync(join(cwd, NAME))
    writeFileSync(join(cwd, NAME, 'keep.txt'), 'mine\n')
    const result = run(cwd, ['--template', 'simple', NAME])
    if (result.status !== 1) throw new Error('exit ' + result.status)
    same(readFileSync(join(cwd, NAME, 'keep.txt'), 'utf8'), 'mine\n', 'kept file')
    same(listFiles(cwd).join(','), NAME + '/keep.txt', 'tree after refusal')
  })

  gate('no name exits 1, an extra argument exits 1, and --template with no value exits 1', () => {
    const cwd = fresh()
    same(run(cwd, []).status, 1, 'no name exit')
    same(run(cwd, ['one', 'two']).status, 1, 'extra argument exit')
    same(run(cwd, [NAME, '--template']).status, 1, 'missing template value exit')
    same(listFiles(cwd).length, 0, 'files after refusals')
  })

  gate('--help exits 0 and names the command and the template list', () => {
    const result = run(fresh(), ['--help'])
    same(result.status, 0, 'help exit')
    if (!result.stdout.includes('Usage: jayzee-create-app') || !result.stdout.includes('fsm-game')) throw new Error('help text missing')
  })
} finally {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
}
finish();
