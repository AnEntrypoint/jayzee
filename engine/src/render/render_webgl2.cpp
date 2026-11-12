#include "render_webgl2.h"

#include <cstdint>

#include <GLES3/gl3.h>
#include <emscripten/html5.h>

#include "../model_pool.h"
#include "../page_cache.h"
#include "../phase_timer.h"
#include "vegetation_draw.h"

namespace engine::render::webgl2 {

namespace {

constexpr char kPropVertex[] = R"GLSL(#version 300 es
precision highp float;
precision highp int;
layout(std140) uniform Frame {
  vec4 planes[6];
  mat4 viewProj;
  vec4 eye;
  uvec4 counts;
  vec4 classRadius;
  uvec4 classMaterial;
};
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec4 aQuat;
layout(location = 2) in uint aClass;
flat out uint vClass;
out vec3 vWorld;
out vec3 vNormal;

vec3 cubeCorner(int vid) {
  int face = vid / 6;
  int k = vid - face * 6;
  int axis = face / 2;
  float sgn = ((face & 1) == 0) ? 0.5 : -0.5;
  float tu = (k == 1 || k == 2 || k == 4) ? 0.5 : -0.5;
  float tv = (k == 2 || k == 4 || k == 5) ? 0.5 : -0.5;
  vec3 p = vec3(0.0);
  p[axis] = sgn;
  p[(axis + 1) % 3] = tu;
  p[(axis + 2) % 3] = tv;
  return p;
}

vec3 cubeNormal(int vid) {
  int face = vid / 6;
  vec3 n = vec3(0.0);
  n[face / 2] = ((face & 1) == 0) ? 1.0 : -1.0;
  return n;
}

vec3 rotateQuat(vec4 q, vec3 v) {
  vec3 t = 2.0 * cross(q.xyz, v);
  return v + q.w * t + cross(q.xyz, t);
}

void main() {
  vec3 world = aPos + rotateQuat(aQuat, cubeCorner(gl_VertexID));
  vWorld = world;
  vNormal = rotateQuat(aQuat, cubeNormal(gl_VertexID));
  vClass = aClass;
  gl_Position = viewProj * vec4(world, 1.0);
}
)GLSL";

constexpr char kPropFragment[] = R"GLSL(#version 300 es
precision highp float;
precision highp int;
precision highp sampler2DArray;
layout(std140) uniform Frame {
  vec4 planes[6];
  mat4 viewProj;
  vec4 eye;
  uvec4 counts;
  vec4 classRadius;
  uvec4 classMaterial;
};
layout(std140) uniform Materials {
  uvec4 materialWords[640];
};
layout(std140) uniform Lights {
  vec4 lightData[512];
};
uniform sampler2DArray albedo;
flat in uint vClass;
in vec3 vWorld;
in vec3 vNormal;
out vec4 outColour;

uint materialWord(uint i) {
  uvec4 v = materialWords[i >> 2u];
  return v[int(i & 3u)];
}

void main() {
  uint mi = classMaterial[int(min(vClass, 3u))];
  uint base = mi * 10u;
  vec3 colour = vec3(uintBitsToFloat(materialWord(base)), uintBitsToFloat(materialWord(base + 1u)), uintBitsToFloat(materialWord(base + 2u)));
  uint layer = materialWord(base + 9u);
  ivec2 texel = ivec2(clamp(fract(vWorld.xz) * 16.0, 0.0, 15.0));
  vec3 albedoColour = texelFetch(albedo, ivec3(texel, int(layer)), 0).rgb;
  vec3 n = normalize(vNormal);
  vec3 lit = vec3(0.2);
  for (uint i = 0u; i < counts.x; i++) {
    vec4 lp = lightData[i * 2u];
    vec4 lc = lightData[i * 2u + 1u];
    vec3 d = lp.xyz - vWorld;
    float dist = max(length(d), 1e-6);
    float att = max(0.0, 1.0 - dist / max(lp.w, 1e-6));
    lit += lc.xyz * lc.w * att * max(dot(n, d / dist), 0.0);
  }
  outColour = vec4(albedoColour * colour * lit, 1.0);
}
)GLSL";

