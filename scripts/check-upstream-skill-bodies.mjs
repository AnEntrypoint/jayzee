import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { parseManifest, parseSkillIndex } from '../src/upstream-skills/skillIndex.js'
import { bindSkills, parseSkillJson, skillById, totalBodyBytes } from '../src/upstream-skills/skillBodies.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const fixtureDir = join(root, 'scripts', 'fixtures', 'upstream', 'skills')

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}
const same = (actual, expected, label = 'value') => {
  assert(actual === expected, label + ' is ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected))
}
const sameJson = (actual, expected, label = 'value') => same(JSON.stringify(actual), JSON.stringify(expected), label)
const mustReject = (check) => {
  let rejected = false
  try {
    check()
  } catch (_) {
    rejected = true
  }
  assert(rejected, 'negative control was accepted')
}
const digestOf = (bytes) => createHash('sha256').update(bytes).digest('hex')

const manifestText = readFileSync(join(fixtureDir, 'MANIFEST.txt'), 'utf8')
const manifest = parseManifest(manifestText)
const indexRows = parseSkillIndex(readFileSync(join(fixtureDir, 'INDEX.md'), 'utf8'))
const fileBytes = (name) => {
  try {
    return new Uint8Array(readFileSync(join(fixtureDir, name)))
  } catch (_) {
    return null
  }
}
const skills = bindSkills(indexRows, manifest, fileBytes, digestOf)
const decode = (bytes) => new TextDecoder('utf-8', { fatal: true }).decode(bytes)

gate('the manifest lists 47 entries, and every skill body matches its manifest sha256 and size', () => {
  same(manifest.length, 47, 'manifest entries')
  for (const entry of manifest.filter((item) => item.name.endsWith('.json') || item.name.endsWith('.md'))) {
    const bytes = fileBytes(entry.name)
    assert(bytes !== null, 'missing body ' + entry.name)
    same(bytes.length, entry.size, entry.name + ' size')
    same(digestOf(bytes), entry.sha256, entry.name + ' sha256')
  }
})

gate('all 23 skills are served in index order with the index name and description', () => {
  same(skills.length, 23, 'served skills')
  sameJson(skills.map((skill) => skill.id), indexRows.map((row) => row.id), 'served order')
  for (const skill of skills) {
    const row = indexRows.find((item) => item.id === skill.id)
    same(skill.name, row.name, skill.id + ' name')
    same(skill.description, row.description, skill.id + ' description')
  }
})

gate('each served body is the md text and equals the json content field, as upstream wrote them', () => {
  for (const skill of skills) {
    same(skill.body, decode(fileBytes(skill.id + '.md')), skill.id + ' body')
    same(parseSkillJson(decode(fileBytes(skill.id + '.json'))).content, skill.body, skill.id + ' json content')
  }
})

gate('the bodies total the sum of the manifest md sizes, and skillById finds a served skill or nothing', () => {
  const mdSizes = manifest.filter((item) => item.name.endsWith('.md') && item.name !== 'INDEX.md').reduce((sum, item) => sum + item.size, 0)
  same(totalBodyBytes(skills), mdSizes, 'total body bytes')
  same(skillById(skills, 'physics').name, 'Physics', 'physics name')
  same(skillById(skills, 'no-such-skill'), null, 'unknown skill')
})

const rebuiltManifest = (name, bytes) => manifest.map((entry) => (entry.name === name ? { name, sha256: digestOf(bytes), size: bytes.length } : entry))

gate('a tampered body, a tampered manifest sha, a missing body and a renamed json field are each refused', () => {
  const first = indexRows[0]
  const mdName = first.id + '.md'
  const jsonName = first.id + '.json'
  const tampered = new TextEncoder().encode(decode(fileBytes(mdName)) + 'x')
  mustReject(() => bindSkills(indexRows, rebuiltManifest(mdName, tampered), (name) => (name === mdName ? tampered : fileBytes(name)), digestOf))
  mustReject(() => bindSkills(indexRows, manifest.map((entry) => (entry.name === mdName ? { ...entry, sha256: '0'.repeat(64) } : entry)), fileBytes, digestOf))
  mustReject(() => bindSkills(indexRows, manifest, (name) => (name === mdName ? null : fileBytes(name)), digestOf))
  const renamed = new TextEncoder().encode(JSON.stringify({ ...JSON.parse(decode(fileBytes(jsonName))), name: 'Renamed' }))
  mustReject(() => bindSkills(indexRows, rebuiltManifest(jsonName, renamed), (name) => (name === jsonName ? renamed : fileBytes(name)), digestOf))
  mustReject(() => parseSkillJson('{"id":"a","name":"A","description":"d"}'))
})

finish()
