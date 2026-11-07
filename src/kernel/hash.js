export const hashState = (pos, vel, count) => {
  const n = count * 3
  let h = 17
  for (let i = 0; i < n; i++) h = (h * 31 + Math.floor(pos[i] * 4096 + 0.5)) | 0
  for (let i = 0; i < n; i++) h = (h * 31 + Math.floor(vel[i] * 4096 + 0.5)) | 0
  return h
}
