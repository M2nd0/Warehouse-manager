import { balance } from '../../data/balance';
import { emit } from '../context';
import type { SimContext } from '../context';
import { post } from '../economy/ledger';
import { buildReport, emptyDayStats } from '../economy/report';
import { closeDay as closeIncidentDay } from '../incidents';
import { updateMorale } from '../people';
import type { Cents, Client, ClientId, GameState } from '../types';

const { daysPerMonth, daysPerWeek } = balance.time;

/**
 * Finance: rent on the 1st, invoices collected when due, and the end-of-day
 * close (storage fees, wages, month-end invoicing, the daily report).
 */
export function step(state: GameState, ctx: SimContext): void {
  if (ctx.dayStart) {
    if (state.day % daysPerMonth === 0) post(state, ctx, 'rent', -balance.rent.garagePerMonth);
    collectInvoices(state, ctx);
  }
  if (ctx.dayEnd) closeDay(state, ctx);
}

function collectInvoices(state: GameState, ctx: SimContext): void {
  for (const invoice of state.invoices) {
    if (invoice.paid || invoice.dueDay > state.day) continue;
    invoice.paid = true;
    post(state, ctx, 'invoice', invoice.amount, invoice.clientId);
  }
}

/** What a client owes for the services delivered since the last invoice. */
export function unbilledAmount(client: Client): Cents {
  const { contract, unbilled } = client;
  return (
    unbilled.storageFees +
    unbilled.palletsReceived * contract.receivingFeePerPallet +
    unbilled.lines * contract.pickFeePerLine
  );
}

function closeDay(state: GameState, ctx: SimContext): void {
  // Storage is billed per pallet per day in a rack.
  const stored = new Map<ClientId, number>();
  for (const pallet of state.pallets.values()) {
    if (pallet.status === 'stored') stored.set(pallet.clientId, (stored.get(pallet.clientId) ?? 0) + 1);
  }
  for (const client of state.clients) {
    const pallets = stored.get(client.id) ?? 0;
    const fee = Math.round((pallets * client.contract.storageFeePerPalletMonth) / daysPerMonth);
    client.unbilled.palletDays += pallets;
    client.unbilled.storageFees += fee;
    state.today.revenue += fee;
  }

  // Everyone on the payroll earns a day's wage; GDD: wages are paid weekly.
  let wagesToday = 0;
  for (const worker of state.workers) {
    const earned = Math.round(worker.wagePerMonth / daysPerMonth);
    worker.wagesOwed += earned;
    wagesToday += earned;
  }
  if ((state.day + 1) % daysPerWeek === 0) {
    let owed = 0;
    for (const worker of state.workers) {
      owed += worker.wagesOwed;
      worker.wagesOwed = 0;
    }
    if (owed > 0) post(state, ctx, 'wages', -owed);
  }

  // GDD: clients are invoiced monthly and pay 30 days later.
  if ((state.day + 1) % daysPerMonth === 0) {
    for (const client of state.clients) {
      const amount = unbilledAmount(client);
      if (amount > 0) {
        state.invoices.push({
          id: state.nextId++,
          clientId: client.id,
          issuedDay: state.day,
          dueDay: state.day + balance.invoicing.paymentTermDays,
          amount,
          paid: false,
        });
      }
      client.unbilled = { palletDays: 0, storageFees: 0, palletsReceived: 0, lines: 0 };
      client.month = { shipped: 0, late: 0, wrong: 0, breachDays: 0 };
    }
  }

  // GDD: the overdraft covers 14 days in the red, then it is insolvency.
  state.overdraftDays = state.cash < 0 ? state.overdraftDays + 1 : 0;
  if (state.overdraftDays > 0) emit(ctx, { type: 'overdraft', tick: state.tick, days: state.overdraftDays });
  if (state.overdraftDays >= balance.finance.overdraftDays) {
    state.gameOver = { day: state.day };
    emit(ctx, { type: 'game-over', tick: state.tick });
  }

  const report = buildReport(state, wagesToday, Math.round(balance.rent.garagePerMonth / daysPerMonth));
  state.reports.push(report);
  emit(ctx, { type: 'day-ended', tick: state.tick, report });

  // GDD: reputation grows with OTIF and falls with complaints.
  if (report.otif !== null) {
    const { goodDay, badDay } = balance.incidents.reputation;
    const delta = report.otif >= 0.95 ? goodDay : report.otif < 0.85 ? badDay : 0;
    state.reputation = Math.min(100, Math.max(0, state.reputation + delta));
  }
  for (const worker of state.workers) updateMorale(worker);
  closeIncidentDay(state, ctx);

  // Start the new day with a clean slate.
  state.today = emptyDayStats();
  state.orders = state.orders.filter((o) => o.status !== 'shipped');
  state.trucks = state.trucks.filter((t) => t.status !== 'done');
}
