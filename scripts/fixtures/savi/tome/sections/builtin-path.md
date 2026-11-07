## builtin/path

Distances and spacing use meters. spacing defaults to 2. closed adds the return segment; do not repeat the first point. distance returns Infinity and nearest returns null beyond within. at wraps for a closed path and clamps for an open path.

```ts
createPath(points: ([x, z] | [x, y, z] | { x, y?, z })[], opts?: { closed?: boolean, smooth?: boolean, spacing?: number }): PathHandle
PathHandle.points: readonly [x, z][]
PathHandle.closed: boolean; PathHandle.length: number
PathHandle.distance(x, z, within?: number): number
PathHandle.nearest(x, z, within?: number): { x, y, z, distance, arcLength, t, segmentIndex, tx, tz } | null
PathHandle.at(arcLength: number): { x, y, z, tx, tz }
```
