## Kaggle physics run

Written by `node scripts/kaggle/record.mjs` from one `kaggle kernels output` read of `heclgang/jayzee-physics-goalpost` version 43. One JSON result per configuration; the table is that file.

- Budget: 16.7 ms per tick, 900 ticks per configuration. Ticks 0 and 1 are the boot ticks, ticks 2 to 299 the settle window, and ticks from 300 the steady window. The timed call is the whole worker tick: page streaming, follow, `engine_tick` and the pose export.
- Arena plan: 1024 players under a 1073741824 byte budget.
- Machine: Intel(R) Xeon(R) CPU @ 2.20GHz, 4 CPUs, Node v22.23.4, machine class GenuineIntel-6-79-0 (2 cores, 4 threads).
- Pushed 2026-11-12T09:20:34.493Z. Queue wait 9 s from the push to the first line of the script. Run time 505.5 s for 55 of 55 planned runs.
- reference build of engine-core-1024mib-threads-simd.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4, 4); in the steady window alone 131072 bodies hold it (workers 4, 4).
- engine-core-1024mib-threads-simd.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 2, 3, 6, 4); in the steady window alone 131072 bodies hold it (workers 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 2, 3, 6, 4).
- engine-core-1024mib-threads.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4); in the steady window alone 131072 bodies hold it (workers 4).
- engine-core-1024mib-threads-simd.mjs, cold: no body count holds the budget at p99 with zero ticks over budget; in the steady window alone 131072 bodies hold it (workers 4).
- profile build of engine-core-1024mib-threads-simd.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4, 4, 4); in the steady window alone 131072 bodies hold it (workers 4, 4, 4).
- Refused by the arena plan: none.
- Runs that gave no result: none.

