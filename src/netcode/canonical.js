import { decodeInputs, inputPacketBytes, writeInputRecords } from '../protocol/input.js'

const scratchBuffer = new ArrayBuffer(inputPacketBytes(1))
const scratchView = new DataView(scratchBuffer)
const scratchRecords = [null]

export const canonicalInput = (record) => {
  scratchRecords[0] = record
  writeInputRecords(scratchView, scratchRecords)
  return decodeInputs(scratchBuffer)[0]
}
