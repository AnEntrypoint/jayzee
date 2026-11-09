#include "phase_timer.h"

namespace engine::phase {

#if defined(ENGINE_PHASE_TIMERS)

namespace {

double totals[kCount];

}

double& total(Id id) {
  return totals[id];
}

#endif

}
