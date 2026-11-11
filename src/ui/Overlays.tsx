import { t } from '../data/i18n';
import { ONBOARDING_STEPS } from '../sim/systems/clients';
import type { DailyReport, GameView } from '../sim/types';
import { Field } from './bits';
import { formatAmount, formatMoney, formatPercent } from './format';

/** The first day's six tasks (GDD "Onboarding"); gone once all are done. */
export function OnboardingCard({ state }: { state: GameView }) {
  const done = state.onboarding.done;
  if (done >= ONBOARDING_STEPS) return null;
  const steps = [1, 2, 3, 4, 5, 6] as const;
  return (
    <aside class="onboarding" data-testid="onboarding">
      <h2 class="onboarding__title">{t('onboarding.title', { done, total: ONBOARDING_STEPS })}</h2>
      <p class="onboarding__lead">{t('onboarding.lead')}</p>
      <ol class="onboarding__list">
        {steps.map((n) => (
          <li key={n} class={n <= done ? 'is-done' : n === done + 1 ? 'is-next' : ''}>
            {t(`onboarding.step.${n}`)}
          </li>
        ))}
      </ol>
    </aside>
  );
}

/** The end-of-day report (GDD: OTIF, error rate, cost per line, capacity used). */
export function ReportCard({ report, onClose }: { report: DailyReport; onClose(): void }) {
  const none = t('report.none');
  const due = report.ordersOnTime + report.ordersLate;
  const costs = report.wages + report.rent;
  return (
    <div class="modal" role="dialog" aria-label={t('report.title', { day: report.day + 1 })} data-testid="report">
      <div class="modal__card">
        <h2 class="modal__title">{t('report.title', { day: report.day + 1 })}</h2>
        <div class="stats">
          <div class="stat">
            <span class={`stat__value ${report.otif !== null && report.otif < 0.85 ? 'tone-bad' : ''}`}>
              {report.otif === null ? none : formatPercent(report.otif)}
            </span>
            <span class="stat__label">{t('report.otif')}</span>
          </div>
          <div class="stat">
            <span class="stat__value">{report.errorRate === null ? none : formatPercent(report.errorRate)}</span>
            <span class="stat__label">{t('report.errorRate')}</span>
          </div>
          <div class="stat">
            <span class="stat__value">
              {report.costPerLine === null ? none : t('unit.perLine', { amount: formatAmount(report.costPerLine) })}
            </span>
            <span class="stat__label">{t('report.costPerLine')}</span>
          </div>
          <div class="stat">
            <span class="stat__value">
              {report.storageCapacity > 0 ? formatPercent(report.storageUsed / report.storageCapacity, 0) : none}
            </span>
            <span class="stat__label">{t('report.storage')}</span>
          </div>
        </div>
        <Field label={t('report.otif')} value={t('report.otifDetail', { perfect: report.ordersPerfect, due })} />
        <Field label={t('report.errorRate')} value={t('report.errorDetail', { errors: report.lineErrors, lines: report.linesPicked })} />
        <Field
          label={t('report.inbound')}
          value={t('report.inboundDetail', {
            received: report.palletsReceived,
            putAway: report.palletsPutAway,
            trucks: report.trucksServed,
            wait: report.truckWaitMinutes,
          })}
        />
        <Field
          label={t('report.outbound')}
          value={t('report.outboundDetail', {
            shipped: report.ordersShipped,
            pallets: report.palletsShipped,
            late: report.ordersLate,
            open: report.openOrders,
          })}
        />
        <Field
          label={t('report.labour')}
          value={t('report.labourDetail', { busy: Math.round(report.busyMinutes), shift: report.shiftMinutes })}
        />
        <Field label={t('report.revenue')} value={formatMoney(report.revenue)} tone="good" />
        <Field label={t('report.costs')} value={formatMoney(-costs)} />
        <Field label={t('report.penalties')} value={formatMoney(-report.penalties)} tone={report.penalties > 0 ? 'bad' : 'plain'} />
        <div class="field field--total">
          <span class="field__label">{t('report.cash')}</span>
          <span class="field__value">{formatMoney(report.cash)}</span>
        </div>
        <button type="button" class="btn btn--primary" data-testid="report-close" onClick={onClose}>
          {t('report.close')}
        </button>
      </div>
    </div>
  );
}

/** New game, export and import of the save. */
export function GameMenu({ onNew, onExport, onImport }: { onNew(): void; onExport(): void; onImport(file: File): void }) {
  return (
    <nav class="menu" aria-label={t('menu.label')}>
      <button type="button" class="menu__item" data-testid="menu-new" onClick={onNew}>
        {t('menu.new')}
      </button>
      <button type="button" class="menu__item" data-testid="menu-export" onClick={onExport}>
        {t('menu.export')}
      </button>
      <label class="menu__item">
        {t('menu.import')}
        <input
          type="file"
          accept="application/json,.json"
          class="visually-hidden"
          data-testid="menu-import"
          onChange={(event) => {
            const input = event.currentTarget;
            const file = input.files?.[0];
            if (file) onImport(file);
            input.value = '';
          }}
        />
      </label>
    </nav>
  );
}
