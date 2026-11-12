## Kaggle physics run

Written by `node scripts/kaggle/record.mjs` from one `kaggle kernels output` read of `heclgang/jayzee-physics-goalpost` version 52. One JSON result per configuration; the table is that file.

- Budget: 16.7 ms per tick, 900 ticks per configuration. Ticks 0 and 1 are the boot ticks, ticks 2 to 299 the settle window, and ticks from 300 the steady window. The timed call is the whole worker tick: page streaming, follow, `engine_tick` and the pose export.
- Arena plan: 1024 players under a 1073741824 byte budget.
- Machine: Intel(R) Xeon(R) CPU @ 2.20GHz, 4 CPUs, Node v22.23.4, machine class GenuineIntel-6-79-0 (2 cores, 4 threads).
- Pushed 2026-11-12T13:43:21.949Z. Queue wait 10 s from the push to the first line of the script. Run time 485.8 s for 55 of 55 planned runs.
- reference build of engine-core-1024mib-threads-simd.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4, 4, 4, 4, 4); in the steady window alone 131072 bodies hold it (workers 4, 4, 4, 4, 4).
- engine-core-1024mib-threads-simd.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 2, 3, 4); in the steady window alone 131072 bodies hold it (workers 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 2, 3, 4).
- engine-core-1024mib-threads.mjs, warmed: no body count holds the budget at p99 with zero ticks over budget; in the steady window alone none holds it.
- engine-core-1024mib-threads-simd.mjs, cold: no body count holds the budget at p99 with zero ticks over budget; in the steady window alone none holds it.
- profile build of engine-core-1024mib-threads-simd.mjs, warmed: 12288 bodies hold the budget at p99 with zero ticks over budget (workers 4, 4, 4); in the steady window alone 12288 bodies hold it (workers 4, 4, 4).
- Refused by the arena plan: none.
- Runs that gave no result: none.