| glue | bodies | workers | solver iterations | node flags | median ms | p99 ms | max ms | ticks over budget | ticks 0 and 1 ms | settle p99 ms | settle max ms | settle over budget | steady median ms | steady p99 ms | steady over budget | arena used bytes | arena bytes | warm-up ms | load ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.903 | 9.6 | 12.347 | 0 | 7.79 / 4.72 | 10.673 | 12.347 | 0 | 6.943 | 8.939 | 0 | 278248248 | 668400144 | 1345.2 | 1106.2 | 10.2 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.055 | 9.891 | 13.528 | 0 | 6.88 / 3.79 | 11.947 | 13.528 | 0 | 6.126 | 7.868 | 0 | 278230008 | 668400144 | 422 | 171.8 | 7.5 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.304 | 11.769 | 23.952 | 4 | 7.83 / 4.73 | 17.214 | 18.584 | 3 | 7.399 | 9.521 | 1 | 278248248 | 668400144 | 1336.6 | 1142.9 | 10.6 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.25 | 11.031 | 15.254 | 0 | 6.92 / 3.94 | 9.089 | 10.072 | 0 | 6.358 | 11.88 | 0 | 278230008 | 668400144 | 472.9 | 181.8 | 7.9 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.217 | 12.696 | 19.725 | 1 | 8.37 / 4.82 | 9.639 | 13.062 | 0 | 7.405 | 12.878 | 1 | 278248248 | 668400144 | 1312 | 1145.9 | 10.6 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.988 | 10.069 | 14.097 | 0 | 6.91 / 3.85 | 8.771 | 12.065 | 0 | 6.09 | 10.625 | 0 | 278230008 | 668400144 | 456.9 | 196.9 | 7.6 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.158 | 12.241 | 14.107 | 0 | 8.14 / 4.84 | 9.133 | 10.484 | 0 | 7.286 | 13.06 | 0 | 278248248 | 668400144 | 1322.8 | 1160.1 | 10.6 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.958 | 7.81 | 10.233 | 0 | 7.05 / 3.74 | 8.97 | 10.233 | 0 | 6.026 | 7.716 | 0 | 278230008 | 668400144 | 446.9 | 181.9 | 7.4 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.19 | 12.916 | 18.848 | 1 | 8.03 / 4.69 | 9.339 | 10.021 | 0 | 7.395 | 13.527 | 1 | 278248248 | 668400144 | 1304.7 | 1124.2 | 10.5 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.974 | 7.965 | 9.754 | 0 | 6.92 / 3.84 | 8.713 | 9.686 | 0 | 6.079 | 7.965 | 0 | 278230008 | 668400144 | 433.6 | 177.3 | 7.4 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.941 | 11.513 | 14.073 | 0 | 6.84 / 3.77 | 8.17 | 8.794 | 0 | 6.046 | 12.279 | 0 | 278230008 | 668400144 | 439.1 | 175.1 | 7.5 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.694 | 7.017 | 8.197 | 0 | 6.83 / 3.88 | 6.938 | 7.32 | 0 | 5.764 | 7.049 | 0 | 278210888 | 668400144 | 443.3 | 176.7 | 7.1 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.866 | 9.421 | 12.967 | 0 | 6.82 / 4.08 | 11.496 | 12.967 | 0 | 5.975 | 7.518 | 0 | 278230008 | 668400144 | 446.4 | 184.1 | 7.4 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.599 | 9.995 | 16.466 | 0 | 7.05 / 3.9 | 6.8 | 7.136 | 0 | 5.686 | 10.523 | 0 | 278210888 | 668400144 | 447.2 | 191.8 | 7.1 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.925 | 7.719 | 9.709 | 0 | 8.01 / 4.24 | 7.984 | 9.709 | 0 | 6.019 | 7.587 | 0 | 278230008 | 668400144 | 442.4 | 204.9 | 7.4 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.577 | 6.895 | 7.472 | 0 | 7 / 3.74 | 6.732 | 7.406 | 0 | 5.661 | 6.895 | 0 | 278210888 | 668400144 | 459.2 | 316.9 | 7.1 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.898 | 10.491 | 14.549 | 0 | 7.28 / 3.92 | 7.832 | 10.084 | 0 | 6.032 | 11.175 | 0 | 278230008 | 668400144 | 428.9 | 221.4 | 7.5 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.601 | 9.236 | 16.197 | 0 | 6.62 / 3.73 | 6.97 | 7.495 | 0 | 5.708 | 9.962 | 0 | 278210888 | 668400144 | 441.6 | 176.7 | 7.1 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.916 | 7.661 | 9.949 | 0 | 6.94 / 3.91 | 7.686 | 9.949 | 0 | 6.013 | 7.611 | 0 | 278230008 | 668400144 | 439.1 | 252.9 | 7.4 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.616 | 9.312 | 16.949 | 1 | 6.82 / 3.78 | 11.909 | 16.949 | 1 | 5.652 | 6.799 | 0 | 278210888 | 668400144 | 426.2 | 172.8 | 7.1 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.799 | 10.512 | 13.615 | 0 | 6.88 / 3.82 | 8.119 | 9.517 | 0 | 5.871 | 11.647 | 0 | 278230008 | 668400144 | 442.2 | 173.9 | 7.4 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.582 | 10.199 | 14.449 | 0 | 6.7 / 3.63 | 7.082 | 7.937 | 0 | 5.632 | 11.459 | 0 | 278210888 | 668400144 | 435.3 | 215.2 | 7.1 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.91 | 7.686 | 9.929 | 0 | 6.92 / 3.84 | 7.667 | 9.887 | 0 | 6.008 | 7.687 | 0 | 278230008 | 668400144 | 444 | 172.9 | 7.3 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.655 | 9.289 | 13.599 | 0 | 6.82 / 3.9 | 12.265 | 13.599 | 0 | 5.688 | 6.965 | 0 | 278210888 | 668400144 | 444.7 | 207.3 | 7.2 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.905 | 10.174 | 16.407 | 0 | 6.75 / 3.7 | 8.414 | 9.602 | 0 | 5.994 | 10.461 | 0 | 278230008 | 668400144 | 452.6 | 214.9 | 7.5 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.543 | 6.875 | 8.225 | 0 | 6.9 / 3.8 | 6.682 | 7.224 | 0 | 5.592 | 6.903 | 0 | 278210888 | 668400144 | 445.6 | 174.6 | 6.9 |
| 1024mib-threads-simd, warmed | 131072 | 1 | 4 |  | 11.256 | 15.691 | 18.895 | 5 | 8.95 / 5.56 | 13.871 | 14.228 | 0 | 11.473 | 16.547 | 5 | 278230008 | 668203536 | 522.6 | 176.4 | 12.3 |
| 1024mib-threads-simd, warmed | 131072 | 2 | 4 |  | 7.632 | 11.869 | 13.584 | 0 | 7.62 / 4.39 | 9.88 | 10.279 | 0 | 7.831 | 12.147 | 0 | 278230008 | 668269072 | 437.3 | 227.8 | 9 |
| 1024mib-threads-simd, warmed | 131072 | 3 | 4 |  | 6.824 | 8.854 | 9.244 | 0 | 7.16 / 4.28 | 8.841 | 9.244 | 0 | 6.959 | 8.856 | 0 | 278230008 | 668334608 | 446.9 | 175.2 | 8.1 |
| 1024mib-threads-simd, warmed | 131072 | 6 | 4 |  | 5.955 | 8.08 | 8.82 | 0 | 6.88 / 3.8 | 7.877 | 8.82 | 0 | 6.107 | 8.115 | 0 | 278230008 | 668531216 | 448.6 | 283.6 | 7.7 |
| 1024mib-threads, warmed | 131072 | 4 | 4 |  | 7.004 | 11.947 | 15.675 | 0 | 7.43 / 4.21 | 14.483 | 15.675 | 0 | 7.107 | 9.096 | 0 | 278230008 | 668400144 | 500.5 | 197 | 8.5 |
| 1024mib-threads-simd, cold | 131072 | 4 | 4 |  | 5.855 | 10.486 | 26.027 | 2 | 26.03 / 7.57 | 9.115 | 21.332 | 1 | 5.969 | 10.486 | 0 | 278230008 | 668400144 |  | 120.3 | 7 |
| 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.323 | 5.934 | 8.328 | 0 | 8.33 / 3.59 | 6.447 | 7.15 | 0 | 0.317 | 0.383 | 0 | 196038896 | 668400144 | 428.5 | 186.9 | 2.2 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.888 | 8.742 | 14.656 | 0 | 6.68 / 3.81 | 7.864 | 9.092 | 0 | 5.92 | 8.915 | 0 | 405628416 | 668400144 | 433.4 | 176.8 | 18.2 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 5.318 | 7.158 | 8.755 | 0 | 8.13 / 3.84 | 7.08 | 8.755 | 0 | 5.369 | 7.158 | 0 | 222452960 | 668400144 | 442.1 | 178.4 | 5.3 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 5.168 | 9.392 | 12.534 | 0 | 7.72 / 3.45 | 11.583 | 12.534 | 0 | 5.141 | 6.341 | 0 | 222603776 | 668400144 | 439.6 | 168.9 | 5.2 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 5.449 | 6.888 | 10.598 | 0 | 7.7 / 3.61 | 7.743 | 10.598 | 0 | 5.523 | 6.871 | 0 | 222407312 | 668400144 | 439.4 | 255.7 | 5.4 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 5.198 | 6.547 | 7.76 | 0 | 7.76 / 3.37 | 6.729 | 6.894 | 0 | 5.183 | 6.441 | 0 | 222564304 | 668400144 | 453.8 | 226.7 | 5.2 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.191 | 13.243 | 18.993 | 3 | 9.3 / 6.06 | 11.543 | 14.588 | 0 | 7.282 | 14.17 | 3 | 278246392 | 668400144 | 542 | 198.8 | 8.8 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.186 | 13.116 | 17.853 | 1 | 9.47 / 7.68 | 10.646 | 10.881 | 0 | 7.303 | 14.139 | 1 | 278246392 | 668400144 | 533.6 | 356.4 | 8.9 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.205 | 12.379 | 18.115 | 1 | 9.27 / 5.5 | 10.578 | 12.323 | 0 | 7.308 | 14.567 | 1 | 278246392 | 668400144 | 539.1 | 188.9 | 8.8 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.16 | 11.885 | 15.709 | 0 | 9.83 / 5.51 | 9.675 | 11.997 | 0 | 7.218 | 13.032 | 0 | 278246392 | 668400144 | 539.5 | 180.6 | 8.7 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.213 | 9.136 | 11.808 | 0 | 9 / 7.63 | 9.829 | 10.838 | 0 | 7.283 | 8.945 | 0 | 278246392 | 668400144 | 514 | 253.5 | 8.7 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.23 | 9.413 | 15.528 | 0 | 12.94 / 6.22 | 10.603 | 15.528 | 0 | 7.32 | 9.139 | 0 | 278246392 | 668400144 | 526.7 | 178.3 | 8.7 |
| profile 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.331 | 9.341 | 14.034 | 0 | 11.21 / 5.29 | 11.087 | 14.034 | 0 | 0.324 | 0.507 | 0 | 196055280 | 668400144 | 538.9 | 180.6 | 2.9 |
| profile 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.334 | 7.742 | 11.118 | 0 | 11.12 / 5.3 | 8.436 | 8.799 | 0 | 0.323 | 0.438 | 0 | 196055280 | 668400144 | 539.5 | 176.6 | 2.7 |
| profile 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.337 | 7.662 | 11.185 | 0 | 11.19 / 5 | 8.093 | 10.151 | 0 | 0.328 | 0.429 | 0 | 196055280 | 668400144 | 549.5 | 189.9 | 2.7 |

