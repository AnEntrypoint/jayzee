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
  return (1.0 - tx) * (1.0 - ty) * s00 + tx * (1.0 - ty) * s10 + (1.0 - tx) * ty * s01 + tx * ty * s11;
}

}
