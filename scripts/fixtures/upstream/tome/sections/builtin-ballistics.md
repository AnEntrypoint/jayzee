## builtin/ballistics

solveShot returns launch velocity and flight time, or null for an unreachable target. speed is meters per second; g is the magnitude of acceleration. elevation returns the low angle in radians.

```ts
solveShot(from: Vec3, to: Vec3, speed: number, g: number, lead?: { x, z } | Vec3 | null): { vel: Vec3, time: number } | null
elevation(speed: number, g: number, distance: number, rise: number): number | null
```
