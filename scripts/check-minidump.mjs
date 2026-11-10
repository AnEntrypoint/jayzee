import assert from 'node:assert/strict'
import { MinidumpError, readMinidump } from './browser/minidump.mjs'
import { profileOf, summariseDump } from './browser/crash-dumps.mjs'
import { finish, gate } from './lib/gate.mjs'

const CONTEXT_BYTES = 0x100
const STREAM_BYTES = { exception: 168, module: 4 + 108, thread: 4 + 48 }

const buildDump = ({ signature = 0x504d444d, rsp = 0x7008n, annotations = null } = {}) => {
  const parts = []
  let size = 32 + 12 * 4
  const place = (bytes) => {
    const at = size
    parts.push(bytes)
    size += bytes.byteLength
    return at
  }
  const block = (length, fill) => {
    const bytes = new Uint8Array(length)
    fill(new DataView(bytes.buffer))
    return bytes
  }
  const utf8 = (text) => {
    const body = new TextEncoder().encode(text)
    return block(4 + body.length + 1, (view) => {
      view.setUint32(0, body.length, true)
      new Uint8Array(view.buffer).set(body, 4)
    })
  }
  const nameRva = place(block(4 + 16, (view) => {
    view.setUint32(0, 16, true)
    Array.from('/bin/app').forEach((char, i) => view.setUint16(4 + i * 2, char.charCodeAt(0), true))
  }))
  const stackRva = place(block(32, (view) => {
    view.setBigUint64(0, 0x10030n, true)
    view.setBigUint64(8, 0x10010n, true)
    view.setBigUint64(16, 0x2n, true)
    view.setBigUint64(24, 0x10020n, true)
  }))
  const contextRva = place(block(CONTEXT_BYTES, (view) => {
    view.setBigUint64(0x98, rsp, true)
    view.setBigUint64(0xf8, 0x10005n, true)
  }))
  const moduleRva = place(block(STREAM_BYTES.module, (view) => {
    view.setUint32(0, 1, true)
    view.setBigUint64(4, 0x10000n, true)
    view.setUint32(12, 0x1000, true)
    view.setUint32(24, nameRva, true)
  }))
  const threadRva = place(block(STREAM_BYTES.thread, (view) => {
    view.setUint32(0, 1, true)
    view.setUint32(4, 77, true)
    view.setBigUint64(28, 0x7000n, true)
    view.setUint32(36, 32, true)
    view.setUint32(40, stackRva, true)
    view.setUint32(48, contextRva, true)
  }))
  const exceptionRva = place(block(STREAM_BYTES.exception, (view) => {
    view.setUint32(0, 77, true)
    view.setUint32(8, 11, true)
    view.setUint32(12, 1, true)
    view.setBigUint64(24, 0x5c0n, true)
    view.setUint32(160, CONTEXT_BYTES, true)
    view.setUint32(164, contextRva, true)
  }))
  let crashpad = { rva: 0, size: 0 }
  if (annotations) {
    const entries = Object.entries(annotations).map(([key, value]) => [place(utf8(key)), place(utf8(value))])
    const objectsRva = place(block(4 + entries.length * 12, (view) => {
      view.setUint32(0, entries.length, true)
      entries.forEach(([keyRva, valueRva], i) => {
        view.setUint32(4 + i * 12, keyRva, true)
        view.setUint16(8 + i * 12, 1, true)
        view.setUint32(12 + i * 12, valueRva, true)
      })
    }))
    const infoRva = place(block(28, (view) => {
      view.setUint32(20, 4 + entries.length * 12, true)
      view.setUint32(24, objectsRva, true)
    }))
    const listRva = place(block(4 + 12, (view) => {
      view.setUint32(0, 1, true)
      view.setUint32(8, 28, true)
      view.setUint32(12, infoRva, true)
    }))
    crashpad = { rva: place(block(52, (view) => {
      view.setUint32(44, 16, true)
      view.setUint32(48, listRva, true)
    })), size: 52 }
  }
  const file = new Uint8Array(size)
  const head = new DataView(file.buffer)
  head.setUint32(0, signature, true)
  head.setUint32(8, 4, true)
  head.setUint32(12, 32, true)
  const streams = [[4, STREAM_BYTES.module, moduleRva], [3, STREAM_BYTES.thread, threadRva], [6, STREAM_BYTES.exception, exceptionRva], [crashpad.size ? 0x43500001 : 0, crashpad.size, crashpad.rva]]
  streams.forEach(([type, bytes, rva], i) => {
    head.setUint32(32 + i * 12, type, true)
    head.setUint32(36 + i * 12, bytes, true)
    head.setUint32(40 + i * 12, rva, true)
  })
  let at = 32 + 12 * 4
  for (const part of parts) {
    file.set(part, at)
    at += part.byteLength
  }
  return file
}

gate('readMinidump reads the signal, the fault address and the faulting instruction as module plus offset', () => {
  const dump = readMinidump(buildDump())
  assert.equal(dump.crash.signalName, 'SIGSEGV')
  assert.equal(dump.crash.signalCode, 1)
  assert.equal(dump.crash.address, '0x5c0')
  assert.equal(dump.crash.threadId, 77)
  assert.deepEqual(dump.crash.instruction, { module: 'app', offset: '0x5' })
  assert.deepEqual(dump.modules, [{ name: '/bin/app', base: '0x10000', size: 4096 }])
})
gate('the stack scan starts at the stack pointer and keeps only values inside a module', () => {
  assert.deepEqual(readMinidump(buildDump()).crash.stack, [{ module: 'app', offset: '0x10' }, { module: 'app', offset: '0x20' }])
  assert.deepEqual(readMinidump(buildDump({ rsp: 0x7000n })).crash.stack.map((frame) => frame.offset), ['0x30', '0x10', '0x20'])
  assert.equal(readMinidump(buildDump({ rsp: 0x7000n }), { stackFrames: 1 }).crash.stack.length, 1)
})
gate('crashpad annotation objects are read by name', () => {
  const dump = readMinidump(buildDump({ annotations: { ptype: 'renderer', 'switch-3': '--user-data-dir=/p/.playwriter/browser-profile', 'url-chunk': 'http://127.0.0.1/x' } }))
  assert.equal(dump.moduleAnnotations[0].objects.ptype, 'renderer')
  assert.equal(profileOf(dump), '/p/.playwriter/browser-profile')
})
gate('summariseDump names the process type, the profile, the page and the top frames', () => {
  const summary = summariseDump(buildDump({ annotations: { ptype: 'renderer', pid: '42', 'switch-3': '--user-data-dir=/p/.playwriter/browser-profile', 'url-chunk': 'http://127.0.0.1/x' } }))
  assert.deepEqual(summary, { ptype: 'renderer', pid: '42', profile: '/p/.playwriter/browser-profile', url: 'http://127.0.0.1/x', signal: 'SIGSEGV', signalCode: 1, address: '0x5c0', instruction: 'app+0x5', stack: ['app+0x10', 'app+0x20'] })
})
gate('a dump with no crashpad stream has no annotations and no profile', () => {
  const dump = readMinidump(buildDump())
  assert.deepEqual(dump.moduleAnnotations, [])
  assert.equal(profileOf(dump), null)
})
gate('a file that is not a minidump, or that is cut short, is refused with MinidumpError', () => {
  assert.throws(() => readMinidump(buildDump({ signature: 0x12345678 })), MinidumpError)
  assert.throws(() => readMinidump(buildDump().subarray(0, 200)), MinidumpError)
  assert.throws(() => readMinidump(new Uint8Array(8)), MinidumpError)
})
finish()
