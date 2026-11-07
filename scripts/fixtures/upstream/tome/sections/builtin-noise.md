## builtin/noise

```ts
simplex2(opts: { x, z, frequency?, amplitude?, seed? }): number
simplex3(opts: { x, y, z, frequency?, amplitude?, seed? }): number
fbm2(opts: { x, z, frequency?, amplitude?, octaves?, gain?, lacunarity?, seed? }): number
ridged(opts: { x, z, frequency?, amplitude?, octaves?, gain?, lacunarity?, ridgeGain?, seed? }): number
billowed2(opts: { x, z, frequency?, amplitude?, octaves?, gain?, lacunarity?, seed? }): number
gradient2(opts: { x, z, frequency?, seed?, delta? }): { x, z, magnitude }
domainWarp2(opts: { x, z, warpAmp?, warpFrequency?, frequency?, amplitude?, octaves?, gain?, lacunarity?, seed? }): number
voronoi2(opts: { x, z, frequency?, seed?, metric? }): { f1, f2, cell }
white2(opts: { x, z, seed? }): number
makeSeededRng(seed: number | string): { next(), double(), int32(), uint32(), range(min, max) }
```
