import { describe, expect, it } from 'vitest';
import { balance } from '../src/data/balance';
import { createSim } from '../src/sim';
import { misplaceChance } from '../src/sim/incidents';
import { manhattan } from '../src/sim/nav';
import { TICKS_PER_DAY } from '../src/sim/time';
import type { GameState } from '../src/sim/types';
import { quiet, starterSim, violations } from './helpers';

/** Average distance between a pallet and the nearest other pallet of its SKU. */
function scatter(state: GameState): number {
  const stored = [...state.pallets.values()].filter((p) => p.status === 'stored');
  const cell = (locId: string) => state.locations.get(locId)?.cell ?? { x: 0, y: 0 };
  let total = 0;
  let count = 0;
  for (const pallet of stored) {
    const mates = stored.filter((o) => o.id !== pallet.id && o.skuId === pallet.skuId);
    if (mates.length === 0) continue;
    total += Math.min(...mates.map((o) => manhattan(cell(o.locId), cell(pallet.locId))));
    count++;
  }
  return total / Math.max(1, count);
}

describe('put-away with fixed positions (MVP)', () => {
  it('marking them out is paid once', () => {
    const sim = createSim();
    const price = balance.putaway.fixedPositionsPrice;
    expect(sim.dispatch({ type: 'set-putaway', strategy: 'fixed' })).toMatchObject({ ok: true });
    expect(sim.state.settings).toMatchObject({ putawayStrategy: 'fixed', fixedPositions: true });
    expect(sim.state.cash).toBe(balance.start.cash - price);
    sim.dispatch({ type: 'set-putaway', strategy: 'chaos' });
    sim.dispatch({ type: 'set-putaway', strategy: 'fixed' });
    expect(sim.state.cash).toBe(balance.start.cash - price);

    const broke = createSim();
    broke.state.cash = price - 1;
    expect(broke.dispatch({ type: 'set-putaway', strategy: 'fixed' })).toEqual({ ok: false, error: 'not-enough-cash' });
    expect(broke.state.settings.putawayStrategy).toBe('chaos');
  });

  it('keeps each SKU together, where chaos scatters it', () => {
    const run = (fixed: boolean): GameState => {
      const sim = starterSim({ seed: 9 });
      if (fixed) sim.dispatch({ type: 'set-putaway', strategy: 'fixed' });
      sim.run(6 * TICKS_PER_DAY);
      expect(violations(sim.state)).toEqual([]);
      return sim.state;
    };
    const chaos = scatter(run(false));
    const fixed = scatter(run(true));
    expect(fixed).toBeLessThan(2.5);
    expect(chaos).toBeGreaterThan(fixed * 1.5);
  });

  it('GDD: fixed locations prevent lost goods', () => {
    const { state } = createSim();
    const worker = state.workers[0];
    expect(misplaceChance(worker, 0, true)).toBeCloseTo(misplaceChance(worker, 0) * balance.putaway.fixedMisplaceFactor, 12);
  });
});

describe('insolvency (GDD: the overdraft covers 14 days of negative cash)', () => {
  it('fourteen days in a row in the red end the game; time then stands still', () => {
    const sim = quiet(createSim());
    sim.state.cash = -100;
    const limit = balance.finance.overdraftDays;
    const events = sim.run((limit - 1) * TICKS_PER_DAY);
    expect(sim.state.gameOver).toBeNull();
    expect(events.filter((e) => e.type === 'overdraft').map((e) => (e.type === 'overdraft' ? e.days : 0)))
      .toEqual(Array.from({ length: limit - 1 }, (_, i) => i + 1));

    const last = sim.run(TICKS_PER_DAY);
    expect(sim.state.gameOver).toEqual({ day: limit - 1 });
    expect(last.some((e) => e.type === 'game-over')).toBe(true);

    const tick = sim.state.tick;
    expect(sim.run(500)).toEqual([]);
    expect(sim.state.tick).toBe(tick);
    expect(sim.dispatch({ type: 'build-rack', x: 10, y: 4, orientation: 'h' })).toEqual({ ok: false, error: 'game-over' });
  });

  it('a day back in the black resets the count', () => {
    const sim = quiet(createSim({ workers: 0 }));
    sim.state.cash = -100;
    sim.run(5 * TICKS_PER_DAY);
    expect(sim.state.overdraftDays).toBe(5);
    sim.state.cash = 50_000;
    sim.run(TICKS_PER_DAY);
    expect(sim.state.overdraftDays).toBe(0);
    sim.state.cash = -100;
    sim.run(13 * TICKS_PER_DAY);
    expect(sim.state.gameOver).toBeNull();
  });
});
