import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { register } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { runBlendTree } from './lib/blendTreeScenario.mjs'

register(new URL('./lib/threeStubHooks.mjs', import.meta.url))

const spointRoot = resolve(process.argv[2] ?? '/workspace/spoint')
const sourceRel = 'src/animation/BlendTree.js'
const outFile = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'spoint', 'blend-tree.json')
const { BlendTree1D, BlendTree2D, BlendTreeNode } = await import(pathToFileURL(join(spointRoot, sourceRel)).href)

const sections = runBlendTree({ BlendTree1D, BlendTree2D, BlendTreeNode })
const fixture = {
  source: {
    file: sourceRel,
    sha256: createHash('sha256').update(readFileSync(join(spointRoot, sourceRel))).digest('hex'),
    note: 'spoint BlendTree1D, BlendTree2D and BlendTreeNode run on scripts/lib/blendTreeScenario.mjs. The file imports three.js at line 1, but no class in it uses that import, so the import is replaced by an empty module through scripts/lib/threeStubHooks.mjs. AnimationBlender is not in this fixture.',
  },
  sections,
}
writeFileSync(outFile, JSON.stringify(fixture, null, 1) + '\n')
console.log('wrote blend-tree.json', Object.entries(sections).map(([name, lines]) => name + ' ' + lines.length).join(', '))
