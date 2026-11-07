import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { parseTomeIndex, summarizeTome } from '../src/savi-tome/tomeIndex.js'
import { bindSections, sectionByFile, sectionsByHeading, sectionText, totalSectionBytes } from '../src/savi-tome/tomeSections.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const tomeDir = join(root, 'scripts', 'fixtures', 'savi', 'tome')
const indexPath = join(tomeDir, 'INDEX.md')
const sourceDir = join(root, 'src', 'savi-tome')
const INDEX_SHA256 = 'a387aef7017c6f0b2623b333ee19f8f4ccffc802e333748c187db78bee30cb24'
const AGGREGATE_SHA256 = 'c9b640bb549ab06f9ae10eab004769335e4c7ef14781d1ee93d18673d1b9597a'
const TOTAL_BYTES = 119517

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
const sha256Of = (bytes) => createHash('sha256').update(bytes).digest('hex')

const rows = parseTomeIndex(readFileSync(indexPath, 'utf8'))
const readBody = (file) => {
  const path = join(tomeDir, file)
  return existsSync(path) ? new Uint8Array(readFileSync(path)) : null
}
const sections = bindSections(rows, readBody)

gate('the index and the 69 section bodies are byte copies of the savi checkout', () => {
  same(sha256Of(readFileSync(indexPath)), INDEX_SHA256, 'index sha256')
  const aggregate = rows.map((row) => sha256Of(readBody(row.file)) + '  ' + row.file + '\n').join('')
  same(sha256Of(aggregate), AGGREGATE_SHA256, 'aggregate sha256 of the section bodies in index order')
})

gate('the index lists 69 sections and the bodies on disk are exactly the listed files', () => {
  same(summarizeTome(rows).distinctFiles, 69, 'distinct files')
  const onDisk = readdirSync(join(tomeDir, 'sections')).map((name) => 'sections/' + name).sort()
  sameJson(onDisk, rows.map((row) => row.file).sort(), 'files on disk')
})

gate('every section is served at its index byte count, and the bodies total 119517 bytes', () => {
  same(sections.length, 69, 'served sections')
  sameJson(sections.map((section) => section.file), rows.map((row) => row.file), 'served order')
  same(totalSectionBytes(sections), TOTAL_BYTES, 'total served bytes')
})

gate('every body decodes as strict UTF-8, and each served text matches its file', () => {
  for (const section of sections) {
    same(sectionText(section), readFileSync(join(tomeDir, section.file), 'utf8'), section.file + ' text')
  }
  mustReject(() => sectionText({ bytes: new Uint8Array([0xff]) }))
})

gate('the repeated heading World Queries serves both of its bodies, and they differ', () => {
  const copies = sectionsByHeading(sections, 'World Queries')
  sameJson(copies.map((section) => section.file), ['sections/world-queries.md', 'sections/world-queries-2.md'], 'World Queries files')
  assert(sectionText(copies[0]) !== sectionText(copies[1]), 'the two World Queries bodies are identical')
})

gate('a served section is found by its file, and an unknown file is not served', () => {
  const section = sectionByFile(sections, 'sections/identity.md')
  same(section.heading, 'Identity', 'identity heading')
  same(sectionByFile(sections, 'sections/not-in-index.md'), null, 'unknown file')
})

gate('a missing body, a body of the wrong length and a duplicate file are refused', () => {
  const one = [{ heading: 'h', file: 'sections/x.md', bytes: 2, source: 'all' }]
  mustReject(() => bindSections(one, () => null))
  mustReject(() => bindSections(one, () => new Uint8Array(3)))
  mustReject(() => bindSections([...one, ...one], () => new Uint8Array(2)))
})

const findingsIn = (source) => {
  const found = []
  if (source.includes('//') || source.includes('/*')) found.push('comment marker')
  for (const piece of source.split("from '").slice(1)) {
    const specifier = piece.slice(0, piece.indexOf("'"))
    if (!specifier.startsWith('.')) found.push('bare import ' + specifier)
  }
  const words = new Set(source.split(/[^A-Za-z0-9_$]/))
  for (const token of ['process', 'performance', 'Date', 'setTimeout', 'clearTimeout', 'setImmediate', 'setInterval', 'console', 'window', 'globalThis', 'require', 'Buffer']) {
    if (words.has(token)) found.push('uses ' + token)
  }
  return found
}

gate('src/savi-tome/tomeSections.js is comment-free, imports nothing bare and reads no host global', () => {
  const source = readFileSync(join(sourceDir, 'tomeSections.js'), 'utf8')
  sameJson(findingsIn(source), [], 'findings')
  mustReject(() => assert(findingsIn("import fs from 'node:fs'\nconst t = Buffer.alloc(1) // x").length === 0, 'negative sample'))
})

finish()
