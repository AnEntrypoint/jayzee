## Kaggle physics run

Written by `node scripts/kaggle/record.mjs` from one `kaggle kernels output` read of `heclgang/jayzee-physics-goalpost` version 11. One JSON result per configuration; the table is that file.

- Budget: 16.7 ms per tick, 900 ticks per configuration. Ticks 0 and 1 are the boot ticks, ticks 2 to 299 the settle window, and ticks from 300 the steady window. The timed call is the whole worker tick: page streaming, follow, `engine_tick` and the pose export.
- Arena plan: 1024 players under a 1073741824 byte budget.
- Machine: Intel(R) Xeon(R) CPU @ 2.20GHz, 4 CPUs, Node v22.23.4.
- Pushed 2026-11-11T14:45:27Z. Queue wait 3 s from the push to the first line of the script. Run time 190.5 s for 46 of 46 planned runs.
- engine-core-1024mib-threads.mjs, warmed: 10240 bodies hold the budget at p99 with zero ticks over budget (workers 3, 4); in the steady window alone 10240 bodies hold it (workers 1, 2, 3, 4, 6).
- engine-core-1024mib-threads-simd.mjs, warmed: 10240 bodies hold the budget at p99 with zero ticks over budget (workers 2, 3, 4, 6); in the steady window alone 10240 bodies hold it (workers 1, 2, 3, 4, 6).
- engine-core-1024mib-threads.mjs, cold: no body count holds the budget at p99 with zero ticks over budget; in the steady window alone 10240 bodies hold it (workers 1, 2, 3, 4, 6).
- engine-core-1024mib-threads-simd.mjs, cold: no body count holds the budget at p99 with zero ticks over budget; in the steady window alone 10240 bodies hold it (workers 1, 2, 3, 4, 6).
- cap20480 build of engine-core-1024mib-threads-simd.mjs, warmed: 12288 bodies hold the budget at p99 with zero ticks over budget (workers 3, 4, 6); in the steady window alone 20480 bodies hold it (workers 3, 4, 6).
- cap20480 build of engine-core-1024mib-threads-simd.mjs, cold: no body count holds the budget at p99 with zero ticks over budget; in the steady window alone 20480 bodies hold it (workers 4).
- Refused by the arena plan: 8 workers (workers-do-not-fit).
- Runs that gave no result: none.

