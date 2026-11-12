## Kaggle physics run

Written by `node scripts/kaggle/record.mjs` from one `kaggle kernels output` read of `heclgang/jayzee-physics-goalpost` version 45. One JSON result per configuration; the table is that file.

- Budget: 16.7 ms per tick, 900 ticks per configuration. Ticks 0 and 1 are the boot ticks, ticks 2 to 299 the settle window, and ticks from 300 the steady window. The timed call is the whole worker tick: page streaming, follow, `engine_tick` and the pose export.
- Arena plan: 1024 players under a 1073741824 byte budget.
- Machine: AMD EPYC 7B12, 4 CPUs, Node v22.23.4, machine class AuthenticAMD-23-49-0 (2 cores, 4 threads).
- Pushed 2026-11-12T10:56:48.856Z. Queue wait 12 s from the push to the first line of the script. Run time 386.8 s for 55 of 55 planned runs.
- reference build of engine-core-1024mib-threads-simd.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4, 4, 4, 4); in the steady window alone 131072 bodies hold it (workers 4, 4, 4, 4).
- engine-core-1024mib-threads-simd.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 1, 2, 3, 6, 4); in the steady window alone 131072 bodies hold it (workers 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 1, 2, 3, 6, 4).
- engine-core-1024mib-threads.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4); in the steady window alone 131072 bodies hold it (workers 4).
- engine-core-1024mib-threads-simd.mjs, cold: no body count holds the budget at p99 with zero ticks over budget; in the steady window alone 131072 bodies hold it (workers 4).
- profile build of engine-core-1024mib-threads-simd.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4, 4, 4, 4, 4); in the steady window alone 131072 bodies hold it (workers 4, 4, 4, 4, 4, 4).
- Refused by the arena plan: none.
- Runs that gave no result: none.

