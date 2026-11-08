#include "interest.h"

#include <algorithm>
#include <cmath>
#include <cstring>

namespace engine::interest {

namespace {

struct Client {
  std::uint32_t cellX;
  std::uint32_t cellZ;
  std::uint32_t active;
  std::uint32_t head;
  std::uint32_t filled;
};

static_assert(sizeof(Client) == kClientBytes);

struct State {
  bool bound;
  bool configured;
  budget::Capacity capacity;
  std::uint32_t players;
  std::uint32_t cellsPerSide;
  std::uint32_t radiusCells;
  double cellSize;
  double originX;
  double originZ;
  std::uint32_t truncated;
  std::uint32_t outside;
  Client* clients;
  std::uint32_t* cellStarts;
  std::uint32_t* cellCursor;
  std::uint32_t* bodyCells;
  std::uint32_t* bodyOrder;
  snapshot::Ring ring;
};

State instance{};

State& state() {
  return instance;
}

std::uint32_t axisCell(double value, double origin, double cellSize, std::uint32_t side, bool& clamped) {
  const double scaled = (value - origin) / cellSize;
  if (!(scaled >= 0.0)) {
    clamped = true;
    return 0;
  }
  if (scaled >= static_cast<double>(side)) {
    clamped = true;
    return side - 1;
  }
  return static_cast<std::uint32_t>(scaled);
}

}

bool bind(void* base, const budget::Capacity& capacity) {
  if (base == nullptr || (reinterpret_cast<std::uintptr_t>(base) & 7u) != 0) return false;
  if (capacity.players == 0 || capacity.bodies == 0 || capacity.visiblePerClient == 0 || capacity.baselineDepth == 0 ||
      capacity.interestCellsPerSide == 0) {
    return false;
  }
  const Offsets o = layout(capacity);
  std::uint8_t* bytes = static_cast<std::uint8_t*>(base);
  State& s = state();
  s.capacity = capacity;
  s.bound = true;
  s.configured = false;
  s.players = 0;
  s.cellsPerSide = 0;
  s.radiusCells = 0;
  s.cellSize = 1.0;
  s.originX = 0.0;
  s.originZ = 0.0;
  s.truncated = 0;
  s.outside = 0;
  s.clients = reinterpret_cast<Client*>(bytes + o.clients);
  s.cellStarts = reinterpret_cast<std::uint32_t*>(bytes + o.cellStarts);
  s.cellCursor = reinterpret_cast<std::uint32_t*>(bytes + o.cellCursor);
  s.bodyCells = reinterpret_cast<std::uint32_t*>(bytes + o.bodyCells);
  s.bodyOrder = reinterpret_cast<std::uint32_t*>(bytes + o.bodyOrder);
  s.ring.visible = capacity.visiblePerClient;
  s.ring.depth = capacity.baselineDepth;
  s.ring.ticks = reinterpret_cast<std::uint32_t*>(bytes + o.ticks);
  s.ring.counts = reinterpret_cast<std::uint32_t*>(bytes + o.counts);
  s.ring.indices = reinterpret_cast<std::uint32_t*>(bytes + o.indices);
  s.ring.records = bytes + o.records;
  s.ring.segments = bytes + o.segments;
  std::fill(s.clients, s.clients + capacity.players, Client{0, 0, 0, 0, 0});
  return true;
}

Status configure(std::uint32_t players, double cellSize, double originX, double originZ, std::uint32_t cellsPerSide, std::uint32_t radiusCells) {
  State& s = state();
  if (!s.bound) return kNotConfigured;
  if (players == 0 || players > s.capacity.players) return kRange;
  if (cellsPerSide == 0 || cellsPerSide > s.capacity.interestCellsPerSide) return kRange;
  if (!std::isfinite(cellSize) || !(cellSize > 0.0)) return kRange;
  if (!std::isfinite(originX) || !std::isfinite(originZ)) return kRange;
  s.players = players;
  s.cellsPerSide = cellsPerSide;
  s.radiusCells = std::min(radiusCells, cellsPerSide);
  s.cellSize = cellSize;
  s.originX = originX;
  s.originZ = originZ;
  std::fill(s.clients, s.clients + s.capacity.players, Client{0, 0, 0, 0, 0});
  s.configured = true;
  return kOk;
}

Status setClient(std::uint32_t slot, double x, double z, bool active) {
  State& s = state();
  if (!s.configured) return kNotConfigured;
  if (slot >= s.players) return kBadId;
  if (!std::isfinite(x) || !std::isfinite(z)) return kRange;
  Client& c = s.clients[slot];
  bool clamped = false;
  c.cellX = axisCell(x, s.originX, s.cellSize, s.cellsPerSide, clamped);
  c.cellZ = axisCell(z, s.originZ, s.cellSize, s.cellsPerSide, clamped);
  const std::uint32_t wanted = active ? 1u : 0u;
  if (c.active != wanted) {
    c.active = wanted;
    c.head = 0;
    c.filled = 0;
  }
  return kOk;
}

Status update(std::uint32_t tick, const double* positions, const double* velocities, std::uint32_t count) {
  State& s = state();
  if (!s.configured) return kNotConfigured;
  if (count > s.capacity.bodies) return kRange;
  if (count > 0 && (positions == nullptr || velocities == nullptr)) return kRange;

  const std::uint32_t side = s.cellsPerSide;
  const std::uint32_t cells = side * side;
  const std::uint32_t visible = s.capacity.visiblePerClient;
  const std::uint32_t depth = s.capacity.baselineDepth;

  std::fill(s.cellStarts, s.cellStarts + cells + 1, 0u);
  s.outside = 0;
  for (std::uint32_t body = 0; body < count; ++body) {
    bool clamped = false;
    const std::uint32_t cx = axisCell(positions[3 * static_cast<std::size_t>(body)], s.originX, s.cellSize, side, clamped);
    const std::uint32_t cz = axisCell(positions[3 * static_cast<std::size_t>(body) + 2], s.originZ, s.cellSize, side, clamped);
    if (clamped) s.outside += 1;
    const std::uint32_t cell = cz * side + cx;
    s.bodyCells[body] = cell;
    s.cellStarts[cell + 1] += 1;
  }
  for (std::uint32_t c = 0; c < cells; ++c) s.cellStarts[c + 1] += s.cellStarts[c];
  std::copy(s.cellStarts, s.cellStarts + cells, s.cellCursor);
  for (std::uint32_t body = 0; body < count; ++body) {
    s.bodyOrder[s.cellCursor[s.bodyCells[body]]++] = body;
  }

  s.truncated = 0;
  bool failed = false;
  for (std::uint32_t slot = 0; slot < s.players; ++slot) {
    Client& c = s.clients[slot];
    if (!c.active) continue;
    const std::uint32_t radius = s.radiusCells;
    const std::uint32_t loX = c.cellX > radius ? c.cellX - radius : 0;
    const std::uint32_t loZ = c.cellZ > radius ? c.cellZ - radius : 0;
    const std::uint32_t hiX = std::min(side - 1, c.cellX + radius);
    const std::uint32_t hiZ = std::min(side - 1, c.cellZ + radius);
    const snapshot::Slot out = snapshot::slotOf(s.ring, slot, c.head);

    std::uint32_t stored = 0;
    std::uint32_t total = 0;
    for (std::uint32_t z = loZ; z <= hiZ; ++z) {
      for (std::uint32_t x = loX; x <= hiX; ++x) {
        const std::uint32_t cell = z * side + x;
        const std::uint32_t begin = s.cellStarts[cell];
        const std::uint32_t end = s.cellStarts[cell + 1];
        total += end - begin;
        for (std::uint32_t k = begin; k < end && stored < visible; ++k) {
          out.indices[stored++] = s.bodyOrder[k];
        }
      }
    }
    s.truncated += total - stored;

    std::sort(out.indices, out.indices + stored);
    for (std::uint32_t j = 0; j < stored; ++j) {
      std::uint8_t* record = out.records + static_cast<std::size_t>(j) * codec::kEntityBytes;
      if (!snapshot::encodeRecord(positions, velocities, out.indices[j], record)) {
        std::memset(record, 0, codec::kEntityBytes);
        failed = true;
      }
    }
    *out.count = stored;
    *out.tick = tick;
    c.head = (c.head + 1) % depth;
    c.filled = std::min(c.filled + 1, depth);
  }
  return failed ? kRange : kOk;
}

std::int32_t visibleCount(std::uint32_t slot) {
  State& s = state();
  if (!s.configured) return kNotConfigured;
  if (slot >= s.players) return kBadId;
  const Client& c = s.clients[slot];
  if (!c.active || c.filled == 0) return 0;
  const std::uint32_t newest = (c.head + s.ring.depth - 1) % s.ring.depth;
  return static_cast<std::int32_t>(*snapshot::slotOf(s.ring, slot, newest).count);
}

std::uint32_t truncated() {
  return state().truncated;
}

std::uint32_t outside() {
  return state().outside;
}

std::int32_t encode(std::uint32_t slot, std::uint32_t baselineTick) {
  State& s = state();
  if (!s.configured) return kNotConfigured;
  if (slot >= s.players) return kBadId;
  const Client& c = s.clients[slot];
  if (!c.active || c.filled == 0) return kBadId;
  const std::uint32_t newest = (c.head + s.ring.depth - 1) % s.ring.depth;
  const std::int32_t baseline = snapshot::findSlot(s.ring, slot, c.filled, baselineTick);
  if (baseline < 0) return kBadId;
  return snapshot::encodeDelta(s.ring, slot, newest, static_cast<std::uint32_t>(baseline));
}

const std::uint8_t* segment(std::uint32_t slot) {
  const State& s = state();
  if (!s.bound || slot >= s.capacity.players) return nullptr;
  return snapshot::segmentOf(s.ring, slot);
}

std::size_t segmentBytes() {
  const State& s = state();
  return s.bound ? snapshot::segmentBytesFor(s.capacity.visiblePerClient) : 0;
}

}