| glue | bodies | workers | solver iterations | node flags | median ms | p99 ms | max ms | ticks over budget | ticks 0 and 1 ms | settle p99 ms | settle max ms | settle over budget | steady median ms | steady p99 ms | steady over budget | arena used bytes | arena bytes | warm-up ms | load ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1024mib-threads, warmed | 10240 | 1 | 4 |  | 0.063 | 23.257 | 25.142 | 54 | 15.56 / 18.6 | 24.991 | 25.142 | 53 | 0.063 | 0.095 | 0 | 103298208 | 497242640 | 1356 | 891.8 | 4.4 |
| 1024mib-threads, warmed | 10240 | 2 | 4 |  | 0.064 | 15.412 | 16.726 | 1 | 12.56 / 12.94 | 16.128 | 16.726 | 1 | 0.062 | 0.144 | 0 | 103298208 | 497308176 | 1232.5 | 842.3 | 3.5 |
| 1024mib-threads, warmed | 10240 | 3 | 4 |  | 0.064 | 14.147 | 14.616 | 0 | 11.56 / 11.71 | 14.525 | 14.616 | 0 | 0.064 | 0.094 | 0 | 103298208 | 497373712 | 1441.5 | 893.9 | 3.7 |
| 1024mib-threads, warmed | 10240 | 4 | 4 |  | 0.064 | 12.056 | 13.008 | 0 | 10.54 / 10.14 | 12.516 | 13.008 | 0 | 0.064 | 0.092 | 0 | 103298208 | 497439248 | 1207.9 | 839.1 | 3.3 |
| 1024mib-threads, warmed | 10240 | 6 | 4 |  | 0.062 | 13.305 | 16.935 | 1 | 14.75 / 15.64 | 13.683 | 16.935 | 1 | 0.061 | 0.093 | 0 | 103298208 | 497570320 | 1218.5 | 853.6 | 3.4 |
| 1024mib-threads-simd, warmed | 10240 | 1 | 4 |  | 0.063 | 18.514 | 20.257 | 27 | 13.26 / 15.62 | 18.987 | 20.257 | 27 | 0.063 | 0.114 | 0 | 103298208 | 497242640 | 1183.9 | 884.5 | 3.7 |
| 1024mib-threads-simd, warmed | 10240 | 2 | 4 |  | 0.063 | 12.261 | 13.105 | 0 | 11.35 / 10.81 | 12.726 | 13.105 | 0 | 0.063 | 0.095 | 0 | 103298208 | 497308176 | 1184.5 | 887.1 | 3.3 |
| 1024mib-threads-simd, warmed | 10240 | 3 | 4 |  | 0.064 | 10.784 | 11.864 | 0 | 9.72 / 9.82 | 11.594 | 11.864 | 0 | 0.063 | 0.099 | 0 | 103298208 | 497373712 | 1165.4 | 880.7 | 3.2 |
| 1024mib-threads-simd, warmed | 10240 | 4 | 4 |  | 0.063 | 9.648 | 11.281 | 0 | 8.89 / 8.59 | 10.013 | 11.281 | 0 | 0.063 | 0.106 | 0 | 103298208 | 497439248 | 1157.3 | 880.3 | 3.1 |
| 1024mib-threads-simd, warmed | 10240 | 6 | 4 |  | 0.064 | 10.318 | 13.236 | 0 | 13.24 / 13.16 | 10.854 | 12.679 | 0 | 0.062 | 0.094 | 0 | 103298208 | 497570320 | 1164.6 | 883.9 | 3.2 |
| 1024mib-threads, cold | 10240 | 1 | 4 |  | 0.061 | 24.502 | 55.838 | 72 | 38.77 / 19.8 | 24.987 | 55.838 | 70 | 0.061 | 0.131 | 0 | 103298208 | 497242640 |  | 836.8 | 2.9 |
| 1024mib-threads, cold | 10240 | 2 | 4 |  | 0.065 | 16.303 | 34.232 | 5 | 34.23 / 17.53 | 16.778 | 17.999 | 3 | 0.063 | 0.147 | 0 | 103298208 | 497308176 |  | 835.8 | 2.3 |
| 1024mib-threads, cold | 10240 | 3 | 4 |  | 0.064 | 14.759 | 38.009 | 3 | 38.01 / 17.24 | 15.885 | 20.719 | 1 | 0.062 | 0.135 | 0 | 103298208 | 497373712 |  | 852.8 | 2.2 |
| 1024mib-threads, cold | 10240 | 4 | 4 |  | 0.065 | 14.787 | 38.055 | 3 | 38.05 / 14.74 | 16.418 | 32.16 | 2 | 0.062 | 0.116 | 0 | 103298208 | 497439248 |  | 825.5 | 2.2 |
| 1024mib-threads, cold | 10240 | 6 | 4 |  | 0.064 | 14.419 | 50.803 | 5 | 50.8 / 21.04 | 17.142 | 19.485 | 3 | 0.064 | 0.102 | 0 | 103298208 | 497570320 |  | 881.8 | 2.3 |
| 1024mib-threads-simd, cold | 10240 | 1 | 4 |  | 0.063 | 18.313 | 38.175 | 33 | 38.17 / 17.35 | 18.604 | 20.677 | 31 | 0.063 | 0.138 | 0 | 103298208 | 497242640 |  | 845 | 2.5 |
| 1024mib-threads-simd, cold | 10240 | 2 | 4 |  | 0.064 | 13.423 | 35.327 | 1 | 35.33 / 12.77 | 13.855 | 14.929 | 0 | 0.062 | 0.111 | 0 | 103298208 | 497308176 |  | 841 | 2.1 |
| 1024mib-threads-simd, cold | 10240 | 3 | 4 |  | 0.083 | 12.157 | 33.599 | 1 | 33.6 / 13.03 | 13.353 | 16.671 | 0 | 0.072 | 0.174 | 0 | 103298208 | 497373712 |  | 838.8 | 2 |
| 1024mib-threads-simd, cold | 10240 | 4 | 4 |  | 0.065 | 11.061 | 36.958 | 1 | 36.96 / 12.84 | 13.729 | 14.929 | 0 | 0.064 | 0.149 | 0 | 103298208 | 497439248 |  | 935.5 | 2 |
| 1024mib-threads-simd, cold | 10240 | 6 | 4 |  | 0.064 | 12.053 | 48.242 | 1 | 48.24 / 12.6 | 13.435 | 14.563 | 0 | 0.063 | 0.115 | 0 | 103298208 | 497570320 |  | 862.6 | 2 |
| cap20480 1024mib-threads-simd, warmed | 12288 | 3 | 4 |  | 0.122 | 13.001 | 13.771 | 0 | 11.91 / 12.13 | 13.279 | 13.771 | 0 | 0.121 | 0.174 | 0 | 143627040 | 550234640 | 1168.1 | 875.8 | 3.4 |
| cap20480 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.12 | 11.415 | 12.054 | 0 | 10.98 / 10.48 | 11.683 | 12.054 | 0 | 0.12 | 0.159 | 0 | 143627040 | 550300176 | 1152.5 | 897.5 | 3.3 |
| cap20480 1024mib-threads-simd, warmed | 12288 | 6 | 4 |  | 0.121 | 12.38 | 15.132 | 0 | 13.94 / 15.13 | 12.776 | 13.25 | 0 | 0.12 | 0.215 | 0 | 143627040 | 550431248 | 1179.9 | 873.4 | 3.4 |
| cap20480 1024mib-threads-simd, warmed | 16384 | 3 | 4 |  | 0.13 | 17.834 | 19.075 | 16 | 15.75 / 15.49 | 18.308 | 19.075 | 16 | 0.128 | 0.162 | 0 | 145855280 | 550234640 | 1148.3 | 829.5 | 3.6 |
| cap20480 1024mib-threads-simd, warmed | 16384 | 4 | 4 |  | 0.134 | 15.14 | 17.263 | 3 | 13.03 / 14.04 | 16.8 | 17.263 | 3 | 0.13 | 0.233 | 0 | 145855280 | 550300176 | 1187 | 923.8 | 3.6 |
| cap20480 1024mib-threads-simd, warmed | 16384 | 6 | 4 |  | 0.131 | 15.469 | 17.329 | 3 | 17 / 14.94 | 16.351 | 17.329 | 2 | 0.129 | 0.2 | 0 | 145855280 | 550431248 | 1160.5 | 856.2 | 3.6 |
| cap20480 1024mib-threads-simd, warmed | 20480 | 3 | 4 |  | 0.161 | 23.113 | 24.97 | 71 | 19.54 / 19.03 | 24.264 | 24.97 | 69 | 0.158 | 0.312 | 0 | 148034352 | 550234640 | 1150.3 | 825.1 | 4.1 |
| cap20480 1024mib-threads-simd, warmed | 20480 | 4 | 4 |  | 0.142 | 19.999 | 22.762 | 40 | 17.05 / 17.15 | 20.783 | 22.762 | 38 | 0.14 | 0.187 | 0 | 148034352 | 550300176 | 1155.6 | 872.8 | 3.9 |
| cap20480 1024mib-threads-simd, warmed | 20480 | 6 | 4 |  | 0.144 | 20.302 | 21.483 | 55 | 16.89 / 17.66 | 21.08 | 21.483 | 53 | 0.14 | 0.276 | 0 | 148034352 | 550431248 | 1218.3 | 844 | 4 |
| cap20480 1024mib-threads-simd, cold | 12288 | 4 | 4 |  | 0.19 | 12.698 | 39.807 | 4 | 39.81 / 12.7 | 20.123 | 36.283 | 3 | 0.189 | 0.295 | 0 | 143627040 | 550300176 |  | 840.5 | 2.2 |
| cap20480 1024mib-threads-simd, cold | 16384 | 4 | 4 |  | 0.132 | 16.108 | 45.327 | 4 | 45.33 / 14.96 | 17.389 | 31.253 | 3 | 0.131 | 0.211 | 0 | 145855280 | 550300176 |  | 830.2 | 2.4 |
| cap20480 1024mib-threads-simd, cold | 20480 | 4 | 4 |  | 0.14 | 20.874 | 49.395 | 57 | 49.4 / 19.36 | 22.237 | 23.784 | 55 | 0.137 | 0.2 | 0 | 148034352 | 550300176 |  | 845.3 | 2.7 |

