## Kaggle physics run

Written by `node scripts/kaggle/record.mjs` from one `kaggle kernels output` read of `heclgang/jayzee-physics-goalpost` version 40. One JSON result per configuration; the table is that file.

- Budget: 16.7 ms per tick, 900 ticks per configuration. Ticks 0 and 1 are the boot ticks, ticks 2 to 299 the settle window, and ticks from 300 the steady window. The timed call is the whole worker tick: page streaming, follow, `engine_tick` and the pose export.
- Arena plan: 1024 players under a 1073741824 byte budget.
- Machine: Intel(R) Xeon(R) CPU @ 2.20GHz, 4 CPUs, Node v22.23.4, machine class GenuineIntel-6-79-0 (2 cores, 4 threads).
- Pushed 2026-11-11T23:29:18.911Z. Queue wait 8 s from the push to the first line of the script. Run time 611.9 s for 58 of 58 planned runs.
- reference build of engine-core-1024mib-threads-simd.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4, 4); in the steady window alone 131072 bodies hold it (workers 4, 4).
- engine-core-1024mib-threads-simd.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 2, 3); in the steady window alone 131072 bodies hold it (workers 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 2, 3).
- engine-core-1024mib-threads.mjs, warmed: no body count holds the budget at p99 with zero ticks over budget; in the steady window alone none holds it.
- engine-core-1024mib-threads-simd.mjs, cold: no body count holds the budget at p99 with zero ticks over budget; in the steady window alone 131072 bodies hold it (workers 4).
- profile build of engine-core-1024mib-threads-simd.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4, 4, 4, 4, 4, 4, 4, 4); in the steady window alone 131072 bodies hold it (workers 4, 4, 4, 4, 4, 4, 4, 4, 4).
- Refused by the arena plan: none.
- Runs that gave no result: none.

