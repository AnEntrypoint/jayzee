export const WEBTRANSPORT_DEFAULT_PORT = 4433
const READ_ERROR_BACKOFF_BASE_MS = 10
const READ_ERROR_BACKOFF_MAX_MS = 1000

export const deriveWebTransportUrl = (wsUrl, port) => {
  try {
    const { hostname } = new URL(wsUrl)
    return `https://${hostname}:${port || WEBTRANSPORT_DEFAULT_PORT}/`
  } catch {
    return null
  }
}

export const readErrorBackoffMs = (consecutiveReadErrors) =>
  Math.min(READ_ERROR_BACKOFF_MAX_MS, READ_ERROR_BACKOFF_BASE_MS * 2 ** (consecutiveReadErrors - 1))