| glue | bodies | workers | solver iterations | node flags | median ms | p99 ms | max ms | ticks over budget | ticks 0 and 1 ms | settle p99 ms | settle max ms | settle over budget | steady median ms | steady p99 ms | steady over budget | arena used bytes | arena bytes | warm-up ms | load ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.359 | 9.559 | 13.931 | 0 | 7.56 / 3.97 | 9.343 | 9.743 | 0 | 6.437 | 10.299 | 0 | 278230008 | 668400144 | 479.6 | 177.8 | 7.8 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.44 | 9.962 | 13.25 | 0 | 6.82 / 3.86 | 8.921 | 9.17 | 0 | 6.609 | 11.497 | 0 | 278230008 | 668400144 | 437.6 | 170.1 | 7.8 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.519 | 9.262 | 11.35 | 0 | 7.08 / 4.02 | 9.058 | 11.35 | 0 | 6.739 | 9.287 | 0 | 278230008 | 668400144 | 460.4 | 175 | 7.9 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.678 | 9.503 | 27.473 | 1 | 7.08 / 4.26 | 10.337 | 27.473 | 1 | 6.8 | 9.503 | 0 | 278230008 | 668400144 | 541.7 | 176.4 | 8.2 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.42 | 11.094 | 13.371 | 0 | 7.05 / 4.17 | 12.642 | 13.371 | 0 | 6.42 | 8.686 | 0 | 278230008 | 668400144 | 434.6 | 197 | 7.8 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.653 | 9.763 | 12.108 | 0 | 7.04 / 4.06 | 7.522 | 9.148 | 0 | 5.794 | 10.572 | 0 | 278230008 | 668400144 | 398.6 | 165 | 7 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.577 | 7.335 | 11.297 | 0 | 6.4 / 3.78 | 7.85 | 8.346 | 0 | 5.681 | 7.335 | 0 | 278230008 | 668400144 | 375.5 | 162.1 | 6.8 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.621 | 7.33 | 9.231 | 0 | 7 / 3.88 | 8.073 | 9.231 | 0 | 5.767 | 7.33 | 0 | 278230008 | 668400144 | 413.7 | 217.6 | 6.9 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.601 | 9.752 | 13.494 | 0 | 6.81 / 3.95 | 8.407 | 9.107 | 0 | 5.702 | 10.373 | 0 | 278230008 | 668400144 | 391.7 | 186.2 | 7 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.638 | 9.957 | 13.511 | 0 | 6.88 / 3.81 | 7.668 | 9.611 | 0 | 5.735 | 10.15 | 0 | 278230008 | 668400144 | 395.1 | 240.2 | 7.1 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.611 | 10.345 | 13.789 | 0 | 7 / 4.09 | 7.481 | 8.907 | 0 | 5.73 | 10.904 | 0 | 278230008 | 668400144 | 394.2 | 198.2 | 7 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.362 | 6.511 | 7.609 | 0 | 6.61 / 3.92 | 6.921 | 7.253 | 0 | 5.411 | 6.481 | 0 | 278210888 | 668400144 | 392.3 | 184.8 | 6.6 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.644 | 7.286 | 8.591 | 0 | 6.78 / 3.83 | 7.887 | 8.591 | 0 | 5.703 | 7.224 | 0 | 278230008 | 668400144 | 477.9 | 198.8 | 7 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.66 | 9.668 | 12.244 | 0 | 6.44 / 3.81 | 7.684 | 7.882 | 0 | 5.731 | 10.028 | 0 | 278210888 | 668400144 | 392.2 | 161.6 | 7 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.702 | 11.132 | 12.944 | 0 | 6.85 / 3.92 | 7.919 | 9.04 | 0 | 5.821 | 11.835 | 0 | 278230008 | 668400144 | 387.6 | 231.3 | 7.1 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.347 | 6.552 | 7.461 | 0 | 6.92 / 3.84 | 6.572 | 7.461 | 0 | 5.412 | 6.547 | 0 | 278210888 | 668400144 | 405.1 | 224 | 6.6 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.663 | 10.528 | 13.947 | 0 | 6.5 / 3.84 | 12.868 | 13.947 | 0 | 5.696 | 7.344 | 0 | 278230008 | 668400144 | 397.3 | 158 | 7 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.293 | 9.165 | 13.543 | 0 | 6.73 / 3.82 | 6.783 | 7.035 | 0 | 5.36 | 9.548 | 0 | 278210888 | 668400144 | 394.2 | 163.7 | 6.6 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.005 | 8.322 | 11.556 | 0 | 6.55 / 3.87 | 7.415 | 8.689 | 0 | 6.281 | 8.529 | 0 | 278230008 | 668400144 | 386.6 | 163.5 | 7.2 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.512 | 9.702 | 12.36 | 0 | 6.95 / 4.14 | 12.076 | 12.36 | 0 | 6.575 | 9.198 | 0 | 278210888 | 668400144 | 416.1 | 168.3 | 7.8 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.845 | 11.304 | 15.321 | 0 | 7.69 / 4.51 | 9.764 | 11.304 | 0 | 6.978 | 12.439 | 0 | 278230008 | 668400144 | 480.3 | 187.4 | 8.3 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.337 | 11.08 | 14.861 | 0 | 7.41 / 5.14 | 8.865 | 9.32 | 0 | 6.437 | 12.054 | 0 | 278210888 | 668400144 | 456.6 | 180.2 | 7.7 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.491 | 11.422 | 18.695 | 2 | 7.01 / 4.46 | 8.841 | 11.422 | 0 | 6.659 | 12.838 | 2 | 278230008 | 668400144 | 429.4 | 166.4 | 7.9 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.574 | 9.507 | 14.52 | 0 | 7.75 / 4.43 | 9.507 | 10.487 | 0 | 6.681 | 9.528 | 0 | 278210888 | 668400144 | 444.9 | 179.2 | 7.9 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.543 | 10.841 | 15.028 | 0 | 7.46 / 4.45 | 12.263 | 15.028 | 0 | 6.525 | 8.468 | 0 | 278230008 | 668400144 | 449.7 | 177.5 | 7.9 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.26 | 10.365 | 13.44 | 0 | 6.99 / 4.04 | 7.798 | 8.197 | 0 | 6.398 | 11.088 | 0 | 278210888 | 668400144 | 429 | 217 | 7.6 |
| 1024mib-threads-simd, warmed | 131072 | 1 | 4 |  | 13.025 | 19.439 | 21.838 | 53 | 9.08 / 5.54 | 16.724 | 17.028 | 3 | 13.554 | 20.302 | 50 | 278230008 | 668203536 | 444.2 | 194.2 | 13.6 |
| 1024mib-threads-simd, warmed | 131072 | 2 | 4 |  | 8.331 | 12.499 | 13.984 | 0 | 8.3 / 4.92 | 12.648 | 13.867 | 0 | 8.434 | 12.264 | 0 | 278230008 | 668269072 | 428.4 | 173 | 9.5 |
| 1024mib-threads-simd, warmed | 131072 | 3 | 4 |  | 7.837 | 11.426 | 15.181 | 0 | 7.97 / 5.06 | 13.363 | 15.181 | 0 | 7.953 | 10.915 | 0 | 278230008 | 668334608 | 413.1 | 169.9 | 9 |
| 1024mib-threads-simd, warmed | 131072 | 6 | 4 |  | 6.6 | 11.427 | 21.049 | 1 | 6.91 / 4.04 | 9.002 | 9.654 | 0 | 6.784 | 12.376 | 1 | 278230008 | 668531216 | 439.3 | 205.9 | 8.1 |
| 1024mib-threads, warmed | 131072 | 4 | 4 |  | 7.664 | 12.91 | 18.594 | 3 | 7.6 / 4.5 | 11.454 | 12.534 | 0 | 7.778 | 14.958 | 3 | 278230008 | 668400144 | 484.3 | 326.2 | 9.2 |
| 1024mib-threads-simd, cold | 131072 | 4 | 4 |  | 6.542 | 12.012 | 24.655 | 4 | 24.65 / 18.17 | 8.858 | 22.179 | 1 | 6.739 | 12.012 | 1 | 278230008 | 668400144 |  | 116.4 | 7.5 |
| 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.393 | 7.193 | 9.635 | 0 | 8.82 / 3.76 | 8.222 | 9.635 | 0 | 0.383 | 0.529 | 0 | 196038896 | 668400144 | 453.1 | 172.5 | 2.4 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.413 | 10.35 | 16.576 | 0 | 6.89 / 3.95 | 8.344 | 9.128 | 0 | 6.481 | 10.465 | 0 | 405628416 | 668400144 | 427.3 | 172.3 | 19.6 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 5.54 | 7.692 | 10.604 | 0 | 7.29 / 3.61 | 8.021 | 10.604 | 0 | 5.492 | 7.472 | 0 | 222452960 | 668400144 | 404.6 | 171.6 | 5.4 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 5.463 | 9.117 | 13.3 | 0 | 7.27 / 3.8 | 11.642 | 13.3 | 0 | 5.322 | 7.885 | 0 | 222603776 | 668400144 | 435.1 | 182.1 | 5.5 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 5.916 | 8.515 | 10.026 | 0 | 7.42 / 3.68 | 8.529 | 8.703 | 0 | 5.935 | 8.515 | 0 | 222407312 | 668400144 | 424.2 | 167.6 | 5.8 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 5.259 | 7.29 | 9.51 | 0 | 7.47 / 3.86 | 6.902 | 7.901 | 0 | 5.274 | 7.343 | 0 | 222564304 | 668400144 | 433.9 | 194.6 | 5.3 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.563 | 12.536 | 18.424 | 3 | 10.81 / 6.45 | 10.904 | 11.953 | 0 | 7.713 | 14.302 | 3 | 278246392 | 668400144 | 539 | 175.8 | 8.9 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.767 | 12.425 | 21.798 | 2 | 9.59 / 8.59 | 10.244 | 12.316 | 0 | 7.954 | 13.706 | 2 | 278246392 | 668400144 | 515.5 | 165.9 | 9.1 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.764 | 13.761 | 18.292 | 2 | 9.16 / 9.44 | 10.943 | 13.761 | 0 | 7.913 | 15.395 | 2 | 278246392 | 668400144 | 506 | 166 | 9.2 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.808 | 12.226 | 19.297 | 2 | 9.67 / 6.88 | 9.999 | 10.997 | 0 | 7.967 | 13.622 | 2 | 278246392 | 668400144 | 524.1 | 271.8 | 9.3 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.601 | 12.702 | 16.889 | 1 | 9.32 / 7.76 | 9.624 | 11.284 | 0 | 7.763 | 13.61 | 1 | 278246392 | 668400144 | 515.9 | 204.4 | 9 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.683 | 13.69 | 23.102 | 2 | 9.49 / 7.51 | 10.99 | 13.69 | 0 | 7.772 | 14.74 | 2 | 278246392 | 668400144 | 543.6 | 186.6 | 9.1 |
| profile 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.395 | 7.933 | 10.516 | 0 | 10.15 / 4.94 | 8.598 | 10.516 | 0 | 0.382 | 0.628 | 0 | 196055280 | 668400144 | 520.9 | 170.2 | 2.7 |
| profile 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.41 | 8.758 | 11.306 | 0 | 10.16 / 6.2 | 9.617 | 11.306 | 0 | 0.398 | 0.648 | 0 | 196055280 | 668400144 | 510.3 | 168 | 2.7 |
| profile 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.399 | 8.167 | 10.315 | 0 | 10.32 / 5.31 | 8.996 | 10.166 | 0 | 0.388 | 0.56 | 0 | 196055280 | 668400144 | 520.3 | 266.1 | 2.8 |

