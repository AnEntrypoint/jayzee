## Kaggle physics run

Written by `node scripts/kaggle/record.mjs` from one `kaggle kernels output` read of `heclgang/jayzee-physics-goalpost` version 47. One JSON result per configuration; the table is that file.

- Budget: 16.7 ms per tick, 900 ticks per configuration. Ticks 0 and 1 are the boot ticks, ticks 2 to 299 the settle window, and ticks from 300 the steady window. The timed call is the whole worker tick: page streaming, follow, `engine_tick` and the pose export.
- Arena plan: 1024 players under a 1073741824 byte budget.
- Machine: AMD EPYC 7B12, 4 CPUs, Node v22.23.4, machine class AuthenticAMD-23-49-0 (2 cores, 4 threads).
- Pushed 2026-11-12T11:44:03.737Z. Queue wait 16 s from the push to the first line of the script. Run time 416.6 s for 55 of 55 planned runs.
- reference build of engine-core-1024mib-threads-simd.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4, 4, 4, 4, 4); in the steady window alone 131072 bodies hold it (workers 4, 4, 4, 4, 4).
- engine-core-1024mib-threads-simd.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 1, 2, 3, 6, 4); in the steady window alone 131072 bodies hold it (workers 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 1, 2, 3, 6, 4).
- engine-core-1024mib-threads.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4); in the steady window alone 131072 bodies hold it (workers 4).
- engine-core-1024mib-threads-simd.mjs, cold: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4); in the steady window alone 131072 bodies hold it (workers 4).
- profile build of engine-core-1024mib-threads-simd.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4, 4, 4, 4, 4, 4); in the steady window alone 131072 bodies hold it (workers 4, 4, 4, 4, 4, 4).
- Refused by the arena plan: none.
- Runs that gave no result: none.

