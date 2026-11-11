#include "render_webgpu.h"
#include "vegetation_draw.h"

#include <algorithm>
#include <cstddef>
#include <cstring>

#include <webgpu/webgpu_cpp.h>

#include "../model_pool.h"
#include "../page_cache.h"
#include "../phase_timer.h"

namespace engine::render::webgpu {

namespace {

constexpr char kPropWgsl[] = R"WGSL(
struct Camera {
  planes: array<vec4f, 6>,
  viewProj: mat4x4f,
  eye: vec4f,
  counts: vec4u,
  classRadius: vec4f,
  classMaterial: vec4u,
};

@group(0) @binding(0) var<uniform> cam: Camera;
@group(0) @binding(1) var<storage, read> inst: array<u32>;
@group(0) @binding(2) var<storage, read> materials: array<u32>;
@group(0) @binding(3) var<storage, read> lights: array<vec4f>;
@group(0) @binding(4) var albedo: texture_2d_array<f32>;

struct PropOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
  @location(1) normal: vec3f,
  @location(2) @interpolate(flat) cls: u32,
};

fn instF(i: u32) -> f32 {
  return bitcast<f32>(inst[i]);
}

fn matF(i: u32) -> f32 {
  return bitcast<f32>(materials[i]);
}

fn clipOf(p: vec4f) -> vec4f {
  return vec4f(p.xy, (p.z + p.w) * 0.5, p.w);
}

fn rotate(q: vec4f, v: vec3f) -> vec3f {
  let t = 2.0 * cross(q.xyz, v);
  return v + q.w * t + cross(q.xyz, t);
}

fn cubeCorner(vid: u32) -> vec3f {
  let face = vid / 6u;
  let k = vid % 6u;
  let axis = face / 2u;
  let sgn = select(-0.5, 0.5, (face & 1u) == 0u);
  let tu = select(-0.5, 0.5, k == 1u || k == 2u || k == 4u);
  let tv = select(-0.5, 0.5, k == 2u || k == 4u || k == 5u);
  var p = vec3f(0.0);
  p[axis] = sgn;
  p[(axis + 1u) % 3u] = tu;
  p[(axis + 2u) % 3u] = tv;
  return p;
}

fn cubeNormal(vid: u32) -> vec3f {
  let face = vid / 6u;
  var n = vec3f(0.0);
  n[face / 2u] = select(-1.0, 1.0, (face & 1u) == 0u);
  return n;
}

@vertex
fn vsProps(@builtin(vertex_index) vid: u32, @builtin(instance_index) iid: u32) -> PropOut {
  let base = iid * 8u;
  let centre = vec3f(instF(base), instF(base + 1u), instF(base + 2u));
  let q = vec4f(instF(base + 3u), instF(base + 4u), instF(base + 5u), instF(base + 6u));
  let world = centre + rotate(q, cubeCorner(vid));
  var out: PropOut;
  out.clip = clipOf(cam.viewProj * vec4f(world, 1.0));
  out.world = world;
  out.normal = rotate(q, cubeNormal(vid));
  out.cls = inst[base + 7u];
  return out;
}

@fragment
fn fsProps(vin: PropOut) -> @location(0) vec4f {
  let mi = cam.classMaterial[min(vin.cls, 3u)];
  let m = mi * 10u;
  let colour = vec3f(matF(m), matF(m + 1u), matF(m + 2u));
  let layer = materials[m + 9u];
  let texel = vec2i(clamp(fract(vin.world.xz) * 16.0, vec2f(0.0), vec2f(15.0)));
  let albedoColour = textureLoad(albedo, texel, i32(layer), 0).rgb;
  let n = normalize(vin.normal);
  var lit = vec3f(0.2);
  for (var i = 0u; i < cam.counts.x; i = i + 1u) {
    let lp = lights[i * 2u];
    let lc = lights[i * 2u + 1u];
    let d = lp.xyz - vin.world;
    let dist = max(length(d), 1e-6);
    let att = max(0.0, 1.0 - dist / max(lp.w, 1e-6));
    lit = lit + lc.xyz * lc.w * att * max(dot(n, d / dist), 0.0);
  }
  return vec4f(albedoColour * colour * lit, 1.0);
}
)WGSL";

constexpr char kVegWgsl[] = R"WGSL(
struct Camera {
  planes: array<vec4f, 6>,
  viewProj: mat4x4f,
  eye: vec4f,
  counts: vec4u,
  classRadius: vec4f,
  classMaterial: vec4u,
};

@group(0) @binding(0) var<uniform> cam: Camera;
@group(0) @binding(1) var<storage, read> mats: array<f32>;
@group(0) @binding(2) var<storage, read> materials: array<u32>;
@group(0) @binding(3) var<storage, read> lights: array<vec4f>;
@group(0) @binding(4) var albedo: texture_2d_array<f32>;
@group(0) @binding(5) var<storage, read> slotOrigin: vec4f;

struct VegOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
  @location(1) normal: vec3f,
  @location(2) @interpolate(flat) cls: u32,
};

fn matF(i: u32) -> f32 {
  return bitcast<f32>(materials[i]);
}

fn clipOf(p: vec4f) -> vec4f {
  return vec4f(p.xy, (p.z + p.w) * 0.5, p.w);
}

fn cubeCorner(vid: u32) -> vec3f {
  let face = vid / 6u;
  let k = vid % 6u;
  let axis = face / 2u;
  let sgn = select(-0.5, 0.5, (face & 1u) == 0u);
  let tu = select(-0.5, 0.5, k == 1u || k == 2u || k == 4u);
  let tv = select(-0.5, 0.5, k == 2u || k == 4u || k == 5u);
  var p = vec3f(0.0);
  p[axis] = sgn;
  p[(axis + 1u) % 3u] = tu;
  p[(axis + 2u) % 3u] = tv;
  return p;
}

fn cubeNormal(vid: u32) -> vec3f {
  let face = vid / 6u;
  var n = vec3f(0.0);
  n[face / 2u] = select(-1.0, 1.0, (face & 1u) == 0u);
  return n;
}

@vertex
fn vsVeg(@builtin(vertex_index) vid: u32, @builtin(instance_index) iid: u32) -> VegOut {
  let base = iid * 16u;
  let m0 = vec3f(mats[base], mats[base + 1u], mats[base + 2u]);
  let m1 = vec3f(mats[base + 4u], mats[base + 5u], mats[base + 6u]);
  let m2 = vec3f(mats[base + 8u], mats[base + 9u], mats[base + 10u]);
  let t = vec3f(mats[base + 12u], mats[base + 13u], mats[base + 14u]);
  let c = cubeCorner(vid);
  let world = slotOrigin.xyz + m0 * c.x + m1 * c.y + m2 * c.z + t;
  let n = cubeNormal(vid);
  var out: VegOut;
  out.clip = clipOf(cam.viewProj * vec4f(world, 1.0));
  out.world = world;
  out.normal = m0 * n.x + m1 * n.y + m2 * n.z;
  out.cls = 0u;
  return out;
}

@fragment
fn fsVeg(vin: VegOut) -> @location(0) vec4f {
  let mi = cam.classMaterial[min(vin.cls, 3u)];
  let m = mi * 10u;
  let colour = vec3f(matF(m), matF(m + 1u), matF(m + 2u));
  let layer = materials[m + 9u];
  let texel = vec2i(clamp(fract(vin.world.xz) * 16.0, vec2f(0.0), vec2f(15.0)));
  let albedoColour = textureLoad(albedo, texel, i32(layer), 0).rgb;
  let n = normalize(vin.normal);
  var lit = vec3f(0.2);
  for (var i = 0u; i < cam.counts.x; i = i + 1u) {
    let lp = lights[i * 2u];
    let lc = lights[i * 2u + 1u];
    let d = lp.xyz - vin.world;
    let dist = max(length(d), 1e-6);
    let att = max(0.0, 1.0 - dist / max(lp.w, 1e-6));
    lit = lit + lc.xyz * lc.w * att * max(dot(n, d / dist), 0.0);
  }
  return vec4f(albedoColour * colour * lit, 1.0);
}
)WGSL";

constexpr char kModelWgsl[] = R"WGSL(
struct Camera {
  planes: array<vec4f, 6>,
  viewProj: mat4x4f,
  eye: vec4f,
  counts: vec4u,
  classRadius: vec4f,
  classMaterial: vec4u,
};

@group(0) @binding(0) var<uniform> cam: Camera;

@group(0) @binding(1) var<storage, read> modelRel: array<vec4f>;

struct ModelOut {
  @builtin(position) clip: vec4f,
  @location(0) shade: f32,
};

fn clipOf(p: vec4f) -> vec4f {
  return vec4f(p.xy, (p.z + p.w) * 0.5, p.w);
}

@vertex
fn vsModel(@location(0) pos: vec3f, @builtin(instance_index) iid: u32) -> ModelOut {
  let world = pos * 2.0 + modelRel[iid].xyz;
  var out: ModelOut;
  out.clip = clipOf(cam.viewProj * vec4f(world, 1.0));
  out.shade = 0.5 + 0.5 * pos.y;
  return out;
}

@fragment
fn fsModel(vin: ModelOut) -> @location(0) vec4f {
  return vec4f(vin.shade, 0.6, 0.9, 1.0);
}
)WGSL";

constexpr char kCullWgsl[] = R"WGSL(
struct Camera {
  planes: array<vec4f, 6>,
  viewProj: mat4x4f,
  eye: vec4f,
  counts: vec4u,
  classRadius: vec4f,
  classMaterial: vec4u,
};

struct ModelParams {
  clustersPerSlot: u32,
  verticesPerSlot: u32,
  indicesPerSlot: u32,
  vertexWords: u32,
  width: u32,
  height: u32,
  levels: u32,
  occlusion: u32,
  total: u32,
  slots: u32,
  hzbWidth: u32,
  hzbHeight: u32,
};

@group(0) @binding(0) var<uniform> cam: Camera;
@group(0) @binding(1) var<storage, read> clusters: array<u32>;
@group(0) @binding(2) var<storage, read> slotReady: array<u32>;
@group(0) @binding(3) var<storage, read_write> listA: array<u32>;
@group(0) @binding(4) var<storage, read_write> listCand: array<u32>;
@group(0) @binding(5) var<storage, read_write> listB: array<u32>;
@group(0) @binding(6) var<storage, read_write> counters: array<atomic<u32>>;
@group(0) @binding(7) var<uniform> params: ModelParams;
@group(0) @binding(8) var hzb: texture_2d<f32>;
@group(0) @binding(9) var<storage, read> modelRel: array<vec4f>;

fn clusterWord(gid: u32, word: u32) -> f32 {
  return bitcast<f32>(clusters[gid * 6u + word]);
}

fn sphereOf(gid: u32) -> vec4f {
  let slot = gid / params.clustersPerSlot;
  let placed = modelRel[slot].xyz;
  let centre = vec3f(clusterWord(gid, 0u), clusterWord(gid, 1u), clusterWord(gid, 2u)) * 2.0 + placed;
  return vec4f(centre, clusterWord(gid, 3u) * 2.0);
}

