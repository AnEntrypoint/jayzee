## Juice

A layer pushed onto <player>.look fades in over fade seconds (0.25 when unset, 0 at once) to its intensity (0 to 1, default 1). It fades out the same way when it leaves the list: = [], .splice, or the end of its duration.

```ts
<player>.letterbox = intensity
<player>.vignette = intensity | { intensity, color }
<player>.effects.<name> = intensity
delete <player>.effects.<name>
<player>.look.push('scripts/look-x.js' | { look, intensity, duration, fade, priority, params })
<player>.look = []
<player>.hidden = [ids]
<player>.atmosphere.*
delete <player>.atmosphere.<key>
ctx.stopFx(id: string): void
ctx.pulseFx(id: string, name: string, opts?: { at?: Vec3; data?: Record<string, unknown> }): void
ctx.getFxState(id: string): FxState | null
<player>.music = clip | null
<player>.ambience = clip | null
ctx.music.*
```
