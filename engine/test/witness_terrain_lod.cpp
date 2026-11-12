#include <cmath>
#include <cstdint>
#include <cstring>

#include "arena.h"
#include "harness.h"
#include "planet_frame.h"
#include "render/render_frame.h"
#include "terrain_lod.h"

namespace engine::witness {

namespace {

using engine::test::check;
using engine::test::observe;

namespace rnd = engine::render;

constexpr std::uint32_t kBudget = 64;
constexpr std::uint32_t kLevels = 6;
constexpr double kFullAltitude = 100.0;
constexpr std::uint32_t kSweepSteps = 4000;
constexpr float kSweepTop = 6.5f;
constexpr std::uint32_t kJitterFrames = 200;
constexpr float kSweepSlack = 2.0f * kSweepTop / kSweepSteps / terrain::kMorphBand;
constexpr std::uint32_t kFinePages = 8;
constexpr std::uint32_t kPages = 12;
constexpr std::uint32_t kMiddleA = 8;
constexpr std::uint32_t kMiddleB = 9;
constexpr std::uint32_t kCoarse = 10;
constexpr std::uint32_t kOrphan = 11;
constexpr std::uint32_t kTightBudget = 9;
constexpr std::int64_t kFirstKey = 7000;

rnd::FramePlan lodPlan;
rnd::FramePlan plainPlan;
rnd::Camera lodCamera;
rnd::PagePlacement lodPlacements[rnd::kMaxPageLayers];
terrain::PageLod lodPages[rnd::kMaxPageLayers];
rnd::MaterialSlot lodMaterials[1];
std::uint8_t lodAlbedoReady[rnd::kAlbedoLayers];
std::uint8_t lodAlbedoPixels[rnd::kAlbedoLayers * rnd::kAlbedoBytes];
int lodSlots[kPages];

double altitudeFor(float ratio) {
  return kFullAltitude * std::pow(2.0, static_cast<double>(ratio));
}

float wordFloat(std::uint32_t bits) {
  float value;
  std::memcpy(&value, &bits, sizeof value);
  return value;
}

const std::uint32_t* recordOf(const rnd::FramePlan& plan, std::uint32_t slot) {
  for (std::uint32_t i = 0; i < plan.pageCount; ++i) {
    const std::uint32_t* record = plan.pageRecords + i * rnd::kPageRecordWords;
    if (record[0] == plan.slotLayer[slot]) return record;
  }
  return nullptr;
}

void lawWitness() {
  check(!terrain::enabled() && terrain::state().pageBudget == terrain::kNoPageBudget, "terrain lod: off by default, with no page budget");
  check(!terrain::configure(kBudget, 0, kFullAltitude) && !terrain::configure(kBudget, terrain::kMaxLevels + 1, kFullAltitude) &&
            !terrain::configure(kBudget, kLevels, 0.0) && !terrain::configure(kBudget, kLevels, std::nan("")) && !terrain::enabled(),
        "terrain lod: no levels, more than 16 levels, and a full-detail altitude that is not positive and finite are refused");
  check(terrain::windowFor(64) == 8 && terrain::windowFor(80) == 8 && terrain::windowFor(81) == 9 && terrain::windowFor(256) == 16 && terrain::windowFor(1) == 1,
        "terrain lod: the window is the largest square of pages inside the page budget");
  check(terrain::configure(kBudget, kLevels, kFullAltitude) && terrain::enabled(), "terrain lod: a budget of 64 pages, 6 levels and 100 m of full detail is accepted");

  const terrain::LodState& lod = terrain::select(50.0);
  check(lod.level == 0 && lod.spanCells == 1 && lod.morph == 0.0f && lod.window == 8 && lod.ratio == 0.0f, "terrain lod: below the full-detail altitude the pages are level 0, one cell wide, unmorphed");
  terrain::select(altitudeFor(0.5f));
  check(lod.level == 0 && std::fabs(lod.morph - 0.5f) < 1.0e-4f, "terrain lod: half way through the morph band the blend factor is one half");
  terrain::select(altitudeFor(1.2f));
  check(lod.level == 0 && lod.morph == 1.0f, "terrain lod: the hysteresis band holds level 0 past the doubling altitude, fully morphed to its parent");
  terrain::select(altitudeFor(1.3f));
  check(lod.level == 1 && lod.spanCells == 2 && lod.switches == 1 && std::fabs(lod.morph - 0.1f) < 1.0e-3f, "terrain lod: past the band the pages coarsen to level 1, two cells wide");
  terrain::select(altitudeFor(0.8f));
  check(lod.level == 1 && lod.morph == 0.0f, "terrain lod: coming down, the band holds level 1, unmorphed");
  terrain::select(altitudeFor(0.7f));
  check(lod.level == 0 && std::fabs(lod.morph - 0.9f) < 1.0e-3f && lod.switches == 2, "terrain lod: below the band the pages refine to level 0, which is still nine tenths morphed");
  terrain::select(altitudeFor(0.7499f));
  terrain::select(altitudeFor(1.6f));
  terrain::select(altitudeFor(0.7499f));
  check(lod.level == 0 && lod.morph > 0.999f, "terrain lod: at the altitude where level 1 hands back to level 0, level 0 is fully morphed");
  terrain::select(1.0e9);
  check(lod.level == kLevels - 1 && lod.morph == 0.0f && lod.spanCells == 32, "terrain lod: a very high camera holds the coarsest level, which never morphs");
  terrain::select(-5.0);
  check(lod.level == 0 && lod.altitude == 0.0, "terrain lod: a negative altitude reads as the ground");

  const std::uint32_t before = lod.switches;
  for (std::uint32_t frame = 0; frame < kJitterFrames; ++frame) terrain::select(altitudeFor(frame % 2 == 0 ? 0.8f : 1.2f));
  check(lod.switches == before && lod.level == 0, "terrain lod: 200 frames jittering across the doubling altitude inside the band switch no level from below");
  terrain::select(altitudeFor(1.6f));
  const std::uint32_t above = lod.switches;
  for (std::uint32_t frame = 0; frame < kJitterFrames; ++frame) terrain::select(altitudeFor(frame % 2 == 0 ? 0.8f : 1.2f));
  check(lod.switches == above && lod.level == 1, "terrain lod: and none from above");

  terrain::select(0.0);
  std::uint32_t pops = 0;
  std::uint32_t overBudget = 0;
  std::uint32_t levelSwitches = 0;
  float worstStep = 0.0f;
  std::uint32_t lastLevel = lod.level;
  float lastMorph = lod.morph;
  for (std::uint32_t pass = 0; pass < 2; ++pass) {
    for (std::uint32_t step = 0; step <= kSweepSteps; ++step) {
      const float along = static_cast<float>(step) / kSweepSteps;
      const float ratio = kSweepTop * (pass == 0 ? along : 1.0f - along);
      terrain::select(altitudeFor(ratio));
      if (lod.window * lod.window > kBudget) overBudget += 1;
      if (lod.level != lastLevel) {
        levelSwitches += 1;
        const bool coarsened = lod.level > lastLevel;
        const float finer = coarsened ? terrain::morphOf(lastLevel, lod.ratio, kLevels) : lod.morph;
        const float coarser = coarsened ? lod.morph : terrain::morphOf(lastLevel, lod.ratio, kLevels);
        if (finer < 1.0f - kSweepSlack || coarser > kSweepSlack || (lod.level > lastLevel ? lod.level - lastLevel : lastLevel - lod.level) != 1) pops += 1;
      } else {
        const float delta = std::fabs(lod.morph - lastMorph);
        if (delta > worstStep) worstStep = delta;
      }
      lastLevel = lod.level;
      lastMorph = lod.morph;
    }
  }
  observe("terrain lod: level switches over a sweep from the ground to 90 times the full-detail altitude and back", levelSwitches);
  observe("terrain lod: largest change of the blend factor between two sweep steps inside a level", worstStep);
  check(levelSwitches == 2 * (kLevels - 1) && pops == 0,
        "terrain lod: at every level switch, up or down, the finer level is morphed to its parent and the coarser level is unmorphed to within one sweep step, so the two surfaces meet");
  check(worstStep <= kSweepSlack, "terrain lod: inside a level the blend factor moves no faster than the altitude ratio over the morph band");
  check(overBudget == 0, "terrain lod: the page window never passes the page budget at any altitude");
  terrain::reset();
}

void buildPages() {
  planet::PageCache& pages = planet::state().pages;
  std::memset(lodPlacements, 0, sizeof lodPlacements);
  for (std::uint32_t slot = 0; slot < rnd::kMaxPageLayers; ++slot) lodPages[slot] = terrain::PageLod{0, 0, terrain::kNoParent};
  for (std::uint32_t i = 0; i < kPages; ++i) {
    lodSlots[i] = pages.stage(kFirstKey + i);
    if (lodSlots[i] < 0) continue;
    pages.commit(lodSlots[i]);
    rnd::PagePlacement& placement = lodPlacements[lodSlots[i]];
    placement.origin[0] = 20.0 * i;
    placement.uEdge[0] = 20.0f;
    placement.vEdge[2] = -20.0f;
    placement.placed = 1;
  }
  pages.applyPending();
  for (std::uint32_t i = 0; i < kFinePages; ++i) {
    lodPages[lodSlots[i]] = terrain::PageLod{0, static_cast<std::uint8_t>(i % 4), static_cast<std::uint16_t>(lodSlots[i < 4 ? kMiddleA : kMiddleB])};
  }
  lodPages[lodSlots[kMiddleA]] = terrain::PageLod{1, 0, static_cast<std::uint16_t>(lodSlots[kCoarse])};
  lodPages[lodSlots[kMiddleB]] = terrain::PageLod{1, 1, static_cast<std::uint16_t>(lodSlots[kCoarse])};
  lodPages[lodSlots[kCoarse]] = terrain::PageLod{2, 0, terrain::kNoParent};
  lodPages[lodSlots[kOrphan]] = terrain::PageLod{0, 3, static_cast<std::uint16_t>(rnd::pageLayers() - 1)};
}

rnd::SceneView sceneOf(bool withLods) {
  rnd::SceneView scene{};
  scene.pages = &planet::state().pages;
  scene.placements = lodPlacements;
  scene.pageLods = withLods ? lodPages : nullptr;
  scene.materials = lodMaterials;
  scene.materialCount = 1;
  scene.albedoReady = lodAlbedoReady;
  scene.albedoPixels = lodAlbedoPixels;
  scene.skipProps = true;
  return scene;
}

void recordWitness() {
  buildPages();
  bool staged = true;
  for (std::uint32_t i = 0; i < kPages; ++i) staged = staged && lodSlots[i] >= 0 && static_cast<std::uint32_t>(lodSlots[i]) < rnd::pageLayers() - 1;
  check(staged && planet::state().pages.residentCount() == static_cast<int>(kPages), "terrain lod: twelve pages are resident for the record witness");

  rnd::resetPlan(plainPlan);
  rnd::resetPlan(lodPlan);
  const rnd::SceneView plain = sceneOf(false);
  const rnd::SceneView withLods = sceneOf(true);
  rnd::planFrame(plain, lodCamera, plainPlan);
  rnd::planFrame(withLods, lodCamera, lodPlan);
  bool zero = plainPlan.pageCount == kPages && lodPlan.pageCount == kPages;
  for (std::uint32_t i = 0; i < kPages; ++i) {
    const std::uint32_t* record = lodPlan.pageRecords + i * rnd::kPageRecordWords;
    zero = zero && record[rnd::kPageMorphWord] == 0 && record[rnd::kPageParentWord] == 0 && record[rnd::kPageLodWord] == 0;
  }
  check(zero && std::memcmp(plainPlan.pageRecords, lodPlan.pageRecords, kPages * rnd::kPageRecordBytes) == 0 && rnd::counters().pagesShed == 0,
        "terrain lod: with no page budget every placed page is drawn and its record is byte for byte what it was, with zero lod words");

  terrain::configure(kBudget, kLevels, kFullAltitude);
  terrain::select(altitudeFor(0.5f));
  const std::uint64_t carves = engine::arena::carves();
  rnd::planFrame(withLods, lodCamera, lodPlan);
  bool fine = lodPlan.pageCount == kPages;
  for (std::uint32_t i = 0; i < kFinePages && fine; ++i) {
    const std::uint32_t* record = recordOf(lodPlan, lodSlots[i]);
    fine = record != nullptr && std::fabs(wordFloat(record[rnd::kPageMorphWord]) - 0.5f) < 1.0e-4f &&
           record[rnd::kPageParentWord] == lodPlan.slotLayer[lodSlots[i < 4 ? kMiddleA : kMiddleB]] && record[rnd::kPageLodWord] == i % 4;
  }
  check(fine, "terrain lod: each level 0 page record carries the blend factor one half, its parent's texture layer and its quadrant in the parent");
  const std::uint32_t* middle = recordOf(lodPlan, lodSlots[kMiddleB]);
  check(middle != nullptr && middle[rnd::kPageMorphWord] == 0 && middle[rnd::kPageParentWord] == lodPlan.slotLayer[lodSlots[kCoarse]] &&
            middle[rnd::kPageLodWord] == ((1u << terrain::kLevelShift) | 1u),
        "terrain lod: a level 1 page at the same altitude is unmorphed and carries level 1 in its record");
  const std::uint32_t* orphan = recordOf(lodPlan, lodSlots[kOrphan]);
  const std::uint32_t* coarse = recordOf(lodPlan, lodSlots[kCoarse]);
  check(orphan != nullptr && orphan[rnd::kPageMorphWord] == 0 && orphan[rnd::kPageParentWord] == rnd::kNoLayer && coarse != nullptr &&
            coarse[rnd::kPageParentWord] == rnd::kNoLayer && coarse[rnd::kPageMorphWord] == 0,
        "terrain lod: a page whose parent is not resident, or that has no parent, is not morphed and names no parent layer");

  terrain::select(altitudeFor(1.3f));
  rnd::planFrame(withLods, lodCamera, lodPlan);
  const std::uint32_t* held = recordOf(lodPlan, lodSlots[0]);
  const std::uint32_t* current = recordOf(lodPlan, lodSlots[kMiddleA]);
  check(terrain::state().level == 1 && held != nullptr && wordFloat(held[rnd::kPageMorphWord]) == 1.0f && current != nullptr &&
            std::fabs(wordFloat(current[rnd::kPageMorphWord]) - 0.1f) < 1.0e-3f,
        "terrain lod: after the switch to level 1 a level 0 page still placed is fully morphed, so it matches the level 1 page that replaces it");

  terrain::configure(kTightBudget, kLevels, kFullAltitude);
  terrain::select(50.0);
  rnd::planFrame(withLods, lodCamera, lodPlan);
  bool finest = lodPlan.pageCount == kTightBudget && rnd::counters().pagesShed == kPages - kTightBudget && rnd::counters().pagesPlaced == kPages;
  for (std::uint32_t i = 0; i < kFinePages; ++i) finest = finest && recordOf(lodPlan, lodSlots[i]) != nullptr;
  finest = finest && recordOf(lodPlan, lodSlots[kOrphan]) != nullptr && recordOf(lodPlan, lodSlots[kMiddleA]) == nullptr && recordOf(lodPlan, lodSlots[kCoarse]) == nullptr;
  check(finest, "terrain lod: under a budget of 9 pages at level 0 the nine level 0 pages are drawn and the three coarser pages are shed");

  terrain::select(altitudeFor(1.6f));
  rnd::planFrame(withLods, lodCamera, lodPlan);
  std::uint32_t fineDrawn = 0;
  for (std::uint32_t i = 0; i < kFinePages; ++i) fineDrawn += recordOf(lodPlan, lodSlots[i]) != nullptr ? 1 : 0;
  fineDrawn += recordOf(lodPlan, lodSlots[kOrphan]) != nullptr ? 1 : 0;
  check(terrain::state().level == 1 && lodPlan.pageCount == kTightBudget && recordOf(lodPlan, lodSlots[kMiddleA]) != nullptr &&
            recordOf(lodPlan, lodSlots[kMiddleB]) != nullptr && recordOf(lodPlan, lodSlots[kCoarse]) != nullptr && fineDrawn == 6 && rnd::counters().pagesShed == 3,
        "terrain lod: at level 1 the budget goes to the level 1 pages first, then the coarser page, then six of the nine finer pages, and three are shed");
  check(engine::arena::carves() == carves, "terrain lod: selection and the page plan carve nothing from the arena");

  terrain::reset();
  rnd::planFrame(withLods, lodCamera, lodPlan);
  check(lodPlan.pageCount == kPages && rnd::counters().pagesShed == 0 && std::memcmp(plainPlan.pageRecords, lodPlan.pageRecords, kPages * rnd::kPageRecordBytes) == 0,
        "terrain lod: clearing the page budget returns every page and the unchanged records");

  planet::PageCache& pages = planet::state().pages;
  for (std::uint32_t i = 0; i < kPages; ++i) pages.releaseKey(kFirstKey + i);
  pages.applyPending();
  check(pages.residentCount() == 0, "terrain lod: the witness pages are released");
}

}

void terrainLod() {
  lawWitness();
  recordWitness();
}

}
