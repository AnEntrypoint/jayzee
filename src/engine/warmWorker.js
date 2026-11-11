import { warmEngine } from './warmEngine.js'

self.onmessage = async (event) => {
  try {
    const { glue, spec } = event.data
    const warmed = await warmEngine(glue, spec)
    self.postMessage({ type: 'warmed', warmed: warmed.warmed, reason: warmed.reason, bodies: warmed.bodies, ticks: warmed.ticks, ms: warmed.ms })
  } catch (error) {
    self.postMessage({ type: 'error', message: String(error && error.stack ? error.stack : error) })
  }
}
