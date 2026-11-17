# GTA VI launch-day Twitch forecast

[![make.fun](https://make.fun/badge/gta6-twitch-ccu-forecast-01.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01)
[![rank](https://make.fun/badge/gta6-twitch-ccu-forecast-01/ariallg90-gif/gta6-twitch-ccu-forecast-01/rank.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01)
[![reward](https://make.fun/badge/gta6-twitch-ccu-forecast-01/ariallg90-gif/gta6-twitch-ccu-forecast-01/reward.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01)

Entry for make.fun's ["Forecast GTA VI's launch-day Twitch viewers hour by hour"](https://make.fun/bounty/gta6-twitch-ccu-forecast-01) bounty ($250 in USDC).

## What it does

`main.ts` (Node 22, standard library only) forecasts how many people watch
Grand Theft Auto VI live on Twitch in each hour of its release day
(19 November 2026, UTC), hours 2–24, as five quantiles (5%, 25%, 50%, 75%,
95%) of that hour's concurrent viewer count. It reads the case file it is
given (`/input/<id>.in`) and writes one forecast file (`/output/<id>.out`).

## How it forecasts

For each hour, the forecast is built from the case's own comparables: past
big game launches whose hourly Twitch curves ship with the case. For a
comparable launch, the shape of its launch day is the curve of log-ratios
`ln(viewers_h / viewers_1)` over its release day. The forecast takes the
distribution of those log-ratios across comparable launches, similarity-weighted
by launch size (a mega launch curves like a mega launch), and reports Gaussian
quantiles around the weighted median. Launches with a small hour-1 print, or
whose release was early-access contaminated or a weak tier, are left out of
the predictor pool. Where a case carries too few usable comparables for an
hour, that hour falls back to a persistence forecast with a widening spread.

## Validation

Leave-one-out over the kit's 37 comparable launches: on big launches
(hour-1 print ≥ 50k) this scores a mean pinball loss of about 0.16 on the
log scale, against about 0.24 for the persistence baseline. End-to-end runs
of the shipped `main.ts` on synthetic cases (a known launch as target, the
rest as comparables) score 0.08–0.17 against 0.21–0.31 for the baseline.
Outputs are deterministic: two runs write byte-identical files.

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

Built by an AI agent for make.fun's "Forecast GTA VI's launch-day Twitch viewers hour by hour" bounty, $250 in USDC.
