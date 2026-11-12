## Kaggle physics run

Written by `node scripts/kaggle/record.mjs` from one `kaggle kernels output` read of `heclgang/jayzee-physics-goalpost` version 53. One JSON result per configuration; the table is that file.

- Budget: 16.7 ms per tick, 900 ticks per configuration. Ticks 0 and 1 are the boot ticks, ticks 2 to 299 the settle window, and ticks from 300 the steady window. The timed call is the whole worker tick: page streaming, follow, `engine_tick` and the pose export.
- Arena plan: 1024 players under a 1073741824 byte budget.
- Machine: Intel(R) Xeon(R) CPU @ 2.20GHz, 4 CPUs, Node v22.23.4, machine class GenuineIntel-6-79-0 (2 cores, 4 threads).
- Pushed 2026-11-12T14:16:11.595Z. Queue wait 7 s from the push to the first line of the script. Run time 501 s for 55 of 55 planned runs.
- reference build of engine-core-1024mib-threads-simd.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4); in the steady window alone 131072 bodies hold it (workers 4, 4, 4).
- engine-core-1024mib-threads-simd.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 3, 6, 4); in the steady window alone 131072 bodies hold it (workers 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 3, 6, 4).
- engine-core-1024mib-threads.mjs, warmed: no body count holds the budget at p99 with zero ticks over budget; in the steady window alone 131072 bodies hold it (workers 4).
- engine-core-1024mib-threads-simd.mjs, cold: no body count holds the budget at p99 with zero ticks over budget; in the steady window alone 131072 bodies hold it (workers 4).
- profile build of engine-core-1024mib-threads-simd.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4, 4, 4); in the steady window alone 131072 bodies hold it (workers 4, 4, 4).
- Refused by the arena plan: none.
- Runs that gave no result: none.

