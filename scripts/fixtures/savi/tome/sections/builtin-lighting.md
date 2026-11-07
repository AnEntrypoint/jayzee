## builtin/lighting

```ts
sunDirection: vec3; sunRadiance: vec3; ambientRadiance: vec3
wet: float; rain: float
windDirection: vec2; windSpeed: float; windTravel: vec2
fogColor(toward): vec3
sunVisibility(P): float
lightsAt(P, { shadow }?): vec3
lightCount(P): int; lightRadiance(P, i): vec3; lightPosition(P, i): vec3
```