| glue | bodies | workers | solver iterations | node flags | median ms | p99 ms | max ms | ticks over budget | ticks 0 and 1 ms | settle p99 ms | settle max ms | settle over budget | steady median ms | steady p99 ms | steady over budget | arena used bytes | arena bytes | warm-up ms | load ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.515 | 8.561 | 11.803 | 0 | 5.59 / 4.06 | 7.45 | 9.619 | 0 | 5.643 | 8.873 | 0 | 278248248 | 668400144 | 686.1 | 529.4 | 7.1 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 4.94 | 6.008 | 7.18 | 0 | 5.13 / 3.06 | 6.569 | 7.18 | 0 | 4.992 | 5.937 | 0 | 278230008 | 668400144 | 260.6 | 123.1 | 5.6 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.562 | 8.814 | 11.176 | 0 | 5.52 / 3.79 | 10.713 | 11.176 | 0 | 5.618 | 7.263 | 0 | 278248248 | 668400144 | 661.5 | 522.3 | 7 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 4.86 | 7.082 | 8.838 | 0 | 4.68 / 3 | 6.168 | 8.772 | 0 | 4.992 | 7.245 | 0 | 278230008 | 668400144 | 256.4 | 128.6 | 5.4 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.327 | 6.953 | 31.909 | 1 | 5.29 / 3.21 | 6.91 | 8.334 | 0 | 5.395 | 7.375 | 1 | 278248248 | 668400144 | 693.8 | 526.4 | 6.8 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 4.858 | 7.394 | 10.352 | 0 | 4.63 / 2.89 | 6.384 | 8.502 | 0 | 4.974 | 7.524 | 0 | 278230008 | 668400144 | 263.3 | 124.7 | 5.5 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.539 | 7.337 | 12.155 | 0 | 5.45 / 3.47 | 8.422 | 12.155 | 0 | 5.615 | 7.1 | 0 | 278248248 | 668400144 | 656.7 | 522.8 | 7 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 4.933 | 6.317 | 8.237 | 0 | 5.27 / 3.55 | 6.722 | 8.237 | 0 | 4.971 | 6.161 | 0 | 278230008 | 668400144 | 275.2 | 137.7 | 5.5 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.808 | 9.819 | 12.384 | 0 | 5.85 / 3.7 | 7.813 | 8.917 | 0 | 5.897 | 10.625 | 0 | 278248248 | 668400144 | 659.1 | 541.8 | 7.3 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.002 | 6.402 | 7.716 | 0 | 5.4 / 3.26 | 6.565 | 7.716 | 0 | 5.039 | 6.254 | 0 | 278230008 | 668400144 | 264.8 | 131.9 | 5.7 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 4.984 | 7.795 | 10.361 | 0 | 4.78 / 3.08 | 7.236 | 7.896 | 0 | 5.103 | 8.195 | 0 | 278230008 | 668400144 | 264 | 125.1 | 5.6 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 4.783 | 6.009 | 8.037 | 0 | 5.45 / 3.85 | 5.878 | 7.272 | 0 | 4.81 | 6.127 | 0 | 278210888 | 668400144 | 261.9 | 140.5 | 5.3 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 4.823 | 7.137 | 10.282 | 0 | 4.84 / 3.09 | 9.627 | 10.282 | 0 | 4.792 | 5.939 | 0 | 278230008 | 668400144 | 268.3 | 128.5 | 5.4 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 4.712 | 5.676 | 7.198 | 0 | 5.04 / 3.16 | 5.618 | 6.413 | 0 | 4.749 | 5.683 | 0 | 278210888 | 668400144 | 264.6 | 125.4 | 5.3 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 4.905 | 6.197 | 7.138 | 0 | 6.6 / 2.85 | 6.253 | 7.138 | 0 | 4.975 | 6.175 | 0 | 278230008 | 668400144 | 249.8 | 124.7 | 5.6 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 4.724 | 6.814 | 9.78 | 0 | 4.76 / 3.15 | 5.552 | 5.654 | 0 | 4.795 | 7.871 | 0 | 278210888 | 668400144 | 264.8 | 126.7 | 5.3 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 4.985 | 6.371 | 7.03 | 0 | 3.86 / 1.97 | 6.541 | 6.839 | 0 | 5.053 | 6.325 | 0 | 278230008 | 668400144 | 258.7 | 122.6 | 5.5 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 4.68 | 7.815 | 10.904 | 0 | 4.88 / 3.13 | 5.886 | 6.272 | 0 | 4.694 | 8.688 | 0 | 278210888 | 668400144 | 266.8 | 125.3 | 5.3 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 4.875 | 6.189 | 7.069 | 0 | 4.84 / 3.22 | 6.638 | 7.069 | 0 | 4.936 | 6.174 | 0 | 278230008 | 668400144 | 259.2 | 128.9 | 5.4 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 4.66 | 6.689 | 7.635 | 0 | 4.93 / 3.15 | 5.944 | 6.553 | 0 | 4.721 | 7.047 | 0 | 278210888 | 668400144 | 262.6 | 126.6 | 5.2 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 4.944 | 6.25 | 7.143 | 0 | 4.91 / 2.35 | 6.091 | 7.143 | 0 | 5.042 | 6.344 | 0 | 278230008 | 668400144 | 259 | 130.6 | 5.5 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 4.713 | 7.875 | 11.126 | 0 | 4.88 / 5.02 | 6.191 | 6.37 | 0 | 4.751 | 8.105 | 0 | 278210888 | 668400144 | 258.6 | 126.9 | 5.3 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 4.987 | 6.504 | 7.334 | 0 | 5.13 / 3.32 | 6.531 | 7.334 | 0 | 5.075 | 6.503 | 0 | 278230008 | 668400144 | 266.1 | 124.6 | 5.6 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 4.866 | 8.431 | 12.96 | 0 | 5.49 / 3.26 | 10.166 | 12.96 | 0 | 4.903 | 6.158 | 0 | 278210888 | 668400144 | 266.5 | 132.1 | 5.5 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 4.97 | 6.187 | 8.824 | 0 | 5.13 / 3.13 | 6.658 | 8.824 | 0 | 5.029 | 6.112 | 0 | 278230008 | 668400144 | 266.2 | 125.2 | 5.7 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 4.817 | 6.078 | 9.277 | 0 | 6.18 / 3.88 | 6.604 | 9.277 | 0 | 4.838 | 5.944 | 0 | 278210888 | 668400144 | 256.8 | 126.7 | 5.5 |
| 1024mib-threads-simd, warmed | 131072 | 1 | 4 |  | 6.3 | 9.979 | 11.372 | 0 | 5.24 / 3.24 | 10.283 | 11.372 | 0 | 6.452 | 9.979 | 0 | 278230008 | 668203536 | 270.9 | 125.8 | 7 |
| 1024mib-threads-simd, warmed | 131072 | 2 | 4 |  | 7.345 | 8.969 | 9.823 | 0 | 6.31 / 4.33 | 9.006 | 9.823 | 0 | 7.536 | 8.969 | 0 | 278230008 | 668269072 | 259.4 | 131.4 | 7.5 |
| 1024mib-threads-simd, warmed | 131072 | 3 | 4 |  | 5.947 | 7.951 | 9.439 | 0 | 5.43 / 3.5 | 8.304 | 8.737 | 0 | 5.95 | 7.767 | 0 | 278230008 | 668334608 | 271.7 | 147.9 | 6.6 |
| 1024mib-threads-simd, warmed | 131072 | 6 | 4 |  | 5.168 | 8.411 | 11.207 | 0 | 5.26 / 3.45 | 6.619 | 6.969 | 0 | 5.313 | 9.474 | 0 | 278230008 | 668531216 | 275.1 | 133.2 | 5.8 |
| 1024mib-threads, warmed | 131072 | 4 | 4 |  | 6.045 | 7.824 | 8.79 | 0 | 5.36 / 3.35 | 7.904 | 8.79 | 0 | 6.147 | 7.824 | 0 | 278230008 | 668400144 | 310.2 | 132 | 6.6 |
| 1024mib-threads-simd, cold | 131072 | 4 | 4 |  | 5.158 | 7.004 | 19.238 | 2 | 18.84 / 11.04 | 7.773 | 19.238 | 1 | 5.191 | 6.341 | 0 | 278230008 | 668400144 |  | 77.3 | 5.5 |
| 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.182 | 5.64 | 7.223 | 0 | 5.48 / 3.15 | 6.016 | 7.223 | 0 | 0.175 | 0.251 | 0 | 196038896 | 668400144 | 270 | 134 | 1.8 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.088 | 7.047 | 12.958 | 0 | 4.95 / 3.32 | 6.68 | 7.642 | 0 | 5.103 | 7.141 | 0 | 405628416 | 668400144 | 268.5 | 132.8 | 14.6 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 4.889 | 6.757 | 7.513 | 0 | 5.71 / 3.44 | 6.232 | 6.398 | 0 | 4.987 | 6.864 | 0 | 222452960 | 668400144 | 324.1 | 129 | 4.6 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 4.795 | 6.389 | 8.144 | 0 | 5.29 / 3.07 | 6.556 | 6.858 | 0 | 4.779 | 6.382 | 0 | 222603776 | 668400144 | 281.6 | 158.7 | 4.4 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 5.226 | 7.1 | 8.073 | 0 | 5.44 / 3.36 | 7.269 | 8.073 | 0 | 5.224 | 6.849 | 0 | 222407312 | 668400144 | 304 | 164.7 | 4.8 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 4.819 | 6.445 | 7.894 | 0 | 5.63 / 3.15 | 6.18 | 6.433 | 0 | 4.859 | 6.744 | 0 | 222564304 | 668400144 | 269.8 | 139.9 | 4.5 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.828 | 10.638 | 13.135 | 0 | 6.65 / 3.46 | 12.493 | 13.135 | 0 | 6.859 | 8.916 | 0 | 278246392 | 668400144 | 353.4 | 205 | 7.6 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.762 | 11.234 | 16.456 | 0 | 7.24 / 4.69 | 8.449 | 9.055 | 0 | 6.831 | 12.4 | 0 | 278246392 | 668400144 | 419.2 | 145 | 7.6 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.53 | 10.676 | 12.954 | 0 | 5.53 / 5.4 | 8.893 | 9.295 | 0 | 6.621 | 11.501 | 0 | 278246392 | 668400144 | 359 | 133.4 | 7.3 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.428 | 8.042 | 9.516 | 0 | 6.93 / 5.61 | 8.484 | 8.675 | 0 | 6.468 | 8.025 | 0 | 278246392 | 668400144 | 383.8 | 163.8 | 7.2 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.575 | 10.211 | 16.86 | 1 | 7.05 / 5.69 | 13.546 | 16.86 | 1 | 6.685 | 8.589 | 0 | 278246392 | 668400144 | 360.9 | 204.1 | 7.4 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.53 | 9.668 | 14.939 | 0 | 5.52 / 4.2 | 8.632 | 9.835 | 0 | 6.623 | 10.237 | 0 | 278246392 | 668400144 | 346.7 | 135.8 | 7.3 |
| profile 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.207 | 7.551 | 8.437 | 0 | 8.12 / 3.41 | 8.085 | 8.437 | 0 | 0.198 | 0.439 | 0 | 196055280 | 668400144 | 359.7 | 142.7 | 2.2 |
| profile 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.231 | 7.13 | 7.953 | 0 | 7.95 / 4.2 | 7.461 | 7.677 | 0 | 0.208 | 0.54 | 0 | 196055280 | 668400144 | 356.5 | 131.7 | 2.2 |
| profile 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.217 | 7.991 | 9.282 | 0 | 8.28 / 4.51 | 8.728 | 9.282 | 0 | 0.201 | 0.457 | 0 | 196055280 | 668400144 | 353.4 | 151 | 2.3 |

