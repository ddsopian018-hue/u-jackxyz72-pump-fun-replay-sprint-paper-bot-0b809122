// Stabilised dip-buy mean reversion on pump.fun bonding curves.
//
// Winning family for replay races (playbook §3a): dip-buy only, never chase a
// falling knife, few decisive trades, bank a small gain and stop. Adapted to
// this competition's guardrails, which need at least 20 distinct coins with a
// round trip of at least 0.01 SOL each: the "few trades" budget applies per
// coin (one entry, at most one add, one exit) while the bot works through
// many coins in turn, at most 5 open at once.
//
// Entry, all four conditions at once (one buy per coin, one exit: the
// per-coin trade budget is a single round trip, so fees stay minimal).
//   1. DIP: price is 25-60% below its recent high (high inside ~2000 slots),
//      on a curve that held real SOL at the high (a real run-up, not noise).
//   2. STABILISED: the price has stopped making new lows and bounced at
//      least 3% off the low of the last ~300 slots, and that low is not in
//      the last few slots. A dip still sliding gets no bid.
//   3. BUYERS STEPPING IN: at least 3 of the last 6 trades are buys, net
//      flow over them is not negative, and the latest trade is a buy.
//   4. LIQUID: the curve still holds real SOL (3 SOL minimum; 25 SOL+ is
//      the strong tier and gets full size, weaker curves get a small probe).
//
// Exit: take profit at +15% of cost, stop at -5%, or stale after 200 slots.
// The add branch below stays for completeness but maxPosition equals one
// tranche, so in practice each coin gets exactly one buy and one sell.
//
// Portfolio brakes (only after the 20-coin guardrail minimum is met, so the
// brakes can never strand the entry below it):
//   - BANK: once 20 round trips are closed and equity is up ~+2% of the
//     10 SOL paper capital, sell everything and stop trading.
//   - DRAWDOWN: once 20 round trips are closed and equity has fallen more
//     than ~1.5% from its peak, sell everything and stop trading.
//
// Everything here is a pure function of the batches the harness sends (the
// hello, each batch and its orders, slot by slot): no clock, no randomness,
// no I/O, so the two graded executions produce byte-identical action logs.

import type { Batch, BotState, Mark, OrderInput, Pubkey } from './vendor/makefun-bot.ts';

export interface Params {
  /** Lookback (slots) for the recent high the drawdown is measured from. */
  highWindow: number;
  /** Enter when price is at least this far below the recent high (fraction). */
  ddMin: number;
  /** ...and not further than this (a collapse, not a dip). */
  ddMax: number;
  /** Lookback (slots) for the stabilisation low. */
  lowWindow: number;
  /** Price must have bounced at least this far above the window low. */
  bounceMin: number;
  /** The window low must be at least this many slots old (not still sliding). */
  lowMinAge: number;
  /** The curve must hold at least this much real SOL (lamports) at decision time. */
  minRealSol: bigint;
  /** The recent high must have come with at least this much real SOL (lamports). */
  minHighRealSol: bigint;
  /** Of the last `flowTrades` trades at least `minBuys` must be buys... */
  flowTrades: number;
  minBuys: number;
  /** ...and the most recent trade must be a buy (the dip is being bought). */
  lastMustBeBuy: boolean;
  /** Net SOL bought over the last `flowTrades` trades must be at least this (lamports). */
  minNetFlow: bigint;
  /** Lamports per tranche (capped by the reply size cap) and most lamports per position. */
  tranche: bigint;
  maxPosition: bigint;
  /** Smallest buy worth sending (tx fees are 105k lamports per order; and the
   * guardrail counts only round trips of at least 0.01 SOL, so never buy less). */
  minBuy: bigint;
  /** Add a tranche only while the price stays within this fraction of the first entry price. */
  addBand: number;
  /** Take profit when the position's liquidation value reaches cost * (1 + takeProfit). */
  takeProfit: number;
  /** Stop when liquidation value falls to cost * (1 - stopLoss). */
  stopLoss: number;
  /** Exit after holding this many slots regardless. */
  maxHoldSlots: number;
  /** After an exit, ignore the coin for this many slots. */
  cooldownSlots: number;
  /** Slippage tolerance on buys and on sells (bps). */
  buySlippageBps: number;
  sellSlippageBps: number;
  /** Most new entries per reply. */
  maxEntriesPerBatch: number;
  /** Curves holding at least this much real SOL at entry are "strong" (full size). */
  strongRealSol: bigint;
  /** Weaker curves (down to minRealSol) get a small probe size. */
  weakTranche: bigint;
  weakMaxPosition: bigint;
  /** Dip band for the weak tier (wider at the shallow end: weak probes are
   * the cheap way to reach the 20-coin guardrail minimum). */
  weakDdMin: number;
  weakDdMax: number;
  /** Hold limit for weak-tier positions (slots). */
  weakMaxHoldSlots: number;
  /** Round trips that must be closed before the bank / drawdown brakes may engage. */
  minTripsBeforeBrakes: number;
  /** Bank target: equity above starting capital by this much (lamports) -> go flat, stop. */
  bankTarget: bigint;
  /** Drawdown guard: equity below its peak by this much (lamports) -> go flat, stop. */
  drawdownLimit: bigint;
}