constexpr char kVegVertex[] = R"GLSL(#version 300 es
precision highp float;
precision highp int;
layout(std140) uniform Frame {
  vec4 planes[6];
  mat4 viewProj;
  vec4 eye;
  uvec4 counts;
  vec4 classRadius;
  uvec4 classMaterial;
};
uniform vec3 uOffset;
layout(location = 1) in vec4 aM0;
layout(location = 2) in vec4 aM1;
layout(location = 3) in vec4 aM2;
layout(location = 4) in vec4 aM3;
flat out uint vClass;
out vec3 vWorld;
out vec3 vNormal;

vec3 cubeCorner(int vid) {
  int face = vid / 6;
  int k = vid - face * 6;
  int axis = face / 2;
  float sgn = ((face & 1) == 0) ? 0.5 : -0.5;
  float tu = (k == 1 || k == 2 || k == 4) ? 0.5 : -0.5;
  float tv = (k == 2 || k == 4 || k == 5) ? 0.5 : -0.5;
  vec3 p = vec3(0.0);
  p[axis] = sgn;
  p[(axis + 1) % 3] = tu;
  p[(axis + 2) % 3] = tv;
  return p;
}

vec3 cubeNormal(int vid) {
  int face = vid / 6;
  vec3 n = vec3(0.0);
  n[face / 2] = ((face & 1) == 0) ? 1.0 : -1.0;
  return n;
}

void main() {
  vec3 c = cubeCorner(gl_VertexID);
  vec3 local = c.x * aM0.xyz + c.y * aM1.xyz + c.z * aM2.xyz;
  vec3 world = local + aM3.xyz + uOffset;
  vec3 n = cubeNormal(gl_VertexID);
  vWorld = world;
  vNormal = n.x * aM0.xyz + n.y * aM1.xyz + n.z * aM2.xyz;
  vClass = 0u;
  gl_Position = viewProj * vec4(world, 1.0);
}
)GLSL";

constexpr char kTerrainVertex[] = R"GLSL(#version 300 es
precision highp float;
precision highp int;
layout(std140) uniform Frame {
  vec4 planes[6];
  mat4 viewProj;
  vec4 eye;
  uvec4 counts;
  vec4 classRadius;
  uvec4 classMaterial;
};
layout(location = 0) in uint aLayer;
layout(location = 1) in vec3 aOrigin;
layout(location = 2) in vec3 aUEdge;
layout(location = 3) in vec3 aVEdge;
uniform highp sampler2DArray heights;
out vec3 vWorld;
out vec3 vNormal;

void main() {
  int quad = gl_VertexID / 6;
  int k = gl_VertexID - quad * 6;
  int cx = quad % 15;
  int cy = quad / 15;
  int du = (k == 1 || k == 2 || k == 4) ? 1 : 0;
  int dv = (k == 2 || k == 4 || k == 5) ? 1 : 0;
  int gi = cx + du;
  int gj = cy + dv;
  float h = texelFetch(heights, ivec3(gi, gj, int(aLayer)), 0).r;
  vec3 normal = normalize(cross(aUEdge, aVEdge));
  vec3 world = aOrigin + aUEdge * (float(gi) / 15.0) + aVEdge * (float(gj) / 15.0) + normal * h;
  vWorld = world;
  vNormal = normal;
  gl_Position = viewProj * vec4(world, 1.0);
}
)GLSL";

constexpr char kTerrainFragment[] = R"GLSL(#version 300 es
precision highp float;
in vec3 vWorld;
in vec3 vNormal;
out vec4 outColour;

void main() {
  vec3 sun = normalize(vec3(0.4, 1.0, 0.3));
  float lit = 0.25 + 0.75 * max(dot(normalize(vNormal), sun), 0.0);
  outColour = vec4(vec3(0.36, 0.5, 0.28) * lit, 1.0);
}
)GLSL";

