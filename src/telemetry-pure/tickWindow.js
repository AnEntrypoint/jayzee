export function createTickWindow() {
  let sumTotal = 0
  let sumMv = 0
  let sumPhys = 0
  let sumSnap = 0
  let samples = 0

  const mean = (sum) => (samples > 0 ? sum / samples : 0)

  return {
    add({ total, mv, phys, snap }) {
      sumTotal += total
      sumMv += mv
      sumPhys += phys
      sumSnap += snap
      samples++
    },
    reset() {
      sumTotal = 0
      sumMv = 0
      sumPhys = 0
      sumSnap = 0
      samples = 0
    },
    average() {
      return {
        avgTotalMs: mean(sumTotal),
        avgMvMs: mean(sumMv),
        avgPhysMs: mean(sumPhys),
        avgSnapMs: mean(sumSnap),
        sampleCount: samples,
      }
    },
  }
}
