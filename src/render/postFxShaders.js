export const BLOOM_FULLSCREEN_VERT = `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`

export const BLOOM_THRESHOLD_FRAG = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tScene;
  uniform float uThreshold;
  uniform float uKnee;
  void main() {
    vec3 c = texture2D(tScene, vUv).rgb;
    float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
    float soft = clamp(lum - uThreshold + uKnee, 0.0, 2.0 * uKnee);
    soft = soft * soft / max(0.0001, 4.0 * uKnee);
    float contribution = max(soft, lum - uThreshold);
    float scale = lum > 0.0001 ? contribution / lum : 0.0;
    gl_FragColor = vec4(c * clamp(scale, 0.0, 1.0), 1.0);
  }
`

export const BLOOM_BLUR_FRAG = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tSource;
  uniform vec2 uDirection;
  void main() {
    vec3 sum = texture2D(tSource, vUv).rgb * 0.227;
    for (int i = 1; i <= 4; i++) {
      float w = 0.194 - float(i) * 0.03;
      vec2 o = uDirection * float(i);
      sum += texture2D(tSource, vUv + o).rgb * w;
      sum += texture2D(tSource, vUv - o).rgb * w;
    }
    gl_FragColor = vec4(max(sum, 0.0), 1.0);
  }
`

export const BLOOM_COMPOSITE_FRAG = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tBloom;
  uniform float uIntensity;
  void main() {
    gl_FragColor = vec4(texture2D(tBloom, vUv).rgb * uIntensity, 1.0);
  }
`

export const FSR1_FULLSCREEN_VERT = `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`

export const FSR1_EASU_FRAG = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tSource;
  uniform vec2 uSrcTexel;
  void main() {
    vec2 uv = vUv;
    vec3 center = texture2D(tSource, uv).rgb;
    vec3 n = texture2D(tSource, uv + vec2(0.0, -uSrcTexel.y)).rgb;
    vec3 s = texture2D(tSource, uv + vec2(0.0,  uSrcTexel.y)).rgb;
    vec3 e = texture2D(tSource, uv + vec2( uSrcTexel.x, 0.0)).rgb;
    vec3 w = texture2D(tSource, uv + vec2(-uSrcTexel.x, 0.0)).rgb;
    float lc = dot(center, vec3(0.2126, 0.7152, 0.0722));
    float ln = dot(n, vec3(0.2126, 0.7152, 0.0722));
    float ls = dot(s, vec3(0.2126, 0.7152, 0.0722));
    float le = dot(e, vec3(0.2126, 0.7152, 0.0722));
    float lw = dot(w, vec3(0.2126, 0.7152, 0.0722));
    float lmin = min(lc, min(min(ln, ls), min(le, lw)));
    float lmax = max(lc, max(max(ln, ls), max(le, lw)));
    float contrast = clamp((lmax - lmin) * 4.0, 0.0, 1.0);
    vec3 dirAvg = (n + s + e + w) * 0.25;
    vec3 sharp = center * (1.0 + contrast * 0.5) - dirAvg * (contrast * 0.5);
    gl_FragColor = vec4(mix(center, sharp, contrast), 1.0);
  }
`

export const FSR1_RCAS_FRAG = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tSource;
  uniform vec2 uTexel;
  uniform float uSharpness;
  void main() {
    vec2 uv = vUv;
    vec3 c  = texture2D(tSource, uv).rgb;
    vec3 n  = texture2D(tSource, uv + vec2(0.0, -uTexel.y)).rgb;
    vec3 s  = texture2D(tSource, uv + vec2(0.0,  uTexel.y)).rgb;
    vec3 e  = texture2D(tSource, uv + vec2( uTexel.x, 0.0)).rgb;
    vec3 w  = texture2D(tSource, uv + vec2(-uTexel.x, 0.0)).rgb;
    vec3 mn4 = min(min(n, s), min(e, w));
    vec3 mx4 = max(max(n, s), max(e, w));
    vec3 mn = min(mn4, c);
    vec3 mx = max(mx4, c);
    vec3 reciprocalMx = 1.0 / max(mx, vec3(0.0001));
    vec3 ampl = clamp(min(mn, vec3(2.0) - mx) * reciprocalMx, vec3(0.0), vec3(1.0));
    ampl = sqrt(ampl);
    vec3 w4 = ampl * mix(vec3(-0.125), vec3(-0.20), uSharpness);
    vec3 numerator = w4 * (n + s + e + w) + c;
    vec3 denominator = vec3(1.0) + 4.0 * w4;
    vec3 result = numerator / denominator;
    gl_FragColor = vec4(clamp(result, 0.0, 4.0), 1.0);
  }