constexpr char kModelVertex[] = R"GLSL(#version 300 es
precision highp float;
precision highp int;
layout(std140) uniform Frame {
  vec4 planes[6];
  mat4 viewProj;
  vec4 eye;
  uvec4 counts;
  vec4 classRadius;
  uvec4 classMaterial;
};
uniform vec3 uOffset;
layout(location = 0) in vec3 aPos;
out float vShade;

void main() {
  vShade = 0.5 + 0.5 * aPos.y;
  gl_Position = viewProj * vec4(aPos * 2.0 + uOffset, 1.0);
}
)GLSL";

constexpr char kModelFragment[] = R"GLSL(#version 300 es
precision highp float;
in float vShade;
out vec4 outColour;

void main() {
  outColour = vec4(vShade, 0.6, 0.9, 1.0);
}
)GLSL";

constexpr float kClearRed = 0.05f;
constexpr float kClearGreen = 0.07f;
constexpr float kClearBlue = 0.10f;
constexpr std::uint32_t kMaterialBlockBytes = kMaterialSlots * kMaterialBytes;
constexpr std::uint32_t kLightBlockBytes = kLightSlots * kLightBytes;
std::uint32_t propClassBytes = 0;
constexpr std::uint32_t kFrameBinding = 0;
constexpr std::uint32_t kMaterialBinding = 1;
constexpr std::uint32_t kLightBinding = 2;

std::uint8_t whitePixels[kAlbedoBytes];
GLuint frameUbo = 0;
GLuint materialUbo = 0;
GLuint lightUbo = 0;
GLuint propVbo = 0;
GLuint pageVbo = 0;
GLuint propVao = 0;
GLuint terrainVao = 0;
GLuint propProgram = 0;
GLuint vegProgram = 0;
GLuint vegVao = 0;
GLuint vegVbo[engine::render::vegetation::kMaxSpecies] = {};
GLint vegOffsetLocation = -1;
bool vegBuffersReady = false;
GLuint terrainProgram = 0;
GLuint modelProgram = 0;
GLuint modelVbo = 0;
GLuint modelEbo = 0;
GLuint modelVao = 0;
GLint modelOffsetLocation = -1;
GLuint heightTex = 0;
GLuint albedoTex = 0;
std::uint32_t surfaceWidth = 0;
std::uint32_t surfaceHeight = 0;
engine::models::Range modelRuns[engine::models::kMaxClustersPerSlot];
bool modelsReady = false;
bool ready = false;

const void* offsetPointer(std::uint32_t bytes) {
  return reinterpret_cast<const void*>(static_cast<std::uintptr_t>(bytes));
}

GLuint compileStage(GLenum type, const char* source) {
  const GLuint shader = glCreateShader(type);
  glShaderSource(shader, 1, &source, nullptr);
  glCompileShader(shader);
  GLint status = GL_FALSE;
  glGetShaderiv(shader, GL_COMPILE_STATUS, &status);
  if (status != GL_TRUE) {
    glDeleteShader(shader);
    return 0;
  }
  return shader;
}

GLuint linkProgram(const char* vertexSource, const char* fragmentSource) {
  const GLuint vertex = compileStage(GL_VERTEX_SHADER, vertexSource);
  const GLuint fragment = compileStage(GL_FRAGMENT_SHADER, fragmentSource);
  if (vertex == 0 || fragment == 0) {
    if (vertex != 0) glDeleteShader(vertex);
    if (fragment != 0) glDeleteShader(fragment);
    return 0;
  }
  const GLuint program = glCreateProgram();
  glAttachShader(program, vertex);
  glAttachShader(program, fragment);
  glLinkProgram(program);
  glDeleteShader(vertex);
  glDeleteShader(fragment);
  GLint status = GL_FALSE;
  glGetProgramiv(program, GL_LINK_STATUS, &status);
  if (status != GL_TRUE) {
    glDeleteProgram(program);
    return 0;
  }
  return program;
}

void bindBlock(GLuint program, const char* name, GLuint binding) {
  const GLuint index = glGetUniformBlockIndex(program, name);
  if (index != GL_INVALID_INDEX) glUniformBlockBinding(program, index, binding);
}