Probes on one configuration:

| glue | bodies | workers | solver iterations | node flags | median ms | p99 ms | max ms | ticks over budget | ticks 0 and 1 ms | settle p99 ms | settle max ms | settle over budget | steady median ms | steady p99 ms | steady over budget | arena used bytes | arena bytes | warm-up ms | load ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

Marble bowl (512 marbles, 600 ticks, 4 timed runs per tier after 1 warm run). CPU time is the main thread's run time from the scheduler statistics; wall time is beside it:

| tier | workers | clock | CPU p99 ms | CPU max ms | CPU ticks over 16.7 ms | CPU ticks over 25 ms | wall p99 ms | wall max ms | wall ticks over 16.7 ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|
| 64 MiB fixed | 1 | schedstat | 12.999 | 14.144 | 0 | 0 | 13.07 | 14.709 | 0 | 19.2 |
| 128 MiB fixed | 1 | schedstat | 10.002 | 13 | 0 | 0 | 10.198 | 12.626 | 0 | 19.3 |
| 512 MiB fixed | 1 | schedstat | 9.001 | 11.999 | 0 | 0 | 9.277 | 11.601 | 0 | 15.2 |
| 512 MiB threaded, 2 workers | 2 | schedstat | 7.999 | 10 | 0 | 0 | 8.099 | 9.627 | 0 | 11.9 |
