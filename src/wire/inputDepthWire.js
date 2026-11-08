export const NO_INPUT_DEPTH = -1

export const hasInputDepth = (depth) => typeof depth === 'number' && depth >= 0 && depth <= 255 && (depth | 0) === depth

export const inputDepthFromWire = (depth) => (hasInputDepth(depth) ? depth : NO_INPUT_DEPTH)
