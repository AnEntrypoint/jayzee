## World Queries

query excludes self by default; set ignoreSelf: false to include it. ctx.place.players lists the current place's players.

```ts
ctx.query(opts: ObjectQueryOptions & { select: "ids" }): string[]
ctx.query(opts: CrossingScopeQueryOptions): CrossingRecord[]
ctx.query(opts: ObjectQueryOptions): ObjectView[]
ctx.place.players
```