Probes on one configuration:

| glue | bodies | workers | solver iterations | node flags | median ms | p99 ms | max ms | ticks over budget | ticks 0 and 1 ms | settle p99 ms | settle max ms | settle over budget | steady median ms | steady p99 ms | steady over budget | arena used bytes | arena bytes | warm-up ms | load ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

Marble bowl (512 marbles, 600 ticks, 4 timed runs per tier after 1 warm run). CPU time is the main thread's run time from the scheduler statistics; wall time is beside it:

| tier | workers | clock | CPU p99 ms | CPU max ms | CPU ticks over 16.7 ms | CPU ticks over 25 ms | wall p99 ms | wall max ms | wall ticks over 16.7 ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|
| 64 MiB fixed | 1 | schedstat | 12.001 | 13 | 0 | 0 | 12.3 | 13.348 | 0 | 22 |
| 128 MiB fixed | 1 | schedstat | 14.794 | 17.802 | 3 | 0 | 14.616 | 17.485 | 3 | 22.1 |
| 512 MiB fixed | 1 | schedstat | 12.933 | 14.944 | 0 | 0 | 12.501 | 15.402 | 0 | 17.7 |
| 512 MiB threaded, 2 workers | 2 | schedstat | 7 | 9.999 | 0 | 0 | 7.109 | 11.129 | 0 | 13.1 |
