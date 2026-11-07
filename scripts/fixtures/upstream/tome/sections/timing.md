## Timing

after takes seconds and a named hook export; its callback receives (ctx, payload). cancel takes the returned timer id. now returns milliseconds.

```ts
dt · ctx.dtMs · ctx.gapMs
ctx.after(seconds: number, hookExport: string, payload?: unknown): string
ctx.cancel(id: string): void
ctx.getTimers(ownerId?: string): Array<{ id: number | string; ownerId: string; dueInTicks: number; dueInSeconds: number; engineOwned: boolean; hook?: string }>
ctx.world.settling
```