fn outsideFrustum(s: vec4f) -> bool {
  for (var p = 0u; p < 6u; p = p + 1u) {
    let plane = cam.planes[p];
    if (dot(plane.xyz, s.xyz) + plane.w < -s.w) {
      return true;
    }
  }
  return false;
}

fn occluded(gid: u32) -> bool {
  let s = sphereOf(gid);
  if (!(s.w >= 0.0) || s.w > 1.0e30) {
    return false;
  }
  var lo = vec2f(1.0e30);
  var hi = vec2f(-1.0e30);
  var zmin = 1.0e30;
  for (var i = 0u; i < 8u; i = i + 1u) {
    let signs = vec3f(select(-1.0, 1.0, (i & 1u) != 0u), select(-1.0, 1.0, (i & 2u) != 0u), select(-1.0, 1.0, (i & 4u) != 0u));
    let clip = cam.viewProj * vec4f(s.xyz + signs * s.w, 1.0);
    if (clip.w <= 1.0e-6) {
      return false;
    }
    let ndc = clip.xy / clip.w;
    lo = min(lo, ndc);
    hi = max(hi, ndc);
    zmin = min(zmin, (clip.z + clip.w) * 0.5 / clip.w);
  }
  let w = f32(params.width);
  let h = f32(params.height);
  let limit = vec2f(w - 1.0, h - 1.0);
  let a = clamp(vec2f((lo.x * 0.5 + 0.5) * w, (0.5 - hi.y * 0.5) * h), vec2f(0.0), limit);
  let b = clamp(vec2f((hi.x * 0.5 + 0.5) * w, (0.5 - lo.y * 0.5) * h), vec2f(0.0), limit);
  let span = max(b.x - a.x, b.y - a.y);
  var level = u32(ceil(log2(max(span, 1.0))));
  if (level >= params.levels) {
    level = params.levels - 1u;
  }
  let scale = f32(1u << level);
  let most = vec2u(max(params.hzbWidth >> level, 1u) - 1u, max(params.hzbHeight >> level, 1u) - 1u);
  let ca = min(vec2u(floor(a / scale)), most);
  let cb = min(vec2u(floor(b / scale)), most);
  let l = i32(level);
  let farthest = max(
    max(textureLoad(hzb, vec2i(ca), l).r, textureLoad(hzb, vec2i(vec2u(cb.x, ca.y)), l).r),
    max(textureLoad(hzb, vec2i(vec2u(ca.x, cb.y)), l).r, textureLoad(hzb, vec2i(cb), l).r));
  return zmin > farthest + 1.0e-5;
}

@compute @workgroup_size(64)
fn cullA(@builtin(global_invocation_id) id: vec3u) {
  let gid = id.x;
  if (gid >= params.total) {
    return;
  }
  if (slotReady[gid / params.clustersPerSlot] == 0u || clusters[gid * 6u + 5u] == 0u) {
    return;
  }
  let s = sphereOf(gid);
  if (outsideFrustum(s)) {
    return;
  }
  if (params.occlusion != 0u && occluded(gid)) {
    let k = atomicAdd(&counters[1], 1u);
    listCand[k] = gid;
    return;
  }
  let k = atomicAdd(&counters[0], 1u);
  listA[k] = gid;
}

@compute @workgroup_size(64)
fn cullB(@builtin(global_invocation_id) id: vec3u) {
  let k = id.x;
  if (k >= atomicLoad(&counters[1])) {
    return;
  }
  let gid = listCand[k];
  if (occluded(gid)) {
    return;
  }
  let j = atomicAdd(&counters[2], 1u);
  listB[j] = gid;
}
)WGSL";

constexpr char kFinalizeWgsl[] = R"WGSL(
@group(0) @binding(0) var<storage, read_write> counters: array<atomic<u32>>;
@group(0) @binding(1) var<storage, read_write> args: array<u32>;

@compute @workgroup_size(1)
fn finalize() {
  args[0] = atomicLoad(&counters[0]) * 384u;
  args[1] = 1u;
  args[2] = 0u;
  args[3] = 0u;
  args[4] = atomicLoad(&counters[2]) * 384u;
  args[5] = 1u;
  args[6] = 0u;
  args[7] = 0u;
}
)WGSL";

constexpr char kHzbDepthWgsl[] = R"WGSL(
@group(0) @binding(0) var depthSrc: texture_depth_2d;
@group(0) @binding(1) var hzbOut: texture_storage_2d<r32float, write>;

@compute @workgroup_size(8, 8)
fn hzbFromDepth(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(hzbOut);
  if (id.x >= dims.x || id.y >= dims.y) {
    return;
  }
  let src = textureDimensions(depthSrc);
  var depth = 1.0;
  if (id.x < src.x && id.y < src.y) {
    depth = textureLoad(depthSrc, vec2i(id.xy), 0);
  }
  textureStore(hzbOut, vec2i(id.xy), vec4f(depth, 0.0, 0.0, 0.0));
}
)WGSL";

constexpr char kHzbReduceWgsl[] = R"WGSL(
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var hzbOut: texture_storage_2d<r32float, write>;

@compute @workgroup_size(8, 8)
fn hzbReduce(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(hzbOut);
  if (id.x >= dims.x || id.y >= dims.y) {
    return;
  }
  let most = textureDimensions(src) - vec2u(1u);
  let a = min(id.xy * 2u, most);
  let b = min(id.xy * 2u + vec2u(1u), most);
  let v = max(
    max(textureLoad(src, vec2i(a), 0).r, textureLoad(src, vec2i(vec2u(b.x, a.y)), 0).r),
    max(textureLoad(src, vec2i(vec2u(a.x, b.y)), 0).r, textureLoad(src, vec2i(b), 0).r));
  textureStore(hzbOut, vec2i(id.xy), vec4f(v, 0.0, 0.0, 0.0));
}
)WGSL";

constexpr char kIdWgsl[] = R"WGSL(
struct Camera {
  planes: array<vec4f, 6>,
  viewProj: mat4x4f,
  eye: vec4f,
  counts: vec4u,
  classRadius: vec4f,
  classMaterial: vec4u,
};

struct ModelParams {
  clustersPerSlot: u32,
  verticesPerSlot: u32,
  indicesPerSlot: u32,
  vertexWords: u32,
  width: u32,
  height: u32,
  levels: u32,
  occlusion: u32,
  total: u32,
  slots: u32,
  hzbWidth: u32,
  hzbHeight: u32,
};

@group(0) @binding(0) var<uniform> cam: Camera;
@group(0) @binding(1) var<storage, read> clusters: array<u32>;
@group(0) @binding(2) var<storage, read> vertices: array<u32>;
@group(0) @binding(3) var<storage, read> indices: array<u32>;
@group(0) @binding(4) var<storage, read> visible: array<u32>;
@group(0) @binding(5) var<uniform> params: ModelParams;
@group(0) @binding(6) var<storage, read> modelRel: array<vec4f>;

struct IdOut {
  @builtin(position) clip: vec4f,
  @location(0) @interpolate(flat) id: u32,
};

fn clipOf(p: vec4f) -> vec4f {
  return vec4f(p.xy, (p.z + p.w) * 0.5, p.w);
}

@vertex
fn vsId(@builtin(vertex_index) vi: u32) -> IdOut {
  let gid = visible[vi / 384u];
  let j = vi % 384u;
  let slot = gid / params.clustersPerSlot;
  let base = gid * 6u;
  let firstIndex = clusters[base + 4u];
  let indexCount = clusters[base + 5u];
  let within = select(0u, j, j < indexCount);
  let corner = indices[slot * params.indicesPerSlot + firstIndex + within];
  let at = (slot * params.verticesPerSlot + corner) * params.vertexWords;
  let p = vec3f(bitcast<f32>(vertices[at]), bitcast<f32>(vertices[at + 1u]), bitcast<f32>(vertices[at + 2u]));
  let world = p * 2.0 + modelRel[slot].xyz;
  var out: IdOut;
  out.clip = clipOf(cam.viewProj * vec4f(world, 1.0));
  out.id = ((gid << 7u) | ((j % 384u) / 3u)) + 1u;
  return out;
}

@fragment
fn fsId(vin: IdOut) -> @location(0) u32 {
  return vin.id;
}
)WGSL";

constexpr char kResolveWgsl[] = R"WGSL(
struct Camera {
  planes: array<vec4f, 6>,
  viewProj: mat4x4f,
  eye: vec4f,
  counts: vec4u,
  classRadius: vec4f,
  classMaterial: vec4u,
};

struct ModelParams {
  clustersPerSlot: u32,
  verticesPerSlot: u32,
  indicesPerSlot: u32,
  vertexWords: u32,
  width: u32,
  height: u32,
  levels: u32,
  occlusion: u32,
  total: u32,
  slots: u32,
  hzbWidth: u32,
  hzbHeight: u32,
};

@group(0) @binding(0) var<uniform> cam: Camera;
@group(0) @binding(1) var<storage, read> clusters: array<u32>;
@group(0) @binding(2) var<storage, read> vertices: array<u32>;
@group(0) @binding(3) var<storage, read> indices: array<u32>;
@group(0) @binding(4) var<uniform> params: ModelParams;
@group(0) @binding(5) var ids: texture_2d<u32>;
@group(0) @binding(6) var<storage, read> modelRel: array<vec4f>;

fn clipOf(p: vec4f) -> vec4f {
  return vec4f(p.xy, (p.z + p.w) * 0.5, p.w);
}

fn cross2(a: vec2f, b: vec2f) -> f32 {
  return a.x * b.y - a.y * b.x;
}

@vertex
fn vsFull(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  let x = f32((vi << 1u) & 2u);
  let y = f32(vi & 2u);
  return vec4f(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
}

@fragment
fn fsResolve(@builtin(position) frag: vec4f) -> @location(0) vec4f {
  let id = textureLoad(ids, vec2i(frag.xy), 0).r;
  if (id == 0u) {
    return vec4f(0.05, 0.07, 0.10, 1.0);
  }
  let v = id - 1u;
  let gid = v >> 7u;
  let tri = v & 127u;
  let slot = gid / params.clustersPerSlot;
  let firstIndex = clusters[gid * 6u + 4u];
  var clip: array<vec4f, 3>;
  var height: array<f32, 3>;
  for (var k = 0u; k < 3u; k = k + 1u) {
    let corner = indices[slot * params.indicesPerSlot + firstIndex + tri * 3u + k];
    let at = (slot * params.verticesPerSlot + corner) * params.vertexWords;
    let p = vec3f(bitcast<f32>(vertices[at]), bitcast<f32>(vertices[at + 1u]), bitcast<f32>(vertices[at + 2u]));
    height[k] = p.y;
    clip[k] = clipOf(cam.viewProj * vec4f(p * 2.0 + modelRel[slot].xyz, 1.0));
  }
  let pixel = vec2f(frag.x / f32(params.width) * 2.0 - 1.0, 1.0 - frag.y / f32(params.height) * 2.0);
  let n0 = clip[0].xy / clip[0].w;
  let n1 = clip[1].xy / clip[1].w;
  let n2 = clip[2].xy / clip[2].w;
  let area = cross2(n1 - n0, n2 - n0);
  let p0 = n0 - pixel;
  let p1 = n1 - pixel;
  let p2 = n2 - pixel;
  var weight = vec3f(cross2(p1, p2), cross2(p2, p0), cross2(p0, p1)) / area;
  weight = weight / vec3f(clip[0].w, clip[1].w, clip[2].w);
  weight = weight / (weight.x + weight.y + weight.z);
  let shade = dot(weight, vec3f(0.5 + 0.5 * height[0], 0.5 + 0.5 * height[1], 0.5 + 0.5 * height[2]));
  return vec4f(shade, 0.6, 0.9, 1.0);
}
)WGSL";