// Round numbers, picked from the middle of the broadly least-bad region of
// coarse sweeps on the dev window (not the single best point): deep dip,
// bounce confirmation, 15% take profit against a 5% stop, 0.1 SOL stakes,
// fast 200-slot cycle so the bot turns over enough coins to clear the
// 20-coin guardrail minimum. No dip-buy variant scored positive on dev;
// this is the least-bad robust point, reported as weak (see README).
export const DEFAULT_PARAMS: Params = {
  highWindow: 2000,
  ddMin: 0.3,
  ddMax: 0.6,
  lowWindow: 300,
  bounceMin: 0.02,
  lowMinAge: 10,
  minRealSol: 3_000_000_000n,
  minHighRealSol: 3_000_000_000n,
  flowTrades: 6,
  minBuys: 3,
  lastMustBeBuy: true,
  minNetFlow: 0n,
  tranche: 100_000_000n,
  maxPosition: 100_000_000n,
  minBuy: 10_000_000n,
  addBand: 0.05,
  takeProfit: 0.15,
  stopLoss: 0.05,
  maxHoldSlots: 200,
  cooldownSlots: 100,
  buySlippageBps: 500,
  sellSlippageBps: 3000,
  maxEntriesPerBatch: 4,
  strongRealSol: 25_000_000_000n,
  weakTranche: 50_000_000n,
  weakMaxPosition: 50_000_000n,
  weakDdMin: 0.15,
  weakDdMax: 0.6,
  weakMaxHoldSlots: 200,
  minTripsBeforeBrakes: 20,
  bankTarget: 200_000_000n,
  drawdownLimit: 150_000_000n,
};

interface Tick {
  slot: number;
  /** virtual SOL / virtual tokens: the marginal price. */
  price: number;
  realSol: bigint;
  isBuy: boolean;
  sol: bigint;
}

interface Book {
  ticks: Tick[];
  /** Price and slot of the first fill decision, and the recent high when we entered. */
  entryPrice: number;
  entrySlot: number;
  entryHigh: number;
  /** Lamports committed to buys on this position (sent, filled or not). */
  committed: bigint;
  /** Slot until which the coin is ignored after an exit. */
  coolUntil: number;
  /** A sell is in flight: do not send another. */
  exiting: boolean;
  /** Entered as a strong-tier position. */
  strong: boolean;
}

const FEE_BPS = 125n;
const BPS = 10_000n;

/**
 * The per-reply buy cap, with a margin: the harness checks it against the
 * reserves shifted by our own earlier flow on the coin, which can sit a
 * little below the recorded ones the SDK keeps.
 */
function buyCap(state: BotState, mint: Pubkey): bigint {
  return (state.maxBuyLamports(mint) * 97n) / 100n;
}

/**
 * What selling `tokens` would pay, curve fees deducted, against the reserves
 * the harness marks for the mint (the recorded reserves shifted by our own
 * net flow into the curve).
 */
function liquidationValue(mark: Mark | undefined, tokens: bigint): bigint {
  if (mark === undefined) return 0n;
  const vq = BigInt(mark.virtual_quote_reserves);
  const vt = BigInt(mark.virtual_token_reserves);
  const rq = BigInt(mark.real_quote_reserves);
  if (vt + tokens === 0n) return 0n;
  let q = (tokens * vq) / (vt + tokens);
  if (q > rq) q = rq;
  return q - (q * FEE_BPS + BPS - 1n) / BPS;
}

