import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptsDir = dirname(fileURLToPath(import.meta.url))
const parityPath = join(scriptsDir, '..', 'docs', 'PARITY.md')
const recordPath = join(scriptsDir, 'fixtures', 'spoint', 'feature-gap.json')
const ITEM_LINE = /^- \[( |x)\] \*\*(.+?)\*\* \((\w+)\)/
const SECTION_LINE = /^## (.+)$/
const FILES_LINE = /^ {2}- files: (.+)$/
const BACKTICKED = /`([^`]+)`/g
const SUMMARY_LINE = /^Total claims: (\d+)\. Implemented here: (\d+)\. Remaining: (\d+)\.$/m
const ROW_CLAIM = /lists (\d+) checked and (\d+) unchecked/
const ROW_UNCHECKED_LIST = /The \d+ unchecked items are: (.+?)\. The \d+ checked items/
const FUNCTION_WORDS = new Set(['a', 'an', 'the', 'of'])

export const sha256Hex = (bytes) => createHash('sha256').update(bytes).digest('hex')

export const parseFeatureGap = (text) => {
  const lines = text.split('\n')
  const items = []
  let section = null
  lines.forEach((line, index) => {
    const heading = SECTION_LINE.exec(line)
    if (heading) section = heading[1]
    const item = ITEM_LINE.exec(line)
    if (!item) return
    const files = FILES_LINE.exec(lines[index + 1] ?? '')
    items.push({
      section,
      status: item[1] === 'x' ? 'checked' : 'unchecked',
      name: item[2],
      size: item[3],
      files: files ? [...files[1].matchAll(BACKTICKED)].map((match) => match[1]) : []
    })
  })
  return items
}

export const parseSummary = (text) => {
  const match = SUMMARY_LINE.exec(text)
  return match ? { total: Number(match[1]), implemented: Number(match[2]), remaining: Number(match[3]) } : null
}

export const countItems = (items) => {
  const checked = items.filter((item) => item.status === 'checked').length
  return { total: items.length, checked, unchecked: items.length - checked }
}

export const normalizeName = (name) => name
  .toLowerCase()
  .split(/[^a-z0-9]+/)
  .filter((word) => word !== '' && !FUNCTION_WORDS.has(word))
  .join(' ')

export const parseParityRow = (parityText) => {
  const row = parityText.split('\n').find((line) => line.startsWith('61. '))
  if (row === undefined) throw new Error('PARITY.md has no row 61')
  const claim = ROW_CLAIM.exec(row)
  const list = ROW_UNCHECKED_LIST.exec(row)
  if (!claim || !list) throw new Error('row 61 does not state its counts and its unchecked list')
  return {
    checked: Number(claim[1]),
    unchecked: Number(claim[2]),
    uncheckedNames: list[1].split('; ').map((name) => name.replace(/^and /, ''))
  }
}

export const buildReport = (reportBytes, reportName) => {
  const text = reportBytes.toString('utf8')
  const items = parseFeatureGap(text).map((item, index) => ({
    index: index + 1,
    section: item.section,
    status: item.status,
    verification: item.status === 'checked' ? 'UNVERIFIED' : 'OPEN',
    name: item.name,
    size: item.size,
    files: item.files
  }))
  return {
    report: { file: reportName, sha256: sha256Hex(reportBytes), bytes: reportBytes.length },
    summary: parseSummary(text),
    counts: countItems(items),
    items
  }
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedDirectly) {
  const reportPath = process.argv[2]
  if (!reportPath) {
    console.error('usage: node scripts/gen-feature-gap.mjs <spoint-spawn-feature-gap.md>')
    process.exitCode = 2
  } else {
    const report = buildReport(readFileSync(reportPath), basename(reportPath))
    const record = { ...report, parityRow61: parseParityRow(readFileSync(parityPath, 'utf8')) }
    writeFileSync(recordPath, JSON.stringify(record, null, 2) + '\n')
    console.log(`checked ${record.counts.checked} unchecked ${record.counts.unchecked} total ${record.counts.total} sha256 ${record.report.sha256}`)
    console.log(`wrote ${recordPath}`)
  }
}
