import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { parseTomeIndex, summarizeTome } from '../src/savi-tome/tomeIndex.js'
import { bindSections, sectionText } from '../src/savi-tome/tomeSections.js'
import { headingsOf, lookupByFile, lookupByHeading, lookupText } from '../src/savi-tome/tomeLookup.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const tomeDir = join(root, 'scripts', 'fixtures', 'savi', 'tome')
const sourceDir = join(root, 'src', 'savi-tome')

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}
const same = (actual, expected, label = 'value') => {
  assert(actual === expected, label + ' is ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected))
}
const sameJson = (actual, expected, label = 'value') => same(JSON.stringify(actual), JSON.stringify(expected), label)

const rows = parseTomeIndex(readFileSync(join(tomeDir, 'INDEX.md'), 'utf8'))
const sections = bindSections(rows, (file) => {
  const path = join(tomeDir, file)
  return existsSync(path) ? new Uint8Array(readFileSync(path)) : null
})

gate('the lookup lists the 68 distinct headings in index order', () => {
  const headings = headingsOf(sections)
  same(headings.length, summarizeTome(rows).distinctHeadings, 'distinct headings')
  sameJson(headings, [...new Set(rows.map((row) => row.heading))], 'heading order')
})

gate('looking up every heading returns each of its sections, and the counts add up to 69', () => {
  let total = 0
  for (const heading of headingsOf(sections)) {
    const hits = lookupByHeading(sections, heading)
    sameJson(hits.map((hit) => hit.file), rows.filter((row) => row.heading === heading).map((row) => row.file), heading)
    total += hits.length
  }
  same(total, 69, 'sections reached by heading lookup')
})

gate('the repeated heading World Queries returns both files, and their texts differ', () => {
  const texts = lookupText(sections, 'World Queries')
  sameJson(texts.map((item) => item.file), ['sections/world-queries.md', 'sections/world-queries-2.md'], 'files')
  assert(texts[0].text !== texts[1].text, 'the two World Queries texts are identical')
})

gate('a heading lookup returns the same text as the section body it names', () => {
  const [identity] = lookupText(sections, 'Identity')
  same(identity.file, 'sections/identity.md', 'identity file')
  same(identity.text, readFileSync(join(tomeDir, 'sections/identity.md'), 'utf8'), 'identity text')
  same(sectionText(lookupByFile(sections, identity.file)[0]), identity.text, 'by file and by heading agree')
})

gate('looking up each file returns exactly that one section, and an unknown file or heading returns nothing', () => {
  for (const row of rows) {
    sameJson(lookupByFile(sections, row.file).map((hit) => hit.file), [row.file], row.file)
  }
  sameJson(lookupByFile(sections, 'sections/not-in-index.md'), [], 'unknown file')
  sameJson(lookupByHeading(sections, 'No Such Heading'), [], 'unknown heading')
})

gate('a section whose body is not strict UTF-8 is refused by the text lookup', () => {
  const bad = [{ heading: 'Bad', file: 'sections/bad.md', bytes: new Uint8Array([0xff]) }]
  let rejected = false
  try {
    lookupText(bad, 'Bad')
  } catch (_) {
    rejected = true
  }
  assert(rejected, 'invalid UTF-8 was accepted')
})

gate('heading matching is exact: a different case or a trailing space finds nothing', () => {
  sameJson(lookupByHeading(sections, 'identity'), [], 'lower case')
  sameJson(lookupByHeading(sections, 'Identity '), [], 'trailing space')
})

const findingsIn = (source) => {
  const found = []
  if (source.includes('//') || source.includes('/*')) found.push('comment marker')
  for (const piece of source.split("from '").slice(1)) {
    const specifier = piece.slice(0, piece.indexOf("'"))
    if (!specifier.startsWith('.')) found.push('bare import ' + specifier)
  }
  const words = new Set(source.split(/[^A-Za-z0-9_$]/))
  for (const token of ['process', 'performance', 'Date', 'setTimeout', 'clearTimeout', 'setImmediate', 'setInterval', 'console', 'window', 'globalThis', 'require', 'Buffer', 'URL']) {
    if (words.has(token)) found.push('uses ' + token)
  }
  return found
}

gate('src/savi-tome/tomeLookup.js is comment-free, imports nothing bare and reads no host global', () => {
  sameJson(findingsIn(readFileSync(join(sourceDir, 'tomeLookup.js'), 'utf8')), [], 'findings')
})

finish()
