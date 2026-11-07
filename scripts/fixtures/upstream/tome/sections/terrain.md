## Terrain

```ts
ctx.getWaterLevelAt(x: number, z: number, place?: string): number | null
ctx.readField(name: string, x: number, z: number, place?: string): number
ctx.place.fields[name].runtime[chunk]
ctx.place.fields[name].runtime[chunk] = { ...ctx.place.fields[name].grid, cells }
ctx.place.fields[name].runtime[chunk].cells = next
delete ctx.place.fields[name].runtime[chunk]
ctx.place.fields[name].authored[chunk] = { ...ctx.place.fields[name].grid, cells }
Object.keys(ctx.place.fields[name].runtime)
ctx.place.fields[name].changes(at): { chunks, at }
ctx.getTerrainNormal(x: number, z: number, place?: string): Vec3 | null
```