| glue | bodies | workers | solver iterations | node flags | median ms | p99 ms | max ms | ticks over budget | ticks 0 and 1 ms | settle p99 ms | settle max ms | settle over budget | steady median ms | steady p99 ms | steady over budget | arena used bytes | arena bytes | warm-up ms | load ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.437 | 11.176 | 20.459 | 1 | 10.44 / 6.13 | 15.088 | 20.459 | 1 | 6.484 | 11.061 | 0 | 278230008 | 668400144 | 449.5 | 184.9 | 8.2 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.355 | 12.377 | 16.361 | 0 | 10.38 / 6.61 | 13.804 | 16.361 | 0 | 6.407 | 10.659 | 0 | 268416056 | 668400144 | 461.9 | 185.3 | 8 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.738 | 14.441 | 33.224 | 3 | 8.96 / 4.22 | 10.552 | 11.308 | 0 | 7.404 | 14.964 | 3 | 278230008 | 668400144 | 442.9 | 208.7 | 8.8 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.159 | 15.25 | 18.703 | 4 | 7.99 / 4.32 | 10.176 | 11.932 | 0 | 8.912 | 16.186 | 4 | 268416056 | 668400144 | 432.6 | 175.9 | 9.2 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.045 | 13.215 | 17.234 | 2 | 9.05 / 5.93 | 10.295 | 11.786 | 0 | 8.932 | 14.327 | 2 | 278230008 | 668400144 | 466.6 | 199.4 | 9.1 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.767 | 13.165 | 18.206 | 3 | 10 / 6.17 | 12.22 | 13.31 | 0 | 7.072 | 13.557 | 3 | 268416056 | 668400144 | 427.1 | 181.1 | 8.6 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.85 | 12.822 | 15.788 | 0 | 8.21 / 4.39 | 14.47 | 15.788 | 0 | 6.671 | 9.789 | 0 | 278230008 | 668400144 | 485.4 | 189.5 | 8.7 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.54 | 10.734 | 11.85 | 0 | 7.14 / 4.25 | 10.397 | 11.116 | 0 | 6.645 | 10.766 | 0 | 268416056 | 668400144 | 440.9 | 208.9 | 8.3 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.498 | 14.815 | 27.382 | 3 | 10.89 / 6.29 | 17.527 | 27.382 | 3 | 6.42 | 10.377 | 0 | 278230008 | 668400144 | 445.4 | 195.3 | 8.4 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.692 | 14.583 | 16.478 | 0 | 9.8 / 6.58 | 9.344 | 10.682 | 0 | 6.867 | 14.765 | 0 | 268416056 | 668400144 | 476.5 | 338.1 | 8.7 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.271 | 12.08 | 15.095 | 0 | 7.73 / 4.36 | 13.33 | 15.095 | 0 | 6.269 | 10.732 | 0 | 268416056 | 668400144 | 444.9 | 257.4 | 8.1 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.779 | 9.615 | 14.252 | 0 | 7 / 3.95 | 7.666 | 8.545 | 0 | 5.893 | 10.215 | 0 | 268396936 | 668400144 | 412.6 | 176.1 | 7.2 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.03 | 11.18 | 13.972 | 0 | 7.62 / 4.12 | 8.5 | 8.649 | 0 | 6.135 | 11.616 | 0 | 268416056 | 668400144 | 422.7 | 261.8 | 7.6 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.773 | 9.962 | 11.291 | 0 | 7.19 / 4.12 | 8.23 | 8.731 | 0 | 5.91 | 10.059 | 0 | 268396936 | 668400144 | 405.6 | 178.4 | 7.3 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.277 | 13.378 | 18.94 | 4 | 8.73 / 5.86 | 17.438 | 18.94 | 4 | 6.344 | 11.01 | 0 | 268416056 | 668400144 | 441.2 | 178.8 | 8.2 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.981 | 10.294 | 16.426 | 0 | 9.01 / 5.93 | 9.703 | 9.765 | 0 | 6.011 | 10.602 | 0 | 268396936 | 668400144 | 425.1 | 183.8 | 7.8 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.257 | 11.455 | 14.272 | 0 | 7.1 / 4.09 | 10.908 | 13.083 | 0 | 6.283 | 12.36 | 0 | 268416056 | 668400144 | 430 | 173 | 7.9 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.276 | 12.195 | 16.554 | 0 | 9.17 / 6.09 | 11.862 | 12.949 | 0 | 6.129 | 12.544 | 0 | 268396936 | 668400144 | 452.1 | 194.5 | 8.8 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.119 | 8.82 | 14.832 | 0 | 7.06 / 4.05 | 8.556 | 9.014 | 0 | 6.237 | 9.023 | 0 | 268416056 | 668400144 | 420.4 | 213.4 | 7.5 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.864 | 10.493 | 12.428 | 0 | 7.2 / 4.02 | 11.113 | 12.428 | 0 | 5.923 | 8.309 | 0 | 268396936 | 668400144 | 431.4 | 178 | 7.3 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.002 | 9.713 | 16.23 | 0 | 7.39 / 4.11 | 8.71 | 9.573 | 0 | 6.088 | 10.232 | 0 | 268416056 | 668400144 | 414.3 | 191.9 | 7.5 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.813 | 10.098 | 13.743 | 0 | 7.22 / 4.04 | 7.116 | 7.907 | 0 | 5.91 | 10.68 | 0 | 268396936 | 668400144 | 405 | 168.4 | 7.2 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.225 | 8.957 | 11.181 | 0 | 7.12 / 4.07 | 10.08 | 10.695 | 0 | 6.394 | 8.957 | 0 | 268416056 | 668400144 | 439.7 | 174 | 7.6 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.774 | 9.482 | 12.38 | 0 | 7.28 / 4.19 | 11.585 | 12.38 | 0 | 5.741 | 7.011 | 0 | 268396936 | 668400144 | 421.9 | 177.5 | 7.1 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.035 | 10.48 | 14.264 | 0 | 7.17 / 4.03 | 8.512 | 8.971 | 0 | 6.215 | 10.538 | 0 | 268416056 | 668400144 | 420.9 | 173.2 | 7.5 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.797 | 9.866 | 15.12 | 0 | 7.11 / 4 | 7.556 | 7.956 | 0 | 5.924 | 10.251 | 0 | 268396936 | 668400144 | 418.9 | 201.2 | 7.2 |
| 1024mib-threads-simd, warmed | 131072 | 1 | 4 |  | 11.154 | 16.631 | 26.602 | 8 | 8.62 / 5.52 | 14.59 | 18.739 | 1 | 11.62 | 17.056 | 7 | 268415992 | 668203536 | 411.3 | 170.6 | 12.1 |
| 1024mib-threads-simd, warmed | 131072 | 2 | 4 |  | 7.617 | 11.757 | 17.039 | 1 | 8.07 / 4.79 | 10.212 | 11.251 | 0 | 7.762 | 12.676 | 1 | 268416056 | 668269072 | 447 | 171.2 | 8.9 |
| 1024mib-threads-simd, warmed | 131072 | 3 | 4 |  | 6.71 | 9.071 | 11.162 | 0 | 7.67 / 4.51 | 9.076 | 10.445 | 0 | 6.815 | 9.071 | 0 | 268416056 | 668334608 | 433.2 | 170.8 | 8 |
| 1024mib-threads-simd, warmed | 131072 | 6 | 4 |  | 5.976 | 8.673 | 10.361 | 0 | 6.93 / 3.92 | 8.414 | 9.783 | 0 | 6.126 | 8.882 | 0 | 268416120 | 668531216 | 444.4 | 179.4 | 7.5 |
| 1024mib-threads, warmed | 131072 | 4 | 4 |  | 7.555 | 13.062 | 20.696 | 2 | 7.79 / 4.58 | 16.678 | 20.696 | 2 | 7.631 | 10.397 | 0 | 268416056 | 668400144 | 488.2 | 179.2 | 9 |
| 1024mib-threads-simd, cold | 131072 | 4 | 4 |  | 6.179 | 10.91 | 25.931 | 1 | 25.93 / 9.04 | 12.28 | 15.923 | 0 | 6.311 | 10.871 | 0 | 268416056 | 668400144 |  | 118.4 | 7.2 |
| 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.048 | 5.469 | 7.144 | 0 | 4.65 / 3.22 | 5.913 | 7.144 | 0 | 0.047 | 0.111 | 0 | 182090308 | 668400144 | 429.2 | 180.5 | 1.9 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.956 | 9.517 | 15.702 | 0 | 7.41 / 4.21 | 8.247 | 10.334 | 0 | 5.986 | 9.59 | 0 | 395814464 | 668400144 | 424.8 | 190.6 | 18.3 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 4.977 | 6.864 | 9.46 | 0 | 4.83 / 3.27 | 6.726 | 7.7 | 0 | 5.032 | 7.122 | 0 | 209620160 | 668400144 | 428.7 | 168.8 | 4.9 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 4.869 | 8.899 | 14.356 | 0 | 5.04 / 3.51 | 11.105 | 14.356 | 0 | 4.867 | 6.682 | 0 | 209770976 | 668400144 | 433.6 | 192.3 | 5 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 5.065 | 7.029 | 11.327 | 0 | 4.94 / 3.14 | 7.378 | 9.599 | 0 | 5.119 | 6.663 | 0 | 209574512 | 668400144 | 430.2 | 170.3 | 5 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 4.846 | 9.222 | 11.813 | 0 | 4.94 / 3.25 | 10.044 | 11.813 | 0 | 4.818 | 6.241 | 0 | 209731504 | 668400144 | 452.2 | 167.9 | 5 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.474 | 13.504 | 17.322 | 1 | 11.19 / 5.9 | 10.771 | 11.468 | 0 | 7.657 | 14.342 | 1 | 268432440 | 668400144 | 514.8 | 174.2 | 9 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.403 | 12.095 | 17.103 | 2 | 10.3 / 5.96 | 10.329 | 12.095 | 0 | 7.514 | 13.01 | 2 | 268432440 | 668400144 | 516.4 | 176.5 | 8.9 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.45 | 12.402 | 18.155 | 2 | 9.66 / 5.46 | 10.438 | 12.627 | 0 | 7.57 | 13.345 | 2 | 268432440 | 668400144 | 527.5 | 185.9 | 8.9 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.238 | 9.315 | 12.973 | 0 | 10.23 / 5.4 | 9.44 | 12.973 | 0 | 7.367 | 9.295 | 0 | 268432440 | 668400144 | 516.2 | 202.4 | 8.6 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.159 | 9.725 | 16.442 | 0 | 9.56 / 5.87 | 10.204 | 11.458 | 0 | 7.22 | 9.579 | 0 | 268432440 | 668400144 | 566.9 | 299.8 | 8.7 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.324 | 11.884 | 14.725 | 0 | 9.47 / 5.5 | 13.103 | 14.725 | 0 | 7.387 | 9.822 | 0 | 268432440 | 668400144 | 523.2 | 192.7 | 8.8 |
| profile 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.054 | 7.184 | 9.19 | 0 | 7.17 / 4.73 | 8.072 | 9.19 | 0 | 0.052 | 0.152 | 0 | 182106692 | 668400144 | 531.5 | 174.2 | 2.4 |
| profile 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.054 | 7.171 | 11.84 | 0 | 11.84 / 9.6 | 7.656 | 8.874 | 0 | 0.052 | 0.104 | 0 | 182106692 | 668400144 | 548.4 | 186 | 2.4 |
| profile 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.055 | 7.313 | 9.863 | 0 | 7.08 / 4.45 | 8.891 | 9.863 | 0 | 0.053 | 0.121 | 0 | 182106692 | 668400144 | 508 | 183.1 | 2.4 |