GLuint makeUniformBuffer(std::uint32_t bytes, GLuint binding) {
  GLuint buffer = 0;
  glGenBuffers(1, &buffer);
  glBindBuffer(GL_UNIFORM_BUFFER, buffer);
  glBufferData(GL_UNIFORM_BUFFER, bytes, nullptr, GL_DYNAMIC_DRAW);
  glBindBufferBase(GL_UNIFORM_BUFFER, binding, buffer);
  return buffer;
}

void ensureVegetationBuffers(const engine::render::vegetation::Bound& b) {
  if (vegBuffersReady) return;
  for (std::uint32_t s = 0; s < b.species; ++s) {
    glGenBuffers(1, &vegVbo[s]);
    glBindBuffer(GL_ARRAY_BUFFER, vegVbo[s]);
    glBufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(b.slots) * b.capacity * engine::render::vegetation::kMatrixBytes, nullptr, GL_DYNAMIC_DRAW);
  }
  vegBuffersReady = true;
}

std::uint32_t drawVegetation(const Camera& camera, const engine::render::FrameOrigin& origin) {
  namespace veg = engine::render::vegetation;
  veg::Bound& b = veg::state();
  ensureVegetationBuffers(b);
  static veg::Upload uploads[veg::kMaxSpecies * veg::kMaxSlots];
  static veg::Draw draws[veg::kMaxSpecies * veg::kMaxSlots];
  const std::uint32_t uploadCount = veg::planUploads(b, uploads, veg::kMaxSpecies * veg::kMaxSlots, veg::kUploadBytesPerFrame);
  for (std::uint32_t i = 0; i < uploadCount; ++i) {
    const veg::Upload& u = uploads[i];
    ENGINE_RENDER_CALL(glBindBuffer(GL_ARRAY_BUFFER, vegVbo[u.species]));
    ENGINE_RENDER_CALL(glBufferSubData(GL_ARRAY_BUFFER, static_cast<GLintptr>(u.byteOffset), static_cast<GLsizeiptr>(u.bytes), veg::rangeOf(b, u.species, u.slot)));
  }
  const double frameOrigin[3] = {origin.x, origin.y, origin.z};
  const std::uint32_t drawCount = veg::planDraws(b, reinterpret_cast<const float*>(camera.planes), frameOrigin, draws, veg::kMaxSpecies * veg::kMaxSlots);
  if (drawCount == veg::kPlanBad) return 0;
  std::uint32_t instances = 0;
  for (std::uint32_t i = 0; i < drawCount; ++i) instances += draws[i].count;
  engine::render::counters().vegetationDraws = drawCount;
  engine::render::counters().vegetationInstances = instances;
  ENGINE_RENDER_CALL(glUseProgram(vegProgram));
  ENGINE_RENDER_CALL(glBindVertexArray(vegVao));
  for (std::uint32_t i = 0; i < drawCount; ++i) {
    const veg::Draw& d = draws[i];
    const std::uint32_t local = d.slot * b.capacity * veg::kMatrixBytes;
    ENGINE_RENDER_CALL(glBindBuffer(GL_ARRAY_BUFFER, vegVbo[d.species]));
    for (GLuint k = 0; k < 4; ++k) {
      ENGINE_RENDER_CALL(glVertexAttribPointer(1 + k, 4, GL_FLOAT, GL_FALSE, veg::kMatrixBytes, offsetPointer(local + k * 16)));
    }
    float uOrigin[3];
    veg::relativeOriginFloat(b, d.slot, frameOrigin, uOrigin);
    ENGINE_RENDER_CALL(glUniform3f(vegOffsetLocation, uOrigin[0], uOrigin[1], uOrigin[2]));
    ENGINE_RENDER_CALL(glDrawArraysInstanced(GL_TRIANGLES, 0, kPropVertices, static_cast<GLsizei>(d.count)));
  }
  return drawCount;
}