constexpr char kTerrainWgsl[] = R"WGSL(
struct Camera {
  planes: array<vec4f, 6>,
  viewProj: mat4x4f,
  eye: vec4f,
  counts: vec4u,
  classRadius: vec4f,
  classMaterial: vec4u,
};

@group(0) @binding(0) var<uniform> cam: Camera;
@group(0) @binding(1) var<storage, read> pages: array<u32>;
@group(0) @binding(2) var heights: texture_2d_array<f32>;

struct TerrainOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
  @location(1) normal: vec3f,
};

fn pageF(i: u32) -> f32 {
  return bitcast<f32>(pages[i]);
}

fn clipOf(p: vec4f) -> vec4f {
  return vec4f(p.xy, (p.z + p.w) * 0.5, p.w);
}

@vertex
fn vsTerrain(@builtin(vertex_index) vid: u32, @builtin(instance_index) iid: u32) -> TerrainOut {
  let base = iid * 16u;
  let layer = pages[base];
  let origin = vec3f(pageF(base + 4u), pageF(base + 5u), pageF(base + 6u));
  let uEdge = vec3f(pageF(base + 8u), pageF(base + 9u), pageF(base + 10u));
  let vEdge = vec3f(pageF(base + 12u), pageF(base + 13u), pageF(base + 14u));
  let quad = vid / 6u;
  let k = vid % 6u;
  let cx = quad % 15u;
  let cy = quad / 15u;
  let du = select(0u, 1u, k == 1u || k == 2u || k == 4u);
  let dv = select(0u, 1u, k == 2u || k == 4u || k == 5u);
  let gi = cx + du;
  let gj = cy + dv;
  let h = textureLoad(heights, vec2i(i32(gi), i32(gj)), i32(layer), 0).r;
  let normal = normalize(cross(uEdge, vEdge));
  let world = origin + uEdge * (f32(gi) / 15.0) + vEdge * (f32(gj) / 15.0) + normal * h;
  var out: TerrainOut;
  out.clip = clipOf(cam.viewProj * vec4f(world, 1.0));
  out.world = world;
  out.normal = normal;
  return out;
}

@fragment
fn fsTerrain(vin: TerrainOut) -> @location(0) vec4f {
  let sun = normalize(vec3f(0.4, 1.0, 0.3));
  let lit = 0.25 + 0.75 * max(dot(normalize(vin.normal), sun), 0.0);
  return vec4f(vec3f(0.36, 0.5, 0.28) * lit, 1.0);
}
)WGSL";

constexpr std::uint32_t kPropBindings = 5;
constexpr std::uint32_t kVegBindings = 6;
constexpr std::uint64_t kVegOriginStride = 256;
constexpr std::uint32_t kTerrainBindings = 3;
constexpr std::uint32_t kModelBindings = 2;
constexpr std::uint32_t kModelRelSlots = 64;
constexpr std::uint32_t kCullBindings = 10;
constexpr std::uint32_t kIdBindings = 7;
constexpr std::uint32_t kResolveBindings = 7;
constexpr std::uint32_t kMaxLevels = 16;
constexpr std::uint32_t kReadyWords = 256;
constexpr std::uint32_t kParamWords = 12;
constexpr std::uint32_t kWorkgroupLanes = 64;
constexpr std::uint32_t kTileSide = 8;
constexpr std::uint64_t kParamBytes = kParamWords * 4;
constexpr std::uint64_t kVisArgsBytes = 32;
constexpr std::uint64_t kCounterBytes = 16;
constexpr double kClearRed = 0.05;
constexpr double kClearGreen = 0.07;
constexpr double kClearBlue = 0.10;
constexpr std::uint64_t kCameraBytes = sizeof(Camera);
std::uint64_t bodyBytes = 0;
constexpr std::uint64_t kLightBytes = static_cast<std::uint64_t>(kLightSlots) * engine::render::kLightBytes;
constexpr std::uint64_t kMaterialBytes = static_cast<std::uint64_t>(kMaterialSlots) * engine::render::kMaterialBytes;
constexpr std::uint64_t kPageBytes = static_cast<std::uint64_t>(kMaxPageLayers) * kPageRecordBytes;
constexpr std::uint64_t kArgsBytes = static_cast<std::uint64_t>(kArgsWords) * 4;
constexpr std::uint32_t kZeroCounters[4] = {0, 0, 0, 0};

std::uint8_t whitePixels[kAlbedoBytes];

wgpu::Device device;
wgpu::Queue queue;
wgpu::Surface surface;
wgpu::Buffer cameraBuf;
wgpu::Buffer argsBuf;
wgpu::Buffer lightBuf;
wgpu::Buffer materialBuf;
wgpu::Buffer pageBuf;
wgpu::Buffer instanceBuf[kPropClasses];
wgpu::Texture heightTex;
wgpu::Texture albedoTex;
wgpu::Texture depthTex;
wgpu::TextureView heightView;
wgpu::TextureView albedoView;
wgpu::TextureView depthView;
wgpu::TextureView depthOnlyView;
wgpu::RenderPipeline propPipe;
wgpu::RenderPipeline terrainPipe;
wgpu::RenderPipeline modelPipe;
wgpu::BindGroup modelGroup;
wgpu::Buffer modelVertexBuf;
wgpu::Buffer modelIndexBuf;
engine::models::Range modelRuns[engine::models::kMaxClustersPerSlot];
wgpu::BindGroup propGroup[kPropClasses];
wgpu::RenderPipeline vegPipe;
wgpu::BindGroupLayout vegLayout;
wgpu::Buffer vegBuf[engine::render::vegetation::kMaxSpecies];
wgpu::Buffer vegOriginBuf;
wgpu::Buffer modelRelBuf;
wgpu::BindGroup vegGroup[engine::render::vegetation::kMaxSpecies * engine::render::vegetation::kMaxSlots];
bool vegReady = false;
engine::render::vegetation::Draw vegDraws[engine::render::vegetation::kMaxSpecies * engine::render::vegetation::kMaxSlots];
std::uint32_t vegDrawCount = 0;
wgpu::BindGroup terrainGroup;
wgpu::TextureFormat surfaceFormat = wgpu::TextureFormat::BGRA8Unorm;
bool ready = false;

wgpu::Texture idTex;
wgpu::TextureView idView;
wgpu::Texture hzbTex;
wgpu::TextureView hzbAllView;
wgpu::TextureView hzbLevelView[kMaxLevels];
wgpu::Buffer clusterBuf;
wgpu::Buffer slotReadyBuf;
wgpu::Buffer listBuf[3];
wgpu::Buffer counterBuf;
wgpu::Buffer cullStaging;
bool cullCopied = false;
bool cullPending = false;
wgpu::Buffer visArgsBuf;
wgpu::Buffer paramBuf;
wgpu::RenderPipeline idPipe;
wgpu::RenderPipeline resolvePipe;
wgpu::ComputePipeline cullPipe[2];
wgpu::ComputePipeline finalizePipe;
wgpu::ComputePipeline hzbDepthPipe;
wgpu::ComputePipeline hzbReducePipe;
wgpu::BindGroup cullGroup;
wgpu::BindGroup finalizeGroup;
wgpu::BindGroup hzbDepthGroup;
wgpu::BindGroup hzbReduceGroup[kMaxLevels];
wgpu::BindGroup idGroup[2];
wgpu::BindGroup resolveGroup;
std::uint32_t surfaceWidth = 0;
std::uint32_t surfaceHeight = 0;
std::uint32_t hzbLevels = 0;
std::uint32_t hzbWidth = 0;
std::uint32_t hzbHeight = 0;
std::uint32_t visSlots = 0;
std::uint32_t visStride = 0;
std::uint32_t visTotal = 0;
bool visibilityReady = false;
bool hzbValid = false;
std::uint32_t readyWords[kReadyWords];
std::uint32_t paramWords[kParamWords];

wgpu::Buffer makeBuffer(std::uint64_t size, wgpu::BufferUsage usage) {
  wgpu::BufferDescriptor desc{};
  desc.size = size;
  desc.usage = usage;
  return device.CreateBuffer(&desc);
}

wgpu::Texture makeTexture(std::uint32_t width, std::uint32_t height, std::uint32_t layers, wgpu::TextureFormat format, wgpu::TextureUsage usage) {
  wgpu::TextureDescriptor desc{};
  desc.size = wgpu::Extent3D{width, height, layers};
  desc.format = format;
  desc.usage = usage;
  desc.dimension = wgpu::TextureDimension::e2D;
  return device.CreateTexture(&desc);
}

wgpu::TextureView makeArrayView(wgpu::Texture texture, std::uint32_t layers) {
  wgpu::TextureViewDescriptor desc{};
  desc.dimension = wgpu::TextureViewDimension::e2DArray;
  desc.arrayLayerCount = layers;
  return texture.CreateView(&desc);
}

wgpu::ShaderModule makeModule(const char* code) {
  wgpu::ShaderModuleWGSLDescriptor source{};
  source.code = code;
  wgpu::ShaderModuleDescriptor desc{};
  desc.nextInChain = &source;
  return device.CreateShaderModule(&desc);
}

wgpu::BindGroupLayoutEntry bufferEntry(std::uint32_t binding, wgpu::ShaderStage visibility, wgpu::BufferBindingType type) {
  wgpu::BindGroupLayoutEntry entry{};
  entry.binding = binding;
  entry.visibility = visibility;
  entry.buffer.type = type;
  return entry;
}

wgpu::BindGroupLayoutEntry arrayTextureEntry(std::uint32_t binding, wgpu::ShaderStage visibility, wgpu::TextureSampleType sample) {
  wgpu::BindGroupLayoutEntry entry{};
  entry.binding = binding;
  entry.visibility = visibility;
  entry.texture.sampleType = sample;
  entry.texture.viewDimension = wgpu::TextureViewDimension::e2DArray;
  return entry;
}

wgpu::BindGroupLayoutEntry textureEntry(std::uint32_t binding, wgpu::ShaderStage visibility, wgpu::TextureSampleType sample) {
  wgpu::BindGroupLayoutEntry entry{};
  entry.binding = binding;
  entry.visibility = visibility;
  entry.texture.sampleType = sample;
  entry.texture.viewDimension = wgpu::TextureViewDimension::e2D;
  return entry;
}