| glue | bodies | workers | solver iterations | node flags | median ms | p99 ms | max ms | ticks over budget | ticks 0 and 1 ms | settle p99 ms | settle max ms | settle over budget | steady median ms | steady p99 ms | steady over budget | arena used bytes | arena bytes | warm-up ms | load ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.35 | 10.551 | 13.86 | 0 | 8.15 / 5.03 | 12.209 | 13.86 | 0 | 7.414 | 9.496 | 0 | 278248248 | 668400144 | 1231.9 | 1055.5 | 10.3 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.712 | 9.279 | 15.825 | 0 | 7.26 / 3.93 | 10.427 | 15.825 | 0 | 5.77 | 7.695 | 0 | 278248248 | 668400144 | 1109.4 | 1015.9 | 8.6 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.142 | 11.237 | 21.27 | 1 | 7.85 / 4.97 | 12.701 | 15.447 | 0 | 7.267 | 9.851 | 1 | 278248248 | 668400144 | 1124.4 | 1032.6 | 10 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.212 | 10.621 | 16.126 | 0 | 6.75 / 3.81 | 14.883 | 16.126 | 0 | 6.241 | 8.321 | 0 | 278248248 | 668400144 | 1174.1 | 1097.7 | 9.3 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.628 | 11.354 | 15.897 | 0 | 8.2 / 5.06 | 10.305 | 11.354 | 0 | 7.725 | 12.281 | 0 | 278248248 | 668400144 | 1126.3 | 1001.6 | 10.4 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.21 | 9.775 | 12.474 | 0 | 7.27 / 3.92 | 9.123 | 12.082 | 0 | 6.306 | 10.719 | 0 | 278248248 | 668400144 | 1120.7 | 1027.6 | 9.1 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.612 | 11.481 | 17.771 | 1 | 8.7 / 5.36 | 10.628 | 11.481 | 0 | 7.675 | 11.982 | 1 | 278248248 | 668400144 | 1145.6 | 1049.8 | 10.4 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.148 | 10.351 | 16.579 | 0 | 7.13 / 3.86 | 8.358 | 10.258 | 0 | 6.289 | 10.973 | 0 | 278248248 | 668400144 | 1137.2 | 979.9 | 9 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.674 | 11.774 | 17.896 | 1 | 8.26 / 5.15 | 9.68 | 11.765 | 0 | 7.777 | 12.185 | 1 | 278248248 | 668400144 | 1165.3 | 1073.4 | 10.5 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.174 | 10.551 | 17.199 | 1 | 6.91 / 3.73 | 8.73 | 10.551 | 0 | 6.285 | 12.378 | 1 | 278248248 | 668400144 | 1169.6 | 1024.7 | 9.1 |
| reference 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 1.153 | 16.756 | 18.617 | 9 | 14.49 / 9.89 | 17.789 | 18.617 | 9 | 1.142 | 1.404 | 0 | 196109184 | 668400144 | 1107 | 941.3 | 4.5 |
| 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.453 | 14.864 | 15.864 | 0 | 13.69 / 9.16 | 15.313 | 15.864 | 0 | 0.437 | 0.566 | 0 | 196109184 | 668400144 | 1163.6 | 927.9 | 3.8 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.68 | 11.072 | 14.103 | 0 | 7.28 / 4.82 | 8.925 | 12.25 | 0 | 6.743 | 12.064 | 0 | 342582144 | 668400144 | 1118.9 | 1106.5 | 9.6 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.492 | 10.562 | 14.177 | 0 | 6.81 / 4.07 | 9.22 | 10.562 | 0 | 6.558 | 11.188 | 0 | 342569792 | 668400144 | 1098.7 | 1039.2 | 9.4 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.818 | 10.76 | 15.212 | 0 | 6.41 / 4.12 | 8.389 | 9.398 | 0 | 5.951 | 12.072 | 0 | 278250856 | 668400144 | 1159.1 | 1056.3 | 8.9 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 2 |  | 5.807 | 7.949 | 9.612 | 0 | 6.77 / 3.66 | 7.989 | 9.612 | 0 | 5.917 | 7.949 | 0 | 276984240 | 668400144 | 1136.9 | 1045.8 | 8.7 |
| reference 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 1.019 | 15.888 | 16.643 | 0 | 14.8 / 10.1 | 16.39 | 16.643 | 0 | 0.993 | 1.276 | 0 | 196109184 | 668400144 | 1196.9 | 1038.3 | 4.5 |
| 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.422 | 15.003 | 17.764 | 1 | 13.91 / 9.13 | 16.249 | 17.764 | 1 | 0.411 | 0.71 | 0 | 196109184 | 668400144 | 1203.8 | 1076.7 | 4 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.768 | 9.01 | 9.704 | 0 | 6.56 / 4.76 | 9.155 | 9.704 | 0 | 6.944 | 9.01 | 0 | 342582144 | 668400144 | 1101.4 | 1088.8 | 9.5 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.964 | 8.684 | 15.101 | 0 | 7.3 / 4.68 | 9.44 | 15.101 | 0 | 6.056 | 8.092 | 0 | 342569792 | 668400144 | 1132.5 | 975.1 | 8.9 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.827 | 9.386 | 13.421 | 0 | 6.44 / 4.02 | 11.984 | 13.421 | 0 | 5.947 | 8.033 | 0 | 278250856 | 668400144 | 1102.8 | 1044.7 | 8.7 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 2 |  | 5.717 | 9.856 | 13.808 | 0 | 7.04 / 3.74 | 7.922 | 9.553 | 0 | 5.834 | 10.012 | 0 | 276984240 | 668400144 | 1118.7 | 968.5 | 8.6 |
| reference 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.877 | 15.379 | 16.582 | 0 | 15.53 / 9.86 | 16.4 | 16.582 | 0 | 0.848 | 1.211 | 0 | 196109184 | 668400144 | 1113.4 | 1052.6 | 4.3 |
| 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.426 | 14.269 | 15.803 | 0 | 13.86 / 8.62 | 14.985 | 15.803 | 0 | 0.417 | 0.587 | 0 | 196109184 | 668400144 | 1107.1 | 964.7 | 3.7 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.479 | 11.13 | 17.597 | 2 | 6.44 / 4.63 | 8.511 | 9.654 | 0 | 6.596 | 13.342 | 2 | 342582144 | 668400144 | 1196.8 | 1011.3 | 9.4 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.407 | 11.53 | 16.363 | 0 | 6.68 / 4.04 | 8.453 | 9.856 | 0 | 6.55 | 12.334 | 0 | 342569792 | 668400144 | 1112.9 | 992.1 | 9.2 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.523 | 9.599 | 13.791 | 0 | 6.66 / 4.37 | 9.29 | 12.298 | 0 | 6.656 | 9.738 | 0 | 278250856 | 668400144 | 1169.2 | 947.3 | 9.3 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 2 |  | 5.741 | 7.9 | 10.167 | 0 | 7.38 / 3.74 | 8.523 | 10.167 | 0 | 5.737 | 7.661 | 0 | 276984240 | 668400144 | 1176.2 | 985.5 | 8.7 |
| 1024mib-threads-simd, warmed | 131072 | 1 | 4 |  | 11.381 | 15.801 | 21.968 | 3 | 8.41 / 5.35 | 14.164 | 14.328 | 0 | 11.778 | 16.168 | 3 | 278248248 | 668203536 | 1110.8 | 1074.1 | 13.7 |
| 1024mib-threads-simd, warmed | 131072 | 2 | 4 |  | 7.309 | 11.363 | 15.678 | 0 | 7.75 / 4.27 | 9.46 | 10.135 | 0 | 7.511 | 12.281 | 0 | 278248248 | 668269072 | 1113.8 | 931.4 | 10 |
| 1024mib-threads-simd, warmed | 131072 | 3 | 4 |  | 6.968 | 10.381 | 12.959 | 0 | 7.88 / 4.33 | 8.977 | 9.542 | 0 | 7.194 | 11.448 | 0 | 278248248 | 668334608 | 1086.8 | 987.3 | 9.7 |
| 1024mib-threads-simd, warmed | 131072 | 6 | 4 |  | 6.329 | 11.078 | 16.777 | 1 | 6.7 / 3.75 | 8.438 | 9.695 | 0 | 6.477 | 12.267 | 1 | 278248248 | 668531216 | 1097.5 | 986.6 | 9.2 |
| 1024mib-threads, warmed | 131072 | 4 | 4 |  | 7.548 | 13.37 | 25.207 | 2 | 7.14 / 4.25 | 9.747 | 13.564 | 0 | 7.707 | 14.083 | 2 | 278248248 | 668400144 | 1157 | 947.4 | 10.3 |
| 1024mib-threads-simd, cold | 131072 | 4 | 4 |  | 6.538 | 9.221 | 25.227 | 2 | 25.23 / 8.9 | 10.933 | 18.488 | 1 | 6.655 | 8.986 | 0 | 278248248 | 668400144 |  | 817.5 | 8.1 |
| 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.425 | 6.368 | 8.051 | 0 | 6.71 / 3.7 | 6.77 | 8.051 | 0 | 0.41 | 0.501 | 0 | 196055280 | 668400144 | 1164.1 | 1157.3 | 4.1 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.225 | 9.208 | 20.863 | 1 | 7.02 / 4.1 | 8.641 | 10.442 | 0 | 6.274 | 9.22 | 1 | 405657056 | 668400144 | 1106.8 | 1093.1 | 20.5 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 5.623 | 9.518 | 15.444 | 0 | 6.68 / 3.58 | 7.438 | 9.005 | 0 | 5.631 | 12.08 | 0 | 222472736 | 668400144 | 1165.5 | 948.2 | 7.1 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 5.48 | 7.18 | 8.673 | 0 | 6.74 / 3.55 | 7.084 | 7.28 | 0 | 5.474 | 7.289 | 0 | 222620160 | 668400144 | 1118.2 | 1019.6 | 6.9 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 5.688 | 7.272 | 9.318 | 0 | 7.05 / 3.59 | 6.829 | 8.328 | 0 | 5.714 | 7.297 | 0 | 222423696 | 668400144 | 1136.5 | 1136 | 7.2 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 5.357 | 9.678 | 11.838 | 0 | 6.83 / 3.81 | 8.974 | 9.825 | 0 | 5.351 | 10.401 | 0 | 222580688 | 668400144 | 1111.6 | 918.1 | 6.8 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.464 | 10.894 | 15.871 | 0 | 9.99 / 4.2 | 8.965 | 11.881 | 0 | 6.485 | 12.095 | 0 | 278248248 | 668400144 | 1137.3 | 988.1 | 9.4 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.599 | 10.461 | 15.969 | 0 | 10.46 / 4.05 | 8.515 | 10.105 | 0 | 6.735 | 11.51 | 0 | 278248248 | 668400144 | 1150.6 | 1027.5 | 9.5 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.405 | 10.847 | 18.321 | 2 | 9.08 / 4.15 | 8.806 | 10.8 | 0 | 6.433 | 12.273 | 2 | 278248248 | 668400144 | 1143 | 1029.9 | 9.4 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.301 | 10.74 | 15.145 | 0 | 8.36 / 4.01 | 8.466 | 10.957 | 0 | 6.505 | 10.99 | 0 | 278248248 | 668400144 | 1134.1 | 930.6 | 9.1 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.416 | 8.704 | 10.691 | 0 | 9.03 / 4 | 8.945 | 10.691 | 0 | 6.592 | 8.481 | 0 | 278248248 | 668400144 | 1132.9 | 1098.1 | 9.3 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.488 | 9.031 | 9.901 | 0 | 9.8 / 4.26 | 9.051 | 9.901 | 0 | 6.581 | 8.893 | 0 | 278248248 | 668400144 | 1158.8 | 1067.8 | 9.4 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.123 | 8.217 | 9.686 | 0 | 9.34 / 3.88 | 8.265 | 9.686 | 0 | 6.203 | 8.213 | 0 | 278248248 | 668400144 | 1169.3 | 909.6 | 8.9 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.032 | 8.237 | 10.471 | 0 | 8.47 / 3.91 | 8.767 | 10.471 | 0 | 6.115 | 7.976 | 0 | 278248248 | 668400144 | 1134.5 | 1067.8 | 8.9 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.112 | 10.215 | 18.678 | 1 | 9.06 / 3.96 | 12.47 | 18.678 | 1 | 6.192 | 8.234 | 0 | 278248248 | 668400144 | 1118.9 | 927.4 | 9 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.207 | 10.49 | 14.66 | 0 | 10.15 / 4.22 | 13.171 | 14.66 | 0 | 6.351 | 8.747 | 0 | 278248248 | 668400144 | 1139.9 | 932.9 | 9.1 |

