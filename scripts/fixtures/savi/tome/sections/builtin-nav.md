## builtin/nav

findPath returns feet positions. ok: false means a cut-off path that ends at the reachable spot nearest the goal. partial: true means the search is still reading the ground: ask again on a later tick. An empty list with no partial means no path was found. Defaults use the caller's body size, step height, and slope limit; maxDrop is 3 meters and bodies is all. Call from a behavior with the place's physics available.

```ts
findPath(ctx, from: Vec3, to: Vec3, opts?: { radius?, height?, step?, slope?, maxDrop?, bodies?: 'all' | 'static', ignore?: string[], budget? }): { points: Vec3[], ok: boolean, partial?: true }
```
