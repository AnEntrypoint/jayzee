## builtin/math

shortestArc returns degrees in (-180, 180]. stepAngle takes dt and smoothing in seconds; smoothing defaults to 0.06, and 0 turns at once.

```ts
clamp(value: number, min: number, max: number): number
clamp01(value: number): number
lerp(a: number, b: number, t: number): number
lerp(a: OklchString, b: OklchString, t: number): OklchString
smoothstep(edge0: number, edge1: number, x: number): number
inverseLerp(a: number, b: number, value: number): number
remap(inMin: number, inMax: number, outMin: number, outMax: number, value: number): number
shortestArc(fromDeg: number, toDeg: number): number;
stepAngle(currentDeg: number, targetDeg: number, dt: Seconds, opts?: { smoothing?: Seconds; maxDegPerSec?: number }): number;
degToRad(deg: number): number
radToDeg(rad: number): number
```
