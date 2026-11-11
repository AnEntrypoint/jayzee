const closedBuffers = new WeakSet()
const mailboxWaits = new WeakMap()
let tracking = false

export const trackMailboxWaits = () => {
  if (tracking || typeof Atomics.waitAsync !== 'function') return
  tracking = true
  const waitAsync = Atomics.waitAsync
  Atomics.waitAsync = (array, index, value, timeout) => {
    if (closedBuffers.has(array.buffer)) return { async: true, value: new Promise(() => {}) }
    mailboxWaits.set(array.buffer, { array, index })
    return waitAsync(array, index, value, timeout)
  }
}

export const closeMailbox = (buffer) => {
  closedBuffers.add(buffer)
  const wait = mailboxWaits.get(buffer)
  if (!wait) return 0
  mailboxWaits.delete(buffer)
  return Atomics.notify(wait.array, wait.index)
}
