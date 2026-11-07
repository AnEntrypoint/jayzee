export function bindSections(rows, readBody) {
  const seen = new Set()
  const sections = []
  for (const row of rows) {
    if (seen.has(row.file)) throw new Error('tome section file listed twice: ' + row.file)
    seen.add(row.file)
    const bytes = readBody(row.file)
    if (!bytes) throw new Error('tome section body missing: ' + row.file)
    if (bytes.length !== row.bytes) throw new Error('tome section ' + row.file + ' is ' + bytes.length + ' bytes, index says ' + row.bytes)
    sections.push({ heading: row.heading, file: row.file, bytes })
  }
  return sections
}

export function sectionByFile(sections, file) {
  return sections.find((section) => section.file === file) ?? null
}

export function sectionsByHeading(sections, heading) {
  return sections.filter((section) => section.heading === heading)
}

export function sectionText(section) {
  return new TextDecoder('utf-8', { fatal: true }).decode(section.bytes)
}

export function totalSectionBytes(sections) {
  return sections.reduce((sum, section) => sum + section.bytes.length, 0)
}
