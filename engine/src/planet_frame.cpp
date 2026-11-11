#include "planet_frame.h"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <limits>
#include <new>

namespace engine::planet {

namespace {

enum Side : int { kUPlus = 0, kUMinus = 1, kVPlus = 2, kVMinus = 3 };

struct Frame {
  double c[3];
  double u[3];
  double v[3];
};

constexpr Frame kFrames[kFaces] = {
    {{1, 0, 0}, {0, 0, -1}, {0, 1, 0}},
    {{-1, 0, 0}, {0, 0, 1}, {0, 1, 0}},
    {{0, 1, 0}, {1, 0, 0}, {0, 0, -1}},
    {{0, -1, 0}, {1, 0, 0}, {0, 0, 1}},
    {{0, 0, 1}, {1, 0, 0}, {0, 1, 0}},
    {{0, 0, -1}, {-1, 0, 0}, {0, 1, 0}},
};

struct Link {
  int face;
  int side;
  int sign;
};

constexpr Link kLinks[kFaces][4] = {
    {{5, kUMinus, 1}, {4, kUPlus, 1}, {2, kUPlus, 1}, {3, kUPlus, -1}},
    {{4, kUMinus, 1}, {5, kUPlus, 1}, {2, kUMinus, -1}, {3, kUMinus, 1}},
    {{0, kVPlus, 1}, {1, kVPlus, -1}, {5, kVPlus, -1}, {4, kVPlus, 1}},
    {{0, kVMinus, -1}, {1, kVMinus, 1}, {4, kVMinus, 1}, {5, kVMinus, -1}},
    {{0, kUMinus, 1}, {1, kUPlus, 1}, {2, kVMinus, 1}, {3, kVPlus, 1}},
    {{1, kUMinus, 1}, {0, kUPlus, 1}, {2, kVPlus, -1}, {3, kVMinus, -1}},
};

constexpr double kAtanScale = 4.0 / 3.14159265358979323846;

double dot(const double* a, const double* b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

int clampIndex(int value, int cellsPerFace) {
  return std::clamp(value, 0, cellsPerFace - 1);
}

int edgeSide(int coord, int cellsPerFace) {
  if (coord < 0) return -1;
  if (coord >= cellsPerFace) return 1;
  return 0;
}

Cell stepAcrossEdge(int face, int which, int t, int cellsPerFace) {
  const Link& link = kLinks[face][which];
  const int tPrime = link.sign > 0 ? t : cellsPerFace - 1 - t;
  const int last = cellsPerFace - 1;
  switch (link.side) {
    case kUPlus:
      return {link.face, last, tPrime};
    case kUMinus:
      return {link.face, 0, tPrime};
    case kVPlus:
      return {link.face, tPrime, last};
    default:
      return {link.face, tPrime, 0};
  }
}

double clampUnit(double value) {
  return std::clamp(value, 0.0, 1.0);
}

constexpr std::size_t kAlign = 16;

std::size_t alignUp(std::size_t value) {
  return (value + kAlign - 1) / kAlign * kAlign;
}

Planet* bound = nullptr;

}

std::size_t bytesFor(std::uint32_t pageSlots) {
  const std::size_t pages = PageCache::bytesFor(pageSlots);
  if (pages == 0) return 0;
  return alignUp(sizeof(Planet)) + pages;
}

Planet* bind(void* base, std::uint32_t pageSlots) {
  if (bound != nullptr) return nullptr;
  const std::size_t total = bytesFor(pageSlots);
  if (base == nullptr || total == 0) return nullptr;
  std::memset(base, 0, total);
  Planet* terrain = new (base) Planet();
  if (!terrain->pages.bind(static_cast<std::uint8_t*>(base) + alignUp(sizeof(Planet)), pageSlots)) return nullptr;
  bound = terrain;
  return terrain;
}

Planet& state() {
  return *bound;
}

bool configure(Planet& terrain, double radius, double cellSize, double maxHeight) {
  if (!(radius > 0.0) || !(cellSize > 0.0) || !(maxHeight >= 0.0)) return false;
  const double cells = std::ceil((2.0 * radius) / cellSize);
  if (!(cells >= 1.0) || cells > kMaxCellsPerFace) return false;
  terrain.radius = radius;
  terrain.cellSize = cellSize;
  terrain.maxHeight = maxHeight;
  terrain.cellsPerFace = static_cast<int>(cells);
  terrain.gapQueries = 0;
  terrain.configured = true;
  terrain.pages.clear();
  return true;
}

int pickFace(double x, double y, double z) {
  const double point[3] = {x, y, z};
  int best = -1;
  double bestDot = -std::numeric_limits<double>::infinity();
  for (int face = 0; face < kFaces; ++face) {
    const double d = dot(point, kFrames[face].c);
    if (d > bestDot) {
      bestDot = d;
      best = face;
    }
  }
  return best;
}

FaceLocal worldToFaceLocal(double x, double y, double z, double radius) {
  const int face = pickFace(x, y, z);
  const Frame& frame = kFrames[face];
  const double point[3] = {x, y, z};
  const double cu = dot(point, frame.u);
  const double cv = dot(point, frame.v);
  const double cc = dot(point, frame.c);
  const double ccSafe = cc > 1.0 ? cc : 1.0;
  return {face, kAtanScale * radius * std::atan(cu / ccSafe), kAtanScale * radius * std::atan(cv / ccSafe)};
}

Cell worldToCell(double x, double y, double z, double radius, double cellSize) {
  const FaceLocal local = worldToFaceLocal(x, y, z, radius);
  return {local.face, static_cast<int>(std::floor((local.ox + radius) / cellSize)),
          static_cast<int>(std::floor((local.oy + radius) / cellSize))};
}

bool packCellKey(int face, int cx, int cy, int cellsPerFace, std::int64_t& key) {
  const std::int64_t stride = cellsPerFace + kSeamSlackCells;
  const std::int64_t columns = stride * 4;
  const std::int64_t row = face * stride + cx;
  if (row > kMaxSafeInteger / columns || row < -kMaxSafeInteger / columns) return false;
  const std::int64_t value = row * columns + cy;
  if (value > kMaxSafeInteger || value < -kMaxSafeInteger) return false;
  key = value;
  return true;
}

Cell resolveCell(int face, int cx, int cy, int cellsPerFace) {
  int f = face;
  int x = cx;
  int y = cy;
  for (int hop = 0; hop < 2; ++hop) {
    const int xSide = edgeSide(x, cellsPerFace);
    const int ySide = edgeSide(y, cellsPerFace);
    if (xSide == 0 && ySide == 0) return {f, x, y};
    if (xSide != 0) {
      const int t = clampIndex(y, cellsPerFace);
      const Cell r = stepAcrossEdge(f, xSide > 0 ? kUPlus : kUMinus, t, cellsPerFace);
      f = r.face;
      x = r.cx;
      y = r.cy;
      continue;
    }
    const int t = clampIndex(x, cellsPerFace);
    const Cell r = stepAcrossEdge(f, ySide > 0 ? kVPlus : kVMinus, t, cellsPerFace);
    f = r.face;
    x = r.cx;
    y = r.cy;
  }
  return {f, clampIndex(x, cellsPerFace), clampIndex(y, cellsPerFace)};
}

double heightAt(Planet& terrain, double x, double y, double z) {
  const FaceLocal local = worldToFaceLocal(x, y, z, terrain.radius);
  const double offsetX = (local.ox + terrain.radius) / terrain.cellSize;
  const double offsetY = (local.oy + terrain.radius) / terrain.cellSize;
  const int cx = clampIndex(static_cast<int>(std::floor(offsetX)), terrain.cellsPerFace);
  const int cy = clampIndex(static_cast<int>(std::floor(offsetY)), terrain.cellsPerFace);
  std::int64_t key = 0;
  const int slot = packCellKey(local.face, cx, cy, terrain.cellsPerFace, key) ? terrain.pages.lookup(key) : -1;
  if (slot < 0) {
    terrain.gapQueries += 1;
    return 0.0;
  }
  const double gx = clampUnit(offsetX - cx) * (kPageSide - 1);
  const double gy = clampUnit(offsetY - cy) * (kPageSide - 1);
  const int i0 = std::min(static_cast<int>(gx), kPageSide - 2);
  const int j0 = std::min(static_cast<int>(gy), kPageSide - 2);
  const double tx = gx - i0;
  const double ty = gy - j0;
  const float* s = terrain.pages.pageSamples(slot);
  const double s00 = s[j0 * kPageSide + i0];
  const double s10 = s[j0 * kPageSide + i0 + 1];
  const double s01 = s[(j0 + 1) * kPageSide + i0];
  const double s11 = s[(j0 + 1) * kPageSide + i0 + 1];
  if (ty <= tx) return s00 + tx * (s10 - s00) + ty * (s11 - s10);
  return s00 + ty * (s01 - s00) + tx * (s11 - s01);
}

double ceilingAt(const Planet& terrain, double x, double y, double z, double reachMetres) {
  constexpr double kMetricSlack = 2.0;
  const FaceLocal local = worldToFaceLocal(x, y, z, terrain.radius);
  const double offsetX = (local.ox + terrain.radius) / terrain.cellSize;
  const double offsetY = (local.oy + terrain.radius) / terrain.cellSize;
  const int cx = clampIndex(static_cast<int>(std::floor(offsetX)), terrain.cellsPerFace);
  const int cy = clampIndex(static_cast<int>(std::floor(offsetY)), terrain.cellsPerFace);
  const double last = kPageSide - 1;
  const double span = kMetricSlack * reachMetres * last / terrain.cellSize;
  const double gx = clampUnit(offsetX - cx) * last;
  const double gy = clampUnit(offsetY - cy) * last;
  if (gx - span < 0.0 || gy - span < 0.0 || gx + span > last || gy + span > last) return std::numeric_limits<double>::infinity();
  std::int64_t key = 0;
  const int slot = packCellKey(local.face, cx, cy, terrain.cellsPerFace, key) ? terrain.pages.lookup(key) : -1;
  if (slot < 0) return 0.0;
  const int i0 = static_cast<int>(gx - span);
  const int j0 = static_cast<int>(gy - span);
  const int i1 = std::min(static_cast<int>(gx + span) + 1, kPageSide - 1);
  const int j1 = std::min(static_cast<int>(gy + span) + 1, kPageSide - 1);
  const float* s = terrain.pages.pageSamples(slot);
  float highest = s[j0 * kPageSide + i0];
  for (int j = j0; j <= j1; ++j) {
    for (int i = i0; i <= i1; ++i) highest = std::max(highest, s[j * kPageSide + i]);
  }
  return highest;
}

SurfaceSample sampleSurface(Planet& terrain, double x, double y, double z, PageCursor& cursor) {
  SurfaceSample out;
  const double point[3] = {x, y, z};
  const double distance = std::sqrt(dot(point, point));
  const double up[3] = {x / distance, y / distance, z / distance};
  out.height = 0.0;
  out.normal[0] = up[0];
  out.normal[1] = up[1];
  out.normal[2] = up[2];
  out.flat = true;
  const int face = pickFace(x, y, z);
  const Frame& frame = kFrames[face];
  const double cu = dot(point, frame.u);
  const double cv = dot(point, frame.v);
  const double cc = dot(point, frame.c);
  const double ccSafe = cc > 1.0 ? cc : 1.0;
  const double scale = kAtanScale * terrain.radius;
  const double offsetX = (scale * std::atan(cu / ccSafe) + terrain.radius) / terrain.cellSize;
  const double offsetY = (scale * std::atan(cv / ccSafe) + terrain.radius) / terrain.cellSize;
  const int cx = clampIndex(static_cast<int>(std::floor(offsetX)), terrain.cellsPerFace);
  const int cy = clampIndex(static_cast<int>(std::floor(offsetY)), terrain.cellsPerFace);
  std::int64_t key = 0;
  int slot = -1;
  if (packCellKey(face, cx, cy, terrain.cellsPerFace, key)) {
    if (!cursor.valid || cursor.key != key) {
      cursor.key = key;
      cursor.slot = terrain.pages.lookup(key);
      cursor.valid = true;
    }
    slot = cursor.slot;
  }
  if (slot < 0) {
    terrain.gapQueries += 1;
    return out;
  }
  const double gx = clampUnit(offsetX - cx) * (kPageSide - 1);
  const double gy = clampUnit(offsetY - cy) * (kPageSide - 1);
  const int i0 = std::min(static_cast<int>(gx), kPageSide - 2);
  const int j0 = std::min(static_cast<int>(gy), kPageSide - 2);
  const double tx = gx - i0;
  const double ty = gy - j0;
  const float* s = terrain.pages.pageSamples(slot);
  const double s00 = s[j0 * kPageSide + i0];
  const double s10 = s[j0 * kPageSide + i0 + 1];
  const double s01 = s[(j0 + 1) * kPageSide + i0];
  const double s11 = s[(j0 + 1) * kPageSide + i0 + 1];
  double alongX = 0.0;
  double alongY = 0.0;
  if (ty <= tx) {
    alongX = s10 - s00;
    alongY = s11 - s10;
    out.height = s00 + tx * alongX + ty * alongY;
  } else {
    alongX = s11 - s01;
    alongY = s01 - s00;
    out.height = s00 + ty * alongY + tx * alongX;
  }
  if (alongX == 0.0 && alongY == 0.0) return out;
  const double perOffset = (kPageSide - 1) / terrain.cellSize;
  const double slopeX = alongX * perOffset * scale / (ccSafe * ccSafe + cu * cu);
  const double slopeY = alongY * perOffset * scale / (ccSafe * ccSafe + cv * cv);
  double normal[3];
  for (int k = 0; k < 3; ++k) {
    const double gradient = slopeX * (ccSafe * frame.u[k] - cu * frame.c[k]) + slopeY * (ccSafe * frame.v[k] - cv * frame.c[k]);
    normal[k] = up[k] - gradient;
  }
  const double length = std::sqrt(dot(normal, normal));
  for (int k = 0; k < 3; ++k) out.normal[k] = normal[k] / length;
  out.flat = false;
  return out;
}

void surfacePoint(const Frame& frame, double radius, double ox, double oy, double* out) {
  const double tu = std::tan(ox / (kAtanScale * radius));
  const double tv = std::tan(oy / (kAtanScale * radius));
  double d[3];
  for (int k = 0; k < 3; ++k) d[k] = frame.c[k] + tu * frame.u[k] + tv * frame.v[k];
  const double len = std::sqrt(dot(d, d));
  for (int k = 0; k < 3; ++k) out[k] = radius * d[k] / len;
}

void cellFrame(const Planet& terrain, int face, int cx, int cy, double* out) {
  const Frame& frame = kFrames[face];
  const double ox0 = cx * terrain.cellSize - terrain.radius;
  const double oy0 = cy * terrain.cellSize - terrain.radius;
  const double ox1 = ox0 + terrain.cellSize;
  const double oy1 = oy0 + terrain.cellSize;
  double corner[3];
  double alongU[3];
  double alongV[3];
  surfacePoint(frame, terrain.radius, ox0, oy0, corner);
  surfacePoint(frame, terrain.radius, ox1, oy0, alongU);
  surfacePoint(frame, terrain.radius, ox0, oy1, alongV);
  for (int k = 0; k < 3; ++k) {
    out[k] = corner[k];
    out[3 + k] = alongU[k] - corner[k];
    out[6 + k] = alongV[k] - corner[k];
  }
}

}