Probes on one configuration:

| glue | bodies | workers | solver iterations | node flags | median ms | p99 ms | max ms | ticks over budget | ticks 0 and 1 ms | settle p99 ms | settle max ms | settle over budget | steady median ms | steady p99 ms | steady over budget | arena used bytes | arena bytes | warm-up ms | load ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

Marble bowl (512 marbles, 600 ticks, 4 timed runs per tier after 1 warm run). CPU time is the main thread's run time from the scheduler statistics; wall time is beside it:

| tier | workers | clock | CPU p99 ms | CPU max ms | CPU ticks over 16.7 ms | CPU ticks over 25 ms | wall p99 ms | wall max ms | wall ticks over 16.7 ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|
| 64 MiB fixed | 1 | schedstat | 13.257 | 17.836 | 2 | 0 | 13.966 | 17.877 | 3 | 21.5 |
| 128 MiB fixed | 1 | schedstat | 12.744 | 16.6 | 0 | 0 | 13.165 | 16.892 | 1 | 21.3 |
| 512 MiB fixed | 1 | schedstat | 11.686 | 14.541 | 0 | 0 | 11.476 | 17.425 | 1 | 16.7 |
| 512 MiB threaded, 2 workers | 2 | schedstat | 8.067 | 9.762 | 0 | 0 | 8.687 | 11.872 | 0 | 13.9 |
