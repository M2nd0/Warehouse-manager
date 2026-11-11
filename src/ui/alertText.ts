import { balance } from '../data/balance';
import { t } from '../data/i18n';
import type { Alert } from '../sim/queries';
import type { GameView } from '../sim/types';
import { formatClock } from './format';
import { describeIncident } from './incidentText';
import { clientName, durationText } from './text';

/** Wording of the alerts column: what is wrong, and the reason in a second line. */
export interface AlertText {
  title: string;
  detail: string | null;
}

export function describeAlert(state: GameView, alert: Alert): AlertText {
  const p = alert.params;
  const num = (key: string): number => Number(p[key] ?? 0);
  switch (alert.kind) {
    case 'incident': {
      const incident = state.incidents.find((i) => i.id === p.incidentId);
      if (!incident) return { title: t('alert.incident'), detail: null };
      const text = describeIncident(state, incident);
      return { title: text.title, detail: text.deadline ?? text.cause };
    }
    case 'orders-late':
      return { title: t('alert.ordersLate', { count: num('count') }), detail: t('alert.ordersLate.detail') };
    case 'orders-at-risk':
      return {
        title: t('alert.ordersAtRisk', { count: num('count'), time: formatClock(num('departureTick')) }),
        detail: t('alert.ordersAtRisk.detail', {
          due: num('due'),
          pickers: num('pickers'),
          pace: num('minutesPerOrder'),
          left: durationText(num('minutesLeft')),
        }),
      };
    case 'worker-blocked':
      return { title: t('alert.blocked', { name: String(p.name) }), detail: t('alert.blocked.detail') };
    case 'nobody-in':
      return { title: t('alert.nobodyIn'), detail: t('alert.nobodyIn.detail') };
    case 'truck-waiting': {
      const who = num('pickup') === 1 ? t('truck.carrier') : clientName(String(p.client));
      const free = balance.trucks.freeMinutes - num('minutes');
      return {
        title: t('alert.truckWaiting', { who, time: durationText(num('minutes')) }),
        detail:
          num('pickup') === 1
            ? t('alert.truckWaiting.pickup')
            : free > 0
              ? t('alert.truckWaiting.free', { time: durationText(free) })
              : t('alert.truckWaiting.charged'),
      };
    }
    case 'receiving-full':
      return { title: t('alert.receivingFull'), detail: t('alert.receivingFull.detail') };
    case 'storage-full':
      return num('pallets') > 0
        ? { title: t('alert.storageFull', { pallets: num('pallets') }), detail: t('alert.storageFull.detail') }
        : { title: t('alert.storageNearlyFull', { used: num('used'), capacity: num('capacity') }), detail: null };
    case 'worker-tired':
      return { title: t('alert.tired', { name: String(p.name), fatigue: num('fatigue') }), detail: t('alert.tired.detail') };
    case 'worker-idle':
      return { title: t('alert.idle', { name: String(p.name), time: durationText(num('minutes')) }), detail: null };
    case 'offer':
      return {
        title: t('alert.offer', { client: clientName(String(p.client)) }),
        detail: t('alert.offer.detail', { day: num('untilDay') }),
      };
  }
}
