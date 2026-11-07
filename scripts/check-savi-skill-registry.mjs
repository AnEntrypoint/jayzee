import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { parseManifest, parseSkillIndex } from '../src/savi-skills/skillIndex.js'
import { bindSkills } from '../src/savi-skills/skillBodies.js'
import { createSkillRegistry } from '../src/savi-skills/skillRegistry.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const fixtureDir = join(root, 'scripts', 'fixtures', 'savi', 'skills')
const sourceDir = join(root, 'src', 'savi-skills')

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}
const same = (actual, expected, label = 'value') => {
  assert(actual === expected, label + ' is ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected))
}
const sameJson = (actual, expected, label = 'value') => same(JSON.stringify(actual), JSON.stringify(expected), label)
const mustThrow = (check) => {
  let thrown = false
  try {
    check()
  } catch (_) {
    thrown = true
  }
  assert(thrown, 'negative control was accepted')
}
const digestOf = (bytes) => createHash('sha256').update(bytes).digest('hex')

const manifest = parseManifest(readFileSync(join(fixtureDir, 'MANIFEST.txt'), 'utf8'))
const indexRows = parseSkillIndex(readFileSync(join(fixtureDir, 'INDEX.md'), 'utf8'))
const fileBytes = (name) => new Uint8Array(readFileSync(join(fixtureDir, name)))
const skills = bindSkills(indexRows, manifest, fileBytes, digestOf)
const mdSha = new Map(manifest.map((entry) => [entry.name, entry.sha256]))
const verify = (skill) => digestOf(new TextEncoder().encode(skill.body)) === mdSha.get(skill.id + '.md')

gate('all 23 served skills install, and the registry lists them in index order', () => {
  const registry = createSkillRegistry({ verify })
  for (const skill of skills) registry.install(skill)
  sameJson(registry.ids(), indexRows.map((row) => row.id), 'installed ids')
})

gate('a looked-up skill returns the served body and description, and an unknown id returns nothing', () => {
  const registry = createSkillRegistry({ verify })
  for (const skill of skills) registry.install(skill)
  const physics = registry.lookup('physics')
  same(physics.body, skills.find((skill) => skill.id === 'physics').body, 'physics body')
  same(physics.description, skills.find((skill) => skill.id === 'physics').description, 'physics description')
  same(registry.lookup('no-such-skill'), null, 'unknown id')
})

gate('an installed record is frozen, so a caller cannot change what the registry holds', () => {
  const registry = createSkillRegistry({ verify })
  const record = registry.install(skills[0])
  assert(Object.isFrozen(record), 'record is not frozen')
  mustThrow(() => {
    'use strict'
    record.body = 'changed'
    if (record.body !== 'changed') throw new Error('unchanged')
  })
  same(registry.lookup(skills[0].id).body, skills[0].body, 'body after attempted change')
})

gate('a duplicate install, a forged body, a malformed id and a missing description are each refused', () => {
  const registry = createSkillRegistry({ verify })
  const [first] = skills
  registry.install(first)
  mustThrow(() => registry.install(first))
  mustThrow(() => registry.install({ ...skills[1], body: skills[1].body + 'x' }))
  mustThrow(() => registry.install({ ...skills[1], id: 'Bad Id' }))
  const { description, ...withoutDescription } = skills[1]
  mustThrow(() => registry.install(withoutDescription))
  sameJson(registry.ids(), [first.id], 'ids after refusals')
})

gate('an uninstalled skill is gone, and it can be installed again', () => {
  const registry = createSkillRegistry({ verify })
  registry.install(skills[2])
  same(registry.uninstall(skills[2].id), true, 'uninstall result')
  same(registry.lookup(skills[2].id), null, 'lookup after uninstall')
  same(registry.uninstall(skills[2].id), false, 'second uninstall')
  registry.install(skills[2])
  same(registry.lookup(skills[2].id).id, skills[2].id, 'lookup after reinstall')
})

gate('a registry without a verifier is refused', () => {
  mustThrow(() => createSkillRegistry({}))
})

const findingsIn = (source) => {
  const found = []
  if (source.includes('//') || source.includes('/*')) found.push('comment marker')
  for (const piece of source.split("from '").slice(1)) {
    const specifier = piece.slice(0, piece.indexOf("'"))
    if (!specifier.startsWith('.')) found.push('bare import ' + specifier)
  }
  const words = new Set(source.split(/[^A-Za-z0-9_$]/))
  for (const token of ['eval', 'Function', 'fetch', 'process', 'performance', 'Date', 'setTimeout', 'console', 'window', 'globalThis', 'require', 'Buffer']) {
    if (words.has(token)) found.push('uses ' + token)
  }
  return found
}

gate('src/savi-skills/skillRegistry.js is comment-free, imports nothing bare, and neither evaluates nor runs a body', () => {
  sameJson(findingsIn(readFileSync(join(sourceDir, 'skillRegistry.js'), 'utf8')), [], 'findings')
})

finish()
