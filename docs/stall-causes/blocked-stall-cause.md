# Blocked-stall cause, round 2 G1, with a thread sampler that keeps up

Runs: `r2-G1-fixed` (round 2) and `r1-G1-fixed` (round 1), each a paired G1 with 12 burn workers and a 240 s window, behind the load gate (1-minute load below 3 before each start). Page captures are `engine-render.html?phase=10&tier=1024&timed=1` in the project browser. Thread sampler: `scripts/browser/thread-cpu-sampler.mjs` at a 50 ms period, renderer main threads only (commit `921279f`). Per-stall rows: `round2-r1-G1-fixed.tsv` (124 stalls) and `round2-r2-G1-fixed.tsv` (164 stalls). Raw files are in `build/diag/paired-F` (git-ignored).

## Sampler gap check

| run | ticks | median gap | p99 | max | gaps over 100 ms |
|---|---|---|---|---|---|
| r2-G1-fixed | 5082 | 50 ms | 69 ms | 84 ms | 0 |
| r1-G1-fixed | 4932 | 50 ms | 77 ms | 142 ms | 2 |

The r2 run kept up. The r1 run did not, on 2 of its 4932 ticks, so the gap check fails for r1. Its stall counts are less reliable than r2's by the time those two gaps covered, and the check is reported as failing rather than waived.

## Stall counts by category

| run | stalls | cpu-bound | starved | blocked |
|---|---|---|---|---|
| r2-G1-fixed | 164 | 27 | 32 | 105 |
| r1-G1-fixed | 124 | 22 | 52 | 50 |

Blocked stalls by active bodies: r2 has 70 at active 0, 29 at 10240 and 6 mid. r1 has 19 at active 0, 30 at 10240 and 1 mid.

## What the blocked class is made of

Phase coverage: for every stall in both runs, the nine frame phases sum to the frame's tick time (median coverage 1.00 to 1.02, median unattributed time between −0.3 and −0.1 ms). So every blocked stall sits inside the measured phases, and the phases that dominate blocked stalls are physics and readback. The wait-site record (`docs/stall-causes/wait-sites.md`) finds no wait in either phase.

| run | blocked stalls | median total | under 20 ms | median renderer CPU | median CPU share |
|---|---|---|---|---|---|
| r2-G1-fixed | 105 | 9.7 ms | 75 | 3.9 ms | 0.40 |
| r1-G1-fixed | 50 | 26.9 ms | 20 | 16.9 ms | 0.56 |

The two runs give two different answers:

1. In r2, most blocked stalls are short (75 of 105 under 20 ms, median 9.7 ms). The renderer's CPU counter moves in 10 ms jiffies and the probe interpolates between records, so for a stall of this length the CPU share is within about one jiffy of zero to one. For these stalls the probe cannot tell CPU from waiting, so `blocked` here is a measurement limit, not evidence of a wait.
2. In r1, the blocked stalls are longer (median 26.9 ms) and the renderer used about 56% of their time on the CPU, with no cgroup pressure. About 44% of their time is off the CPU, with no cgroup pressure, inside physics and readback. No engine site in those phases blocks, so this time is not explained by a wait the code makes.

## Cause

Settled part: the blocked class in r2 is a counter-resolution effect on short stalls, not a wait. The CPU counter cannot resolve a stall shorter than about two jiffies.

Open part: the off-CPU time in r1's longer blocked stalls. It sits inside physics and readback, which have no wait site, and no cgroup pressure explains it. The probe cannot say whether the thread slept, was preempted by something outside the cgroup, or was in a page-fault or memory path that the stime counter does not capture.

What would settle the open part: sample `/proc/<pid>/task/<tid>/schedstat` for the renderer main thread (run time and run-queue wait in nanoseconds, not jiffies). Run time against wall time per stall would separate sleep (no run time and no wait) from runnable-but-not-running (wait time) and from CPU the jiffy counter rounds away. That needs a probe change and a new run; it was not made in this pass.

## Status

## Round 3: r1 G1 with the scheduler instrument (`r1-G1-sched`)

Run: round 1 paired G1, 12 burn workers, 240 s, behind the load gate. Thread sampler at a 50 ms period with the Phase A instrument (commit `f646318`): renderer main-thread `schedstat`, `wchan` and fault counts per tick, and the cgroup memory and IO pressure totals and the sampler's own scheduler stats per tick. Files: `build/diag/paired-F/r1-G1-sched.*` (git-ignored). Per-stall rows: `docs/stall-causes/round2-r1-G1-sched.tsv` (115 stalls).

### Sampler gap check

4921 ticks, median gap 51 ms, p99 78 ms, max 106 ms, one gap over 100 ms (tick 2800, 106 ms). The check FAILS by 6 ms. The sampler's own scheduler stats for that tick show 34.0 ms of run-queue wait and 7.5 ms of run time, so the late tick was the sampler waiting for a CPU during the burn. This is the same cause as the earlier r1 failures, with a smaller margin.

### Stall counts by category

blocked 60, starved 50, cpu-bound 5 (115 stalls).

### The blocked stalls: what the renderer main thread was doing

Shares of each category's total stall time, from the per-stall `schedstat` run and wait deltas (sleep is the stall time minus run and wait, clamped at zero):

| verdict | stall time | run share | runnable-wait share | sleep share |
|---|---|---|---|---|
| blocked | 2937.7 ms | 0.56 | 0.42 (about 1234 ms) | 0.03 (about 100 ms) |
| starved | 1870.1 ms | 0.25 | 0.62 (about 1159 ms) | 0.13 (about 245 ms) |
| cpu-bound | 154.8 ms | 0.80 | 0.43 | 0 |

The 44% off-CPU share in the earlier round is confirmed as the same time. It is 42% runnable and waiting for a CPU, and 3% sleeping. It was labelled blocked, not starved, because the cgroup pressure share for each stall was under 0.5, while the same stalls were waiting for a CPU for about 0.42 of their time. So `blocked` in this classifier means "contention below the pressure threshold", not "no contention".

The sampled wait categories inside the blocked stalls agree. Of the 73 samples in blocked stall windows, 72 read `wchan` 0 (running at the sample) and 1 read `futex_do_wait`. Twelve blocked stalls had no sample inside their window, so they are judged from the nearest sample before them. The one futex sample is in frame 84, which has 12 ms of sleep. No other blocked stall has a sleep above 1 ms in its window that a sample confirms.

### The off-CPU wait site

- The wait is the scheduler's run queue. The renderer main thread is runnable and is not running. It is not a call in the engine or in the page.
- Measured duration: about 1234 ms of runnable wait across the 60 blocked stalls (median 0.43 of each stall's time). The starved stalls wait about 1159 ms the same way.
- Why it is inherent to this condition: the G1 burn runs 12 workers on the host's 12 CPUs, all in one root cgroup. The renderer and the sampler compete for those CPUs by design. Removing the wait means changing the burn, which changes the condition under test.
- Limit: run and wait are interpolated between 50 ms ticks, so for a stall shorter than one tick the split is the average over the ticks around it. The blocked stalls have a median of about 26 ms, so the split is roughly right for most of them and coarse for the shortest.

### Status

REPORT: open. The sampler gap check failed again on r1, by 6 ms, with the sampler's own run-queue wait measured on that tick. The blocked-stall off-CPU time is named as run-queue wait (CPU contention under G1), inherent to the condition, with the measured duration above. The r2 sub-20 ms stalls remain a measurement limit as recorded.
