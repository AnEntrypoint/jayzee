import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { parseManifest, parseSkillIndex } from '../src/upstream-skills/skillIndex.js'
import { bindSkills } from '../src/upstream-skills/skillBodies.js'
import { createSkillRegistry } from '../src/upstream-skills/skillRegistry.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const fixtureDir = join(root, 'scripts', 'fixtures', 'upstream', 'skills')

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

gate('a verifier that refuses a skill leaves the registry without it, and names the skill', () => {
  const refuseOne = (skill) => skill.id !== skills[3].id && verify(skill)
  const registry = createSkillRegistry({ verify: refuseOne })
  let message = ''
  try {
    registry.install(skills[3])
  } catch (error) {
    message = error.message
  }
  assert(message.includes(skills[3].id), 'refusal does not name ' + skills[3].id)
  same(registry.lookup(skills[3].id), null, 'lookup of refused skill')
  sameJson(registry.ids(), [], 'ids after refused install')
})

gate('a verifier that accepts a skill installs it, and a throwing verifier propagates its error', () => {
  const accepting = createSkillRegistry({ verify: () => true })
  same(accepting.install(skills[3]).id, skills[3].id, 'accepted install id')
  const throwing = createSkillRegistry({
    verify: () => {
      throw new Error('verifier broke')
    },
  })
  let propagated = ''
  try {
    throwing.install(skills[3])
  } catch (error) {
    propagated = error.message
  }
  same(propagated, 'verifier broke', 'propagated error')
  sameJson(throwing.ids(), [], 'ids after throwing verifier')
})

gate('a registry without a verifier is refused', () => {
  mustThrow(() => createSkillRegistry({}))
})

gate('every served skill, refused alone, leaves the registry without it, and the refusal names it (all 23)', () => {
  for (const target of skills) {
    const registry = createSkillRegistry({ verify: (skill) => skill.id !== target.id && verify(skill) })
    let message = ''
    for (const skill of skills) {
      try {
        registry.install(skill)
      } catch (error) {
        assert(skill.id === target.id, 'a skill other than ' + target.id + ' was refused: ' + skill.id)
        message = error.message
      }
    }
    assert(message.includes(target.id), 'refusal does not name ' + target.id)
    same(registry.lookup(target.id), null, target.id + ' lookup after refusal')
    same(registry.ids().length, 22, 'installed skills when ' + target.id + ' is refused')
  }
})

gate('every served skill, forged in its body, is refused and leaves no record (all 23)', () => {
  for (const skill of skills) {
    const registry = createSkillRegistry({ verify })
    mustThrow(() => registry.install({ ...skill, body: skill.body + 'x' }))
    same(registry.lookup(skill.id), null, skill.id + ' lookup after forged install')
    sameJson(registry.ids(), [], skill.id + ' ids after forged install')
  }
})

finish()
