import { t } from '../data/i18n';
import type { Alert } from '../sim/queries';
import type { GameView } from '../sim/types';
import { describeAlert } from './alertText';
import type { UiActions } from './controller';
import { formatClock } from './format';
import type { Notice, PanelId } from './store';

/** Which panel holds the buttons for dealing with an alert. */
const PANEL_FOR: Partial<Record<Alert['kind'], PanelId>> = {
  incident: 'operations',
  offer: 'clients',
  'orders-late': 'operations',
};

/**
 * The alerts column (FUN-PLAN step 1): everything that is wrong right now,
 * worst first, each with its reason; a click takes the camera to the cause.
 * Below it, the day's news — things that happened and are worth remembering.
 */
export function Alerts({
  state,
  alerts,
  notices,
  actions,
}: {
  state: GameView;
  alerts: readonly Alert[];
  notices: readonly Notice[];
  actions: UiActions;
}) {
  if (alerts.length === 0 && notices.length === 0) return null;
  return (
    <section class="alerts" aria-label={t('alerts.label')} data-testid="alerts">
      {alerts.map((alert) => {
        const text = describeAlert(state, alert);
        return (
          <button
            key={alert.key}
            type="button"
            class={`alert alert--${alert.tone}`}
            data-testid="alert"
            data-kind={alert.kind}
            onClick={() => actions.focus(alert.subject, alert.cell, PANEL_FOR[alert.kind])}
          >
            <span class="alert__title">{text.title}</span>
            {text.detail && <span class="alert__detail">{text.detail}</span>}
          </button>
        );
      })}
      {notices.map((notice) => (
        <div key={notice.id} class={`alert alert--notice alert--${notice.tone}`} data-testid="notice">
          <button type="button" class="alert__body" onClick={() => actions.focus(notice.subject, notice.cell)}>
            <span class="alert__time">{formatClock(notice.tick)}</span> {notice.text}
          </button>
          <button
            type="button"
            class="iconbtn"
            aria-label={t('alerts.dismiss')}
            onClick={() => actions.dismissNotice(notice.id)}
          >
            ×
          </button>
        </div>
      ))}
    </section>
  );
}
