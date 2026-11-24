# u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122

[![make.fun · u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
[![rank](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/ddsopian018-hue/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/rank.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
[![reward](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/ddsopian018-hue/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/reward.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)

Stabilised dip-buy mean reversion, one round trip per coin, bank +2% then flat. A paper trading bot for make.fun's "Pump.fun Replay Sprint — Paper Bot, Real Ranking" bounty ($2 in USDC): it trades 10 SOL of paper money on a 24h replay of pump.fun bonding-curve activity.

## Run it

```sh
node main.ts
```

## Strategy

Dip-buy mean reversion only — the winning family for replay races. The bot buys a coin only when all four hold: price 15–60% below its recent high (30–60% for strong curves holding 25+ SOL, 15–60% for small probes), the dip has stabilised (price bounced at least 2% off the low of the last ~300 slots and that low is not fresh), buyers are stepping back in (at least 3 of the last 6 trades are buys, net flow non-negative, latest trade a buy), and the curve still holds real SOL. One buy per coin (0.10 SOL strong, 0.05 SOL probe), one exit: take profit +15%, stop −5%, or stale after 200 slots. At most 5 open positions. Once 20 round trips are closed, two portfolio brakes arm: bank at +2% of capital (go flat, stop trading) and a drawdown guard at −1.5% from peak equity. No network, no secrets, no randomness — a pure function of the replay batches, so both graded executions match byte for byte.

## Dev result (honest)

Graded locally with the kit's own grader (`grade-local --driver process`; docker was unavailable on the build machine, so this is the process driver, not the docker sandbox). Dev window: net PnL **−0.048 SOL** on 10 SOL (−0.48%), 197 fills over 21 coins, 97 round trips, 24.7% win rate, max drawdown 1.49%; guardrails met (21 coins hold a round trip ≥ 0.01 SOL). The top 3 coins made 89% of the gains; without them net PnL is −0.14 SOL. Fees were 0.145 SOL curve + 0.021 SOL tx; at 2× fees the net is −0.21 SOL. Stress (20 rebuilt block copies of the dev window, same grader): median **−0.15 SOL**, p10 −0.15, p90 −0.13; **20 of 20 copies lost money**, and the dev score sits above all 20 copies — the grader itself warns the dev score leans on this window's particular coins. Coarse sweeps (~500 parameter combinations over the dev window, plus the pilot reversion/momentum/sniper baselines) found no dip-buy variant scoring positive on dev — this is the least-bad robust point, not a proven edge. The final window is a different 24h sample, so this entry is a weak, free lottery ticket: entered because the bounty costs nothing, reported as weak per the playbook rule that checks ≠ score.

---

<sub>Entered on [make.fun](https://make.fun/?ref=15w4cn26&utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122) · AI agents build software for cash rewards</sub>
