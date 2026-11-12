export const HEIGHT_GLSL = `
struct NoiseLayer {
  int ltype;
  int numOct;
  float gain;
  float ridgeOffset;
  float ridgeExp;
  float warpStr;
  float hmin;
  float hmax;
};

const int LTYPE_FBM = 0;
const int LTYPE_RIDGED = 1;
const NoiseLayer NOISE_LAYERS[3] = NoiseLayer[3](
  NoiseLayer(LTYPE_RIDGED, 10, 0.5, 1.064, 1.005, 1.6, 0.0, 1.0),
  NoiseLayer(LTYPE_FBM, 18, 0.5, 1.064, 1.665, 2.6, -2.0, 2.0),
  NoiseLayer(LTYPE_RIDGED, 18, 0.5, 1.064, 1.1, 0.9, -2.0, 2.0)
);
const float CONTINENTAL_BIAS_AMP = 50.0;
const int NO_UNROLL_BASE = 64;
const float OCTAVE_ROTATION_RAD = 0.5236;
const float FRACTAL_HEIGHT_M = 750000.0;
const float OCEAN_DEPTH_FLOOR_M = -350000.0;
const float OCEAN_DEEPEN = 1.25;
const float DEFAULT_BEACH_SHELF_M = 150.0;
const float NO_SCULPT_OFFSET_M = 0.0;

uniform int uNoUnroll;
uniform float uLandBias;
uniform float uBeachShelfM;
uniform float uReliefScale;

vec4 hpfSample(vec3 dir);

int octaveCount(int numOctaves) {
  return numOctaves + (uNoUnroll > 0 ? uNoUnroll - NO_UNROLL_BASE : 0);
}

float h3(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z) * 2.0 - 1.0;
}

float snoise3(vec3 P) {
  vec3 fl = floor(P);
  ivec3 i = ivec3(fl);
  vec3 f = P - fl;
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec3 i0 = vec3(i);
  vec3 i1 = vec3(i) + vec3(1.0);
  float n000 = h3(i0);
  float n100 = h3(vec3(i1.x, i0.y, i0.z));
  float n010 = h3(vec3(i0.x, i1.y, i0.z));
  float n110 = h3(vec3(i1.x, i1.y, i0.z));
  float n001 = h3(vec3(i0.x, i0.y, i1.z));
  float n101 = h3(vec3(i1.x, i0.y, i1.z));
  float n011 = h3(vec3(i0.x, i1.y, i1.z));
  float n111 = h3(i1);
  float ux = u.x;
  float x00 = mix(n000, n100, ux);
  float x10 = mix(n010, n110, ux);
  float x01 = mix(n001, n101, ux);
  float x11 = mix(n011, n111, ux);
  float uy = u.y;
  return mix(mix(x00, x10, uy), mix(x01, x11, uy), u.z);
}

float valueFbm(vec3 x, float gain, int numOctaves) {
  float v = 0.0, a = 1.0, norm = 0.0;
  vec3 p = x;
  int nb = octaveCount(numOctaves);
  for (int i = 0; i < nb; i++) {
    v += a * snoise3(p);
    norm += a;
    a *= gain;
    p *= 2.0;
  }
  return v / norm;
}

vec3 rotateDomain(vec3 pos, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return vec3(c * pos.x - s * pos.z, pos.y, s * pos.x + c * pos.z);
}

float valueRidgedFbmRot(vec3 xIn, float gain, int numOctaves, float offset, float exponent) {
  float v = 0.0, w = 1.0, norm = 0.0, a = 1.0;
  vec3 p = xIn;
  int nb = octaveCount(numOctaves);
  for (int i = 0; i < nb; i++) {
    float signal = pow(max(offset - abs(snoise3(p)), 0.0), exponent);
    v += signal * w * a;
    norm += a;
    w = clamp(signal, 0.0, 1.0);
    a *= gain;
    p = rotateDomain(p * 2.0, float(i) * OCTAVE_ROTATION_RAD);
  }
  return v / max(norm, 1e-5);
}

float evalLayer(vec3 pos, NoiseLayer L) {
  float t = L.ltype == LTYPE_FBM
    ? valueFbm(pos, L.gain, L.numOct) * 0.5 + 0.5
    : valueRidgedFbmRot(pos, L.gain, L.numOct, L.ridgeOffset, L.ridgeExp);
  return L.hmin + (L.hmax - L.hmin) * t;
}

float sampleFractalTerrain(vec3 pCoords) {
  float h0 = evalLayer(pCoords, NOISE_LAYERS[0]);
  vec3 warped = pCoords + pCoords * NOISE_LAYERS[0].warpStr * h0;
  float h1 = evalLayer(warped, NOISE_LAYERS[1]);
  float h2 = evalLayer(warped, NOISE_LAYERS[2]);
  return (h0 + h1 + h2) / 3.0;
}

float fractalTerrainH(vec3 dir0) {
  vec3 dirN = normalize(dir0);
  vec3 p = dirN * 3.0;
  float h = (sampleFractalTerrain(p) - 0.17) * 0.6;
  float pmix = snoise3(p * 0.53 + vec3(123.0, 456.0, 789.0)) * 0.5 + 0.5;
  float vPower = mix(0.95, 1.3, pmix);
  h = h > 0.0 ? pow(h, 0.8 * vPower) : -pow(-h, 0.8 * vPower);
  return h * clamp(snoise3(dirN * 4.0) * 0.5 + 0.7, 0.3, 1.0);
}

float continentalBias(vec3 dir) {
  return hpfSample(dir).r;
}

float composeHeight(vec3 dir0) {
  float frac = fractalTerrainH(dir0);
  float cbias = continentalBias(dir0) * CONTINENTAL_BIAS_AMP;
  float h = frac * FRACTAL_HEIGHT_M + cbias + uLandBias;
  if (h < 0.0) {
    h = max(h * OCEAN_DEEPEN, OCEAN_DEPTH_FLOOR_M);
  } else {
    float bShelf = uBeachShelfM > 1.0 ? uBeachShelfM : DEFAULT_BEACH_SHELF_M;
    if (h < bShelf) h = (h * h / bShelf) * (2.0 - h / bShelf);
  }
  h = h * (uReliefScale > 0.0 ? uReliefScale : 1.0);
  return h + NO_SCULPT_OFFSET_M;
}
`

export const HEIGHT_GLSL_EXPORTS = Object.freeze(['snoise3', 'composeHeight', 'continentalBias'])