wgpu::BindGroupLayoutEntry storageTextureEntry(std::uint32_t binding, wgpu::ShaderStage visibility) {
  wgpu::BindGroupLayoutEntry entry{};
  entry.binding = binding;
  entry.visibility = visibility;
  entry.storageTexture.access = wgpu::StorageTextureAccess::WriteOnly;
  entry.storageTexture.format = wgpu::TextureFormat::R32Float;
  entry.storageTexture.viewDimension = wgpu::TextureViewDimension::e2D;
  return entry;
}

wgpu::BindGroupLayout makeLayout(const wgpu::BindGroupLayoutEntry* entries, std::uint32_t count) {
  wgpu::BindGroupLayoutDescriptor desc{};
  desc.entryCount = count;
  desc.entries = entries;
  return device.CreateBindGroupLayout(&desc);
}

wgpu::PipelineLayout makePipelineLayout(wgpu::BindGroupLayout layout) {
  wgpu::PipelineLayoutDescriptor desc{};
  desc.bindGroupLayoutCount = 1;
  desc.bindGroupLayouts = &layout;
  return device.CreatePipelineLayout(&desc);
}

wgpu::BindGroupEntry bufferBinding(std::uint32_t binding, wgpu::Buffer buffer, std::uint64_t size) {
  wgpu::BindGroupEntry entry{};
  entry.binding = binding;
  entry.buffer = buffer;
  entry.offset = 0;
  entry.size = size;
  return entry;
}

wgpu::BindGroupEntry bufferBindingAt(std::uint32_t binding, wgpu::Buffer buffer, std::uint64_t offset, std::uint64_t size) {
  wgpu::BindGroupEntry entry{};
  entry.binding = binding;
  entry.buffer = buffer;
  entry.offset = offset;
  entry.size = size;
  return entry;
}

wgpu::BindGroupEntry viewBinding(std::uint32_t binding, wgpu::TextureView view) {
  wgpu::BindGroupEntry entry{};
  entry.binding = binding;
  entry.textureView = view;
  return entry;
}

wgpu::BindGroup makeGroup(wgpu::BindGroupLayout layout, const wgpu::BindGroupEntry* entries, std::uint32_t count) {
  wgpu::BindGroupDescriptor desc{};
  desc.layout = layout;
  desc.entryCount = count;
  desc.entries = entries;
  return device.CreateBindGroup(&desc);
}

wgpu::ComputePipeline makeCompute(wgpu::PipelineLayout layout, wgpu::ShaderModule module, const char* entry) {
  wgpu::ComputePipelineDescriptor desc{};
  desc.layout = layout;
  desc.compute.module = module;
  desc.compute.entryPoint = entry;
  return device.CreateComputePipeline(&desc);
}

void writeBuffer(wgpu::Buffer buffer, std::uint64_t offset, const void* data, std::uint64_t size) {
  ENGINE_RENDER_CALL(queue.WriteBuffer(buffer, offset, data, size));
}

void writeLayers(wgpu::Texture texture, std::uint32_t firstLayer, std::uint32_t layers, const void* pixels, std::uint32_t side, std::uint32_t bytesPerTexel) {
  wgpu::TexelCopyTextureInfo destination{};
  destination.texture = texture;
  destination.origin = wgpu::Origin3D{0, 0, firstLayer};
  wgpu::TexelCopyBufferLayout layout{};
  layout.bytesPerRow = side * bytesPerTexel;
  layout.rowsPerImage = side;
  const wgpu::Extent3D size{side, side, layers};
  const std::size_t bytes = static_cast<std::size_t>(side) * side * bytesPerTexel * layers;
  ENGINE_RENDER_CALL(queue.WriteTexture(&destination, pixels, bytes, &layout, &size));
}

std::uint32_t levelsFor(std::uint32_t width, std::uint32_t height) {
  std::uint32_t side = width > height ? width : height;
  std::uint32_t levels = 1;
  while (side > 1) {
    side = (side + 1) / 2;
    levels += 1;
  }
  return levels;
}

std::uint32_t powerOfTwoAtLeast(std::uint32_t value) {
  std::uint32_t size = 1;
  while (size < value) size <<= 1;
  return size;
}

int buildPipelines() {
  wgpu::ShaderModule propModule = makeModule(kPropWgsl);
  wgpu::ShaderModule terrainModule = makeModule(kTerrainWgsl);
  if (!propModule || !terrainModule) return engine::kNotConfigured;

  const wgpu::ShaderStage vertexFragment = wgpu::ShaderStage::Vertex | wgpu::ShaderStage::Fragment;
  const wgpu::ShaderStage vertex = wgpu::ShaderStage::Vertex;
  const wgpu::ShaderStage fragment = wgpu::ShaderStage::Fragment;
  wgpu::BindGroupLayoutEntry propEntries[kPropBindings];
  propEntries[0] = bufferEntry(0, vertexFragment, wgpu::BufferBindingType::Uniform);
  propEntries[1] = bufferEntry(1, vertex, wgpu::BufferBindingType::ReadOnlyStorage);
  propEntries[2] = bufferEntry(2, fragment, wgpu::BufferBindingType::ReadOnlyStorage);
  propEntries[3] = bufferEntry(3, fragment, wgpu::BufferBindingType::ReadOnlyStorage);
  propEntries[4] = arrayTextureEntry(4, fragment, wgpu::TextureSampleType::UnfilterableFloat);
  wgpu::BindGroupLayout propLayout = makeLayout(propEntries, kPropBindings);
  wgpu::PipelineLayout propPipeLayout = makePipelineLayout(propLayout);

  wgpu::ColorTargetState colour{};
  colour.format = surfaceFormat;
  wgpu::FragmentState propFragment{};
  propFragment.module = propModule;
  propFragment.entryPoint = "fsProps";
  propFragment.targetCount = 1;
  propFragment.targets = &colour;
  wgpu::DepthStencilState depth{};
  depth.format = wgpu::TextureFormat::Depth32Float;
  depth.depthWriteEnabled = true;
  depth.depthCompare = wgpu::CompareFunction::Less;

  wgpu::RenderPipelineDescriptor propDesc{};
  propDesc.layout = propPipeLayout;
  propDesc.vertex.module = propModule;
  propDesc.vertex.entryPoint = "vsProps";
  propDesc.fragment = &propFragment;
  propDesc.depthStencil = &depth;
  propDesc.primitive.topology = wgpu::PrimitiveTopology::TriangleList;
  propDesc.primitive.cullMode = wgpu::CullMode::None;
  propPipe = device.CreateRenderPipeline(&propDesc);

  wgpu::ShaderModule vegModule = makeModule(kVegWgsl);
  if (!vegModule) return engine::kNotConfigured;
  wgpu::BindGroupLayoutEntry vegEntries[kVegBindings];
  vegEntries[0] = bufferEntry(0, vertexFragment, wgpu::BufferBindingType::Uniform);
  vegEntries[1] = bufferEntry(1, vertex, wgpu::BufferBindingType::ReadOnlyStorage);
  vegEntries[2] = bufferEntry(2, fragment, wgpu::BufferBindingType::ReadOnlyStorage);
  vegEntries[3] = bufferEntry(3, fragment, wgpu::BufferBindingType::ReadOnlyStorage);
  vegEntries[4] = arrayTextureEntry(4, fragment, wgpu::TextureSampleType::UnfilterableFloat);
  vegEntries[5] = bufferEntry(5, vertex, wgpu::BufferBindingType::ReadOnlyStorage);
  vegLayout = makeLayout(vegEntries, kVegBindings);
  wgpu::PipelineLayout vegPipeLayout = makePipelineLayout(vegLayout);

  wgpu::FragmentState vegFragment{};
  vegFragment.module = vegModule;
  vegFragment.entryPoint = "fsVeg";
  vegFragment.targetCount = 1;
  vegFragment.targets = &colour;
  wgpu::RenderPipelineDescriptor vegDesc{};
  vegDesc.layout = vegPipeLayout;
  vegDesc.vertex.module = vegModule;
  vegDesc.vertex.entryPoint = "vsVeg";
  vegDesc.fragment = &vegFragment;
  vegDesc.depthStencil = &depth;
  vegDesc.primitive.topology = wgpu::PrimitiveTopology::TriangleList;
  vegDesc.primitive.cullMode = wgpu::CullMode::None;
  vegPipe = device.CreateRenderPipeline(&vegDesc);
  if (!vegPipe) return engine::kNotConfigured;

  wgpu::BindGroupLayoutEntry terrainEntries[kTerrainBindings];
  terrainEntries[0] = bufferEntry(0, vertex, wgpu::BufferBindingType::Uniform);
  terrainEntries[1] = bufferEntry(1, vertex, wgpu::BufferBindingType::ReadOnlyStorage);
  terrainEntries[2] = arrayTextureEntry(2, vertex, wgpu::TextureSampleType::UnfilterableFloat);
  wgpu::BindGroupLayout terrainLayout = makeLayout(terrainEntries, kTerrainBindings);
  wgpu::PipelineLayout terrainPipeLayout = makePipelineLayout(terrainLayout);

  wgpu::ColorTargetState terrainColour{};
  terrainColour.format = surfaceFormat;
  wgpu::FragmentState terrainFragment{};
  terrainFragment.module = terrainModule;
  terrainFragment.entryPoint = "fsTerrain";
  terrainFragment.targetCount = 1;
  terrainFragment.targets = &terrainColour;

  wgpu::RenderPipelineDescriptor terrainDesc{};
  terrainDesc.layout = terrainPipeLayout;
  terrainDesc.vertex.module = terrainModule;
  terrainDesc.vertex.entryPoint = "vsTerrain";
  terrainDesc.fragment = &terrainFragment;
  terrainDesc.depthStencil = &depth;
  terrainDesc.primitive.topology = wgpu::PrimitiveTopology::TriangleList;
  terrainDesc.primitive.cullMode = wgpu::CullMode::None;
  terrainPipe = device.CreateRenderPipeline(&terrainDesc);

  if (engine::models::bound()) {
    wgpu::ShaderModule modelModule = makeModule(kModelWgsl);
    wgpu::BindGroupLayoutEntry modelEntries[kModelBindings];
    modelEntries[0] = bufferEntry(0, vertex, wgpu::BufferBindingType::Uniform);
    modelEntries[1] = bufferEntry(1, vertex, wgpu::BufferBindingType::ReadOnlyStorage);
    wgpu::BindGroupLayout modelLayout = makeLayout(modelEntries, kModelBindings);
    wgpu::PipelineLayout modelPipeLayout = makePipelineLayout(modelLayout);

    wgpu::VertexAttribute position{};
    position.format = wgpu::VertexFormat::Float32x3;
    position.offset = 0;
    position.shaderLocation = 0;
    wgpu::VertexBufferLayout vertexLayout{};
    vertexLayout.arrayStride = engine::models::layout().vertexStrideBytes;
    vertexLayout.stepMode = wgpu::VertexStepMode::Vertex;
    vertexLayout.attributeCount = 1;
    vertexLayout.attributes = &position;

    wgpu::ColorTargetState modelColour{};
    modelColour.format = surfaceFormat;
    wgpu::FragmentState modelFragment{};
    modelFragment.module = modelModule;
    modelFragment.entryPoint = "fsModel";
    modelFragment.targetCount = 1;
    modelFragment.targets = &modelColour;

    wgpu::RenderPipelineDescriptor modelDesc{};
    modelDesc.layout = modelPipeLayout;
    modelDesc.vertex.module = modelModule;
    modelDesc.vertex.entryPoint = "vsModel";
    modelDesc.vertex.bufferCount = 1;
    modelDesc.vertex.buffers = &vertexLayout;
    modelDesc.fragment = &modelFragment;
    modelDesc.depthStencil = &depth;
    modelDesc.primitive.topology = wgpu::PrimitiveTopology::TriangleList;
    modelDesc.primitive.cullMode = wgpu::CullMode::None;
    modelPipe = device.CreateRenderPipeline(&modelDesc);

    modelRelBuf = makeBuffer(static_cast<std::uint64_t>(kModelRelSlots) * 16, wgpu::BufferUsage::Storage | wgpu::BufferUsage::CopyDst);
    wgpu::BindGroupEntry modelBindings[kModelBindings];
    modelBindings[0] = bufferBinding(0, cameraBuf, kCameraBytes);
    modelBindings[1] = bufferBinding(1, modelRelBuf, static_cast<std::uint64_t>(kModelRelSlots) * 16);
    modelGroup = makeGroup(modelLayout, modelBindings, kModelBindings);
    if (!modelPipe || !modelGroup) return engine::kNotConfigured;
  }

  if (!propPipe || !terrainPipe) return engine::kNotConfigured;

  for (std::uint32_t c = 0; c < kPropClasses; ++c) {
    wgpu::BindGroupEntry propBindings[kPropBindings];
    propBindings[0] = bufferBinding(0, cameraBuf, kCameraBytes);
    propBindings[1] = bufferBinding(1, instanceBuf[c], bodyBytes);
    propBindings[2] = bufferBinding(2, materialBuf, kMaterialBytes);
    propBindings[3] = bufferBinding(3, lightBuf, kLightBytes);
    propBindings[4] = viewBinding(4, albedoView);
    propGroup[c] = makeGroup(propLayout, propBindings, kPropBindings);
  }

  wgpu::BindGroupEntry terrainBindings[kTerrainBindings];
  terrainBindings[0] = bufferBinding(0, cameraBuf, kCameraBytes);
  terrainBindings[1] = bufferBinding(1, pageBuf, kPageBytes);
  terrainBindings[2] = viewBinding(2, heightView);
  terrainGroup = makeGroup(terrainLayout, terrainBindings, kTerrainBindings);

  return (propGroup[0] && terrainGroup) ? engine::kOk : engine::kNotConfigured;
}

