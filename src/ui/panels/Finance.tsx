import { t } from '../../data/i18n';
import { cashflow, monthToDate } from '../../sim/queries';
import type { CashflowDay } from '../../sim/queries';
import type { GameView } from '../../sim/types';
import { Empty, Field, Section, Stat } from '../bits';
import { formatMoney } from '../format';
import { clientName } from '../text';

const CHART_WIDTH = 300;
const CHART_HEIGHT = 80;
const MOVEMENTS_SHOWN = 7;

/** Projected cash as a line; the zero line shows when it dips into the red. */
function CashChart({ days }: { days: CashflowDay[] }) {
  const values = days.map((d) => d.cash);
  const low = Math.min(0, ...values);
  const high = Math.max(1, ...values);
  const x = (i: number): number => (i / Math.max(1, days.length - 1)) * CHART_WIDTH;
  const y = (value: number): number => CHART_HEIGHT - ((value - low) / (high - low)) * CHART_HEIGHT;
  const points = values.map((value, i) => `${x(i).toFixed(1)},${y(value).toFixed(1)}`).join(' ');
  const lowest = days.reduce((min, d) => (d.cash < min.cash ? d : min), days[0]);
  return (
    <figure class="chart">
      <svg
        viewBox={`0 -4 ${CHART_WIDTH} ${CHART_HEIGHT + 8}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={t('finance.cashflow')}
      >
        <line class="chart__zero" x1="0" x2={CHART_WIDTH} y1={y(0)} y2={y(0)} />
        <polyline class={`chart__line ${lowest.cash < 0 ? 'chart__line--bad' : ''}`} points={points} />
      </svg>
      <figcaption>
        {t('finance.lowest', { amount: formatMoney(lowest.cash, 0), day: lowest.day + 1 })}
      </figcaption>
    </figure>
  );
}

/** Panel 4: cash, this month's profit and loss, invoices, the next 30 days. */
export function FinancePanel({ state }: { state: GameView }) {
  const month = monthToDate(state);
  const days = cashflow(state);
  const outstanding = state.invoices.filter((invoice) => !invoice.paid);
  const receivable = outstanding.reduce((sum, invoice) => sum + invoice.amount, 0);
  const movements = days.flatMap((d) => d.items.map((item) => ({ ...item, day: d.day }))).slice(0, MOVEMENTS_SHOWN);

  return (
    <>
      <div class="stats">
        <Stat label={t('hud.cash')} value={formatMoney(state.cash, 0)} tone={state.cash < 0 ? 'bad' : 'plain'} />
        <Stat label={t('finance.receivable')} value={formatMoney(receivable, 0)} />
      </div>

      <Section title={t('finance.month', { month: month.month + 1 })}>
        <Field label={t('finance.earned')} value={formatMoney(month.earned)} />
        <Field label={t('finance.wages')} value={formatMoney(-month.wages)} />
        <Field label={t('finance.rent')} value={formatMoney(-month.rent)} />
        <Field label={t('finance.penalties')} value={formatMoney(-month.penalties)} tone={month.penalties > 0 ? 'bad' : 'plain'} />
        <div class="field field--total">
          <span class="field__label">{t('finance.profit')}</span>
          <span class={`field__value ${month.profit < 0 ? 'tone-bad' : 'tone-good'}`}>{formatMoney(month.profit)}</span>
        </div>
        {month.construction !== 0 && <Field label={t('finance.construction')} value={formatMoney(-month.construction)} />}
        <p class="note">{t('finance.earnedNote')}</p>
      </Section>

      <Section title={t('finance.invoices')} aside={String(outstanding.length)}>
        {outstanding.length === 0 && <Empty text={t('finance.noInvoices')} />}
        {outstanding.map((invoice) => (
          <Field
            key={invoice.id}
            label={t('finance.invoiceDue', { client: clientName(invoice.clientId), day: invoice.dueDay + 1 })}
            value={formatMoney(invoice.amount)}
          />
        ))}
      </Section>

      <Section title={t('finance.cashflow')}>
        <CashChart days={days} />
        {movements.map((item, i) => (
          <Field
            key={i}
            label={t('finance.movement', { day: item.day + 1, what: t(`ledger.${item.kind}`) })}
            value={formatMoney(item.amount, 0)}
            tone={item.amount < 0 ? 'plain' : 'good'}
          />
        ))}
      </Section>
    </>
  );
}