| glue | bodies | workers | solver iterations | node flags | median ms | p99 ms | max ms | ticks over budget | ticks 0 and 1 ms | settle p99 ms | settle max ms | settle over budget | steady median ms | steady p99 ms | steady over budget | arena used bytes | arena bytes | warm-up ms | load ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.54 | 10.019 | 12.353 | 0 | 6.61 / 4.21 | 8.517 | 9.341 | 0 | 6.693 | 10.227 | 0 | 278248248 | 668400144 | 721.5 | 650 | 8.2 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.583 | 7.441 | 8.707 | 0 | 3.91 / 2.12 | 7.076 | 7.663 | 0 | 5.683 | 7.445 | 0 | 278230008 | 668400144 | 291 | 137.8 | 6.3 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.582 | 8.45 | 15.685 | 0 | 6.73 / 4.01 | 8.43 | 10.195 | 0 | 6.683 | 8.509 | 0 | 278248248 | 668400144 | 777.6 | 640.3 | 8.2 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.805 | 8.158 | 24.36 | 1 | 5.46 / 3.53 | 9.605 | 12.327 | 0 | 5.868 | 7.638 | 1 | 278230008 | 668400144 | 282.8 | 138.7 | 6.5 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.756 | 10.37 | 14.457 | 0 | 6.26 / 4.05 | 8.094 | 8.944 | 0 | 7.123 | 10.915 | 0 | 278248248 | 668400144 | 709.1 | 555.8 | 8.4 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.775 | 7.55 | 8.967 | 0 | 6.46 / 3.84 | 8.132 | 8.967 | 0 | 5.83 | 7.55 | 0 | 278230008 | 668400144 | 297.9 | 139.1 | 6.5 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.602 | 8.334 | 9.438 | 0 | 6.29 / 5.44 | 8.291 | 9.438 | 0 | 6.71 | 8.348 | 0 | 278248248 | 668400144 | 682.1 | 673.6 | 8.2 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.707 | 7.895 | 11.666 | 0 | 6.29 / 3.62 | 7.233 | 7.895 | 0 | 5.748 | 8.32 | 0 | 278230008 | 668400144 | 283.8 | 138.2 | 6.4 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.696 | 9.329 | 15.395 | 0 | 6.75 / 4.2 | 8.703 | 8.86 | 0 | 6.826 | 11.27 | 0 | 278248248 | 668400144 | 681.1 | 637.6 | 8.3 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.608 | 7.37 | 8.928 | 0 | 5.12 / 3.3 | 7.152 | 7.784 | 0 | 5.665 | 7.486 | 0 | 278230008 | 668400144 | 282.9 | 138 | 6.3 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.645 | 7.102 | 7.53 | 0 | 4.37 / 2.13 | 6.895 | 7.102 | 0 | 5.734 | 7.171 | 0 | 278230008 | 668400144 | 272.2 | 138.8 | 6.3 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.425 | 8.289 | 12.02 | 0 | 5.09 / 3.36 | 6.695 | 7.284 | 0 | 5.495 | 9.032 | 0 | 278210888 | 668400144 | 298 | 140.1 | 6.2 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.602 | 7.191 | 9.382 | 0 | 5.41 / 3.96 | 7.4 | 9.382 | 0 | 5.69 | 7.078 | 0 | 278230008 | 668400144 | 280.7 | 133.8 | 6.3 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.243 | 6.655 | 6.994 | 0 | 6.75 / 2.74 | 6.435 | 6.54 | 0 | 5.253 | 6.718 | 0 | 278210888 | 668400144 | 284.2 | 140.2 | 5.9 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.631 | 9.282 | 14.755 | 0 | 5.16 / 3.35 | 6.823 | 7.674 | 0 | 5.743 | 10.146 | 0 | 278230008 | 668400144 | 271.9 | 133.4 | 6.3 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.475 | 6.986 | 7.711 | 0 | 5.26 / 3.77 | 6.986 | 7.271 | 0 | 5.568 | 7.12 | 0 | 278210888 | 668400144 | 297.2 | 165.2 | 6.2 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.59 | 7.562 | 11.975 | 0 | 5.04 / 2.67 | 9.848 | 11.975 | 0 | 5.613 | 6.977 | 0 | 278230008 | 668400144 | 285.8 | 138.9 | 6.3 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.338 | 7.306 | 11.577 | 0 | 5.27 / 3.49 | 6.461 | 6.56 | 0 | 5.405 | 8.563 | 0 | 278210888 | 668400144 | 283 | 131.2 | 6 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.578 | 7.271 | 8.718 | 0 | 5.04 / 3.37 | 7.268 | 7.291 | 0 | 5.699 | 7.28 | 0 | 278230008 | 668400144 | 276.9 | 136.4 | 6.3 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.422 | 9.024 | 13.638 | 0 | 5.21 / 3.28 | 6.84 | 6.98 | 0 | 5.564 | 10.532 | 0 | 278210888 | 668400144 | 284.2 | 146.1 | 6.1 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.588 | 6.98 | 7.869 | 0 | 5.21 / 3.42 | 7.335 | 7.869 | 0 | 5.654 | 6.694 | 0 | 278230008 | 668400144 | 271.8 | 131.6 | 6.2 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.413 | 7.32 | 9.676 | 0 | 5.26 / 4.14 | 8.201 | 9.676 | 0 | 5.418 | 6.81 | 0 | 278210888 | 668400144 | 288 | 143.8 | 6.1 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.601 | 8.814 | 13.733 | 0 | 5.16 / 3.42 | 7.054 | 7.358 | 0 | 5.717 | 8.995 | 0 | 278230008 | 668400144 | 292.8 | 133.6 | 6.3 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.225 | 6.529 | 8.316 | 0 | 5.6 / 3.73 | 6.462 | 8.098 | 0 | 5.27 | 6.618 | 0 | 278210888 | 668400144 | 274.4 | 141.4 | 5.8 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.609 | 8.374 | 13.793 | 0 | 5.42 / 3.21 | 6.933 | 7.924 | 0 | 5.715 | 9.165 | 0 | 278230008 | 668400144 | 286 | 131.8 | 6.3 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.419 | 6.814 | 7.577 | 0 | 4.92 / 3.41 | 7.057 | 7.577 | 0 | 5.443 | 6.782 | 0 | 278210888 | 668400144 | 286.8 | 135.5 | 6.1 |
| 1024mib-threads-simd, warmed | 131072 | 1 | 4 |  | 7.308 | 12.002 | 14.513 | 0 | 5.4 / 3.36 | 10.636 | 14.513 | 0 | 7.559 | 12.243 | 0 | 278230008 | 668203536 | 281.9 | 197.6 | 8.1 |
| 1024mib-threads-simd, warmed | 131072 | 2 | 4 |  | 8.118 | 10.44 | 13.026 | 0 | 8.09 / 4.67 | 11.449 | 13.026 | 0 | 8.246 | 10.272 | 0 | 278230008 | 668269072 | 287.2 | 139.9 | 8.5 |
| 1024mib-threads-simd, warmed | 131072 | 3 | 4 |  | 6.308 | 9.273 | 12.826 | 0 | 5.06 / 3.81 | 7.882 | 8.055 | 0 | 6.519 | 11.756 | 0 | 278230008 | 668334608 | 291.5 | 136.6 | 7 |
| 1024mib-threads-simd, warmed | 131072 | 6 | 4 |  | 5.655 | 7.679 | 9.364 | 0 | 5.49 / 3.4 | 7.66 | 7.862 | 0 | 5.735 | 7.726 | 0 | 278230008 | 668531216 | 293.5 | 141.8 | 6.4 |
| 1024mib-threads, warmed | 131072 | 4 | 4 |  | 6.418 | 8.262 | 9.036 | 0 | 5.92 / 4.25 | 8.401 | 8.481 | 0 | 6.522 | 8.157 | 0 | 278230008 | 668400144 | 359.2 | 177.9 | 7.2 |
| 1024mib-threads-simd, cold | 131072 | 4 | 4 |  | 5.652 | 8.497 | 16.265 | 0 | 16.27 / 8.5 | 6.883 | 15.489 | 0 | 5.75 | 8.913 | 0 | 278230008 | 668400144 |  | 81.1 | 6 |
| 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.181 | 6.01 | 6.839 | 0 | 5.22 / 3.31 | 6.313 | 6.839 | 0 | 0.17 | 0.406 | 0 | 196038896 | 668400144 | 275.5 | 130.4 | 1.8 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.552 | 7.397 | 11.454 | 0 | 5.53 / 3.55 | 7.045 | 8.636 | 0 | 5.601 | 7.446 | 0 | 405628416 | 668400144 | 274.9 | 140.4 | 15.8 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 5.148 | 6.643 | 7.66 | 0 | 5.28 / 2.24 | 6.643 | 7.107 | 0 | 5.139 | 6.699 | 0 | 222452960 | 668400144 | 272.3 | 135 | 4.7 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 4.969 | 6.465 | 7.447 | 0 | 4.01 / 2.88 | 6.22 | 6.807 | 0 | 4.911 | 6.619 | 0 | 222603776 | 668400144 | 282.7 | 132 | 4.5 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 5.271 | 6.556 | 8.975 | 0 | 5.48 / 3.12 | 6.618 | 8.975 | 0 | 5.264 | 6.556 | 0 | 222407312 | 668400144 | 314.8 | 141.3 | 4.8 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 5.013 | 6.474 | 6.95 | 0 | 5.45 / 3.17 | 6.773 | 6.95 | 0 | 4.935 | 6.35 | 0 | 222564304 | 668400144 | 284.3 | 137.8 | 4.6 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.66 | 8.298 | 10.705 | 0 | 10.71 / 5.89 | 8.329 | 8.453 | 0 | 6.743 | 8.188 | 0 | 278246392 | 668400144 | 345.8 | 143.7 | 7.4 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.56 | 9.984 | 15.623 | 0 | 6.77 / 4.33 | 8.621 | 9.519 | 0 | 6.607 | 11.723 | 0 | 278246392 | 668400144 | 341.8 | 136.9 | 7.2 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.6 | 9.28 | 14.325 | 0 | 6.96 / 5.88 | 8.088 | 8.214 | 0 | 6.703 | 10.446 | 0 | 278246392 | 668400144 | 366.5 | 141.4 | 7.3 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.569 | 7.948 | 8.754 | 0 | 6.79 / 4.89 | 8.169 | 8.754 | 0 | 6.634 | 7.948 | 0 | 278246392 | 668400144 | 333.9 | 132.5 | 7.1 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.727 | 9.581 | 13.816 | 0 | 7 / 3.57 | 11.655 | 13.816 | 0 | 6.761 | 8.439 | 0 | 278246392 | 668400144 | 347 | 136.5 | 7.4 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.7 | 10.681 | 13.143 | 0 | 6.18 / 3.39 | 8.397 | 8.5 | 0 | 6.786 | 11.419 | 0 | 278246392 | 668400144 | 334.4 | 141.9 | 7.4 |
| profile 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.185 | 7.273 | 8.012 | 0 | 7.47 / 4.41 | 7.548 | 8.012 | 0 | 0.175 | 0.225 | 0 | 196055280 | 668400144 | 361.9 | 133.2 | 2.2 |
| profile 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.196 | 7.256 | 8.912 | 0 | 7.58 / 3.27 | 8.166 | 8.912 | 0 | 0.186 | 0.441 | 0 | 196055280 | 668400144 | 368.6 | 139.1 | 2.2 |
| profile 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.285 | 7.279 | 7.779 | 0 | 7.31 / 4.54 | 7.725 | 7.779 | 0 | 0.199 | 0.563 | 0 | 196055280 | 668400144 | 363.4 | 139.4 | 2.2 |