std::uint32_t drawModels(const Camera& camera, const engine::render::FrameOrigin& origin) {
  const std::uint32_t stride = engine::models::layout().vertexStrideBytes;
  ENGINE_RENDER_CALL(glUseProgram(modelProgram));
  ENGINE_RENDER_CALL(glBindVertexArray(modelVao));
  ENGINE_RENDER_CALL(glBindBuffer(GL_ARRAY_BUFFER, modelVbo));
  std::uint32_t drawn = 0;
  for (std::uint32_t s = 0; s < engine::models::slotCount(); ++s) {
    if (!engine::models::slotReady(s)) continue;
    std::uint32_t kept = 0;
    const double frameOrigin[3] = {origin.x, origin.y, origin.z};
    const std::uint32_t runs = engine::models::visibleRuns(s, camera.planes, modelRuns, &kept, frameOrigin);
    drawn += kept;
    if (runs == 0) continue;
    float offset[3];
    engine::models::modelOffset(s, offset);
    float relative[3];
    engine::render::relativeOfFloat(offset, origin, relative);
    ENGINE_RENDER_CALL(glUniform3f(modelOffsetLocation, relative[0], relative[1], relative[2]));
    for (std::uint32_t r = 0; r < runs; ++r) {
      const engine::models::Range& run = modelRuns[r];
      ENGINE_RENDER_CALL(glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, stride, offsetPointer(run.firstVertex * stride)));
      ENGINE_RENDER_CALL(glDrawElements(GL_TRIANGLES, run.indexCount, GL_UNSIGNED_INT, offsetPointer(run.firstIndex * engine::models::kIndexBytes)));
    }
  }
  return drawn;
}

}

