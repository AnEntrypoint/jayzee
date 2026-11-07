const SECTION_CLASSES = [
  ['Listed in the published spec', 'published'],
  ['Listed with a per-game or per-world id', 'per-game'],
  ['Listed but disabled or partial', 'disabled'],
  ['Not in the published spec', 'manual-only']
]

export const ENDPOINT_CLASSES = SECTION_CLASSES.map(([, className]) => className)

const SECTION_HEADING = /^## (.+) \((\d+)\)$/
const ENDPOINT_ROW = /^- (\/api\/\S+)$/
const STATED_TOTAL = /the endpoints the manual names \((\d+)\)/
const STATED_PATHS = /\((\d+) paths\)/

const classOfSection = (title) => {
  const match = SECTION_CLASSES.find(([prefix]) => title.startsWith(prefix))
  if (!match) throw new Error('section cannot be classified: ' + title)
  return match[1]
}

const requiredTotal = (markdown) => {
  const match = STATED_TOTAL.exec(markdown)
  if (!match) throw new Error('document states no total of endpoints')
  return Number(match[1])
}

const statedPathCount = (markdown) => {
  const match = STATED_PATHS.exec(markdown)
  return match ? Number(match[1]) : null
}

export const parseDocument = (markdown) => {
  const sections = []
  const endpoints = []
  const seenPaths = new Set()
  markdown.split('\n').forEach((line, index) => {
    const lineNumber = index + 1
    if (line.startsWith('## ')) {
      const heading = SECTION_HEADING.exec(line)
      if (!heading) throw new Error('line ' + lineNumber + ': section heading states no count')
      sections.push({
        title: heading[1],
        class: classOfSection(heading[1]),
        statedCount: Number(heading[2]),
        line: lineNumber,
        endpoints: []
      })
      return
    }
    if (!line.startsWith('- ')) return
    const section = sections.at(-1)
    if (!section) throw new Error('line ' + lineNumber + ': endpoint row before any section')
    const row = ENDPOINT_ROW.exec(line)
    if (!row) throw new Error('line ' + lineNumber + ': malformed endpoint row: ' + line)
    const path = row[1]
    if (seenPaths.has(path)) throw new Error('line ' + lineNumber + ': duplicate path ' + path)
    seenPaths.add(path)
    const endpoint = { path, class: section.class, line: lineNumber }
    section.endpoints.push(endpoint)
    endpoints.push(endpoint)
  })
  return {
    statedTotal: requiredTotal(markdown),
    statedPaths: statedPathCount(markdown),
    sections,
    endpoints
  }
}

export const parseEndpoints = (markdown) => parseDocument(markdown).endpoints

export const countsByClass = (endpoints) => {
  const counts = Object.fromEntries(ENDPOINT_CLASSES.map((className) => [className, 0]))
  for (const endpoint of endpoints) counts[endpoint.class] += 1
  return counts
}

export const findCountMismatches = (document) => {
  const sectionMismatches = document.sections
    .filter((section) => section.statedCount !== section.endpoints.length)
    .map((section) => section.class + ': states ' + section.statedCount + ', parses ' + section.endpoints.length)
  if (document.statedTotal === document.endpoints.length) return sectionMismatches
  return [...sectionMismatches, 'total: states ' + document.statedTotal + ', parses ' + document.endpoints.length]
}
