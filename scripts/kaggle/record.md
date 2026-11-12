## Kaggle physics run

Written by `node scripts/kaggle/record.mjs` from one `kaggle kernels output` read of `heclgang/jayzee-physics-goalpost` version 50. One JSON result per configuration; the table is that file.

- Budget: 16.7 ms per tick, 900 ticks per configuration. Ticks 0 and 1 are the boot ticks, ticks 2 to 299 the settle window, and ticks from 300 the steady window. The timed call is the whole worker tick: page streaming, follow, `engine_tick` and the pose export.
- Arena plan: 1024 players under a 1073741824 byte budget.
- Machine: AMD EPYC 7B12, 4 CPUs, Node v22.23.4, machine class AuthenticAMD-23-49-0 (2 cores, 4 threads).
- Pushed 2026-11-12T13:00:21.812Z. Queue wait 13 s from the push to the first line of the script. Run time 453.7 s for 65 of 65 planned runs.
- reference build of engine-core-1024mib-threads-simd.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4, 4, 4, 4, 4, 4, 4, 4, 4); in the steady window alone 131072 bodies hold it (workers 4, 4, 4, 4, 4, 4, 4, 4, 4, 4).
- engine-core-1024mib-threads-simd.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 1, 2, 3, 6, 4); in the steady window alone 131072 bodies hold it (workers 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 1, 2, 3, 6, 4).
- engine-core-1024mib-threads.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4); in the steady window alone 131072 bodies hold it (workers 4).
- engine-core-1024mib-threads-simd.mjs, cold: no body count holds the budget at p99 with zero ticks over budget; in the steady window alone 131072 bodies hold it (workers 4).
- profile build of engine-core-1024mib-threads-simd.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4, 4, 4, 4, 4, 4); in the steady window alone 131072 bodies hold it (workers 4, 4, 4, 4, 4, 4).
- Refused by the arena plan: none.
- Runs that gave no result: none.

