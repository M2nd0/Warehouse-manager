/**
 * Headless run of the simulation with the starter garage layout.
 *
 *   npm run sim                 3 days, seed 1
 *   npm run sim -- 30           30 days
 *   npm run sim -- 30 7 2       30 days, seed 7, 2 workers
 */
import { garageStarterRacks } from '../src/data/halls';
import { createSim } from '../src/sim';
import { TICKS_PER_DAY } from '../src/sim/time';
import { formatMoney, formatPercent } from '../src/ui/format';
import { formatDailyReport } from '../src/ui/reportText';

const [daysArg, seedArg, workersArg] = process.argv.slice(2);
const days = Number(daysArg ?? 3);
const seed = Number(seedArg ?? 1);
const workers = workersArg === undefined ? undefined : Number(workersArg);

const sim = createSim({ seed, workers });
for (const rack of garageStarterRacks) sim.dispatch({ type: 'build-rack', ...rack });

const started = performance.now();
for (const event of sim.run(days * TICKS_PER_DAY)) {
  if (event.type === 'day-ended') console.log(`${formatDailyReport(event.report)}\n`);
}
const elapsed = performance.now() - started;

const reports = sim.state.reports;
const sum = (pick: (r: (typeof reports)[number]) => number): number =>
  reports.reduce((total, r) => total + pick(r), 0);
const due = sum((r) => r.ordersOnTime + r.ordersLate);
const lines = sum((r) => r.linesPicked);

console.log(`══ ${days} days, seed ${seed}, ${sim.state.workers.length} worker(s) `.padEnd(64, '═'));
console.log(`  OTIF            ${due > 0 ? formatPercent(sum((r) => r.ordersPerfect) / due) : 'n/a'}`);
console.log(`  Picking errors  ${lines > 0 ? formatPercent(sum((r) => r.lineErrors) / lines) : 'n/a'}`);
console.log(`  Lines per day   ${(lines / days).toFixed(1)}`);
console.log(`  Labour busy     ${formatPercent(sum((r) => r.busyMinutes) / Math.max(1, sum((r) => r.shiftMinutes)), 0)}`);
console.log(`  Earned          ${formatMoney(sum((r) => r.revenue))}   penalties ${formatMoney(sum((r) => r.penalties))}`);
console.log(`  Cash            ${formatMoney(sim.state.cash)}`);
console.log(`  ${(elapsed / (days * TICKS_PER_DAY) * 1000).toFixed(1)} µs per tick`);