bool buildVisibility(std::uint32_t width, std::uint32_t height) {
  const std::uint32_t slots = engine::models::slotCount();
  const std::uint32_t stride = engine::models::clusterStride();
  if (!engine::models::bound() || slots == 0 || slots > kReadyWords || stride == 0) return false;
  hzbWidth = powerOfTwoAtLeast(width);
  hzbHeight = powerOfTwoAtLeast(height);
  hzbLevels = levelsFor(hzbWidth, hzbHeight);
  if (hzbLevels > kMaxLevels) return false;
  surfaceWidth = width;
  surfaceHeight = height;
  visSlots = slots;
  visStride = stride;
  visTotal = slots * stride;

  clusterBuf = makeBuffer(engine::models::clusterPoolBytes(), wgpu::BufferUsage::Storage | wgpu::BufferUsage::CopyDst);
  slotReadyBuf = makeBuffer(kReadyWords * 4, wgpu::BufferUsage::Storage | wgpu::BufferUsage::CopyDst);
  for (std::uint32_t i = 0; i < 3; ++i) {
    listBuf[i] = makeBuffer(static_cast<std::uint64_t>(visTotal) * 4, wgpu::BufferUsage::Storage | wgpu::BufferUsage::CopyDst);
  }
  counterBuf = makeBuffer(kCounterBytes, wgpu::BufferUsage::Storage | wgpu::BufferUsage::CopyDst | wgpu::BufferUsage::CopySrc);
  cullStaging = makeBuffer(kCounterBytes, wgpu::BufferUsage::MapRead | wgpu::BufferUsage::CopyDst);
  visArgsBuf = makeBuffer(kVisArgsBytes, wgpu::BufferUsage::Storage | wgpu::BufferUsage::Indirect | wgpu::BufferUsage::CopyDst);
  paramBuf = makeBuffer(kParamBytes, wgpu::BufferUsage::Uniform | wgpu::BufferUsage::CopyDst);

  idTex = makeTexture(width, height, 1, wgpu::TextureFormat::R32Uint, wgpu::TextureUsage::RenderAttachment | wgpu::TextureUsage::TextureBinding);
  idView = idTex.CreateView();

  wgpu::TextureDescriptor hzbDesc{};
  hzbDesc.size = wgpu::Extent3D{hzbWidth, hzbHeight, 1};
  hzbDesc.format = wgpu::TextureFormat::R32Float;
  hzbDesc.mipLevelCount = hzbLevels;
  hzbDesc.usage = wgpu::TextureUsage::TextureBinding | wgpu::TextureUsage::StorageBinding;
  hzbDesc.dimension = wgpu::TextureDimension::e2D;
  hzbTex = device.CreateTexture(&hzbDesc);
  wgpu::TextureViewDescriptor allDesc{};
  allDesc.dimension = wgpu::TextureViewDimension::e2D;
  allDesc.mipLevelCount = hzbLevels;
  hzbAllView = hzbTex.CreateView(&allDesc);
  for (std::uint32_t l = 0; l < hzbLevels; ++l) {
    wgpu::TextureViewDescriptor levelDesc{};
    levelDesc.dimension = wgpu::TextureViewDimension::e2D;
    levelDesc.baseMipLevel = l;
    levelDesc.mipLevelCount = 1;
    hzbLevelView[l] = hzbTex.CreateView(&levelDesc);
  }

  const wgpu::ShaderStage compute = wgpu::ShaderStage::Compute;
  const wgpu::ShaderStage vertex = wgpu::ShaderStage::Vertex;
  const wgpu::ShaderStage fragment = wgpu::ShaderStage::Fragment;

  wgpu::BindGroupLayoutEntry cullEntries[kCullBindings];
  cullEntries[0] = bufferEntry(0, compute, wgpu::BufferBindingType::Uniform);
  cullEntries[1] = bufferEntry(1, compute, wgpu::BufferBindingType::ReadOnlyStorage);
  cullEntries[2] = bufferEntry(2, compute, wgpu::BufferBindingType::ReadOnlyStorage);
  cullEntries[3] = bufferEntry(3, compute, wgpu::BufferBindingType::Storage);
  cullEntries[4] = bufferEntry(4, compute, wgpu::BufferBindingType::Storage);
  cullEntries[5] = bufferEntry(5, compute, wgpu::BufferBindingType::Storage);
  cullEntries[6] = bufferEntry(6, compute, wgpu::BufferBindingType::Storage);
  cullEntries[7] = bufferEntry(7, compute, wgpu::BufferBindingType::Uniform);
  cullEntries[8] = textureEntry(8, compute, wgpu::TextureSampleType::UnfilterableFloat);
  cullEntries[9] = bufferEntry(9, compute, wgpu::BufferBindingType::ReadOnlyStorage);
  wgpu::BindGroupLayout cullLayout = makeLayout(cullEntries, kCullBindings);
  wgpu::PipelineLayout cullPipeLayout = makePipelineLayout(cullLayout);
  wgpu::ShaderModule cullModule = makeModule(kCullWgsl);
  cullPipe[0] = makeCompute(cullPipeLayout, cullModule, "cullA");
  cullPipe[1] = makeCompute(cullPipeLayout, cullModule, "cullB");

  wgpu::BindGroupLayoutEntry finalizeEntries[2];
  finalizeEntries[0] = bufferEntry(0, compute, wgpu::BufferBindingType::Storage);
  finalizeEntries[1] = bufferEntry(1, compute, wgpu::BufferBindingType::Storage);
  wgpu::BindGroupLayout finalizeLayout = makeLayout(finalizeEntries, 2);
  finalizePipe = makeCompute(makePipelineLayout(finalizeLayout), makeModule(kFinalizeWgsl), "finalize");

  wgpu::BindGroupLayoutEntry depthEntries[2];
  depthEntries[0] = textureEntry(0, compute, wgpu::TextureSampleType::Depth);
  depthEntries[1] = storageTextureEntry(1, compute);
  wgpu::BindGroupLayout depthLayout = makeLayout(depthEntries, 2);
  hzbDepthPipe = makeCompute(makePipelineLayout(depthLayout), makeModule(kHzbDepthWgsl), "hzbFromDepth");

  wgpu::BindGroupLayoutEntry reduceEntries[2];
  reduceEntries[0] = textureEntry(0, compute, wgpu::TextureSampleType::UnfilterableFloat);
  reduceEntries[1] = storageTextureEntry(1, compute);
  wgpu::BindGroupLayout reduceLayout = makeLayout(reduceEntries, 2);
  hzbReducePipe = makeCompute(makePipelineLayout(reduceLayout), makeModule(kHzbReduceWgsl), "hzbReduce");

  wgpu::BindGroupLayoutEntry idEntries[kIdBindings];
  idEntries[6] = bufferEntry(6, vertex, wgpu::BufferBindingType::ReadOnlyStorage);
  idEntries[0] = bufferEntry(0, vertex, wgpu::BufferBindingType::Uniform);
  idEntries[1] = bufferEntry(1, vertex, wgpu::BufferBindingType::ReadOnlyStorage);
  idEntries[2] = bufferEntry(2, vertex, wgpu::BufferBindingType::ReadOnlyStorage);
  idEntries[3] = bufferEntry(3, vertex, wgpu::BufferBindingType::ReadOnlyStorage);
  idEntries[4] = bufferEntry(4, vertex, wgpu::BufferBindingType::ReadOnlyStorage);
  idEntries[5] = bufferEntry(5, vertex, wgpu::BufferBindingType::Uniform);
  wgpu::BindGroupLayout idLayout = makeLayout(idEntries, kIdBindings);
  wgpu::ShaderModule idModule = makeModule(kIdWgsl);
  wgpu::ColorTargetState idColour{};
  idColour.format = wgpu::TextureFormat::R32Uint;
  wgpu::FragmentState idFragment{};
  idFragment.module = idModule;
  idFragment.entryPoint = "fsId";
  idFragment.targetCount = 1;
  idFragment.targets = &idColour;
  wgpu::RenderPipelineDescriptor idDesc{};
  idDesc.layout = makePipelineLayout(idLayout);
  idDesc.vertex.module = idModule;
  idDesc.vertex.entryPoint = "vsId";
  idDesc.fragment = &idFragment;
  wgpu::DepthStencilState depth{};
  depth.format = wgpu::TextureFormat::Depth32Float;
  depth.depthWriteEnabled = true;
  depth.depthCompare = wgpu::CompareFunction::Less;
  idDesc.depthStencil = &depth;
  idDesc.primitive.topology = wgpu::PrimitiveTopology::TriangleList;
  idDesc.primitive.cullMode = wgpu::CullMode::None;
  idPipe = device.CreateRenderPipeline(&idDesc);

  wgpu::BindGroupLayoutEntry resolveEntries[kResolveBindings];
  resolveEntries[6] = bufferEntry(6, fragment, wgpu::BufferBindingType::ReadOnlyStorage);
  resolveEntries[0] = bufferEntry(0, fragment, wgpu::BufferBindingType::Uniform);
  resolveEntries[1] = bufferEntry(1, fragment, wgpu::BufferBindingType::ReadOnlyStorage);
  resolveEntries[2] = bufferEntry(2, fragment, wgpu::BufferBindingType::ReadOnlyStorage);
  resolveEntries[3] = bufferEntry(3, fragment, wgpu::BufferBindingType::ReadOnlyStorage);
  resolveEntries[4] = bufferEntry(4, fragment, wgpu::BufferBindingType::Uniform);
  resolveEntries[5] = textureEntry(5, fragment, wgpu::TextureSampleType::Uint);
  wgpu::BindGroupLayout resolveLayout = makeLayout(resolveEntries, kResolveBindings);
  wgpu::ShaderModule resolveModule = makeModule(kResolveWgsl);
  wgpu::ColorTargetState resolveColour{};
  resolveColour.format = surfaceFormat;
  wgpu::FragmentState resolveFragment{};
  resolveFragment.module = resolveModule;
  resolveFragment.entryPoint = "fsResolve";
  resolveFragment.targetCount = 1;
  resolveFragment.targets = &resolveColour;
  wgpu::RenderPipelineDescriptor resolveDesc{};
  resolveDesc.layout = makePipelineLayout(resolveLayout);
  resolveDesc.vertex.module = resolveModule;
  resolveDesc.vertex.entryPoint = "vsFull";
  resolveDesc.fragment = &resolveFragment;
  resolveDesc.primitive.topology = wgpu::PrimitiveTopology::TriangleList;
  resolvePipe = device.CreateRenderPipeline(&resolveDesc);

  if (!cullPipe[0] || !cullPipe[1] || !finalizePipe || !hzbDepthPipe || !hzbReducePipe || !idPipe || !resolvePipe) return false;

  wgpu::BindGroupEntry cullBindings[kCullBindings];
  cullBindings[0] = bufferBinding(0, cameraBuf, kCameraBytes);
  cullBindings[1] = bufferBinding(1, clusterBuf, engine::models::clusterPoolBytes());
  cullBindings[2] = bufferBinding(2, slotReadyBuf, kReadyWords * 4);
  cullBindings[3] = bufferBinding(3, listBuf[0], static_cast<std::uint64_t>(visTotal) * 4);
  cullBindings[4] = bufferBinding(4, listBuf[1], static_cast<std::uint64_t>(visTotal) * 4);
  cullBindings[5] = bufferBinding(5, listBuf[2], static_cast<std::uint64_t>(visTotal) * 4);
  cullBindings[6] = bufferBinding(6, counterBuf, kCounterBytes);
  cullBindings[7] = bufferBinding(7, paramBuf, kParamBytes);
  cullBindings[8] = viewBinding(8, hzbAllView);
  cullBindings[9] = bufferBinding(9, modelRelBuf, static_cast<std::uint64_t>(kModelRelSlots) * 16);
  cullGroup = makeGroup(cullLayout, cullBindings, kCullBindings);

  wgpu::BindGroupEntry finalizeBindings[2];
  finalizeBindings[0] = bufferBinding(0, counterBuf, kCounterBytes);
  finalizeBindings[1] = bufferBinding(1, visArgsBuf, kVisArgsBytes);
  finalizeGroup = makeGroup(finalizeLayout, finalizeBindings, 2);

  wgpu::BindGroupEntry depthBindings[2];
  depthBindings[0] = viewBinding(0, depthOnlyView);
  depthBindings[1] = viewBinding(1, hzbLevelView[0]);
  hzbDepthGroup = makeGroup(depthLayout, depthBindings, 2);

  for (std::uint32_t l = 1; l < hzbLevels; ++l) {
    wgpu::BindGroupEntry reduceBindings[2];
    reduceBindings[0] = viewBinding(0, hzbLevelView[l - 1]);
    reduceBindings[1] = viewBinding(1, hzbLevelView[l]);
    hzbReduceGroup[l] = makeGroup(reduceLayout, reduceBindings, 2);
  }

  for (std::uint32_t pass = 0; pass < 2; ++pass) {
    wgpu::BindGroupEntry idBindings[kIdBindings];
    idBindings[0] = bufferBinding(0, cameraBuf, kCameraBytes);
    idBindings[1] = bufferBinding(1, clusterBuf, engine::models::clusterPoolBytes());
    idBindings[2] = bufferBinding(2, modelVertexBuf, engine::models::vertexPoolBytes());
    idBindings[3] = bufferBinding(3, modelIndexBuf, engine::models::indexPoolBytes());
    idBindings[4] = bufferBinding(4, listBuf[pass == 0 ? 0 : 2], static_cast<std::uint64_t>(visTotal) * 4);
    idBindings[5] = bufferBinding(5, paramBuf, kParamBytes);
    idBindings[6] = bufferBinding(6, modelRelBuf, static_cast<std::uint64_t>(kModelRelSlots) * 16);
    idGroup[pass] = makeGroup(idLayout, idBindings, kIdBindings);
  }

  wgpu::BindGroupEntry resolveBindings[kResolveBindings];
  resolveBindings[0] = bufferBinding(0, cameraBuf, kCameraBytes);
  resolveBindings[1] = bufferBinding(1, clusterBuf, engine::models::clusterPoolBytes());
  resolveBindings[2] = bufferBinding(2, modelVertexBuf, engine::models::vertexPoolBytes());
  resolveBindings[3] = bufferBinding(3, modelIndexBuf, engine::models::indexPoolBytes());
  resolveBindings[4] = bufferBinding(4, paramBuf, kParamBytes);
  resolveBindings[5] = viewBinding(5, idView);
  resolveBindings[6] = bufferBinding(6, modelRelBuf, static_cast<std::uint64_t>(kModelRelSlots) * 16);
  resolveGroup = makeGroup(resolveLayout, resolveBindings, kResolveBindings);

  for (std::uint32_t l = 1; l < hzbLevels; ++l) {
    if (!hzbReduceGroup[l]) return false;
  }
  return cullGroup && finalizeGroup && hzbDepthGroup && idGroup[0] && idGroup[1] && resolveGroup;
}

