## builtin/postfx

A look export returns the final color. Start from ctx.scene. Use node operations such as .mul() on ctx.param values. Color adjustments are neutral when omitted. vignette defaults to roundness 2 and feather 0.45. dof focusDistance and focusRange are meters; bokehScale is pixels and defaults to 1. blur amount is 0 to 1. Put frame resamplers before color adjustments. bloom returns the existing color; configure bloom with the look's bloomStrength, bloomRadius, and bloomThreshold parameters. Antialiasing is each player's own setting, not part of a look: jaggies in Settings, where "no (slow)" turns antialiasing on, so a look carries no edge pass of its own.

```ts
grade(color, { exposure, saturation, contrast, brightness, lift, gamma, gain, temperature, tint, haze, hazeColor }): color
vignette(color, intensity, { color, roundness, feather }): color
grain(color, intensity): color; film(color, intensity): color; tint(color, "oklch(L C H)", amount): color; scanlines(color, intensity, count): color; dotScreen(color, angle, scale): color
chromaticAberration(color, strength): color; dof(color, viewZ, focusDistance, focusRange, bokehScale): color; pixelate(scene, size): color; blur(scene, amount): color
ctx.scene: vec3; ctx.depth: texture; ctx.viewZ: float; ctx.viewZAt(uv): float; ctx.normal(uv): vec3; ctx.worldPosition(uv): vec3; ctx.skyVisibility(P, N?): float; ctx.previousUv(P): vec2; ctx.velocity: vec2; ctx.target(name, options): target; ctx.pass(target, (uv) => vec3 | vec4): texture; ctx.cube: texture; ctx.cover: texture
ctx.data: texture
bloom(color): color
```
