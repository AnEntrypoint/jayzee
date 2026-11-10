const SIGNATURE = 0x504d444d
const STREAM = { threadList: 3, moduleList: 4, exception: 6, systemInfo: 7, crashpadInfo: 0x43500001 }
const CONTEXT_AMD64 = { rsp: 0x98, rbp: 0xa0, rip: 0xf8 }
const MODULE_BYTES = 108
const THREAD_BYTES = 48
const SIGNALS = { 4: 'SIGILL', 5: 'SIGTRAP', 6: 'SIGABRT', 7: 'SIGBUS', 8: 'SIGFPE', 11: 'SIGSEGV' }

export class MinidumpError extends Error {
  constructor(message) {
    super(message)
    this.name = 'MinidumpError'
    this.code = 'MINIDUMP_MALFORMED'
  }
}

const viewOf = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
const hex = (value) => '0x' + value.toString(16)

const inside = (view, offset, length, what) => {
  if (offset < 0 || length < 0 || offset + length > view.byteLength) throw new MinidumpError(what + ' at ' + offset + ' with ' + length + ' bytes runs past the ' + view.byteLength + ' byte file')
}

const utf16String = (view, rva) => {
  inside(view, rva, 4, 'string length')
  const length = view.getUint32(rva, true)
  inside(view, rva + 4, length, 'string')
  let text = ''
  for (let i = 0; i < length; i += 2) text += String.fromCharCode(view.getUint16(rva + 4 + i, true))
  return text
}

const utf8String = (view, rva) => {
  inside(view, rva, 4, 'utf8 length')
  const length = view.getUint32(rva, true)
  inside(view, rva + 4, length, 'utf8 string')
  return new TextDecoder().decode(new Uint8Array(view.buffer, view.byteOffset + rva + 4, length))
}

const readDirectory = (view) => {
  inside(view, 0, 32, 'header')
  if (view.getUint32(0, true) !== SIGNATURE) throw new MinidumpError('the file does not start with MDMP')
  const count = view.getUint32(8, true)
  const rva = view.getUint32(12, true)
  inside(view, rva, count * 12, 'stream directory')
  return Array.from({ length: count }, (_, i) => ({ type: view.getUint32(rva + i * 12, true), size: view.getUint32(rva + i * 12 + 4, true), rva: view.getUint32(rva + i * 12 + 8, true) }))
}

const readModules = (view, stream) => {
  if (!stream) return []
  inside(view, stream.rva, 4, 'module count')
  const count = view.getUint32(stream.rva, true)
  inside(view, stream.rva + 4, count * MODULE_BYTES, 'module list')
  return Array.from({ length: count }, (_, i) => {
    const at = stream.rva + 4 + i * MODULE_BYTES
    return { base: view.getBigUint64(at, true), size: view.getUint32(at + 8, true), name: utf16String(view, view.getUint32(at + 20, true)) }
  })
}

const readThreads = (view, stream) => {
  if (!stream) return []
  inside(view, stream.rva, 4, 'thread count')
  const count = view.getUint32(stream.rva, true)
  inside(view, stream.rva + 4, count * THREAD_BYTES, 'thread list')
  return Array.from({ length: count }, (_, i) => {
    const at = stream.rva + 4 + i * THREAD_BYTES
    return { id: view.getUint32(at, true), stackStart: view.getBigUint64(at + 24, true), stackSize: view.getUint32(at + 32, true), stackRva: view.getUint32(at + 36, true), contextRva: view.getUint32(at + 44, true) }
  })
}

const readException = (view, stream) => {
  if (!stream) return null
  inside(view, stream.rva, 168, 'exception stream')
  const at = stream.rva
  const signal = view.getUint32(at + 8, true)
  return { threadId: view.getUint32(at, true), signal, signalName: SIGNALS[signal] ?? null, signalCode: view.getUint32(at + 12, true), address: view.getBigUint64(at + 24, true), contextRva: view.getUint32(at + 164, true) }
}

const readDictionary = (view, location) => {
  if (location.size === 0) return {}
  inside(view, location.rva, 4, 'annotation count')
  const count = view.getUint32(location.rva, true)
  inside(view, location.rva + 4, count * 8, 'annotation entries')
  return Object.fromEntries(Array.from({ length: count }, (_, i) => {
    const at = location.rva + 4 + i * 8
    return [utf8String(view, view.getUint32(at, true)), utf8String(view, view.getUint32(at + 4, true))]
  }))
}

