export function headingsOf(sections) {
  const seen = new Set()
  const headings = []
  for (const section of sections) {
    if (seen.has(section.heading)) continue
    seen.add(section.heading)
    headings.push(section.heading)
  }
  return headings
}

export function lookupByHeading(sections, heading) {
  return sections.filter((section) => section.heading === heading)
}

export function lookupByFile(sections, file) {
  return sections.filter((section) => section.file === file)
}

export function lookupText(sections, heading) {
  return lookupByHeading(sections, heading).map((section) => ({
    file: section.file,
    text: new TextDecoder('utf-8', { fatal: true }).decode(section.bytes),
  }))
}
