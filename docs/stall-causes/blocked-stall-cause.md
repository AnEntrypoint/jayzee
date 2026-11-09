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

REPORT: finished for the sampler change and the two G1 runs; open for the cause of r1's off-CPU blocked time.
