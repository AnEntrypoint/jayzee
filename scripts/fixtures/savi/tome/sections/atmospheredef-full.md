## AtmosphereDef (full)

```ts
atmosphere: {
  sky?:
    | { kind: "color", color: Color, params?: Record<string, num | bool | [num | [num, ...], ...] | { size: [x, y], data: [num, ...] }> }
    | { kind: "gradient", horizon: Color, zenith: Color, params?: Record<string, num | bool | [num | [num, ...], ...] | { size: [x, y], data: [num, ...] }> }
    | { kind: "rayleigh", turbidity?: num, rayleighCoefficient?: num, mieCoefficient?: num, mieDirectionalG?: num, skyColor?: Color, rayleighColor?: Color, mieColor?: Color, groundAlbedo?: Color, horizonTint?: Color, zenithTint?: Color, saturation?: 0-2, sunDiskSize?: num, sunDiskIntensity?: num, params?: Record<string, num | bool | [num | [num, ...], ...] | { size: [x, y], data: [num, ...] }> }
    | { kind: "realistic", model: "rayleigh", turbidity?: num, rayleighCoefficient?: num, mieCoefficient?: num, mieDirectionalG?: num, skyColor?: Color, rayleighColor?: Color, mieColor?: Color, groundAlbedo?: Color, horizonTint?: Color, zenithTint?: Color, saturation?: 0-2, sunDiskSize?: num, sunDiskIntensity?: num, params?: Record<string, num | bool | [num | [num, ...], ...] | { size: [x, y], data: [num, ...] }> }
    | { kind: "realistic", model: "hosek", turbidity?: num, rayleighColor?: Color, mieColor?: Color, groundAlbedo?: Color, horizonTint?: Color, zenithTint?: Color, saturation?: 0-2, sunDiskSize?: num, sunDiskIntensity?: num, params?: Record<string, num | bool | [num | [num, ...], ...] | { size: [x, y], data: [num, ...] }> },
  ground?: bool,
  fog?:
    | { kind: "linear", color?: Color | null, near: num, far: num, height?: { base?, falloff } }
    | { kind: "exp2", color?: Color | null, density: num, height?: { base?, falloff } },
  sun?: { rotation?: { pitch?, yaw? }, orbit?: { noonYaw?, maxElevation? }, light?: { color?: Color, intensity?: num, shadow?: bool | { enabled?: bool, softness?: num } } },
  ambient?: { light?: { color?: Color, intensity?: num } },
  hemisphere?: { skyColor?: Color, groundColor?: Color, intensity?: num },
  environmentIntensity?: num,
  clouds?: { enabled?: bool, density?: 0-1, altitude?: num, thickness?: num, speed?: num, color?: Color, opacity?: 0-1, shadow?: 0-1, texture?: "/cdn/value.<sha>.png" },
  stars?: { enabled?: bool, density?: 0-1, brightness?: 0-2, size?: num, twinkle?: bool, color?: Color, milkyWay?: 0-1 },
  moon?: { enabled?: bool, phase?: 0-1, size?: num, color?: Color, intensity?: num },
  wind?: { direction?, speed? },
  wet?: 0-1,
  rain?: 0-1,
  timeOfDay?: 0-24,
  cycle?: { periodMs: num, epoch: num, bands?: [[fromHour, speed], ...] } | { frozen: 0-24 } | { lengthSeconds, startTime?, anchorHour?, anchorTick? },
  look?: { script?: "scripts/file.js", filter?: "pixel" | "linear", toneMapping?: "aces" | "neutral" | "none" | "linear" | "reinhard" | "cineon" | "agx", params?: Record<string, num | bool | str>, cube?: { parent: str, eye?: [x, y, z] } },
}
```
