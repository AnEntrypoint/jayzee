import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const WORD = ['sa', 'vi'].join('')
const BANNED = new RegExp('\\b' + WORD + '\\b', 'i')
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root }).toString().split('\0').filter(Boolean)

gate('the banned project word is matched as a whole word and not inside a longer word', () => {
  if (!BANNED.test(WORD + ' x')) throw new Error('whole word not matched')
  if (BANNED.test('saving and savings and saviour')) throw new Error('a longer word was matched')
})

gate('no tracked path or text file uses the banned project word', () => {
  const hits = []
  for (const file of tracked) {
    if (BANNED.test(file)) hits.push(file + ' (path)')
    const bytes = readFileSync(join(root, file))
    if (bytes.includes(0)) continue
    bytes.toString('utf8').split('\n').forEach((line, index) => {
      if (BANNED.test(line)) hits.push(file + ':' + (index + 1))
    })
  }
  if (hits.length > 0) throw new Error(hits.join(', '))
})

finish()
