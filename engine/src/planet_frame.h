#ifndef ENGINE_PLANET_FRAME_H
#define ENGINE_PLANET_FRAME_H

#include <cstddef>
#include <cstdint>

#include "page_cache.h"

namespace engine::planet {

constexpr int kFaces = 6;
constexpr int kSeamSlackCells = 2;
constexpr int kMaxCellsPerFace = 1 << 20;
constexpr std::int64_t kMaxSafeInteger = 9007199254740991;

struct Cell {
  int face;
  int cx;
  int cy;
};

struct FaceLocal {
  int face;
  double ox;
  double oy;
};

struct Planet {
  double radius = 0.0;
  double cellSize = 0.0;
  double maxHeight = 0.0;
  int cellsPerFace = 0;
  std::uint64_t gapQueries = 0;
  bool configured = false;
  PageCache pages;
};

struct PageCursor {
  std::int64_t key = 0;
  int slot = -1;
  bool valid = false;
};

struct SurfaceSample {
  double height;
  double normal[3];
  bool flat;
};

std::size_t bytesFor(std::uint32_t pageSlots);
Planet* bind(void* base, std::uint32_t pageSlots);
Planet& state();
bool configure(Planet& terrain, double radius, double cellSize, double maxHeight);
int pickFace(double x, double y, double z);
FaceLocal worldToFaceLocal(double x, double y, double z, double radius);
Cell worldToCell(double x, double y, double z, double radius, double cellSize);
bool packCellKey(int face, int cx, int cy, int cellsPerFace, std::int64_t& key);
Cell resolveCell(int face, int cx, int cy, int cellsPerFace);
double heightAt(Planet& terrain, double x, double y, double z);
double ceilingAt(const Planet& terrain, double x, double y, double z, double reachMetres);
SurfaceSample sampleSurface(Planet& terrain, double x, double y, double z, PageCursor& cursor);
void cellFrame(const Planet& terrain, int face, int cx, int cy, double* out);

}

#endif