Probes on one configuration:

| glue | bodies | workers | solver iterations | node flags | median ms | p99 ms | max ms | ticks over budget | ticks 0 and 1 ms | settle p99 ms | settle max ms | settle over budget | steady median ms | steady p99 ms | steady over budget | arena used bytes | arena bytes | warm-up ms | load ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

Marble bowl (512 marbles, 600 ticks, 4 timed runs per tier after 1 warm run). CPU time is the main thread's run time from the scheduler statistics; wall time is beside it:

| tier | workers | clock | CPU p99 ms | CPU max ms | CPU ticks over 16.7 ms | CPU ticks over 25 ms | wall p99 ms | wall max ms | wall ticks over 16.7 ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|
| 64 MiB fixed | 1 | schedstat | 11.002 | 12.992 | 0 | 0 | 11.219 | 12.817 | 0 | 20 |
| 128 MiB fixed | 1 | schedstat | 11 | 13 | 0 | 0 | 11.325 | 13.27 | 0 | 20 |
| 512 MiB fixed | 1 | schedstat | 9.91 | 10.999 | 0 | 0 | 9.421 | 11.459 | 0 | 15.9 |
| 512 MiB threaded, 2 workers | 2 | schedstat | 7.998 | 8.588 | 0 | 0 | 7.71 | 11.507 | 0 | 14.8 |