void drawProps(wgpu::RenderPassEncoder& pass) {
  ENGINE_RENDER_CALL(pass.SetPipeline(propPipe));
  for (std::uint32_t c = 0; c < kPropClasses; ++c) {
    ENGINE_RENDER_CALL(pass.SetBindGroup(0, propGroup[c]));
    ENGINE_RENDER_CALL(pass.DrawIndirect(argsBuf, (kArgsPropWord + c * 4) * 4));
  }
}

bool ensureVegetation(const engine::render::vegetation::Bound& b) {
  if (vegReady) return true;
  const std::uint64_t slotBytes = static_cast<std::uint64_t>(b.capacity) * engine::render::vegetation::kMatrixBytes;
  for (std::uint32_t sp = 0; sp < b.species; ++sp) vegBuf[sp] = makeBuffer(static_cast<std::uint64_t>(b.slots) * slotBytes, wgpu::BufferUsage::Storage | wgpu::BufferUsage::CopyDst);
  vegOriginBuf = makeBuffer(static_cast<std::uint64_t>(b.slots) * kVegOriginStride, wgpu::BufferUsage::Storage | wgpu::BufferUsage::CopyDst);
  for (std::uint32_t sp = 0; sp < b.species; ++sp) {
    for (std::uint32_t slot = 0; slot < b.slots; ++slot) {
      wgpu::BindGroupEntry vegBindings[kVegBindings];
      vegBindings[0] = bufferBinding(0, cameraBuf, kCameraBytes);
      vegBindings[1] = bufferBinding(1, vegBuf[sp], static_cast<std::uint64_t>(b.slots) * slotBytes);
      vegBindings[2] = bufferBinding(2, materialBuf, kMaterialBytes);
      vegBindings[3] = bufferBinding(3, lightBuf, kLightBytes);
      vegBindings[4] = viewBinding(4, albedoView);
      vegBindings[5] = bufferBindingAt(5, vegOriginBuf, static_cast<std::uint64_t>(slot) * kVegOriginStride, 16);
      vegGroup[engine::render::vegetation::indexOf(b, sp, slot)] = makeGroup(vegLayout, vegBindings, kVegBindings);
      if (!vegGroup[engine::render::vegetation::indexOf(b, sp, slot)]) return false;
    }
  }
  vegReady = true;
  return true;
}

void uploadVegetation(const Camera& camera, const engine::render::FrameOrigin& origin) {
  namespace veg = engine::render::vegetation;
  vegDrawCount = 0;
  veg::Bound& b = veg::state();
  if (!veg::bound() || !ensureVegetation(b)) return;
  const double frameOrigin[3] = {origin.x, origin.y, origin.z};
  static veg::Upload uploads[veg::kMaxSpecies * veg::kMaxSlots];
  const std::uint32_t uploadCount = veg::planUploads(b, uploads, veg::kMaxSpecies * veg::kMaxSlots, veg::kUploadBytesPerFrame);
  for (std::uint32_t i = 0; i < uploadCount; ++i) {
    const veg::Upload& u = uploads[i];
    writeBuffer(vegBuf[u.species], u.byteOffset, veg::rangeOf(b, u.species, u.slot), u.bytes);
  }
  for (std::uint32_t slot = 0; slot < b.slots; ++slot) {
    bool resident = false;
    for (std::uint32_t s = 0; s < b.species; ++s) resident = resident || b.counts[veg::indexOf(b, s, slot)] != 0;
    if (!resident) continue;
    float relOrigin[4] = {0.0f, 0.0f, 0.0f, 0.0f};
    veg::relativeOriginFloat(b, slot, frameOrigin, relOrigin);
    writeBuffer(vegOriginBuf, static_cast<std::uint64_t>(slot) * kVegOriginStride, relOrigin, sizeof(relOrigin));
  }
  const std::uint32_t drawCount = veg::planDraws(b, reinterpret_cast<const float*>(camera.planes), frameOrigin, vegDraws, veg::kMaxSpecies * veg::kMaxSlots);
  vegDrawCount = drawCount == veg::kPlanBad ? 0 : drawCount;
  std::uint32_t instances = 0;
  for (std::uint32_t i = 0; i < vegDrawCount; ++i) instances += vegDraws[i].count;
  engine::render::counters().vegetationDraws = vegDrawCount;
  engine::render::counters().vegetationInstances = instances;
}

void drawVegetation(wgpu::RenderPassEncoder& pass) {
  if (vegDrawCount == 0 || !vegReady) return;
  const engine::render::vegetation::Bound& b = engine::render::vegetation::state();
  ENGINE_RENDER_CALL(pass.SetPipeline(vegPipe));
  for (std::uint32_t i = 0; i < vegDrawCount; ++i) {
    const engine::render::vegetation::Draw& d = vegDraws[i];
    ENGINE_RENDER_CALL(pass.SetBindGroup(0, vegGroup[engine::render::vegetation::indexOf(b, d.species, d.slot)]));
    ENGINE_RENDER_CALL(pass.Draw(kPropVertices, d.count, 0, d.slot * b.capacity));
  }
}

