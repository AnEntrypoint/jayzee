## Kaggle physics run

Written by `node scripts/kaggle/record.mjs` from one `kaggle kernels output` read of `heclgang/jayzee-physics-goalpost` version 42. One JSON result per configuration; the table is that file.

- Budget: 16.7 ms per tick, 900 ticks per configuration. Ticks 0 and 1 are the boot ticks, ticks 2 to 299 the settle window, and ticks from 300 the steady window. The timed call is the whole worker tick: page streaming, follow, `engine_tick` and the pose export.
- Arena plan: 1024 players under a 1073741824 byte budget.
- Machine: Intel(R) Xeon(R) CPU @ 2.20GHz, 4 CPUs, Node v22.23.4, machine class GenuineIntel-6-79-0 (2 cores, 4 threads).
- Pushed 2026-11-12T08:41:05.241Z. Queue wait 13 s from the push to the first line of the script. Run time 546.3 s for 55 of 55 planned runs.
- reference build of engine-core-1024mib-threads-simd.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4, 4, 4, 4); in the steady window alone 131072 bodies hold it (workers 4, 4, 4, 4).
- engine-core-1024mib-threads-simd.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 2, 3, 6, 4); in the steady window alone 131072 bodies hold it (workers 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 2, 3, 6, 4).
- engine-core-1024mib-threads.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4); in the steady window alone 131072 bodies hold it (workers 4).
- engine-core-1024mib-threads-simd.mjs, cold: no body count holds the budget at p99 with zero ticks over budget; in the steady window alone 131072 bodies hold it (workers 4).
- profile build of engine-core-1024mib-threads-simd.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4, 4, 4); in the steady window alone 131072 bodies hold it (workers 4, 4, 4, 4, 4, 4).
- Refused by the arena plan: none.
- Runs that gave no result: none.