| glue | bodies | workers | solver iterations | node flags | median ms | p99 ms | max ms | ticks over budget | ticks 0 and 1 ms | settle p99 ms | settle max ms | settle over budget | steady median ms | steady p99 ms | steady over budget | arena used bytes | arena bytes | warm-up ms | load ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.861 | 8.809 | 11.146 | 0 | 5.74 / 3.65 | 7.721 | 8.196 | 0 | 5.941 | 9.096 | 0 | 278248248 | 668400144 | 696.4 | 526.8 | 7.5 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 4.855 | 6.159 | 7.159 | 0 | 5.18 / 3.38 | 6.372 | 6.916 | 0 | 4.884 | 6.124 | 0 | 278230008 | 668400144 | 266.7 | 130.8 | 5.4 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.934 | 8.232 | 10.042 | 0 | 5.84 / 3.98 | 8.817 | 10.042 | 0 | 6.037 | 7.808 | 0 | 278248248 | 668400144 | 669.5 | 544.1 | 7.4 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.038 | 7.916 | 11.705 | 0 | 4.76 / 3.03 | 6.335 | 6.916 | 0 | 5.116 | 8.185 | 0 | 278230008 | 668400144 | 265.4 | 123.4 | 5.8 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.16 | 7.776 | 24.066 | 1 | 5.68 / 3.71 | 8.744 | 24.066 | 1 | 6.228 | 7.547 | 0 | 278248248 | 668400144 | 668.7 | 542 | 7.6 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.059 | 7.356 | 8.58 | 0 | 5.05 / 3.07 | 7.398 | 7.853 | 0 | 5.124 | 7.356 | 0 | 278230008 | 668400144 | 260.9 | 128.5 | 5.8 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.873 | 8.872 | 12.318 | 0 | 5.85 / 3.83 | 7.691 | 8.635 | 0 | 5.926 | 9.664 | 0 | 278248248 | 668400144 | 672.6 | 619.3 | 7.4 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 4.931 | 6.109 | 8.083 | 0 | 4.99 / 3.14 | 6.815 | 8.083 | 0 | 5.012 | 5.994 | 0 | 278230008 | 668400144 | 260.5 | 126.7 | 5.6 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.927 | 9.317 | 14.432 | 0 | 5.7 / 3.57 | 7.597 | 7.653 | 0 | 6.047 | 10.692 | 0 | 278248248 | 668400144 | 661.7 | 534.2 | 7.4 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 4.946 | 6.19 | 7.159 | 0 | 4.93 / 2.27 | 6.395 | 6.667 | 0 | 5.008 | 6.19 | 0 | 278230008 | 668400144 | 266.3 | 126.4 | 5.5 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.855 | 7.514 | 8.781 | 0 | 5.84 / 3.83 | 7.606 | 8.734 | 0 | 5.938 | 7.514 | 0 | 278248248 | 668400144 | 717.4 | 610.7 | 7.4 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.215 | 9.193 | 12.841 | 0 | 5.76 / 3.02 | 6.549 | 6.818 | 0 | 5.322 | 9.668 | 0 | 278230008 | 668400144 | 269.8 | 155.8 | 6 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.058 | 9.001 | 10.875 | 0 | 5.31 / 3.57 | 8.527 | 9.39 | 0 | 6.12 | 9.029 | 0 | 278248248 | 668400144 | 649.7 | 544 | 7.6 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.01 | 6.248 | 7.574 | 0 | 4.81 / 2.57 | 6.656 | 7.574 | 0 | 5.11 | 6.248 | 0 | 278230008 | 668400144 | 267.1 | 126 | 5.6 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.93 | 8.645 | 13.118 | 0 | 5.67 / 3.57 | 7.548 | 8.985 | 0 | 6.035 | 8.953 | 0 | 278248248 | 668400144 | 655.8 | 554.3 | 7.4 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 4.982 | 6.14 | 7.198 | 0 | 5.16 / 3.16 | 6.277 | 7.198 | 0 | 5.044 | 6.14 | 0 | 278230008 | 668400144 | 272.5 | 135.1 | 5.5 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.951 | 7.697 | 8.711 | 0 | 5.52 / 3.59 | 7.646 | 8.711 | 0 | 6.135 | 7.701 | 0 | 278248248 | 668400144 | 661.4 | 555.8 | 7.3 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.149 | 8.171 | 12.005 | 0 | 4.13 / 3.96 | 7.098 | 8.302 | 0 | 5.203 | 8.754 | 0 | 278230008 | 668400144 | 262.9 | 138.1 | 5.9 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.882 | 7.639 | 8.869 | 0 | 4.92 / 4.22 | 8.11 | 8.869 | 0 | 5.977 | 7.639 | 0 | 278248248 | 668400144 | 637.2 | 625.1 | 7.3 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.106 | 6.392 | 8.735 | 0 | 4.96 / 3.19 | 6.26 | 8.735 | 0 | 5.215 | 6.46 | 0 | 278230008 | 668400144 | 295.7 | 171.1 | 5.8 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.061 | 8.031 | 11.039 | 0 | 5.08 / 3.15 | 6.304 | 6.788 | 0 | 5.168 | 8.831 | 0 | 278230008 | 668400144 | 271.1 | 132.6 | 5.8 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 4.822 | 6.139 | 7.924 | 0 | 5.07 / 3.31 | 5.713 | 7.924 | 0 | 4.889 | 6.179 | 0 | 278210888 | 668400144 | 262.8 | 132.3 | 5.4 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 4.972 | 7.874 | 10.726 | 0 | 5.21 / 3.37 | 6.116 | 6.594 | 0 | 5.105 | 9.283 | 0 | 278230008 | 668400144 | 261.2 | 132.8 | 5.5 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 4.791 | 5.931 | 6.711 | 0 | 5.08 / 3.42 | 5.989 | 6.142 | 0 | 4.842 | 5.931 | 0 | 278210888 | 668400144 | 273.5 | 129.3 | 5.3 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.171 | 8.612 | 12.149 | 0 | 5.71 / 3.52 | 6.679 | 8.375 | 0 | 5.292 | 8.965 | 0 | 278230008 | 668400144 | 267.4 | 135.1 | 5.8 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 4.943 | 6.153 | 7.494 | 0 | 5.31 / 3.31 | 6.39 | 7.494 | 0 | 4.987 | 5.962 | 0 | 278210888 | 668400144 | 266.5 | 138.4 | 5.5 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.02 | 6.992 | 8.041 | 0 | 4.09 / 3.12 | 7.915 | 8.041 | 0 | 5.041 | 6.121 | 0 | 278230008 | 668400144 | 274.4 | 128.6 | 5.8 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 4.843 | 6.912 | 10.277 | 0 | 3.93 / 1.97 | 5.731 | 6.309 | 0 | 4.933 | 7.448 | 0 | 278210888 | 668400144 | 266.9 | 129.9 | 5.3 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.053 | 6.542 | 7.836 | 0 | 4.96 / 3.26 | 6.792 | 7.836 | 0 | 5.139 | 6.542 | 0 | 278230008 | 668400144 | 267.3 | 127.7 | 5.6 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.081 | 9.22 | 12.288 | 0 | 5.01 / 3.6 | 9.305 | 12.288 | 0 | 5.168 | 9.038 | 0 | 278210888 | 668400144 | 276 | 131.8 | 5.8 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.211 | 6.424 | 6.813 | 0 | 5.57 / 3.11 | 6.424 | 6.811 | 0 | 5.273 | 6.502 | 0 | 278230008 | 668400144 | 275.4 | 133.1 | 5.8 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 4.837 | 8.381 | 12.549 | 0 | 4.01 / 2.16 | 6.252 | 6.873 | 0 | 4.901 | 9.975 | 0 | 278210888 | 668400144 | 273.1 | 133 | 5.5 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.249 | 6.741 | 9.752 | 0 | 4.96 / 3.24 | 7.211 | 9.752 | 0 | 5.356 | 6.564 | 0 | 278230008 | 668400144 | 273.8 | 130 | 5.9 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.054 | 6.443 | 8.445 | 0 | 5.02 / 3.04 | 6.736 | 8.445 | 0 | 5.066 | 6.17 | 0 | 278210888 | 668400144 | 275.4 | 136.3 | 5.6 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.25 | 8.24 | 12.231 | 0 | 5.03 / 3.45 | 6.963 | 7.203 | 0 | 5.299 | 8.774 | 0 | 278230008 | 668400144 | 261.3 | 137.1 | 5.9 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 4.96 | 6.049 | 7.256 | 0 | 5.08 / 3.32 | 5.828 | 6.446 | 0 | 5.017 | 6.06 | 0 | 278210888 | 668400144 | 280.1 | 131.5 | 5.5 |
| 1024mib-threads-simd, warmed | 131072 | 1 | 4 |  | 6.533 | 10.905 | 14.669 | 0 | 6.32 / 3.32 | 8.247 | 8.986 | 0 | 6.729 | 11.353 | 0 | 278230008 | 668203536 | 264.5 | 162.8 | 7.3 |
| 1024mib-threads-simd, warmed | 131072 | 2 | 4 |  | 7.205 | 9.439 | 12.612 | 0 | 5.04 / 2.79 | 8.884 | 9.708 | 0 | 7.329 | 10.101 | 0 | 278230008 | 668269072 | 270.9 | 132.3 | 7.4 |
| 1024mib-threads-simd, warmed | 131072 | 3 | 4 |  | 6.127 | 7.527 | 8.368 | 0 | 5.3 / 3.55 | 7.403 | 8.368 | 0 | 6.256 | 7.546 | 0 | 278230008 | 668334608 | 278.6 | 134.9 | 6.6 |
| 1024mib-threads-simd, warmed | 131072 | 6 | 4 |  | 5.19 | 8.751 | 10.934 | 0 | 4.08 / 2.19 | 6.48 | 8.751 | 0 | 5.347 | 9.235 | 0 | 278230008 | 668531216 | 275.4 | 140.5 | 5.9 |
| 1024mib-threads, warmed | 131072 | 4 | 4 |  | 5.817 | 7.287 | 8.228 | 0 | 5.5 / 3.75 | 7.632 | 8.228 | 0 | 5.904 | 7.226 | 0 | 278230008 | 668400144 | 312.6 | 127.3 | 6.3 |
| 1024mib-threads-simd, cold | 131072 | 4 | 4 |  | 5.222 | 6.669 | 20.063 | 1 | 20.06 / 6.18 | 7.268 | 12.417 | 0 | 5.259 | 6.439 | 0 | 278230008 | 668400144 |  | 85.1 | 5.6 |
| 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.178 | 5.338 | 5.701 | 0 | 5.58 / 3.23 | 5.584 | 5.701 | 0 | 0.168 | 0.225 | 0 | 196038896 | 668400144 | 266.3 | 130.7 | 1.6 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.061 | 6.792 | 10.608 | 0 | 5.37 / 3.07 | 6.663 | 6.971 | 0 | 5.1 | 6.89 | 0 | 405628416 | 668400144 | 269.1 | 154.4 | 14.4 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 4.759 | 6.149 | 8.124 | 0 | 4 / 2.88 | 6.114 | 8.124 | 0 | 4.836 | 6.191 | 0 | 222452960 | 668400144 | 272.7 | 129 | 4.3 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 4.652 | 5.839 | 6.674 | 0 | 3.99 / 1.83 | 6.256 | 6.674 | 0 | 4.643 | 5.839 | 0 | 222603776 | 668400144 | 266.5 | 133.6 | 4.2 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 4.752 | 6.055 | 8.349 | 0 | 4.96 / 2.24 | 6.211 | 8.349 | 0 | 4.766 | 5.918 | 0 | 222407312 | 668400144 | 274.5 | 133.3 | 4.2 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 4.591 | 6.047 | 6.864 | 0 | 5.15 / 3.94 | 6.244 | 6.364 | 0 | 4.492 | 5.98 | 0 | 222564304 | 668400144 | 274.2 | 135.2 | 4.1 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.082 | 8.968 | 13.533 | 0 | 7.74 / 4.74 | 11.51 | 13.533 | 0 | 6.127 | 7.369 | 0 | 278246392 | 668400144 | 342.3 | 142.4 | 6.8 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.078 | 8.736 | 16.58 | 0 | 6.25 / 4.44 | 7.595 | 9.132 | 0 | 6.194 | 10.042 | 0 | 278246392 | 668400144 | 342.7 | 130.7 | 6.8 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.201 | 7.377 | 8.55 | 0 | 6.81 / 4.22 | 7.625 | 8.55 | 0 | 6.259 | 7.377 | 0 | 278246392 | 668400144 | 338.8 | 128.5 | 6.7 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.279 | 8.92 | 16.077 | 0 | 6.59 / 4.3 | 11.32 | 16.077 | 0 | 6.361 | 7.947 | 0 | 278246392 | 668400144 | 327.4 | 133.7 | 6.9 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.31 | 9.282 | 14.168 | 0 | 6.59 / 6.87 | 8.272 | 9.648 | 0 | 6.341 | 9.684 | 0 | 278246392 | 668400144 | 347.7 | 135.9 | 7 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.366 | 8.74 | 11.526 | 0 | 6.64 / 4.69 | 8.011 | 8.679 | 0 | 6.508 | 9.343 | 0 | 278246392 | 668400144 | 342.8 | 138.4 | 7 |
| profile 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.191 | 7.137 | 8.027 | 0 | 8.03 / 5.89 | 7.471 | 7.622 | 0 | 0.184 | 0.341 | 0 | 196055280 | 668400144 | 332.3 | 157.9 | 2.1 |
| profile 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.183 | 6.891 | 8.033 | 0 | 8.03 / 4.24 | 7.406 | 7.529 | 0 | 0.175 | 0.242 | 0 | 196055280 | 668400144 | 352.8 | 141.1 | 2.1 |
| profile 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.185 | 7.042 | 7.783 | 0 | 7.15 / 5.07 | 7.384 | 7.783 | 0 | 0.179 | 0.367 | 0 | 196055280 | 668400144 | 344.1 | 135.8 | 2.1 |

