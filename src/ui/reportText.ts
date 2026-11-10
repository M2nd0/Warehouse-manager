import { t } from '../data/i18n';
import type { DailyReport } from '../sim/types';
import { formatAmount, formatMoney, formatPercent } from './format';

/**
 * The daily report as plain text (console output until the report panel
 * exists). Days are shown 1-based, like in the HUD.
 */
export function formatDailyReport(r: DailyReport): string {
  const none = t('report.none');
  const due = r.ordersOnTime + r.ordersLate;
  const rows: [string, string, string][] = [
    [
      t('report.otif'),
      r.otif === null ? none : formatPercent(r.otif),
      t('report.otifDetail', { perfect: r.ordersPerfect, due }),
    ],
    [
      t('report.errorRate'),
      r.errorRate === null ? none : formatPercent(r.errorRate),
      t('report.errorDetail', { errors: r.lineErrors, lines: r.linesPicked }),
    ],
    [
      t('report.costPerLine'),
      r.costPerLine === null ? none : t('unit.perLine', { amount: formatAmount(r.costPerLine) }),
      t('report.costDetail', { wages: formatMoney(r.wages), rent: formatMoney(r.rent) }),
    ],
    [
      t('report.inbound'),
      String(r.palletsReceived),
      t('report.inboundDetail', {
        received: r.palletsReceived,
        putAway: r.palletsPutAway,
        trucks: r.trucksServed,
        wait: r.truckWaitMinutes,
      }),
    ],
    [
      t('report.outbound'),
      String(r.ordersShipped),
      t('report.outboundDetail', {
        shipped: r.ordersShipped,
        pallets: r.palletsShipped,
        late: r.ordersLate,
        open: r.openOrders,
      }) + (r.pickupsMissed > 0 ? `, ${t('report.pickupMissed', { count: r.pickupsMissed })}` : ''),
    ],
    [
      t('report.storage'),
      r.storageCapacity > 0 ? formatPercent(r.storageUsed / r.storageCapacity, 0) : none,
      t('report.storageDetail', { used: r.storageUsed, capacity: r.storageCapacity }),
    ],
    [
      t('report.labour'),
      r.shiftMinutes > 0 ? formatPercent(r.busyMinutes / r.shiftMinutes, 0) : none,
      t('report.labourDetail', { busy: Math.round(r.busyMinutes), shift: r.shiftMinutes }),
    ],
    [
      t('report.money'),
      formatMoney(r.revenue),
      t('report.moneyDetail', { penalties: formatMoney(r.penalties) }),
    ],
    [t('report.cash'), formatMoney(r.cash), ''],
  ];

  const labelWidth = Math.max(...rows.map((row) => row[0].length));
  const valueWidth = Math.max(...rows.map((row) => row[1].length));
  const title = `── ${t('report.title', { day: r.day + 1 })} `;
  const lines = [title.padEnd(64, '─')];
  for (const [label, value, detail] of rows) {
    lines.push(`  ${label.padEnd(labelWidth)}  ${value.padStart(valueWidth)}  ${detail}`.trimEnd());
  }
  return lines.join('\n');
}
