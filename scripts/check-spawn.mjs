import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { decodeName, readFrames, sha256Hex, verifyContent, parseHead, parseHeadResponse, parseManifest, normalizeFeedEntry, walkFeed, parseResolve, parseLedgerKey, cdnValue } from '../src/spawn/index.js'

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'spawn')
const bytesOf = (path) => readFileSync(join(fixtures, path))
const textOf = (path) => readFileSync(join(fixtures, path), 'utf8')
const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const head = parseHead(textOf('head.json'))
const manifestBytes = bytesOf('manifest.bin')
const hashList = textOf('hashes.txt').trim().split('\n')
const feedFixture = JSON.parse(textOf('feed-worlds.json'))
const valueNames = ['ff7affdc24ed647572af175a195fa0254bd88f148af45fe5e31188bc141fe7cb', '3696dcd0916619ab2e9b5d1b46ee1628ee70e449700b855346f32c277f8c4bb3', 'eb538548ec7c755c00033fb4c83736ba4764da4081ed3aeeaffccdcc2a36d114']

const serve = (entries) => {
  const calls = []
  const fetchPage = async ({ offset, limit }) => {
    calls.push({ offset, limit })
    return entries.slice(offset, offset + limit)
  }
  return { fetchPage, calls }
}

const served = serve(feedFixture)
let walked = null
let walkError = null
try {
  walked = await walkFeed(served.fetchPage)
} catch (error) {
  walkError = error
}
const duplicated = serve([...feedFixture, ...feedFixture])
let walkedTwice = null
let walkTwiceError = null
try {
  walkedTwice = await walkFeed(duplicated.fetchPage)
} catch (error) {
  walkTwiceError = error
}

gate('decodes the documented ~XX name escapes', () => {
  assert(decodeName('~2fcdn~2fneutral-default-avatar.glb.yaml') === '/cdn/neutral-default-avatar.glb.yaml', 'slash escape')
  assert(decodeName('https~3a~2f~2fspawnfile.io~2fprod~2fcharacter-assets~2f1794000000000-savi-reduced-fitted.glb.yaml') === 'https://spawnfile.io/prod/character-assets/1794000000000-savi-reduced-fitted.glb.yaml', 'url escape')
  assert(decodeName('plain-name.glb') === 'plain-name.glb', 'unescaped name')
  assert(decodeName('a~7eb') === 'a~b', 'tilde escape')
})

gate('rejects a bare tilde and a non-ASCII escape', () => {
  let bare = false
  let wide = false
  try {
    decodeName('a~b')
  } catch {
    bare = true
  }
  try {
    decodeName('a~80b')
  } catch {
    wide = true
  }
  assert(bare, 'bare tilde was accepted')
  assert(wide, 'non-ASCII escape was accepted')
})

gate('readFrames returns the four fixture frames exactly', () => {
  const frames = readFrames(manifestBytes)
  assert(frames.length === 4, 'expected 4 frames, got ' + frames.length)
  const total = frames.reduce((sum, frame) => sum + frame.length + 4, 0)
  assert(total === manifestBytes.length, 'frames consumed ' + total + ' of ' + manifestBytes.length)
})

gate('readFrames rejects truncated input', () => {
  let rejected = 0
  for (const cut of [manifestBytes.length - 1, 2]) {
    try {
      readFrames(manifestBytes.subarray(0, cut))
    } catch {
      rejected += 1
    }
  }
  assert(rejected === 2, 'truncated input was accepted')
})

gate('parseHead accepts the fixture head and rejects a malformed one', () => {
  assert(head.v === 1 && head.seq === 342, 'head fields')
  const broken = JSON.parse(textOf('head.json'))
  broken.worldHex = 'XYZ'
  let rejected = false
  try {
    parseHead(JSON.stringify(broken))
  } catch {
    rejected = true
  }
  assert(rejected, 'malformed worldHex was accepted')
})

gate('parseManifest checks the sheet against head.sheet', () => {
  const manifest = parseManifest(manifestBytes, head)
  assert(manifest.sheetHash === head.sheet, 'sheet hash differs from head.sheet')
  assert(manifest.frames.length === 2, 'expected 2 frames after the index and sheet, got ' + manifest.frames.length)
  let rejected = false
  try {
    parseManifest(manifestBytes, { ...head, sheet: '0'.repeat(64) })
  } catch {
    rejected = true
  }
  assert(rejected, 'sheet mismatch was accepted')
})

gate('the index lists exactly the 80 value hashes in hashes.txt', () => {
  const manifest = parseManifest(manifestBytes, head)
  const listed = Object.values(manifest.index.hashes).sort()
  assert(listed.length === 80, 'index lists ' + listed.length + ' hashes')
  assert(JSON.stringify(listed) === JSON.stringify([...hashList].sort()), 'index hashes differ from hashes.txt')
})

