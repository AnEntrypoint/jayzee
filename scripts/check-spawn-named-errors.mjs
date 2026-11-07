import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import {
  worldStoreError, parseHeadResponse, WorldStoreError, HeadNotFoundError, UnknownWorldStoreKeyError, ValueNotFoundError, WORLD_STORE_SCOPE,
} from '../src/spawn/content.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const fixture = (...parts) => readFileSync(join(root, 'scripts', 'fixtures', ...parts), 'utf8')
const contentSource = readFileSync(join(root, 'src', 'spawn', 'content.js'), 'utf8')
const findings = fixture('upstream', 'spawn-evidence', 'FINDINGS.md')
const record = fixture('spawn', 'learning-record-section-7.md')

const ZEROS = '0'.repeat(64)
const WORLD = '41cd46499614484ca9261ce32e257e22'
const VALUE_BODY = '{"error":"value_not_found"}'
const MANIFEST_BODY = '{"error":"value_not_found","hash":"' + ZEROS + '"}'
const UNKNOWN_BODY = '{"error":"unknown_world_store_key"}'
const HEAD_BODY = '{"error":"head_not_found"}'
const bytesOf = (text) => new TextEncoder().encode(text).length

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}
const same = (actual, expected, label = 'value') => {
  assert(actual === expected, label + ' is ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected))
}
const mustThrow = (check, fragment, type) => {
  let error = null
  try {
    check()
  } catch (thrown) {
    error = thrown
  }
  assert(error !== null, 'negative control was accepted')
  assert(error.message.includes(fragment), 'refused for the wrong reason: ' + error.message)
  if (type !== undefined) assert(error instanceof type, 'refused with ' + error.name + ', expected ' + type.name)
}

gate('line 30 of the FINDINGS witness holds the drifted manifest 200 and 513116 bytes', () => {
  const line30 = findings.split('\n')[29]
  assert(line30.includes('manifests/3fa9a434...') && line30.includes('200 application/octet-stream, 513116 bytes'), 'line 30 lost the drifted manifest witness')
  assert(line30.includes('NOT reproduced') && line30.includes('OPEN'), 'line 30 lost the OPEN drifted-head scope')
})

gate('the learning record section 7 copy quotes the byte counts this module is tested against', () => {
  assert(record.startsWith('## 7. Error keys on world-store'), 'section 7 heading')
  for (const quoted of ['27 bytes', '101 bytes', '35 bytes', '26 bytes', '1673 bytes', '513116 bytes']) {
    assert(record.includes(quoted), 'record lost ' + quoted)
  }
  same(bytesOf(VALUE_BODY), 27, 'value_not_found body bytes')
  same(bytesOf(MANIFEST_BODY), 101, 'value_not_found manifest body bytes')
  same(bytesOf(UNKNOWN_BODY), 35, 'unknown_world_store_key body bytes')
  same(bytesOf(HEAD_BODY), 26, 'head_not_found body bytes')
})

gate('value_not_found on a value route is a named ValueNotFoundError with its request context and the scope the record gives', () => {
  const path = '/world-store/values/' + ZEROS
  const error = worldStoreError(404, VALUE_BODY, { method: 'GET', path })
  assert(error instanceof ValueNotFoundError && error instanceof WorldStoreError, 'class')
  same(error.name, 'ValueNotFoundError', 'name')
  same(error.key, 'value_not_found', 'key')
  same(error.status, 404, 'status')
  same(error.bytes, 27, 'bytes')
  same(error.context.path, path, 'request path')
  same(error.message, 'value_not_found at ' + path, 'message')
  assert(error.scope.includes('two absent hashes were tested') && error.scope.includes('not a rule for every absent hash'), 'value scope')
})

gate('the manifest form of value_not_found is the same named error at 101 bytes', () => {
  const error = worldStoreError(404, MANIFEST_BODY, { method: 'GET', path: '/world-store/manifests/' + ZEROS })
  assert(error instanceof ValueNotFoundError, 'class')
  same(error.bytes, 101, 'manifest bytes')
})

gate('unknown_world_store_key is a named UnknownWorldStoreKeyError, scoped to the misspelled resource and OPEN for the drifted head', () => {
  const path = '/world-store/git/' + WORLD + '/head.jsn'
  const error = worldStoreError(404, UNKNOWN_BODY, { method: 'GET', path })
  assert(error instanceof UnknownWorldStoreKeyError, 'class')
  same(error.key, 'unknown_world_store_key', 'key')
  same(error.bytes, 35, 'bytes')
  same(error.context.path, path, 'request path')
  assert(error.scope.includes('misspelled resource') && error.scope.includes('head.jsn'), 'misspelled-resource scope')
  assert(error.scope.includes('not reproduced') && error.scope.includes('OPEN'), 'drifted-head scope is not OPEN')
})

gate('a 200 head parses as present; the repo fixture is world 4e709464 (not the drifted world), and the record control for 41cd49 is cited as text only', () => {
  const response = parseHeadResponse(200, fixture('spawn', 'head.json'))
  assert(response.present === true && response.head.worldHex === '4e709464ecfc408f980ac3b5b46b0ee3', 'fixture head did not parse as present for its own world')
  assert(record.includes('200 application/json, 1673 bytes') && record.includes(WORLD), 'record lost the 1673-byte control for the misspelled-resource world')
})

gate('head_not_found on the head route is a named HeadNotFoundError, and the head reads as absent with that error attached', () => {
  const path = '/world-store/git/' + WORLD + '/head.json'
  const response = parseHeadResponse(404, HEAD_BODY, { method: 'GET', path })
  same(response.present, false, 'absent head')
  assert(response.error instanceof HeadNotFoundError, 'named error attached')
  same(response.error.bytes, 26, 'bytes')
  same(response.error.context.path, path, 'request path')
  assert(response.error.scope.includes('3 of the 256 spawn-reported worlds were sampled'), 'head scope')
  same(parseHeadResponse(404, fixture('spawn', 'head-404.json')).present, false, 'the fixture 404 reads as absent')
})

gate('each key keeps its own scope: the three scope texts differ, and no key is merged into another', () => {
  const scopes = Object.values(WORLD_STORE_SCOPE)
  same(scopes.length, 3, 'scope count')
  same(new Set(scopes).size, 3, 'distinct scopes')
  same(new Set([HeadNotFoundError, UnknownWorldStoreKeyError, ValueNotFoundError].map((type) => new type(404, {}, 0).name)).size, 3, 'distinct names')
})

gate('a head route refuses the other two keys: they throw their own named error and never read as an absent head', () => {
  mustThrow(() => parseHeadResponse(404, UNKNOWN_BODY, { path: '/git/head.json' }), 'unknown_world_store_key at /git/head.json', UnknownWorldStoreKeyError)
  mustThrow(() => parseHeadResponse(404, VALUE_BODY, { path: '/git/head.json' }), 'value_not_found', ValueNotFoundError)
})

gate('negative controls: an unlisted 404 key, a non-object body, a prototype key, non-JSON and other statuses are refused', () => {
  mustThrow(() => worldStoreError(404, '{"error":"gone"}'), 'unexpected 404 body')
  mustThrow(() => worldStoreError(404, 'null'), 'unexpected 404 body')
  mustThrow(() => worldStoreError(404, '{"error":"constructor"}'), 'unexpected 404 body')
  mustThrow(() => worldStoreError(404, 'not json'), 'Unexpected token', SyntaxError)
  mustThrow(() => worldStoreError(500, VALUE_BODY), 'world-store request returned status 500')
  mustThrow(() => parseHeadResponse(500, ''), 'head request returned status 500')
  mustThrow(() => parseHeadResponse(404, '{"error":"gone"}'), 'unexpected 404 body')
})

gate('src/spawn/content.js carries no comment marker', () => {
  assert(!contentSource.includes('//') && !contentSource.includes('/*'), 'comment marker in content.js')
})

finish()
