import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { buildReport, countItems, parseFeatureGap, parseSummary, sha256Hex } from './gen-feature-gap.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const copyPath = join(here, 'fixtures', 'spoint', 'spoint-spawn-feature-gap.md')
const recordPath = join(here, 'fixtures', 'spoint', 'feature-gap.json')
const EXPECTED = { total: 60, checked: 47, unchecked: 13 }

const copyBytes = readFileSync(copyPath)
const copyText = copyBytes.toString('utf8')
const record = JSON.parse(readFileSync(recordPath, 'utf8'))
const freshItems = parseFeatureGap(copyText)

const assertNoProblems = (problems) => {
  if (problems.length > 0) throw new Error(problems.join('; '))
}

const assertDetects = (problems, control) => {
  if (problems.length === 0) throw new Error('negative control not detected: ' + control)
}

const countProblems = (expected, actual) => Object.keys(expected)
  .filter((key) => expected[key] !== actual[key])
  .map((key) => `${key} expected ${expected[key]}, found ${actual[key]}`)

const summaryProblems = (text) => {
  const summary = parseSummary(text)
  if (summary === null) return ['summary line not found']
  const stated = { total: summary.total, checked: summary.implemented, unchecked: summary.remaining }
  return countProblems(stated, countItems(parseFeatureGap(text)))
}

const hashProblems = (recorded, bytes) => {
  const problems = []
  const actual = sha256Hex(bytes)
  if (actual !== recorded.sha256) problems.push(`sha256 expected ${recorded.sha256}, found ${actual}`)
  if (bytes.length !== recorded.bytes) problems.push(`bytes expected ${recorded.bytes}, found ${bytes.length}`)
  return problems
}

const verificationProblems = (items) => items.flatMap((item) => {
  const wanted = item.status === 'checked' ? 'UNVERIFIED' : 'OPEN'
  return item.verification === wanted
    ? []
    : [`item ${item.index} (${item.name}) is ${item.status} but marked ${item.verification}`]
})

const freshProblems = (recorded, fresh) => ['report', 'summary', 'counts', 'items']
  .filter((key) => JSON.stringify(recorded[key]) !== JSON.stringify(fresh[key]))
  .map((key) => `${key} differs from a fresh parse of the copy`)

const fresh = buildReport(copyBytes, 'spoint-spawn-feature-gap.md')

gate('the fixture records the sha256 and byte length of the copy', () => {
  assertNoProblems(hashProblems(record.report, copyBytes))
  const altered = Buffer.from(copyBytes)
  altered[0] ^= 0x01
  assertDetects(hashProblems(record.report, altered), 'one flipped byte in the copy')
})

gate('the report summary line states the counts the parser finds', () => {
  assertNoProblems(summaryProblems(copyText))
  assertDetects(summaryProblems(copyText.replace('Remaining: 13.', 'Remaining: 12.')), 'a summary line that states 12 remaining')
})

gate('the parser finds 47 checked and 13 unchecked items', () => {
  assertNoProblems(countProblems(EXPECTED, countItems(freshItems)))
  const movedToChecked = copyText.replace('- [ ] **Surface the tick drop counter**', '- [x] **Surface the tick drop counter**')
  assertDetects(countProblems(EXPECTED, countItems(parseFeatureGap(movedToChecked))), 'an unchecked item moved to checked')
})

gate('the fixture counts and items equal a fresh parse of the copy', () => {
  assertNoProblems(freshProblems(record, fresh))
  assertDetects(freshProblems({ ...record, items: record.items.slice(1) }, fresh), 'a fixture missing its first item')
})

gate('checked items stay UNVERIFIED and unchecked items stay OPEN', () => {
  assertNoProblems(verificationProblems(record.items))
  const markedVerified = record.items.map((item) => (item.status === 'checked' ? { ...item, verification: 'VERIFIED' } : item))
  assertDetects(verificationProblems(markedVerified), 'a checked item marked VERIFIED')
})

finish()