gate('fixture values verify against their content hashes', () => {
  for (const name of valueNames) {
    assert(verifyContent(name, bytesOf(join('values', name + '.bin'))), 'value ' + name + ' does not verify')
  }
})

gate('a changed byte fails content verification', () => {
  const bytes = Buffer.from(bytesOf(join('values', valueNames[0] + '.bin')))
  bytes[0] ^= 0x01
  assert(!verifyContent(valueNames[0], bytes), 'altered value still verifies')
  assert(sha256Hex(bytes) !== valueNames[0], 'altered value kept its hash')
})

gate('verifyContent rejects a malformed hash', () => {
  let rejected = false
  try {
    verifyContent('ABC', Buffer.alloc(1))
  } catch {
    rejected = true
  }
  assert(rejected, 'malformed hash was accepted')
})

gate('normalizeFeedEntry keeps the six feed fields and rejects a missing one', () => {
  const entry = normalizeFeedEntry(feedFixture[0])
  assert(Object.keys(entry).join(',') === 'world,adventure,name,creator,app,sort', 'field set')
  let rejected = false
  try {
    normalizeFeedEntry({ ...feedFixture[0], world: '' })
  } catch {
    rejected = true
  }
  assert(rejected, 'empty world was accepted')
})

gate('walkFeed returns every distinct fixture world', () => {
  if (walkError) throw walkError
  const distinct = new Set(feedFixture.map((entry) => entry.world)).size
  assert(walked.entries.length === distinct, 'walked ' + walked.entries.length + ' of ' + distinct)
})

gate('walkFeed requests 22-entry steps with a 44-entry cap and stops after two empty pages', () => {
  if (walkError) throw walkError
  assert(served.calls.every((call) => call.limit <= 44), 'a page asked for more than 44 entries')
  assert(served.calls.every((call, index) => call.offset === index * 22), 'offsets are not 22-entry steps')
  assert(walked.pages === 7, 'expected 7 pages for 100 entries, got ' + walked.pages)
})

gate('walkFeed drops repeated worlds', () => {
  if (walkTwiceError) throw walkTwiceError
  const distinct = new Set(feedFixture.map((entry) => entry.world)).size
  assert(walkedTwice.entries.length === distinct, 'duplicated feed walked to ' + walkedTwice.entries.length + ' entries')
})

gate('parseResolve maps a found result to the head world', () => {
  const resolved = parseResolve(textOf('resolve-found.json'))
  assert(resolved.type === 'found', 'result type ' + resolved.type)
  assert(resolved.worldHex === head.worldHex, 'resolved world ' + resolved.worldHex + ' differs from head ' + head.worldHex)
})

gate('parseResolve refuses a result type it does not know', () => {
  let rejected = false
  try {
    parseResolve('{"ok":true,"result":{"type":"gone"}}')
  } catch {
    rejected = true
  }
  assert(rejected, 'unknown result type was accepted')
})

gate('a 404 head_not_found response reads as an absent head', () => {
  const response = parseHeadResponse(404, textOf('head-404.json'))
  assert(response.present === false, 'absent head read as present')
})

gate('a 200 head response parses the head, and other statuses are refused', () => {
  const response = parseHeadResponse(200, textOf('head.json'))
  assert(response.present === true && response.head.sheet === head.sheet, 'present head did not parse')
  let rejected = false
  try {
    parseHeadResponse(500, '')
  } catch {
    rejected = true
  }
  assert(rejected, 'status 500 was read as a head response')
})

const glbRows = textOf('glb-rows.tsv').trim().split('\n').slice(1).map((line) => line.split('\t'))

gate('a ledger key names the same cdn value as the GLB row url', () => {
  for (const row of glbRows) {
    const sha = row[1]
    const url = row[2]
    const key = 'world.assets/3d/~2fcdn~2fvalue.' + sha + '.glb.yaml'
    const { bucket, asset } = parseLedgerKey(key)
    assert(bucket === '3d', 'bucket ' + bucket)
    assert(asset === '/cdn/value.' + sha + '.glb', 'asset ' + asset)
    assert(cdnValue(asset).sha === sha, 'sha from asset does not match the row')
    assert(url.endsWith('/cdn/value.' + sha + '.glb'), 'row url does not name the same value')
  }
})

gate('a ledger key without a two-hex bucket is refused', () => {
  let rejected = false
  try {
    parseLedgerKey('world.assets/~2fcdn~2fvalue.yaml')
  } catch {
    rejected = true
  }
  assert(rejected, 'key without a bucket was accepted')
})

finish()