void drawTerrain(wgpu::RenderPassEncoder& pass) {
  ENGINE_RENDER_CALL(pass.SetPipeline(terrainPipe));
  ENGINE_RENDER_CALL(pass.SetBindGroup(0, terrainGroup));
  ENGINE_RENDER_CALL(pass.DrawIndirect(argsBuf, kArgsTerrainWord * 4));
}

wgpu::RenderPassColorAttachment colourFor(wgpu::TextureView view, bool clear, wgpu::Color clearValue) {
  wgpu::RenderPassColorAttachment colour{};
  colour.view = view;
  colour.loadOp = clear ? wgpu::LoadOp::Clear : wgpu::LoadOp::Load;
  colour.storeOp = wgpu::StoreOp::Store;
  colour.clearValue = clearValue;
  return colour;
}

wgpu::RenderPassDepthStencilAttachment depthFor(bool clear) {
  wgpu::RenderPassDepthStencilAttachment depth{};
  depth.view = depthView;
  depth.depthLoadOp = clear ? wgpu::LoadOp::Clear : wgpu::LoadOp::Load;
  depth.depthStoreOp = wgpu::StoreOp::Store;
  depth.depthClearValue = 1.0f;
  return depth;
}

void uploadModelOffsets(const engine::render::FrameOrigin& origin) {
  if (!engine::models::bound()) return;
  const std::uint32_t slots = engine::models::slotCount() < kModelRelSlots ? engine::models::slotCount() : kModelRelSlots;
  for (std::uint32_t s = 0; s < slots; ++s) {
    float offset[3];
    engine::models::modelOffset(s, offset);
    float rel[4] = {0.0f, 0.0f, 0.0f, 0.0f};
    engine::render::relativeOfFloat(offset, origin, rel);
    writeBuffer(modelRelBuf, static_cast<std::uint64_t>(s) * 16, rel, sizeof(rel));
  }
}

void encodeForward(wgpu::CommandEncoder& encoder, wgpu::TextureView target, const Camera& camera, const engine::render::FrameOrigin& origin) {
  wgpu::RenderPassColorAttachment colour = colourFor(target, true, wgpu::Color{kClearRed, kClearGreen, kClearBlue, 1.0});
  wgpu::RenderPassDepthStencilAttachment depth = depthFor(true);
  wgpu::RenderPassDescriptor passDesc{};
  passDesc.colorAttachmentCount = 1;
  passDesc.colorAttachments = &colour;
  passDesc.depthStencilAttachment = &depth;

  wgpu::RenderPassEncoder pass = ENGINE_RENDER_CALL(encoder.BeginRenderPass(&passDesc));
  drawProps(pass);
  drawVegetation(pass);
  if (engine::models::bound()) {
    ENGINE_RENDER_CALL(pass.SetPipeline(modelPipe));
    ENGINE_RENDER_CALL(pass.SetBindGroup(0, modelGroup));
    ENGINE_RENDER_CALL(pass.SetVertexBuffer(0, modelVertexBuf, 0, engine::models::vertexPoolBytes()));
    ENGINE_RENDER_CALL(pass.SetIndexBuffer(modelIndexBuf, wgpu::IndexFormat::Uint32, 0, engine::models::indexPoolBytes()));
    for (std::uint32_t s = 0; s < engine::models::slotCount(); ++s) {
      if (!engine::models::slotReady(s)) continue;
      const double frameOrigin[3] = {origin.x, origin.y, origin.z};
      const std::uint32_t runs = engine::models::visibleRuns(s, camera.planes, modelRuns, nullptr, frameOrigin);
      for (std::uint32_t r = 0; r < runs; ++r) {
        const engine::models::Range& run = modelRuns[r];
        ENGINE_RENDER_CALL(pass.DrawIndexed(run.indexCount, 1, run.firstIndex, static_cast<std::int32_t>(run.firstVertex), s));
      }
    }
  }
  drawTerrain(pass);
  ENGINE_RENDER_CALL(pass.End());
}

void dispatchCull(wgpu::CommandEncoder& encoder, std::uint32_t pipeline) {
  const std::uint32_t groups = (visTotal + kWorkgroupLanes - 1) / kWorkgroupLanes;
  wgpu::ComputePassEncoder compute = ENGINE_RENDER_CALL(encoder.BeginComputePass());
  ENGINE_RENDER_CALL(compute.SetPipeline(cullPipe[pipeline]));
  ENGINE_RENDER_CALL(compute.SetBindGroup(0, cullGroup));
  ENGINE_RENDER_CALL(compute.DispatchWorkgroups(groups));
  ENGINE_RENDER_CALL(compute.SetPipeline(finalizePipe));
  ENGINE_RENDER_CALL(compute.SetBindGroup(0, finalizeGroup));
  ENGINE_RENDER_CALL(compute.DispatchWorkgroups(1));
  ENGINE_RENDER_CALL(compute.End());
}

bool changedSince(std::uint8_t* shadow, const void* data, std::uint64_t size) {
  if (std::memcmp(shadow, data, static_cast<std::size_t>(size)) == 0) return false;
  std::memcpy(shadow, data, static_cast<std::size_t>(size));
  return true;
}

static_assert(sizeof(FramePlan::materialWords) == kMaterialBytes);
static_assert(sizeof(FramePlan::pageRecords) == kPageBytes);

std::uint8_t lightShadow[kLightBytes];
std::uint8_t materialShadow[kMaterialBytes];
std::uint8_t pageShadow[kPageBytes];
std::uint32_t propArgsShadow[kPropClasses * 4];
std::uint32_t terrainArgsShadow[4];

void onCullMapped(wgpu::MapAsyncStatus status, wgpu::StringView message, void*) {
  cullPending = false;
  if (status != wgpu::MapAsyncStatus::Success) return;
  const std::uint32_t* words = static_cast<const std::uint32_t*>(cullStaging.GetConstMappedRange(0, kCounterBytes));
  if (words != nullptr) {
    engine::render::counters().cullPassA = words[0];
    engine::render::counters().cullCandidates = words[1];
    engine::render::counters().cullPassB = words[2];
    engine::render::counters().cullFresh = 1;
  }
  cullStaging.Unmap();
}

void drawVisible(wgpu::CommandEncoder& encoder, std::uint32_t pass, bool first) {
  wgpu::RenderPassColorAttachment colour = colourFor(idView, first, wgpu::Color{0.0, 0.0, 0.0, 0.0});
  wgpu::RenderPassDepthStencilAttachment depth = depthFor(first);
  wgpu::RenderPassDescriptor passDesc{};
  passDesc.colorAttachmentCount = 1;
  passDesc.colorAttachments = &colour;
  passDesc.depthStencilAttachment = &depth;
  wgpu::RenderPassEncoder encodePass = ENGINE_RENDER_CALL(encoder.BeginRenderPass(&passDesc));
  ENGINE_RENDER_CALL(encodePass.SetPipeline(idPipe));
  ENGINE_RENDER_CALL(encodePass.SetBindGroup(0, idGroup[pass]));
  ENGINE_RENDER_CALL(encodePass.DrawIndirect(visArgsBuf, pass * 16));
  ENGINE_RENDER_CALL(encodePass.End());
}

void buildHzb(wgpu::CommandEncoder& encoder) {
  {
    wgpu::ComputePassEncoder compute = ENGINE_RENDER_CALL(encoder.BeginComputePass());
    ENGINE_RENDER_CALL(compute.SetPipeline(hzbDepthPipe));
    ENGINE_RENDER_CALL(compute.SetBindGroup(0, hzbDepthGroup));
    ENGINE_RENDER_CALL(compute.DispatchWorkgroups((hzbWidth + kTileSide - 1) / kTileSide, (hzbHeight + kTileSide - 1) / kTileSide));
    ENGINE_RENDER_CALL(compute.End());
  }
  for (std::uint32_t l = 1; l < hzbLevels; ++l) {
    wgpu::ComputePassEncoder compute = ENGINE_RENDER_CALL(encoder.BeginComputePass());
    ENGINE_RENDER_CALL(compute.SetPipeline(hzbReducePipe));
    ENGINE_RENDER_CALL(compute.SetBindGroup(0, hzbReduceGroup[l]));
    const std::uint32_t levelWidth = std::max(hzbWidth >> l, 1u);
    const std::uint32_t levelHeight = std::max(hzbHeight >> l, 1u);
    ENGINE_RENDER_CALL(compute.DispatchWorkgroups((levelWidth + kTileSide - 1) / kTileSide, (levelHeight + kTileSide - 1) / kTileSide));
    ENGINE_RENDER_CALL(compute.End());
  }
}

void encodeVisibility(wgpu::CommandEncoder& encoder, wgpu::TextureView target) {
  dispatchCull(encoder, 0);
  drawVisible(encoder, 0, true);
  buildHzb(encoder);
  dispatchCull(encoder, 1);
  const bool countReadback = engine::render::counters().countReadback != 0;
  cullCopied = false;
  if (countReadback && !cullPending) {
    encoder.CopyBufferToBuffer(counterBuf, 0, cullStaging, 0, kCounterBytes);
    cullCopied = true;
  }
  drawVisible(encoder, 1, false);

  wgpu::RenderPassColorAttachment resolveColour = colourFor(target, true, wgpu::Color{kClearRed, kClearGreen, kClearBlue, 1.0});
  wgpu::RenderPassDescriptor resolveDesc{};
  resolveDesc.colorAttachmentCount = 1;
  resolveDesc.colorAttachments = &resolveColour;
  wgpu::RenderPassEncoder resolvePass = ENGINE_RENDER_CALL(encoder.BeginRenderPass(&resolveDesc));
  ENGINE_RENDER_CALL(resolvePass.SetPipeline(resolvePipe));
  ENGINE_RENDER_CALL(resolvePass.SetBindGroup(0, resolveGroup));
  ENGINE_RENDER_CALL(resolvePass.Draw(3));
  ENGINE_RENDER_CALL(resolvePass.End());

  wgpu::RenderPassColorAttachment frontColour = colourFor(target, false, wgpu::Color{0.0, 0.0, 0.0, 0.0});
  wgpu::RenderPassDepthStencilAttachment frontDepth = depthFor(false);
  wgpu::RenderPassDescriptor frontDesc{};
  frontDesc.colorAttachmentCount = 1;
  frontDesc.colorAttachments = &frontColour;
  frontDesc.depthStencilAttachment = &frontDepth;
  wgpu::RenderPassEncoder front = ENGINE_RENDER_CALL(encoder.BeginRenderPass(&frontDesc));
  drawProps(front);
  drawVegetation(front);
  drawTerrain(front);
  ENGINE_RENDER_CALL(front.End());
}

}

wgpu::PresentMode presentChoice = wgpu::PresentMode::Fifo;

