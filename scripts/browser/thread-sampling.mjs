export const processType = (cmd) => {
  const match = /--type=([\w-]+)/.exec(cmd)
  return match ? match[1] : 'browser'
}

export const parseStat = (stat) => {
  const open = stat.indexOf('(')
  const close = stat.lastIndexOf(')')
  const comm = stat.slice(open + 1, close)
  const fields = stat.slice(close + 2).split(' ')
  return { comm, jiffies: Number(fields[11]) + Number(fields[12]) }
}

export const samplingGaps = (stamps) => stamps.slice(1).map((t, i) => t - stamps[i])

export const gapsOverLimit = (stamps, intervalMs) => samplingGaps(stamps).filter((gap) => gap > 2 * intervalMs)
