## builtin/water

```ts
waterRippleSlope(xz, t, tile, flow, flowSpeed, gust)
waterFoam(xz, t, flowVelocity, amount, scale = 1, softness = 0.08)
waterFoamField(xz, t, flowVelocity, scale = 1)
waterFoamFieldLod(xz, t, flowVelocity, scale, footprint)
waterFoamCoverage(amount, field, softness = 0.08)
waterTransmittance(deepTint, tintDistance, depth)
waterMedium(scene, transmission, scatter)
waterUnderwaterDistortion(uv, t, distance, visibility, strength)
waterRayBoxDistance(origin, direction, lower, upper, sceneDistance)
waterCaustics(floorXZ, t)
waterCausticsAt(floorPos, surfaceY, sunDirection, t, tile, flow, flowSpeed, gust, steepness, baseSlope, dispersion)
waterCausticsRefracted(…same)
waterFresnel(nDotV, f0)
```
