export function snapshotChart(frame) {
  return {
    radius: frame.radius,
    offsetY: frame.offsetY,
    anchorHeight: frame.anchorHeight,
    chartEpoch: frame.chartEpoch,
    east: [...frame.east],
    up: [...frame.up],
    north: [...frame.north],
  }
}
