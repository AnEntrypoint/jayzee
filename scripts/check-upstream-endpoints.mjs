import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { ENDPOINT_CLASSES, parseDocument, parseEndpoints, countsByClass, findCountMismatches } from '../src/upstream/index.js'

const PARITY_ROW_41 = {
  total: 93,
  counts: { published: 39, 'per-game': 21, 'manual-only': 30, disabled: 3 }
}

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'upstream', 'ENDPOINTS.md')
const fixtureText = readFileSync(fixturePath, 'utf8')

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const refuses = (text) => {
  try {
    parseDocument(text)
  } catch {
    return true
  }
  return false
}

const replaceOnce = (text, search, replacement) => {
  assert(text.includes(search), 'control anchor missing: ' + JSON.stringify(search))
  return text.replace(search, replacement)
}

const moveRowUnder = (text, row, heading) => {
  const withoutRow = replaceOnce(text, row + '\n', '')
  return replaceOnce(withoutRow, heading + '\n', heading + '\n' + row + '\n')
}

const DISABLED_HEADING = '## Listed but disabled or partial (its children are listed) (3)'
const PUBLISHED_ROW = '- /api/agent/v1/access'

gate('the fixture parses into endpoint rows, each with a known class and an /api path', () => {
  const endpoints = parseEndpoints(fixtureText)
  assert(endpoints.length > 0, 'no rows parsed')
  for (const endpoint of endpoints) {
    assert(ENDPOINT_CLASSES.includes(endpoint.class), 'unknown class ' + endpoint.class)
    assert(endpoint.path.startsWith('/api/'), 'path ' + endpoint.path)
  }
})

gate('the doc states a total equal to the parsed row count', () => {
  const document = parseDocument(fixtureText)
  assert(document.statedTotal === document.endpoints.length, 'doc states ' + document.statedTotal + ', parses ' + document.endpoints.length)
})

gate('the parsed total is 93, as the doc states and PARITY row 41 says', () => {
  const document = parseDocument(fixtureText)
  assert(document.endpoints.length === PARITY_ROW_41.total, 'parses ' + document.endpoints.length + ', expected ' + PARITY_ROW_41.total)
})

for (const className of ENDPOINT_CLASSES) {
  gate('class ' + className + ': doc heading count equals parsed rows and PARITY row 41', () => {
    const document = parseDocument(fixtureText)
    const section = document.sections.find((candidate) => candidate.class === className)
    assert(section, 'no section for class')
    const parsed = section.endpoints.length
    assert(section.statedCount === parsed, 'doc states ' + section.statedCount + ', parses ' + parsed)
    assert(parsed === PARITY_ROW_41.counts[className], 'parses ' + parsed + ', PARITY row 41 says ' + PARITY_ROW_41.counts[className])
  })
}

gate('the class counts sum to the parsed total', () => {
  const counts = countsByClass(parseEndpoints(fixtureText))
  const sum = Object.values(counts).reduce((total, count) => total + count, 0)
  assert(sum === PARITY_ROW_41.total, 'class counts sum to ' + sum)
})

gate('findCountMismatches reports nothing for the fixture', () => {
  const mismatches = findCountMismatches(parseDocument(fixtureText))
  assert(mismatches.length === 0, mismatches.join('; '))
})

const ROW_FOR_CONTROLS = '- /api/agent/v1/me\n'

gate('negative control: a row with no leading slash is refused', () => {
  assert(refuses(replaceOnce(fixtureText, ROW_FOR_CONTROLS, '- api/agent/v1/me\n')), 'row without slash was accepted')
})

gate('negative control: a row with trailing text is refused', () => {
  assert(refuses(replaceOnce(fixtureText, ROW_FOR_CONTROLS, '- /api/agent/v1/me extra\n')), 'row with trailing text was accepted')
})

gate('negative control: a duplicated path is refused', () => {
  assert(refuses(replaceOnce(fixtureText, ROW_FOR_CONTROLS, ROW_FOR_CONTROLS + ROW_FOR_CONTROLS)), 'duplicate path was accepted')
})

gate('negative control: a section heading outside the four classes is refused', () => {
  assert(refuses(replaceOnce(fixtureText, '## Not in the published spec (30)', '## Pending review (30)')), 'unknown heading was accepted')
})

gate('negative control: a section heading with no count is refused', () => {
  assert(refuses(replaceOnce(fixtureText, '## Not in the published spec (30)', '## Not in the published spec')), 'heading without count was accepted')
})

gate('negative control: a document with no stated total is refused', () => {
  assert(refuses(replaceOnce(fixtureText, 'the endpoints the manual names (93)', 'the endpoints the manual names')), 'document without total was accepted')
})

gate('negative control: a row moved to another class changes the class counts and is caught', () => {
  const moved = moveRowUnder(fixtureText, PUBLISHED_ROW, DISABLED_HEADING)
  const counts = countsByClass(parseEndpoints(moved))
  assert(counts.published === 38 && counts.disabled === 4, 'counts after move: published ' + counts.published + ', disabled ' + counts.disabled)
  assert(findCountMismatches(parseDocument(moved)).length > 0, 'moved row was not caught by the count check')
})

gate('negative control: a heading count off by one is reported as a mismatch', () => {
  const altered = replaceOnce(fixtureText, '## Listed in the published spec (39)', '## Listed in the published spec (40)')
  const mismatches = findCountMismatches(parseDocument(altered))
  assert(mismatches.length === 1 && mismatches[0].startsWith('published:'), 'mismatches: ' + mismatches.join('; '))
})

finish()
