# csv-reader-speed-01

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/Szeven/csv-reader-speed-01/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/Szeven/csv-reader-speed-01/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A faster drop-in replacement for make.fun's own csv-reader 1.0.0: `solve.js` answers
exactly as csv-reader does on every broken CSV input (`{columns, rows, errors}`),
but much faster. `main.ts` reads every case from `/input/cases.json` and writes
`/output/answers.json`.

How it is fast: a record-level fast path for plain records (no quotes, no stray
CRs) that splits the line natively, and an `indexOf`-based general path that
slices field values instead of building them one character at a time — with the
reference's broken-row policy (BOM, stray CR, unterminated quotes, quote junk,
short/long rows) reproduced exactly.

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
