## builtin/tsl

Shader time is seconds: (ctx.now() / 1000) % 3600. uv() reads the first UV set; uv(1) through uv(3) select later sets. A primitive's UV coordinates normally span 0 to 1. A requested attribute must exist on the geometry. audioLevel and audioSpectrum(x) read the sound this player hears (music and world sounds), each 0 to 1, in a material or a look; x runs from 20 Hz at 0 to 20 kHz at 1. objectWorldMatrix(id), objectPosition(id), objectScale(id) and objectDirection(id) read the thing with that id where this frame renders it: the interpolated pose on screen, not its last tick. A thing not here reads 0. The atomics act on an int or uint instancedArray element inside a compute body. atomicAdd, atomicSub, atomicMax, atomicMin, atomicAnd, atomicOr and atomicXor return the element's previous value.

```ts
inputs: uv(), uv(1), uv(2), uv(3), positionLocal, positionMorphed, positionWorld, positionView, normalLocal, normalWorld, cameraPosition, screenUV, screenSize, time, vertexColor(), attribute(name, type), instanceIndex, vertexIndex, frontFacing, sceneDepth, depthFade(metres), viewportSharedTexture(uv = screenUV)
material inputs: materialColor (vec3), materialOpacity (float), materialEmissive (vec3)
audio: audioLevel (float), audioSpectrum(x) (float)
billboarding({ position, horizontal, vertical })
math: float, vec2, vec3, vec4, color, int, mix, smoothstep, step, clamp, min, max, abs, floor, ceil, fract, sign, mod, negate, pow, sqrt, exp, log, sin, cos, tan, atan, atan2, length, distance, dot, cross, normalize, reflect, refract, oneMinus, saturate, remap, remapClamp
noise: mx_noise_float, mx_fractal_noise_float, mx_worley_noise_float, mx_noise_vec3, hash, rand, oscSine, oscTriangle, oscSquare, oscSawtooth
object reads: objectWorldMatrix(id), objectPosition(id), objectScale(id), objectDirection(id)
structure: Fn(([a, b]) => …), select(cond, a, b), If, Loop, .toVar(), .assign(), texture, textureSize(t, level?), textureLoad(t, ivec2), textureLevel(t, uv, mip), texture3D(t, uvw, level?), convertToTexture, PI, PI2, EPSILON
wgslFn(`fn name(a: f32, p: vec3<f32>) -> vec4<f32> { … }`, includes?), name([a, p])
compute: instancedArray(count | typedArray, type = "float"); buffer.element(i); Fn(() => { … })().compute(count, workgroupSize = 64); m.computeNode = pass; deltaTime
textures: textureStore(t, coord, value), texture3D(t, uvw); minFilter = LinearMipmapLinearFilter
workgroup: workgroupArray(type, count), .element(i); workgroupBarrier(); invocationLocalIndex, workgroupId, localId
buffer.setName("height"); texture.name = "fog"; ctx.self.material.buffers[name]
atomics: atomicAdd(buffer.element(i), value), atomicSub, atomicMax, atomicMin, atomicAnd, atomicOr, atomicXor; atomicStore(buffer.element(i), value); atomicLoad(buffer.element(i))
depthFade(m)
```
