## Lifecycle

```ts
ctx.spawn(spec: ObjectSpec): string
ctx.spawn(id: string, spec: ObjectSpec): string
ctx.destroy(id?: string): void
ctx.destroy(ids: string[]): void
ctx.destroy(id: string, options: { force?: boolean }): void
ctx.destroy(ids: string[], options: { force?: boolean }): void
```
