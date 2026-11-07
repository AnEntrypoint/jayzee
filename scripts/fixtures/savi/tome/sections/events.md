## Events

```ts
ctx.emit<K extends ActName>(name: K, payload: ActPayloads[K], options?: { audience?: Audience }): string | void
ctx.emit(name: string, payload?: unknown, options?: { place?: string; to?: string; via?: string; audience?: Audience }): string | void
ctx.on(name: string, handler: TomeEventHandler, options?: TomeEventOptions): () => void
```