Probes on one configuration:

| glue | bodies | workers | solver iterations | node flags | median ms | p99 ms | max ms | ticks over budget | ticks 0 and 1 ms | settle p99 ms | settle max ms | settle over budget | steady median ms | steady p99 ms | steady over budget | arena used bytes | arena bytes | warm-up ms | load ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

Marble bowl (512 marbles, 600 ticks, 4 timed runs per tier after 1 warm run). CPU time is the main thread's run time from the scheduler statistics; wall time is beside it:

| tier | workers | clock | CPU p99 ms | CPU max ms | CPU ticks over 16.7 ms | CPU ticks over 25 ms | wall p99 ms | wall max ms | wall ticks over 16.7 ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|
| 64 MiB fixed | 1 | schedstat | 8.001 | 9.002 | 0 | 0 | 8.131 | 9.179 | 0 | 13.9 |
| 128 MiB fixed | 1 | schedstat | 8.023 | 10.93 | 0 | 0 | 8.5 | 10.976 | 0 | 14.3 |
| 512 MiB fixed | 1 | schedstat | 7.972 | 9.945 | 0 | 0 | 7.66 | 9.361 | 0 | 11.1 |
| 512 MiB threaded, 2 workers | 2 | schedstat | 7.143 | 8.002 | 0 | 0 | 7.435 | 8.095 | 0 | 10.4 |