int init(const char* selector, std::uint32_t width, std::uint32_t height) {
  if (!acceptCreate()) return engine::kRange;
  if (ready) return engine::kOk;

  EmscriptenWebGLContextAttributes attrs{};
  emscripten_webgl_init_context_attributes(&attrs);
  attrs.majorVersion = 2;
  attrs.minorVersion = 0;
  attrs.alpha = 0;
  attrs.depth = 1;
  attrs.stencil = 0;
  attrs.antialias = 0;
  attrs.premultipliedAlpha = 0;
  attrs.preserveDrawingBuffer = 0;
  attrs.enableExtensionsByDefault = 1;
  const EMSCRIPTEN_WEBGL_CONTEXT_HANDLE context = emscripten_webgl_create_context(selector, &attrs);
  if (context <= 0) return engine::kNotConfigured;
  if (emscripten_webgl_make_context_current(context) != EMSCRIPTEN_RESULT_SUCCESS) return engine::kNotConfigured;
  surfaceWidth = width;
  surfaceHeight = height;

  propProgram = linkProgram(kPropVertex, kPropFragment);
  terrainProgram = linkProgram(kTerrainVertex, kTerrainFragment);
  if (propProgram == 0 || terrainProgram == 0) return engine::kNotConfigured;
  bindBlock(propProgram, "Frame", kFrameBinding);
  bindBlock(propProgram, "Materials", kMaterialBinding);
  bindBlock(propProgram, "Lights", kLightBinding);
  bindBlock(terrainProgram, "Frame", kFrameBinding);
  glUseProgram(propProgram);
  glUniform1i(glGetUniformLocation(propProgram, "albedo"), 0);
  glUseProgram(terrainProgram);
  glUniform1i(glGetUniformLocation(terrainProgram, "heights"), 1);
  vegProgram = linkProgram(kVegVertex, kPropFragment);
  if (vegProgram == 0) return engine::kNotConfigured;
  bindBlock(vegProgram, "Frame", kFrameBinding);
  bindBlock(vegProgram, "Materials", kMaterialBinding);
  bindBlock(vegProgram, "Lights", kLightBinding);
  glUseProgram(vegProgram);
  glUniform1i(glGetUniformLocation(vegProgram, "albedo"), 0);
  vegOffsetLocation = glGetUniformLocation(vegProgram, "uOffset");
  glGenVertexArrays(1, &vegVao);
  glBindVertexArray(vegVao);
  for (GLuint location = 1; location < 5; ++location) {
    glEnableVertexAttribArray(location);
    glVertexAttribDivisor(location, 1);
  }
  glBindVertexArray(0);

  frameUbo = makeUniformBuffer(sizeof(Camera), kFrameBinding);
  materialUbo = makeUniformBuffer(kMaterialBlockBytes, kMaterialBinding);
  lightUbo = makeUniformBuffer(kLightBlockBytes, kLightBinding);

  glGenBuffers(1, &propVbo);
  glBindBuffer(GL_ARRAY_BUFFER, propVbo);
  propClassBytes = engine::world().bodyCapacity() * kRecordBytes;
  glBufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(kPropClasses) * propClassBytes, nullptr, GL_DYNAMIC_DRAW);
  glGenVertexArrays(1, &propVao);
  glBindVertexArray(propVao);
  glEnableVertexAttribArray(0);
  glEnableVertexAttribArray(1);
  glEnableVertexAttribArray(2);
  glVertexAttribDivisor(0, 1);
  glVertexAttribDivisor(1, 1);
  glVertexAttribDivisor(2, 1);

  glGenBuffers(1, &pageVbo);
  glBindBuffer(GL_ARRAY_BUFFER, pageVbo);
  glBufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(kMaxPageLayers) * kPageRecordBytes, nullptr, GL_DYNAMIC_DRAW);
  glGenVertexArrays(1, &terrainVao);
  glBindVertexArray(terrainVao);
  glVertexAttribIPointer(0, 1, GL_UNSIGNED_INT, kPageRecordBytes, offsetPointer(0));
  glVertexAttribPointer(1, 3, GL_FLOAT, GL_FALSE, kPageRecordBytes, offsetPointer(16));
  glVertexAttribPointer(2, 3, GL_FLOAT, GL_FALSE, kPageRecordBytes, offsetPointer(32));
  glVertexAttribPointer(3, 3, GL_FLOAT, GL_FALSE, kPageRecordBytes, offsetPointer(48));
  for (GLuint location = 0; location < 4; ++location) {
    glEnableVertexAttribArray(location);
    glVertexAttribDivisor(location, 1);
  }

  glActiveTexture(GL_TEXTURE1);
  glGenTextures(1, &heightTex);
  glBindTexture(GL_TEXTURE_2D_ARRAY, heightTex);
  glTexParameteri(GL_TEXTURE_2D_ARRAY, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
  glTexParameteri(GL_TEXTURE_2D_ARRAY, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
  glTexStorage3D(GL_TEXTURE_2D_ARRAY, 1, GL_R32F, kPageSide, kPageSide, static_cast<GLsizei>(pageLayers()));

  glActiveTexture(GL_TEXTURE0);
  glGenTextures(1, &albedoTex);
  glBindTexture(GL_TEXTURE_2D_ARRAY, albedoTex);
  glTexParameteri(GL_TEXTURE_2D_ARRAY, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
  glTexParameteri(GL_TEXTURE_2D_ARRAY, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
  glTexStorage3D(GL_TEXTURE_2D_ARRAY, 1, GL_RGBA8, kAlbedoSide, kAlbedoSide, kAlbedoLayers);
  for (std::uint32_t i = 0; i < kAlbedoBytes; ++i) whitePixels[i] = 0xff;
  glPixelStorei(GL_UNPACK_ALIGNMENT, 4);
  glTexSubImage3D(GL_TEXTURE_2D_ARRAY, 0, 0, 0, 0, kAlbedoSide, kAlbedoSide, 1, GL_RGBA, GL_UNSIGNED_BYTE, whitePixels);

  if (engine::models::bound()) {
    modelProgram = linkProgram(kModelVertex, kModelFragment);
    if (modelProgram == 0) return engine::kNotConfigured;
    bindBlock(modelProgram, "Frame", kFrameBinding);
    modelOffsetLocation = glGetUniformLocation(modelProgram, "uOffset");

    glGenBuffers(1, &modelVbo);
    glBindBuffer(GL_ARRAY_BUFFER, modelVbo);
    glBufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(engine::models::vertexPoolBytes()), nullptr, GL_DYNAMIC_DRAW);
    glGenBuffers(1, &modelEbo);
    glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, modelEbo);
    glBufferData(GL_ELEMENT_ARRAY_BUFFER, static_cast<GLsizeiptr>(engine::models::indexPoolBytes()), nullptr, GL_DYNAMIC_DRAW);
    glGenVertexArrays(1, &modelVao);
    glBindVertexArray(modelVao);
    glBindBuffer(GL_ARRAY_BUFFER, modelVbo);
    glEnableVertexAttribArray(0);
    glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, modelEbo);
    glBindVertexArray(0);
    modelsReady = true;
  }

  glBindVertexArray(0);
  glBindBuffer(GL_ARRAY_BUFFER, 0);
  ready = true;
  return engine::kOk;
}