Probes on one configuration:

| glue | bodies | workers | solver iterations | node flags | median ms | p99 ms | max ms | ticks over budget | ticks 0 and 1 ms | settle p99 ms | settle max ms | settle over budget | steady median ms | steady p99 ms | steady over budget | arena used bytes | arena bytes | warm-up ms | load ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

Marble bowl (512 marbles, 600 ticks, 4 timed runs per tier after 1 warm run). CPU time is the main thread's run time from the scheduler statistics; wall time is beside it:

| tier | workers | clock | CPU p99 ms | CPU max ms | CPU ticks over 16.7 ms | CPU ticks over 25 ms | wall p99 ms | wall max ms | wall ticks over 16.7 ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|
| 64 MiB fixed | 1 | schedstat | 8.964 | 12.921 | 0 | 0 | 8.846 | 12.713 | 0 | 14.4 |
| 128 MiB fixed | 1 | schedstat | 11.838 | 13.512 | 0 | 0 | 11.584 | 13.792 | 0 | 15.3 |
| 512 MiB fixed | 1 | schedstat | 7.922 | 10.856 | 0 | 0 | 7.607 | 10.833 | 0 | 11.5 |
| 512 MiB threaded, 2 workers | 2 | schedstat | 6.002 | 7.004 | 0 | 0 | 6.162 | 7.378 | 0 | 11.2 |
