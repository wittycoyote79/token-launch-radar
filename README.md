# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/wittycoyote79/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/wittycoyote79/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it reads a sealed DefiLlama snapshot, finds the protocols that record no token yet, ranks them by an implied launch value derived from the snapshot's own figures, and hands in a dashboard with a board, a detail view per protocol, filters, and a concrete farm plan for every row. The value model anchors each protocol's TVL multiple to the live-token comparables in the same category (falling back to the whole market's median), then adjusts for seven-day growth, for how long the protocol has run with no token, and for how many chains it runs on. No protocol name is ever special-cased: the same function scores every row.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
```

That writes `out/board.json` (the ranked board), `out/data.js` (the dashboard's data), `out/dashboard/` (the static page), `out/screenshots/` (the three views) and `out/dossier.json` (what the judge reads). Node.js 22.18 or later, standard library only, no network.

## Layout

- `main.ts` — the entrypoint: reads the snapshot, builds the board, writes the outputs.
- `lib/model.ts` — the value model, the board selection rule, the farm plans, and the snapshot parser.
- `dashboard/` — the static page (`index.html`, `app.css`, `app.js`); renders with no network.
- `screenshots/` — the board, a protocol detail view, and a filtered view.
- `vendor/makefun-board.ts` — make.fun's dossier library, copied from the competition kit as its header directs.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
