import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { WIRE_PROTOCOL_VERSION, MSG, UNRELIABLE_MSGS, DISCONNECT_REASONS, isRegisteredMessage, msgName, isUnreliable } from '../src/protocol/messages.js'

const fixture = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'spoint-messages.json'), 'utf8'))
const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}
const fixtureIds = fixture.msg.map(([, id]) => id)
const fixtureNames = fixture.msg.map(([name]) => name)

gate('wire protocol version matches spoint', () => {
  assert(WIRE_PROTOCOL_VERSION === fixture.version, 'version ' + WIRE_PROTOCOL_VERSION + ' differs from ' + fixture.version)
})

gate('message names and ids match the spoint table exactly', () => {
  assert(Object.keys(MSG).length === fixture.msg.length, 'count ' + Object.keys(MSG).length + ' differs from ' + fixture.msg.length)
  for (const [name, id] of fixture.msg) {
    assert(MSG[name] === id, name + ' is ' + MSG[name] + ', spoint has ' + id)
  }
})

gate('spoint ids are unique', () => {
  assert(new Set(fixtureIds).size === fixtureIds.length, 'duplicate id in the spoint fixture')
  assert(new Set(fixtureNames).size === fixtureNames.length, 'duplicate name in the spoint fixture')
})

gate('msgName maps every registered id back to its name', () => {
  for (const [name, id] of fixture.msg) {
    assert(isRegisteredMessage(id), name + ' is not registered')
    assert(msgName(id) === name, 'msgName(' + id + ') is ' + msgName(id) + ', expected ' + name)
  }
})

gate('msgName formats an unknown id the same way spoint does', () => {
  assert(msgName(0x7fff) === 'unknown(0x7fff)', 'msgName(0x7fff) is ' + msgName(0x7fff))
  assert(isRegisteredMessage(0x7fff) === false, '0x7fff is registered')
})

gate('the unreliable set matches the spoint set exactly', () => {
  assert(UNRELIABLE_MSGS.size === fixture.unreliable.length, 'size ' + UNRELIABLE_MSGS.size + ' differs from ' + fixture.unreliable.length)
  for (const name of fixture.unreliable) {
    assert(isUnreliable(MSG[name]), name + ' should be unreliable')
  }
  for (const [name, id] of fixture.msg) {
    assert(isUnreliable(id) === fixture.unreliable.includes(name), name + ' reliability differs from spoint')
  }
  assert(isUnreliable(0x7fff) === false, 'an unknown id is unreliable')
})

gate('disconnect reasons match spoint', () => {
  assert(JSON.stringify(DISCONNECT_REASONS) === JSON.stringify(fixture.disconnectReasons), 'disconnect reasons differ from spoint')
})

finish()
