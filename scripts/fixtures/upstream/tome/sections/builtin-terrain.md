## builtin/terrain

shore changes heights near the supplied water level. Defaults: apron 6, berm 0.3, grade 0.06, rejoin 24, shelf 2.2, shelfReach 6, drop 20, scale 1. Heights and distances use meters.

```ts
shore(height: number, level: number, opts?: { apron?: number, berm?: number, grade?: number, rejoin?: number, shelf?: number, shelfReach?: number, drop?: number, scale?: number }): number
```
