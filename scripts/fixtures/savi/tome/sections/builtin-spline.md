## builtin/spline

splineLength returns meters, or 0 for a non-spline id. at is 0 to 1 by default; space: distance uses meters. Assign object.spline = { id, at } to place an object on a spline.

```ts
splineLength(ctx, id: string): number
sampleSpline(ctx, id: string, at: number, opts?: { space?: "normalized" | "distance", tangentAxis?: "x" | "z" }): { position, tangent, normal, lateral, rotation, distance, progress } | null
projectToSpline(ctx, id: string, point: Vec3 | [x, y, z] | objectId, opts?): SplineSample | null
```
