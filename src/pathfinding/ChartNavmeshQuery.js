export class ChartNavmeshQuery {
  constructor(navmesh, ledgerOf) {
    this.navmesh = navmesh
    this.ledgerOf = ledgerOf
    this.epoch = -1
    this.toBase = null
    this.fromBase = null
  }

  activeTransfers() {
    const ledger = this.ledgerOf()
    if (!ledger || ledger.currentEpoch === ledger.base.chartEpoch) return null
    if (this.epoch !== ledger.currentEpoch) {
      this.epoch = ledger.currentEpoch
      this.toBase = ledger.transferToBase()
      this.fromBase = ledger.transferFromBase()
    }
    return this
  }

  findPath(start, goal) {
    const transfers = this.activeTransfers()
    if (!transfers) return this.navmesh.findPath(start, goal)
    const path = this.navmesh.findPath(transfers.toBase.point(start), transfers.toBase.point(goal))
    return path && path.map((p) => transfers.fromBase.point(p))
  }

  locate(point) {
    const transfers = this.activeTransfers()
    return this.navmesh.locate(transfers ? transfers.toBase.point(point) : point)
  }

  clearCache() {
    this.navmesh.clearCache()
  }

  get data() {
    return this.navmesh.data
  }

  get bounds() {
    return this.navmesh.bounds
  }

  get config() {
    return this.navmesh.config
  }
}