const readAnnotationObjects = (view, location) => {
  if (location.size === 0) return {}
  inside(view, location.rva, 4, 'annotation object count')
  const count = view.getUint32(location.rva, true)
  inside(view, location.rva + 4, count * 12, 'annotation objects')
  return Object.fromEntries(Array.from({ length: count }, (_, i) => {
    const at = location.rva + 4 + i * 12
    const type = view.getUint16(at + 4, true)
    const valueRva = view.getUint32(at + 8, true)
    return [utf8String(view, view.getUint32(at, true)), type === 1 ? utf8String(view, valueRva) : 'type ' + type]
  }))
}

const readCrashpadInfo = (view, stream) => {
  if (!stream) return { annotations: {}, moduleAnnotations: [] }
  inside(view, stream.rva, 52, 'crashpad info')
  const at = stream.rva
  const annotations = readDictionary(view, { size: view.getUint32(at + 36, true), rva: view.getUint32(at + 40, true) })
  const listSize = view.getUint32(at + 44, true)
  const listRva = view.getUint32(at + 48, true)
  const moduleAnnotations = []
  if (listSize > 0) {
    inside(view, listRva, 4, 'module info count')
    const count = view.getUint32(listRva, true)
    inside(view, listRva + 4, count * 12, 'module info links')
    for (let i = 0; i < count; i += 1) {
      const link = listRva + 4 + i * 12
      const info = view.getUint32(link + 8, true)
      inside(view, info, 28, 'module crashpad info')
      moduleAnnotations.push({
        moduleIndex: view.getUint32(link, true),
        simple: readDictionary(view, { size: view.getUint32(info + 12, true), rva: view.getUint32(info + 16, true) }),
        objects: readAnnotationObjects(view, { size: view.getUint32(info + 20, true), rva: view.getUint32(info + 24, true) }),
      })
    }
  }
  return { annotations, moduleAnnotations }
}

const moduleOf = (modules, address) => modules.find((module) => address >= module.base && address < module.base + BigInt(module.size)) ?? null

const frameOf = (modules, address) => {
  const module = moduleOf(modules, address)
  return module ? { module: module.name.split('/').pop(), offset: hex(address - module.base) } : { module: null, offset: hex(address) }
}

const scanStack = (view, modules, thread, rsp, limit) => {
  const frames = []
  const skip = rsp >= thread.stackStart ? Number(rsp - thread.stackStart) : 0
  inside(view, thread.stackRva, thread.stackSize, 'thread stack')
  for (let at = skip - (skip % 8); at + 8 <= thread.stackSize && frames.length < limit; at += 8) {
    const value = view.getBigUint64(thread.stackRva + at, true)
    if (moduleOf(modules, value)) frames.push(frameOf(modules, value))
  }
  return frames
}

export const readMinidump = (bytes, { stackFrames = 40 } = {}) => {
  const view = viewOf(bytes)
  const directory = readDirectory(view)
  const streamOf = (type) => directory.find((entry) => entry.type === type) ?? null
  const modules = readModules(view, streamOf(STREAM.moduleList))
  const threads = readThreads(view, streamOf(STREAM.threadList))
  const exception = readException(view, streamOf(STREAM.exception))
  const crashpad = readCrashpadInfo(view, streamOf(STREAM.crashpadInfo))
  let crash = null
  if (exception) {
    inside(view, exception.contextRva, CONTEXT_AMD64.rip + 8, 'exception context')
    const rip = view.getBigUint64(exception.contextRva + CONTEXT_AMD64.rip, true)
    const rsp = view.getBigUint64(exception.contextRva + CONTEXT_AMD64.rsp, true)
    const thread = threads.find((candidate) => candidate.id === exception.threadId) ?? null
    crash = {
      threadId: exception.threadId,
      signal: exception.signal,
      signalName: exception.signalName,
      signalCode: exception.signalCode,
      address: hex(exception.address),
      instruction: frameOf(modules, rip),
      stack: thread ? scanStack(view, modules, thread, rsp, stackFrames) : [],
    }
  }
  return {
    streams: directory.map((entry) => hex(entry.type)),
    threads: threads.length,
    modules: modules.map((module) => ({ name: module.name, base: hex(module.base), size: module.size })),
    crash,
    annotations: crashpad.annotations,
    moduleAnnotations: crashpad.moduleAnnotations,
  }
}
