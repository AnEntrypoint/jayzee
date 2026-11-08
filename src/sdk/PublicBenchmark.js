const MB = 1024 * 1024

export function collectBenchmark(ctx, host) {
  if (typeof host !== 'object' || host === null) throw new TypeError('collectBenchmark needs a host snapshot with uptimeSec, memory, git, nodeVersion and now')
  const tickSystem = ctx.tickSystem
  const runtime = ctx.appRuntime
  const players = ctx.players
  const physics = ctx.physics

  const tickStats = tickSystem?.getStats?.() || {}

  return {
    server: {
      uptimeMs: Math.floor(host.uptimeSec * 1000),
      tickRate: tickSystem?.getTickRate?.() || 0,
      tickAvgMs: tickStats.avgTickMs || 0,
      tickP50Ms: tickStats.p50TickMs || 0,
      tickP99Ms: tickStats.p99TickMs || 0,
      dilationFactor: tickSystem?.dilationFactor || 1,
      playerCount: players?.getPlayerCount?.() || 0,
      entityCount: runtime?.getEntityCount?.() || 0,
      physicsBodyCount: physics?.getBodyCount?.() || 0,
      memoryRssMB: Math.round(host.memory.rss / MB),
      memoryHeapMB: Math.round(host.memory.heapUsed / MB),
    },
    world: {
      name: ctx.worldDef?.name || 'unknown',
      entityCount: runtime?.getEntityCount?.() || 0,
      appCount: runtime?.getAppCount?.() || 0,
      terrainEnabled: !!ctx.worldDef?.terrain,
    },
    build: {
      sha: host.git.sha,
      branch: host.git.branch,
      nodeVersion: host.nodeVersion,
    },
    timestamp: host.now,
  }
}