| glue | bodies | workers | solver iterations | node flags | median ms | p99 ms | max ms | ticks over budget | ticks 0 and 1 ms | settle p99 ms | settle max ms | settle over budget | steady median ms | steady p99 ms | steady over budget | arena used bytes | arena bytes | warm-up ms | load ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.227 | 11.154 | 13.558 | 0 | 8.48 / 4.86 | 11.846 | 13.558 | 0 | 7.262 | 10.845 | 0 | 278248248 | 668400144 | 1220.5 | 1040.4 | 10.2 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.684 | 9.907 | 12.808 | 0 | 7.3 / 3.85 | 7.906 | 8.912 | 0 | 5.758 | 10.802 | 0 | 278246392 | 668400144 | 1090 | 1035.7 | 8.6 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.218 | 11.667 | 27.534 | 2 | 8 / 5.01 | 9.943 | 11.667 | 0 | 7.288 | 13.21 | 2 | 278248248 | 668400144 | 1134.5 | 980.7 | 10 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.745 | 10.263 | 12.382 | 0 | 6.57 / 3.9 | 7.698 | 10.072 | 0 | 5.893 | 11.012 | 0 | 278246392 | 668400144 | 1115.7 | 1024 | 8.7 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.209 | 12.843 | 15.954 | 0 | 7.59 / 4.95 | 9.689 | 13.036 | 0 | 7.341 | 13.575 | 0 | 278248248 | 668400144 | 1195.5 | 1000.7 | 10.1 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.056 | 10.996 | 16.094 | 0 | 7.18 / 3.89 | 8.796 | 10.996 | 0 | 6.174 | 11.307 | 0 | 278246392 | 668400144 | 1081.6 | 1060.5 | 9 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.31 | 10.824 | 15.494 | 0 | 7.87 / 5.03 | 9.87 | 10.399 | 0 | 7.444 | 12.735 | 0 | 278248248 | 668400144 | 1178.5 | 1039.3 | 10.2 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.862 | 10.706 | 15.364 | 0 | 6.78 / 4.21 | 7.721 | 8.986 | 0 | 5.981 | 11.887 | 0 | 278246392 | 668400144 | 1120.3 | 1031.1 | 8.8 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.253 | 11.973 | 14.876 | 0 | 7.8 / 4.93 | 9.944 | 10.846 | 0 | 7.365 | 12.489 | 0 | 278248248 | 668400144 | 1092 | 1072.2 | 10.1 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.82 | 7.919 | 8.999 | 0 | 6.89 / 3.77 | 8.397 | 8.999 | 0 | 5.895 | 7.869 | 0 | 278246392 | 668400144 | 1104.2 | 929.9 | 8.5 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.023 | 8.739 | 11.936 | 0 | 7.16 / 3.8 | 7.776 | 8.52 | 0 | 6.216 | 8.825 | 0 | 278246392 | 668400144 | 1171.9 | 933 | 8.8 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.639 | 7.229 | 9.463 | 0 | 6.79 / 4 | 7.45 | 9.463 | 0 | 5.635 | 7.125 | 0 | 278227272 | 668400144 | 1099.5 | 1139.8 | 8.5 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.019 | 10.373 | 12.781 | 0 | 6.76 / 3.87 | 11.825 | 12.781 | 0 | 6.07 | 7.981 | 0 | 278246392 | 668400144 | 1105.5 | 1042.8 | 8.9 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.582 | 9.84 | 13.115 | 0 | 7.02 / 3.93 | 6.873 | 7.681 | 0 | 5.697 | 9.889 | 0 | 278227272 | 668400144 | 1138.5 | 962.3 | 8.5 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.769 | 10.252 | 14.271 | 0 | 7.57 / 4.03 | 8.153 | 8.63 | 0 | 5.916 | 11.312 | 0 | 278246392 | 668400144 | 1129 | 1066.5 | 8.7 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.459 | 9.488 | 13.829 | 0 | 6.93 / 3.91 | 6.838 | 6.942 | 0 | 5.526 | 11.257 | 0 | 278227272 | 668400144 | 1112.7 | 1038.6 | 8.4 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.88 | 7.847 | 9.053 | 0 | 7.4 / 4.03 | 8.774 | 9.053 | 0 | 5.932 | 7.713 | 0 | 278246392 | 668400144 | 1098.3 | 976.1 | 8.6 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.611 | 7.441 | 10.239 | 0 | 7.31 / 3.8 | 6.785 | 7.409 | 0 | 5.696 | 7.747 | 0 | 278227272 | 668400144 | 1135.5 | 1046.6 | 8.4 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.827 | 8.127 | 9.761 | 0 | 6.62 / 3.82 | 8.524 | 9.761 | 0 | 5.865 | 7.592 | 0 | 278246392 | 668400144 | 1099.1 | 861.8 | 8.5 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.552 | 9.132 | 14.735 | 0 | 6.74 / 3.95 | 11.56 | 14.735 | 0 | 5.586 | 7.161 | 0 | 278227272 | 668400144 | 1108.3 | 993.8 | 8.4 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.78 | 9.988 | 14.947 | 0 | 7.05 / 3.94 | 7.783 | 11.769 | 0 | 5.846 | 11.745 | 0 | 278246392 | 668400144 | 1107.6 | 1102.4 | 8.8 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.547 | 10.264 | 15.882 | 0 | 7.32 / 4.16 | 6.877 | 7.067 | 0 | 5.594 | 10.508 | 0 | 278227272 | 668400144 | 1115 | 1090.5 | 8.5 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.794 | 10.28 | 13.719 | 0 | 7.08 / 3.94 | 7.758 | 8.53 | 0 | 5.864 | 10.578 | 0 | 278246392 | 668400144 | 1105.8 | 982.4 | 8.6 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.464 | 6.957 | 7.569 | 0 | 6.85 / 3.78 | 6.972 | 7.569 | 0 | 5.527 | 6.957 | 0 | 278227272 | 668400144 | 1111.9 | 1099.6 | 8.3 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.733 | 7.782 | 9.961 | 0 | 7.26 / 3.89 | 8.317 | 9.961 | 0 | 5.824 | 7.782 | 0 | 278246392 | 668400144 | 1125.9 | 949.9 | 8.5 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.519 | 7.236 | 9.206 | 0 | 6.74 / 3.86 | 7.962 | 9.206 | 0 | 5.593 | 7.012 | 0 | 278227272 | 668400144 | 1121 | 971.2 | 8.3 |
| 1024mib-threads-simd, warmed | 131072 | 1 | 4 |  | 11.17 | 15.405 | 19.065 | 7 | 9.14 / 5.68 | 17.738 | 19.065 | 4 | 11.43 | 14.796 | 3 | 278246392 | 668203536 | 1107.4 | 1012.6 | 13.4 |
| 1024mib-threads-simd, warmed | 131072 | 2 | 4 |  | 7.733 | 10.513 | 14.649 | 0 | 8.29 / 4.67 | 10.295 | 11.688 | 0 | 7.894 | 10.616 | 0 | 278246392 | 668269072 | 1153.1 | 1073.7 | 10.5 |
| 1024mib-threads-simd, warmed | 131072 | 3 | 4 |  | 6.662 | 8.459 | 9.952 | 0 | 7.06 / 4.47 | 8.702 | 9.952 | 0 | 6.815 | 8.441 | 0 | 278246392 | 668334608 | 1110.8 | 955.6 | 9.3 |
| 1024mib-threads-simd, warmed | 131072 | 6 | 4 |  | 6.053 | 8.546 | 9.608 | 0 | 7.74 / 4.24 | 7.905 | 9.174 | 0 | 6.176 | 8.675 | 0 | 278246392 | 668531216 | 1145 | 940.8 | 8.9 |
| 1024mib-threads, warmed | 131072 | 4 | 4 |  | 7.325 | 10.54 | 12.593 | 0 | 7.44 / 4.39 | 8.914 | 10.976 | 0 | 7.607 | 10.631 | 0 | 278246392 | 668400144 | 1161.2 | 996.4 | 10.1 |
| 1024mib-threads-simd, cold | 131072 | 4 | 4 |  | 6.041 | 10.392 | 27.654 | 2 | 27.65 / 7.08 | 13.695 | 22.624 | 1 | 6.105 | 7.965 | 0 | 278246392 | 668400144 |  | 828.9 | 7.7 |
| 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.517 | 6.372 | 7.075 | 0 | 7.06 / 3.99 | 6.824 | 7.075 | 0 | 0.449 | 0.838 | 0 | 196055280 | 668400144 | 1213.8 | 981 | 4 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.852 | 8.756 | 14.107 | 0 | 6.59 / 4.02 | 8.44 | 10.268 | 0 | 5.87 | 8.931 | 0 | 405644800 | 668400144 | 1122.1 | 1115.5 | 19.5 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 5.339 | 6.755 | 8.069 | 0 | 6.6 / 3.54 | 7.034 | 8.069 | 0 | 5.342 | 6.666 | 0 | 222469344 | 668400144 | 1128 | 917.7 | 6.7 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 5.156 | 9.365 | 12.918 | 0 | 6.73 / 3.66 | 11.895 | 12.918 | 0 | 5.122 | 6.415 | 0 | 222620160 | 668400144 | 1100.8 | 972.1 | 6.7 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 5.357 | 6.873 | 8.71 | 0 | 6.46 / 3.65 | 6.873 | 7.588 | 0 | 5.407 | 6.907 | 0 | 222423696 | 668400144 | 1104.6 | 916.7 | 6.7 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 5.119 | 6.602 | 8.01 | 0 | 7.11 / 3.91 | 6.205 | 7.364 | 0 | 5.101 | 6.68 | 0 | 222580688 | 668400144 | 1101.6 | 966 | 6.6 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.997 | 10.288 | 15.348 | 0 | 8.91 / 6.33 | 12.623 | 15.348 | 0 | 7 | 8.677 | 0 | 278246392 | 668400144 | 1179.4 | 1075.1 | 9.9 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.024 | 11.474 | 17.86 | 1 | 9.73 / 5.38 | 15.534 | 17.86 | 1 | 7.106 | 8.736 | 0 | 278246392 | 668400144 | 1187.8 | 946.4 | 9.8 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.957 | 13.037 | 17.705 | 3 | 8.34 / 4.95 | 16.804 | 17.705 | 3 | 7.03 | 9.061 | 0 | 278246392 | 668400144 | 1192.8 | 953.6 | 9.8 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.989 | 10.535 | 15.387 | 0 | 8.43 / 4.83 | 14.234 | 15.387 | 0 | 7.044 | 8.79 | 0 | 278246392 | 668400144 | 1225.1 | 938.8 | 9.8 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.902 | 12.304 | 17.425 | 1 | 9.33 / 6.58 | 14.293 | 17.425 | 1 | 6.935 | 8.747 | 0 | 278246392 | 668400144 | 1203.5 | 928.8 | 9.7 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.852 | 11.787 | 15.31 | 0 | 9.48 / 7.25 | 13.68 | 15.31 | 0 | 6.928 | 8.768 | 0 | 278246392 | 668400144 | 1168.4 | 931.5 | 9.6 |
| profile 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.422 | 7.873 | 10.257 | 0 | 9.4 / 5.07 | 8.208 | 10.257 | 0 | 0.409 | 0.576 | 0 | 196055280 | 668400144 | 1200.6 | 963 | 4.2 |
| profile 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.394 | 7.479 | 9.256 | 0 | 9.26 / 6.34 | 8.211 | 8.525 | 0 | 0.382 | 0.693 | 0 | 196055280 | 668400144 | 1199.2 | 1001.4 | 4.2 |
| profile 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.426 | 7.701 | 9.103 | 0 | 9.1 / 6.32 | 8.047 | 8.067 | 0 | 0.409 | 0.542 | 0 | 196055280 | 668400144 | 1164.6 | 984.9 | 4.2 |

