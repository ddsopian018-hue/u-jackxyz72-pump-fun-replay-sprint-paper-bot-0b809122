// Stabilised dip-buy mean reversion, one round trip per coin, bank +2% then flat.
// Revision: bleed brake added — new entries capped at 2/batch once equity is under water.
// Pump.fun Replay Sprint — Paper Bot, Real Ranking (make.fun).
// Run by the grader as `node /bot/main.ts`; the SDK shim is vendored beside it.

import { runBot } from './vendor/makefun-bot.ts';
import { createStrategy, DEFAULT_PARAMS } from './strategy.ts';

const onBatch = createStrategy(DEFAULT_PARAMS);

await runBot({ onBatch });
