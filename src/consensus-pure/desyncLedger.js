const freshTrack = () => ({ consecutiveCount: 0, evidenceTicks: [], ejected: false })

export function createPeerTracks(peerIds) {
  const tracks = new Map()
  for (const peerId of peerIds) tracks.set(peerId, freshTrack())
  return tracks
}

export function recordOffenders(tracks, offenders, tick, consecutiveDesyncsRequired) {
  for (const [peerId, track] of tracks) {
    if (track.ejected) continue
    if (offenders.includes(peerId)) {
      track.consecutiveCount++
      track.evidenceTicks.push(tick)
      if (track.evidenceTicks.length > consecutiveDesyncsRequired * 2) {
        track.evidenceTicks = track.evidenceTicks.slice(-consecutiveDesyncsRequired)
      }
    } else {
      track.consecutiveCount = 0
      track.evidenceTicks = []
    }
  }
}

export function clearUnejectedRuns(tracks) {
  for (const track of tracks.values()) {
    if (track.ejected) continue
    track.consecutiveCount = 0
    track.evidenceTicks = []
  }
}

export function ejectionDue(track, peerId, localPeerId, consecutiveDesyncsRequired) {
  return !track.ejected && peerId !== localPeerId && track.consecutiveCount >= consecutiveDesyncsRequired
}

export function ejectionEvidence(track, peerId, tick) {
  return {
    tick,
    offenderPubkey: peerId,
    consecutiveCount: track.consecutiveCount,
    evidenceTicks: [...track.evidenceTicks],
  }
}