int frame(const SceneView& scene, const FramePlan& plan, const Camera& camera) {
  if (!ready) return engine::kNotConfigured;

  {
    engine::phase::Scope scope(engine::phase::kUpload);
    ENGINE_RENDER_CALL(glBindBuffer(GL_UNIFORM_BUFFER, frameUbo));
    ENGINE_RENDER_CALL(glBufferSubData(GL_UNIFORM_BUFFER, 0, sizeof(Camera), &camera));
    ENGINE_RENDER_CALL(glBindBuffer(GL_UNIFORM_BUFFER, materialUbo));
    ENGINE_RENDER_CALL(glBufferSubData(GL_UNIFORM_BUFFER, 0, kMaterialBlockBytes, plan.materialWords));
    ENGINE_RENDER_CALL(glBindBuffer(GL_UNIFORM_BUFFER, lightUbo));
    ENGINE_RENDER_CALL(glBufferSubData(GL_UNIFORM_BUFFER, 0, kLightBlockBytes, scene.lights));

    ENGINE_RENDER_CALL(glPixelStorei(GL_UNPACK_ALIGNMENT, 4));
    ENGINE_RENDER_CALL(glActiveTexture(GL_TEXTURE1));
    ENGINE_RENDER_CALL(glBindTexture(GL_TEXTURE_2D_ARRAY, heightTex));
    for (std::uint32_t u = 0; u < plan.uploadCount;) {
      const std::uint32_t end = uploadRunEnd(plan, u);
      ENGINE_RENDER_CALL(glTexSubImage3D(GL_TEXTURE_2D_ARRAY, 0, 0, 0, static_cast<GLint>(plan.uploadLayer[u]), kPageSide, kPageSide, static_cast<GLsizei>(end - u),
                                         GL_RED, GL_FLOAT, scene.pages->pageSamples(static_cast<int>(plan.uploadSlot[u]))));
      u = end;
    }
    ENGINE_RENDER_CALL(glActiveTexture(GL_TEXTURE0));
    ENGINE_RENDER_CALL(glBindTexture(GL_TEXTURE_2D_ARRAY, albedoTex));
    for (std::uint32_t layer = 0; layer < kAlbedoLayers;) {
      if (plan.albedoPending[layer] == 0) {
        layer += 1;
        continue;
      }
      const std::uint32_t end = albedoRunEnd(plan, layer);
      ENGINE_RENDER_CALL(glTexSubImage3D(GL_TEXTURE_2D_ARRAY, 0, 0, 0, static_cast<GLint>(layer), kAlbedoSide, kAlbedoSide, static_cast<GLsizei>(end - layer),
                                         GL_RGBA, GL_UNSIGNED_BYTE, scene.albedoPixels + layer * kAlbedoBytes));
      layer = end;
    }
    if (modelsReady) {
      std::uint64_t modelBudget = engine::models::layout().uploadBytesPerFrame;
      for (std::uint32_t s = 0; s < engine::models::slotCount(); ++s) {
        if (!engine::models::slotDirty(s)) continue;
        const std::uint64_t vertexSlotBytes = engine::models::slotVertexBytes();
        const std::uint64_t indexSlotBytes = engine::models::slotIndexBytes();
        if (vertexSlotBytes + indexSlotBytes > modelBudget) break;
        ENGINE_RENDER_CALL(glBindBuffer(GL_ARRAY_BUFFER, modelVbo));
        ENGINE_RENDER_CALL(glBufferSubData(GL_ARRAY_BUFFER, static_cast<GLintptr>(s * vertexSlotBytes), static_cast<GLsizeiptr>(vertexSlotBytes), engine::models::slotVertices(s)));
        ENGINE_RENDER_CALL(glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, modelEbo));
        ENGINE_RENDER_CALL(glBufferSubData(GL_ELEMENT_ARRAY_BUFFER, static_cast<GLintptr>(s * indexSlotBytes), static_cast<GLsizeiptr>(indexSlotBytes), engine::models::slotIndices(s)));
        engine::models::clearDirty(s);
        modelBudget -= vertexSlotBytes + indexSlotBytes;
      }
      engine::render::selectModelLods(camera, scene.origin, surfaceHeight);
    }
  }

  ENGINE_RENDER_CALL(glBindFramebuffer(GL_FRAMEBUFFER, 0));
  ENGINE_RENDER_CALL(glViewport(0, 0, static_cast<GLsizei>(surfaceWidth), static_cast<GLsizei>(surfaceHeight)));
  ENGINE_RENDER_CALL(glEnable(GL_DEPTH_TEST));
  ENGINE_RENDER_CALL(glClearColor(kClearRed, kClearGreen, kClearBlue, 1.0f));
  ENGINE_RENDER_CALL(glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT));

  ENGINE_RENDER_CALL(glUseProgram(propProgram));
  ENGINE_RENDER_CALL(glBindVertexArray(propVao));
  ENGINE_RENDER_CALL(glBindBuffer(GL_ARRAY_BUFFER, propVbo));
  for (std::uint32_t c = 0; c < kPropClasses; ++c) {
    const std::uint32_t count = plan.propCount[c];
    if (count == 0) continue;
    const std::uint32_t base = c * propClassBytes;
    ENGINE_RENDER_CALL(glBufferSubData(GL_ARRAY_BUFFER, base, static_cast<GLsizeiptr>(count) * kRecordBytes, plan.propRecords + c * plan.bodySlots * kRecordWords));
    ENGINE_RENDER_CALL(glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, kRecordBytes, offsetPointer(base)));
    ENGINE_RENDER_CALL(glVertexAttribPointer(1, 4, GL_FLOAT, GL_FALSE, kRecordBytes, offsetPointer(base + 12)));
    ENGINE_RENDER_CALL(glVertexAttribIPointer(2, 1, GL_UNSIGNED_INT, kRecordBytes, offsetPointer(base + 28)));
    ENGINE_RENDER_CALL(glDrawArraysInstanced(GL_TRIANGLES, 0, kPropVertices, static_cast<GLsizei>(count)));
  }

  if (engine::render::vegetation::bound()) drawVegetation(camera, scene.origin);
  const std::uint32_t drawn = modelsReady && engine::models::bound() ? drawModels(camera, scene.origin) : 0;
  engine::render::counters().cullPassA = drawn;
  engine::render::counters().cullCandidates = 0;
  engine::render::counters().cullPassB = 0;
  engine::render::counters().cullFresh = 1;

  if (plan.pageCount > 0) {
    ENGINE_RENDER_CALL(glUseProgram(terrainProgram));
    ENGINE_RENDER_CALL(glBindVertexArray(terrainVao));
    ENGINE_RENDER_CALL(glBindBuffer(GL_ARRAY_BUFFER, pageVbo));
    ENGINE_RENDER_CALL(glBufferSubData(GL_ARRAY_BUFFER, 0, static_cast<GLsizeiptr>(plan.pageCount) * kPageRecordBytes, plan.pageRecords));
    ENGINE_RENDER_CALL(glDrawArraysInstanced(GL_TRIANGLES, 0, kPageVertices, static_cast<GLsizei>(plan.pageCount)));
  }
  ENGINE_RENDER_CALL(glBindVertexArray(0));
  engine::render::counters().modelPath = engine::render::kModelPathForward;
  return engine::kOk;
}

}
