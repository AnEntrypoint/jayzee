import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const spointRoot = resolve(process.argv[2] ?? '/workspace/spoint')
const outFile = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'spoint', 'app-loader.json')
const { AppLoader } = await import(pathToFileURL(join(spointRoot, 'src/apps/AppLoader.js')).href)

const TREE = {
  'package.json': '{"type":"module"}\n',
  'apps/alpha.js': "export default { name: 'alpha' }\n",
  'apps/beta/index.js': "export default { name: 'beta' }\n",
  'apps/eta.js': "export default { name: 'eta-flat' }\n",
  'apps/eta/index.js': "export default { name: 'eta-folder' }\n",
  'apps/epsilon.js': 'export default {}\n',
  'apps/gamma.js': "export default { name: 'gamma' }\nconst stop = process.exit\n",
  'apps/delta.js': 'export default {  @@ not valid js\n',
  'apps/theta.js': "const fs = require('fs')\nexport default { fs }\n",
  'apps/iota.js': 'export default { g: globalThis }\n',
  'apps/zeta/readme.txt': 'no entry point here\n',
  'apps/rho.txt': 'not an app\n',
  'more/omega.js': "export default { name: 'omega' }\n",
  'more/alpha.js': "export default { name: 'alpha-shadow' }\n",
  'more/mu/index.js': "export default { name: 'mu' }\n",
}

const root = mkdtempSync(join(tmpdir(), 'jz-spoint-app-loader-'))
const byApp = (a, b) => (a.app < b.app ? -1 : a.app > b.app ? 1 : 0)
const sorted = (xs) => [...xs].sort()
try {
  for (const [rel, content] of Object.entries(TREE)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true })
    writeFileSync(join(root, rel), content)
  }
  const registered = []
  const runtime = { registerApp: (name) => registered.push(name), queueReload() {} }
  const dirs = ['apps', 'more'].map((d) => join(root, d))
  const errorSink = console.error
  console.error = () => {}
  let result, resolved
  try {
    const loader = new AppLoader(runtime, { dirs })
    result = await loader.loadAll()
    resolved = {}
    for (const name of ['alpha', 'beta', 'eta', 'zeta', 'gamma', 'missing', 'omega', 'mu', 'epsilon', 'rho']) {
      const found = await loader._resolvePath(name)
      resolved[name] = found === null ? null : relative(root, found).split(sep).join('/')
    }
  } finally {
    console.error = errorSink
  }
  const fixture = {
    generatedFrom: 'spoint src/apps/AppLoader.js loaded from a tree written to a temp directory by scripts/gen-app-loader-fixture.mjs',
    dirs: ['apps', 'more'],
    tree: TREE,
    loadAll: {
      loaded: sorted(result.loaded),
      failed: sorted(result.failed),
      refusals: [...result.refusals].sort(byApp),
    },
    registered: sorted(registered),
    resolve: resolved,
  }
  mkdirSync(dirname(outFile), { recursive: true })
  writeFileSync(outFile, JSON.stringify(fixture, null, 2) + '\n')
  console.log('wrote ' + outFile)
} finally {
  rmSync(root, { recursive: true, force: true })
}
