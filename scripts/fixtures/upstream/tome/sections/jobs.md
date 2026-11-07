## Jobs

The engine's jobs are llm:chat, llm:generate, llm:clear, jev:decide, mail:send, chat:send, chat:history, player:token, player:names, text:check, image:generate, and image:segment. image:generate paints one picture per player per game from that player's words: args { prompt, width, height, transparent, tile }, with width and height in pixels (1536 by 1024 when unset), and tile true for an opaque texture that repeats both ways with no seam; data { name, url, width, height }, where url is written as any texture. A player's next ask answers paint_spent, so keep the url in player.state. image:segment finds the things a picture shows: args { image, prompt, points }, with image a picture's address or a data URL, prompt the words that name what to find, and points [{ x, y, label }] in the picture's pixels; data { masks: [{ name, url, width, height, box, score }] }, one black-and-white PNG per thing found, white where it is, with box its bounds in the picture's pixels.

```ts
ctx.job<T>(jobId: string, args: Record<string, unknown>, callback?: (result: JobResult<T>) => void, options?: JobOptions): string
ctx.job(jobId: string, args: Record<string, unknown>, hookExport: string, payload?: unknown): string
ctx.awaitJob<T>(requestId: string): Promise<JobResult<T>>
ctx.proposePurchase(buyer: string | { readonly id: string }, itemId: string): string
```