Probes on one configuration:

| glue | bodies | workers | solver iterations | node flags | median ms | p99 ms | max ms | ticks over budget | ticks 0 and 1 ms | settle p99 ms | settle max ms | settle over budget | steady median ms | steady p99 ms | steady over budget | arena used bytes | arena bytes | warm-up ms | load ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1024mib-threads-simd, warmed | 10240 | 4 | 4 |  | 0.062 | 9.358 | 10.069 | 0 | 8.92 / 8.53 | 9.579 | 10.069 | 0 | 0.061 | 0.088 | 0 | 103298208 | 497439248 | 1131.9 | 941.7 | 3.1 |
| 1024mib-threads-simd, warmed | 10240 | 4 | 4 | warm run 1024x150 | 0.064 | 9.691 | 10.275 | 0 | 9.7 / 9.4 | 10.188 | 10.275 | 0 | 0.064 | 0.139 | 0 | 103298208 | 497439248 | 1017.1 | 866.6 | 2.9 |
| 1024mib-threads-simd, warmed | 10240 | 4 | 4 | warm run 512x90 | 0.064 | 10.168 | 12.235 | 0 | 8.69 / 11.96 | 11.015 | 12.235 | 0 | 0.064 | 0.117 | 0 | 103298208 | 497439248 | 960.7 | 812.1 | 2.8 |
| 1024mib-threads-simd, warmed | 10240 | 4 | 4 |  | 0.064 | 9.469 | 10.283 | 0 | 8.64 / 8.6 | 9.862 | 10.283 | 0 | 0.064 | 0.091 | 0 | 103298208 | 497439248 | 1157.2 | 828.1 | 3 |
| 1024mib-threads-simd, warmed | 10240 | 4 | 4 | warm run 1024x150 | 0.107 | 9.685 | 12.684 | 0 | 9.25 / 9.99 | 10.214 | 12.684 | 0 | 0.074 | 0.169 | 0 | 103298208 | 497439248 | 1024.1 | 846.5 | 3 |
| 1024mib-threads-simd, warmed | 10240 | 4 | 4 | warm run 512x90 | 0.064 | 9.764 | 11.941 | 0 | 8.65 / 11.94 | 10.467 | 11.693 | 0 | 0.064 | 0.133 | 0 | 103298208 | 497439248 | 987.7 | 879.9 | 2.9 |

Marble bowl (512 marbles, 600 ticks, 4 timed runs per tier after 1 warm run). CPU time is the main thread's run time from the scheduler statistics; wall time is beside it:

| tier | workers | clock | CPU p99 ms | CPU max ms | CPU ticks over 16.7 ms | CPU ticks over 25 ms | wall p99 ms | wall max ms | wall ticks over 16.7 ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|
| 64 MiB fixed | 1 | schedstat | 11.019 | 16.031 | 0 | 0 | 11.491 | 15.897 | 0 | 18.9 |
| 128 MiB fixed | 1 | schedstat | 11.016 | 12.943 | 0 | 0 | 10.76 | 12.552 | 0 | 19.1 |
| 512 MiB fixed | 1 | schedstat | 9 | 10.005 | 0 | 0 | 8.82 | 10.588 | 0 | 15.4 |
| 512 MiB threaded, 2 workers | 2 | schedstat | 6.017 | 7.018 | 0 | 0 | 6.288 | 7.312 | 0 | 13.8 |
