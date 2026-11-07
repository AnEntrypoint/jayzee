## builtin/tween

Keyframes use dot paths into target fields. A value may be a scalar, waypoints, a relative string such as +=5, or per-segment objects with value, duration, and easing. duration and delay use seconds.

```ts
animate(ctx, target: string, keyframes: Record<string, AnimationKeyframeValue>, opts?: { duration?: number, easing?: string, delay?: number, direction?: "normal" | "reverse" | "alternate", loop?: boolean | number }): void
```