export function createStrategy(p: Params = DEFAULT_PARAMS) {
  const books = new Map<Pubkey, Book>();
  const book = (mint: Pubkey): Book => {
    let b = books.get(mint);
    if (b === undefined) {
      b = { ticks: [], entryPrice: 0, entrySlot: -1, entryHigh: 0, committed: 0n, coolUntil: -1, exiting: false, strong: false };
      books.set(mint, b);
    }
    return b;
  };

  let tripsClosed = 0;
  let peakEquity = 0n;
  let stopped = false;

  return function onBatch(state: BotState, batch: Batch): OrderInput[] {
    const slot = batch.slot;
    const touched: Pubkey[] = [];
    for (const e of batch.events) {
      if (e.event !== 'TradeEvent') continue;
      const b = book(e.mint);
      const vt = BigInt(e.virtual_token_reserves);
      const price = vt === 0n ? 0 : Number(BigInt(e.virtual_quote_reserves)) / Number(vt);
      b.ticks.push({ slot, price, realSol: BigInt(e.real_quote_reserves), isBuy: e.is_buy, sol: BigInt(e.sol_amount) });
      if (b.ticks.length > 500) b.ticks.splice(0, b.ticks.length - 500);
      if (touched[touched.length - 1] !== e.mint && !touched.includes(e.mint)) touched.push(e.mint);
    }
    // A position whose sell resolved (or failed) may need another exit attempt.
    for (const f of batch.fills) {
      const b = books.get(f.mint);
      if (b === undefined) continue;
      if (f.side === 'sell') {
        b.exiting = false;
        if (!state.positions.has(f.mint)) {
          if (f.status === 'filled') tripsClosed++;
          b.committed = 0n;
          b.entrySlot = -1;
          b.coolUntil = slot + p.cooldownSlots;
        }
      } else if (f.status !== 'filled' && !state.positions.has(f.mint)) {
        // The opening buy never filled: forget the entry.
        let stillPending = false;
        for (const o of state.pending.values()) if (o.order.mint === f.mint) stillPending = true;
        if (!stillPending) {
          b.committed = 0n;
          b.entrySlot = -1;
        }
      }
    }

    const orders: OrderInput[] = [];
    const cap = state.hello.caps.max_orders_per_batch;
    const tx = state.txFeeLamports();
    const marks = new Map<Pubkey, Mark>();
    for (const m of batch.marks) marks.set(m.mint, m);
    const pendingMints = new Set<Pubkey>();
    for (const o of state.pending.values()) pendingMints.add(o.order.mint);

    // Portfolio equity and the brakes (bank / drawdown), live only once the
    // 20-coin guardrail minimum is met.
    const startCash = BigInt(state.hello.capital.lamports);
    let equity = state.cash;
    for (const [mint, h] of state.positions) equity += liquidationValue(marks.get(mint), h.token_amount);
    if (peakEquity === 0n || equity > peakEquity) peakEquity = equity;
    const brakesLive = tripsClosed >= p.minTripsBeforeBrakes;
    // Bleed brake: once brakes are live and the bot is underwater (equity
    // below starting capital), slow the bleeding by capping new entries.
    const entryCap = brakesLive && equity < startCash ? 2 : p.maxEntriesPerBatch;
    if (brakesLive && !stopped) {
      if (equity - startCash >= p.bankTarget) stopped = true;
      else if (peakEquity - equity >= p.drawdownLimit) stopped = true;
    }
    const flattenAll = stopped;

    // 1. Exits and adds on held positions, in mint order (deterministic).
    const held = [...state.positions.keys()].sort();
    for (const mint of held) {
      if (orders.length >= cap) break;
      const h = state.positions.get(mint)!;
      const b = book(mint);
      const curve = state.curves.get(mint);
      if (curve === undefined || curve.complete) continue;
      if (b.exiting) continue;
      const value = liquidationValue(marks.get(mint), h.token_amount);
      const ticks = b.ticks;
      const price = ticks.length > 0 ? ticks[ticks.length - 1]!.price : 0;
      const entrySlot = b.entrySlot < 0 ? slot : b.entrySlot;
      const gain = h.cost_lamports > 0n ? Number(value - h.cost_lamports) / Number(h.cost_lamports) : 0;
      const tp = gain >= p.takeProfit;
      const sl = gain <= -p.stopLoss;
      const stale = slot - entrySlot >= (b.strong ? p.maxHoldSlots : p.weakMaxHoldSlots);
      if (flattenAll || tp || sl || stale) {
        if (pendingMints.has(mint)) continue;
        orders.push({ side: 'sell', mint, token_amount: h.token_amount, max_slippage_bps: p.sellSlippageBps });
        b.exiting = true;
        continue;
      }
      // Add a tranche while the dip holds near the first entry.
      if (flattenAll || stopped) continue;
      const maxPos = b.strong ? p.maxPosition : p.weakMaxPosition;
      if (pendingMints.has(mint) || b.committed >= maxPos) continue;
      if (Math.abs(price / b.entryPrice - 1) > p.addBand) continue;
      let amount = maxPos - b.committed;
      const tranche = b.strong ? p.tranche : p.weakTranche;
      if (amount > tranche) amount = tranche;
      const sizeCap = buyCap(state, mint);
      if (amount > sizeCap) amount = sizeCap;
      if (amount < p.minBuy) continue;
      if (state.freeCashLamports() - amount - tx < 0n) continue;
      orders.push({ side: 'buy', mint, quote_lamports: amount, max_slippage_bps: p.buySlippageBps });
      b.committed += amount;
      pendingMints.add(mint);
    }

    // 2. New entries on coins that traded this slot. None once stopped.
    if (!stopped) {
      let entries = 0;
      let open = state.committedPositionCount();
      for (const mint of touched) {
        if (orders.length >= cap || entries >= entryCap) break;
        if (open >= state.hello.caps.max_open_positions) break;
        if (state.positions.has(mint) || pendingMints.has(mint)) continue;
        const curve = state.curves.get(mint);
        if (curve === undefined || curve.complete) continue;
        const b = book(mint);
        if (slot < b.coolUntil) continue;
        const ticks = b.ticks;
        if (ticks.length < p.flowTrades) continue;
        const last = ticks[ticks.length - 1]!;
        if (last.realSol < p.minRealSol) continue;
        // Recent high within the window.
        let hi = 0;
        let hiReal = 0n;
        for (let i = ticks.length - 1; i >= 0; i--) {
          const t = ticks[i]!;
          if (slot - t.slot > p.highWindow) break;
          if (t.price > hi) {
            hi = t.price;
            hiReal = t.realSol;
          }
        }
        if (hi <= 0 || hiReal < p.minHighRealSol) continue;
        const dd = 1 - last.price / hi;
        const strong = last.realSol >= p.strongRealSol;
        if (strong ? dd < p.ddMin || dd > p.ddMax : dd < p.weakDdMin || dd > p.weakDdMax) continue;
        // Stabilised: bounced off the low of the last lowWindow slots, and
        // that low is not in the last few slots (no new lows being made).
        let low = Infinity;
        let lowSlot = -1;
        for (let i = ticks.length - 1; i >= 0; i--) {
          const t = ticks[i]!;
          if (slot - t.slot > p.lowWindow) break;
          if (t.price < low) {
            low = t.price;
            lowSlot = t.slot;
          }
        }
        if (!isFinite(low) || low <= 0) continue;
        if (slot - lowSlot < p.lowMinAge) continue;
        if (last.price < low * (1 + p.bounceMin)) continue;
        // Buyers still there.
        let buys = 0;
        let net = 0n;
        for (let i = ticks.length - p.flowTrades; i < ticks.length; i++) {
          const t = ticks[i]!;
          if (t.isBuy) {
            buys++;
            net += t.sol;
          } else net -= t.sol;
        }
        if (buys < p.minBuys || net < p.minNetFlow) continue;
        if (p.lastMustBeBuy && !last.isBuy) continue;
        let amount = strong ? p.tranche : p.weakTranche;
        const maxPos = strong ? p.maxPosition : p.weakMaxPosition;
        if (amount > maxPos) amount = maxPos;
        const sizeCap = buyCap(state, mint);
        if (amount > sizeCap) amount = sizeCap;
        if (amount < p.minBuy) continue;
        if (state.freeCashLamports() - amount - tx < 0n) continue;
        orders.push({ side: 'buy', mint, quote_lamports: amount, max_slippage_bps: p.buySlippageBps });
        b.entryPrice = last.price;
        b.entrySlot = slot;
        b.entryHigh = hi;
        b.committed = amount;
        b.exiting = false;
        b.strong = strong;
        pendingMints.add(mint);
        entries++;
        open++;
      }
    }
    return orders;
  };
}