Probes on one configuration:

| glue | bodies | workers | solver iterations | node flags | median ms | p99 ms | max ms | ticks over budget | ticks 0 and 1 ms | settle p99 ms | settle max ms | settle over budget | steady median ms | steady p99 ms | steady over budget | arena used bytes | arena bytes | warm-up ms | load ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

Marble bowl (512 marbles, 600 ticks, 4 timed runs per tier after 1 warm run). CPU time is the main thread's run time from the scheduler statistics; wall time is beside it:

| tier | workers | clock | CPU p99 ms | CPU max ms | CPU ticks over 16.7 ms | CPU ticks over 25 ms | wall p99 ms | wall max ms | wall ticks over 16.7 ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|
| 64 MiB fixed | 1 | schedstat | 9.001 | 12.896 | 0 | 0 | 9.185 | 12.089 | 0 | 13.9 |
| 128 MiB fixed | 1 | schedstat | 8.002 | 9.001 | 0 | 0 | 8.426 | 9.2 | 0 | 14 |
| 512 MiB fixed | 1 | schedstat | 7.001 | 8.897 | 0 | 0 | 6.754 | 8.447 | 0 | 11 |
| 512 MiB threaded, 2 workers | 2 | schedstat | 6.999 | 8 | 0 | 0 | 7.105 | 9.616 | 0 | 10.9 |
