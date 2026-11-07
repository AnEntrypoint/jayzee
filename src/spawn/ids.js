const UUID = /^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})$/

export const uuidToHex = (uuid) => {
  const match = UUID.exec(uuid)
  if (!match) throw new RangeError('world id must be a lowercase uuid, got ' + uuid)
  return match.slice(1).join('')
}