Probes on one configuration:

| glue | bodies | workers | solver iterations | node flags | median ms | p99 ms | max ms | ticks over budget | ticks 0 and 1 ms | settle p99 ms | settle max ms | settle over budget | steady median ms | steady p99 ms | steady over budget | arena used bytes | arena bytes | warm-up ms | load ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

Marble bowl (512 marbles, 600 ticks, 4 timed runs per tier after 1 warm run). CPU time is the main thread's run time from the scheduler statistics; wall time is beside it:

| tier | workers | clock | CPU p99 ms | CPU max ms | CPU ticks over 16.7 ms | CPU ticks over 25 ms | wall p99 ms | wall max ms | wall ticks over 16.7 ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|
| 64 MiB fixed | 1 | schedstat | 10.939 | 11.003 | 0 | 0 | 10.474 | 11.157 | 0 | 19.7 |
| 128 MiB fixed | 1 | schedstat | 10.969 | 11.958 | 0 | 0 | 10.753 | 12.02 | 0 | 19.8 |
| 512 MiB fixed | 1 | schedstat | 10.001 | 11.004 | 0 | 0 | 10.028 | 11.446 | 0 | 15.7 |
| 512 MiB threaded, 2 workers | 2 | schedstat | 6.999 | 8.836 | 0 | 0 | 7.01 | 9.448 | 0 | 14.3 |
