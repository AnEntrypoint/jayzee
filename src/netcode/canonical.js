import { encodeInputs, decodeInputs } from '../protocol/input.js'

export const canonicalInput = (record) => decodeInputs(encodeInputs([record]))[0]