`

export const FSR1_COMPOSITE_FRAG = `
        precision highp float;
        varying vec2 vUv;
        uniform sampler2D tSource;
        void main() { gl_FragColor = vec4(texture2D(tSource, vUv).rgb, 1.0); }
      `

export const SSR_FULLSCREEN_VERT = `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`

export const SSR_FRAG = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tGBuffer;
  uniform sampler2D tScene;
  uniform sampler2D tWetness;
  uniform bool uHasWetness;
  uniform float uWeatherWetness;
  uniform vec2 uResolution;
  uniform mat4 uProjectionMatrix;
  uniform float uFovFactor;
  uniform float uAspect;
  uniform float uIntensity;
  uniform float uMaxDistance;
  uniform vec3 uCamWorld;
  uniform float uBandHeight;
  uniform mat3 uNormalViewToWorld;
  uniform vec4 spointSea;
uniform vec3 spointSeaShift;
bool spointSeaEnabled() { return spointSea.z > 0.5; }
float spointSeaSurfaceY(vec3 renderPos) {
  vec2 a = renderPos.xz + spointSeaShift.xz;
  float r2 = dot(a, a);
  float rho = spointSea.y;
  float drop = rho > 0.0 ? r2 / (rho + sqrt(max(rho * rho - r2, 0.0))) : 0.0;
  return spointSea.x - spointSeaShift.y - drop;
}

  const int STEPS = 12;

  vec3 reconstructViewPos(vec2 uv, float depth) {
    vec2 ndc = uv * 2.0 - 1.0;
    vec3 viewDir = normalize(vec3(ndc.x * uFovFactor * uAspect, ndc.y * uFovFactor, -1.0));
    float t = depth / max(0.0001, -viewDir.z);
    return viewDir * t;
  }

  vec3 viewToScreen(vec3 viewPos) {
    vec4 clip = uProjectionMatrix * vec4(viewPos, 1.0);
    if (clip.w <= 0.0) return vec3(-1.0);
    vec2 ndc = clip.xy / clip.w;
    return vec3(ndc * 0.5 + 0.5, -viewPos.z);
  }

  void main() {
    vec4 center = texture2D(tGBuffer, vUv);
    float centerDepth = center.a;
    if (centerDepth <= 0.0) { gl_FragColor = vec4(0.0); return; }

    vec3 centerNormal = normalize(center.rgb * 2.0 - 1.0);
    vec3 centerPos = reconstructViewPos(vUv, centerDepth);

    vec3 fragWorld = vec3(dot(uNormalViewToWorld[0], centerPos), dot(uNormalViewToWorld[1], centerPos), dot(uNormalViewToWorld[2], centerPos)) + uCamWorld;
    float bandDist = spointSeaEnabled() ? abs(fragWorld.y - spointSeaSurfaceY(fragWorld)) : uBandHeight;
    float bandFade = 1.0 - clamp(bandDist / uBandHeight, 0.0, 1.0);
    float matWetness = uHasWetness ? texture2D(tWetness, vUv).r : 0.0;
    float wetMask = max(max(bandFade, matWetness), uWeatherWetness);
    if (wetMask <= 0.0) { gl_FragColor = vec4(0.0); return; }

    vec3 viewDir = normalize(centerPos);
    float ndotv = clamp(dot(centerNormal, -viewDir), 0.0, 1.0);
    if (centerNormal.y < 0.3) { gl_FragColor = vec4(0.0); return; }
    float fresnel = pow(1.0 - ndotv, 2.0);

    vec3 reflectDir = reflect(viewDir, centerNormal);
    if (reflectDir.z >= 0.0) { gl_FragColor = vec4(0.0); return; }

    vec3 rayPos = centerPos;
    float stepLen = uMaxDistance / float(STEPS);
    vec4 result = vec4(0.0);
    for (int i = 1; i <= STEPS; i++) {
      rayPos += reflectDir * stepLen;
      vec3 screenPos = viewToScreen(rayPos);
      if (screenPos.x < 0.0 || screenPos.x > 1.0 || screenPos.y < 0.0 || screenPos.y > 1.0) break;
      float sampledDepth = texture2D(tGBuffer, screenPos.xy).a;
      if (sampledDepth <= 0.0) continue;
      float rayDepth = screenPos.z;
      float depthDiff = sampledDepth - rayDepth;
      if (depthDiff > 0.0 && depthDiff < stepLen * 2.0) {
        vec2 edgeFade = smoothstep(0.0, 0.08, screenPos.xy) * smoothstep(0.0, 0.08, 1.0 - screenPos.xy);
        float fade = edgeFade.x * edgeFade.y * (1.0 - float(i) / float(STEPS));
        result = vec4(texture2D(tScene, screenPos.xy).rgb, fade);
        break;
      }
    }
    gl_FragColor = vec4(result.rgb, result.a * fresnel * wetMask * uIntensity);
  }
`

export const SSR_WETNESS_GBUFFER_VERT = `
  void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`

export const SSR_WETNESS_GBUFFER_FRAG = `
  uniform float uWetness;
  void main() { gl_FragColor = vec4(uWetness, 0.0, 0.0, 1.0); }
`

export const SSR_COMPOSITE_FRAG = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tSSR;
  void main() {
    vec4 c = texture2D(tSSR, vUv);
    gl_FragColor = c;
  }
`