void setPresentMode(std::uint32_t mode) {
  presentChoice = mode == 1 ? wgpu::PresentMode::Mailbox : mode == 2 ? wgpu::PresentMode::Immediate : wgpu::PresentMode::Fifo;
}

int init(const char* selector, std::uint32_t width, std::uint32_t height) {
  if (!acceptCreate()) return engine::kRange;
  if (ready) return engine::kOk;

  device = wgpu::Device::Acquire(emscripten_webgpu_get_device());
  if (!device) return engine::kNotConfigured;
  queue = device.GetQueue();

  wgpu::Instance instance = wgpu::CreateInstance();
  wgpu::EmscriptenSurfaceSourceCanvasHTMLSelector canvas{};
  canvas.selector = selector;
  wgpu::SurfaceDescriptor surfaceDesc{};
  surfaceDesc.nextInChain = &canvas;
  surface = instance.CreateSurface(&surfaceDesc);
  if (!surface) return engine::kNotConfigured;

  wgpu::SurfaceConfiguration config{};
  config.device = device;
  config.format = surfaceFormat;
  config.usage = wgpu::TextureUsage::RenderAttachment | wgpu::TextureUsage::CopySrc;
  config.width = width;
  config.height = height;
  config.presentMode = presentChoice;
  config.alphaMode = wgpu::CompositeAlphaMode::Opaque;
  surface.Configure(&config);

  cameraBuf = makeBuffer(kCameraBytes, wgpu::BufferUsage::Uniform | wgpu::BufferUsage::CopyDst);
  argsBuf = makeBuffer(kArgsBytes, wgpu::BufferUsage::Storage | wgpu::BufferUsage::Indirect | wgpu::BufferUsage::CopyDst);
  lightBuf = makeBuffer(kLightBytes, wgpu::BufferUsage::Storage | wgpu::BufferUsage::CopyDst);
  materialBuf = makeBuffer(kMaterialBytes, wgpu::BufferUsage::Storage | wgpu::BufferUsage::CopyDst);
  pageBuf = makeBuffer(kPageBytes, wgpu::BufferUsage::Storage | wgpu::BufferUsage::CopyDst);
  bodyBytes = static_cast<std::uint64_t>(engine::world().bodyCapacity()) * kRecordBytes;
  for (std::uint32_t c = 0; c < kPropClasses; ++c) {
    instanceBuf[c] = makeBuffer(bodyBytes, wgpu::BufferUsage::Storage | wgpu::BufferUsage::CopyDst);
  }

  if (engine::models::bound()) {
    modelVertexBuf = makeBuffer(engine::models::vertexPoolBytes(), wgpu::BufferUsage::Vertex | wgpu::BufferUsage::Storage | wgpu::BufferUsage::CopyDst);
    modelIndexBuf = makeBuffer(engine::models::indexPoolBytes(), wgpu::BufferUsage::Index | wgpu::BufferUsage::Storage | wgpu::BufferUsage::CopyDst);
  }

  heightTex = makeTexture(kPageSide, kPageSide, pageLayers(), wgpu::TextureFormat::R32Float, wgpu::TextureUsage::TextureBinding | wgpu::TextureUsage::CopyDst);
  albedoTex = makeTexture(kAlbedoSide, kAlbedoSide, kAlbedoLayers, wgpu::TextureFormat::RGBA8Unorm, wgpu::TextureUsage::TextureBinding | wgpu::TextureUsage::CopyDst);
  depthTex = makeTexture(width, height, 1, wgpu::TextureFormat::Depth32Float, wgpu::TextureUsage::RenderAttachment | wgpu::TextureUsage::TextureBinding);
  heightView = makeArrayView(heightTex, pageLayers());
  albedoView = makeArrayView(albedoTex, kAlbedoLayers);
  depthView = depthTex.CreateView();
  wgpu::TextureViewDescriptor depthOnlyDesc{};
  depthOnlyDesc.aspect = wgpu::TextureAspect::DepthOnly;
  depthOnlyView = depthTex.CreateView(&depthOnlyDesc);

  for (std::uint32_t i = 0; i < kAlbedoBytes; ++i) whitePixels[i] = 0xff;
  writeLayers(albedoTex, 0, 1, whitePixels, kAlbedoSide, 4);

  if (buildPipelines() != engine::kOk) return engine::kNotConfigured;
  visibilityReady = buildVisibility(width, height);

  ready = true;
  return engine::kOk;
}

int frame(const SceneView& scene, const FramePlan& plan, const Camera& camera) {
  if (!ready) return engine::kNotConfigured;
  const bool visible = engine::render::modelSettings().path == engine::render::kModelPathVisibility && visibilityReady && engine::models::liveCount() > 0;

  {
    engine::phase::Scope scope(engine::phase::kUpload);
    writeBuffer(cameraBuf, 0, &camera, kCameraBytes);
    {
      engine::phase::Scope part(engine::phase::kUploadVegetation);
      uploadVegetation(camera, scene.origin);
    }
    uploadModelOffsets(scene.origin);
    std::uint32_t propArgs[kPropClasses * 4];
    {
      engine::phase::Scope part(engine::phase::kUploadProps);
      for (std::uint32_t c = 0; c < kPropClasses; ++c) {
        const std::uint32_t count = plan.propCount[c];
        if (count != 0) {
          writeBuffer(instanceBuf[c], 0, plan.propRecords + c * plan.bodySlots * kRecordWords, static_cast<std::uint64_t>(count) * kRecordBytes);
        }
        propArgs[c * 4 + 0] = kPropVertices;
        propArgs[c * 4 + 1] = count;
        propArgs[c * 4 + 2] = 0;
        propArgs[c * 4 + 3] = 0;
      }
    }
    if (std::memcmp(propArgsShadow, propArgs, sizeof propArgs) != 0) {
      std::memcpy(propArgsShadow, propArgs, sizeof propArgs);
      writeBuffer(argsBuf, kArgsPropWord * 4, propArgs, sizeof propArgs);
    }
    const std::uint32_t terrainArgs[4] = {kPageVertices, plan.pageCount, 0, 0};
    if (std::memcmp(terrainArgsShadow, terrainArgs, sizeof terrainArgs) != 0) {
      std::memcpy(terrainArgsShadow, terrainArgs, sizeof terrainArgs);
      writeBuffer(argsBuf, kArgsTerrainWord * 4, terrainArgs, sizeof terrainArgs);
    }
    if (changedSince(lightShadow, scene.lights, kLightBytes)) writeBuffer(lightBuf, 0, scene.lights, kLightBytes);
    if (changedSince(materialShadow, plan.materialWords, kMaterialBytes)) writeBuffer(materialBuf, 0, plan.materialWords, kMaterialBytes);
    if (changedSince(pageShadow, plan.pageRecords, kPageBytes)) writeBuffer(pageBuf, 0, plan.pageRecords, kPageBytes);

    std::uint64_t modelBudget = engine::models::layout().uploadBytesPerFrame;
    for (std::uint32_t s = 0; s < engine::models::slotCount(); ++s) {
      if (!engine::models::slotDirty(s)) continue;
      const std::uint64_t vertexSlotBytes = engine::models::slotVertexBytes();
      const std::uint64_t indexSlotBytes = engine::models::slotIndexBytes();
      if (vertexSlotBytes + indexSlotBytes > modelBudget) break;
      writeBuffer(modelVertexBuf, s * vertexSlotBytes, engine::models::slotVertices(s), vertexSlotBytes);
      writeBuffer(modelIndexBuf, s * indexSlotBytes, engine::models::slotIndices(s), indexSlotBytes);
      if (visibilityReady) writeBuffer(clusterBuf, s * engine::models::clusterSlotBytes(), engine::models::slotClusters(s), engine::models::clusterSlotBytes());
      engine::models::clearDirty(s);
      modelBudget -= vertexSlotBytes + indexSlotBytes;
    }

    if (visibilityReady) {
      for (std::uint32_t s = 0; s < visSlots; ++s) readyWords[s] = engine::models::slotReady(s) ? 1u : 0u;
      writeBuffer(slotReadyBuf, 0, readyWords, static_cast<std::uint64_t>(visSlots) * 4);
      const engine::models::Layout& layout = engine::models::layout();
      paramWords[0] = visStride;
      paramWords[1] = layout.verticesPerSlot;
      paramWords[2] = layout.indicesPerSlot;
      paramWords[3] = layout.vertexStrideBytes / 4;
      paramWords[4] = surfaceWidth;
      paramWords[5] = surfaceHeight;
      paramWords[6] = hzbLevels;
      paramWords[7] = engine::render::modelSettings().occlusion != 0 && hzbValid ? 1u : 0u;
      paramWords[8] = visTotal;
      paramWords[9] = visSlots;
      paramWords[10] = hzbWidth;
      paramWords[11] = hzbHeight;
      writeBuffer(paramBuf, 0, paramWords, kParamBytes);
      writeBuffer(counterBuf, 0, kZeroCounters, kCounterBytes);
    }

    engine::phase::Scope pages(engine::phase::kUploadPages);
    for (std::uint32_t u = 0; u < plan.uploadCount;) {
      const std::uint32_t end = uploadRunEnd(plan, u);
      writeLayers(heightTex, plan.uploadLayer[u], end - u, scene.pages->pageSamples(static_cast<int>(plan.uploadSlot[u])), kPageSide, 4);
      u = end;
    }
    for (std::uint32_t layer = 0; layer < kAlbedoLayers;) {
      if (plan.albedoPending[layer] == 0) {
        layer += 1;
        continue;
      }
      const std::uint32_t end = albedoRunEnd(plan, layer);
      writeLayers(albedoTex, layer, end - layer, scene.albedoPixels + layer * kAlbedoBytes, kAlbedoSide, 4);
      layer = end;
    }
  }

  engine::render::counters().modelPath = visible ? engine::render::kModelPathVisibility : engine::render::kModelPathForward;
  wgpu::CommandEncoder encoder = ENGINE_RENDER_CALL(device.CreateCommandEncoder());

  wgpu::SurfaceTexture surfaceTexture{};
  wgpu::TextureView target;
  {
    engine::phase::Scope scope(engine::phase::kAcquire);
    ENGINE_RENDER_CALL(surface.GetCurrentTexture(&surfaceTexture));
    target = ENGINE_RENDER_CALL(surfaceTexture.texture.CreateView());
  }

  wgpu::CommandBuffer commands;
  {
    engine::phase::Scope scope(engine::phase::kEncode);
    if (visible) {
      encodeVisibility(encoder, target);
    } else {
      encodeForward(encoder, target, camera, scene.origin);
    }
    commands = ENGINE_RENDER_CALL(encoder.Finish());
  }
  {
    engine::phase::Scope scope(engine::phase::kSubmit);
    ENGINE_RENDER_CALL(queue.Submit(1, &commands));
  }
  if (cullCopied) {
    cullCopied = false;
    cullPending = true;
    cullStaging.MapAsync(wgpu::MapMode::Read, 0, kCounterBytes, wgpu::CallbackMode::AllowSpontaneous, onCullMapped, static_cast<void*>(nullptr));
  }
  if (visible) hzbValid = true;
  return engine::kOk;
}

}
