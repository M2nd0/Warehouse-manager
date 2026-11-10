import { t } from '../data/i18n';
import { TICKS_PER_DAY } from '../sim/time';

/** Cents → "1 234.50" (thin, non-breaking grouping). */
export function formatAmount(cents: number, decimals = 2): string {
  const negative = cents < 0;
  const fixed = (Math.abs(cents) / 100).toFixed(decimals);
  const [whole, fraction] = fixed.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${negative ? '−' : ''}${grouped}${fraction ? `.${fraction}` : ''}`;
}

export function formatMoney(cents: number, decimals = 2): string {
  return t('money.eur', { amount: formatAmount(cents, decimals) });
}

/** Tick → "08:05". */
export function formatClock(tick: number): string {
  const minute = ((tick % TICKS_PER_DAY) + TICKS_PER_DAY) % TICKS_PER_DAY;
  const hh = Math.floor(minute / 60);
  const mm = minute % 60;
  return `${hh < 10 ? '0' : ''}${hh}:${mm < 10 ? '0' : ''}${mm}`;
}

/** 0.953 → "95.3 %" */
export function formatPercent(ratio: number, decimals = 1): string {
  return t('unit.percent', { value: (ratio * 100).toFixed(decimals) });
}
