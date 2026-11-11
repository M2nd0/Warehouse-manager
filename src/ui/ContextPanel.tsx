import { balance } from '../data/balance';
import { t } from '../data/i18n';
import { checkDemolition } from '../sim/layout';
import { dockDay, palletWeight, rackContents } from '../sim/queries';
import type { EntityRef, GameView } from '../sim/types';
import { Bar, Field } from './bits';
import type { UiActions } from './controller';
import { formatAmount, formatPercent } from './format';
import { DutyPicker } from './panels/People';
import { activityText, clientName, durationText, skuName, truckStatusText, whenText, windowText } from './text';

/**
 * The small card for whatever was clicked in the scene (GDD: worker, rack,
 * pallet, truck, dock). Returns null when the thing is gone.
 */
export function ContextPanel({
  state,
  selection,
  actions,
}: {
  state: GameView;
  selection: EntityRef;
  actions: UiActions;
}) {
  const body = describe(state, selection, actions);
  if (!body) return null;
  return (
    <aside class="context" data-testid="context" data-kind={selection.kind}>
      <header class="context__head">
        <h2 class="context__title">{body.title}</h2>
        {body.subtitle && <span class="context__subtitle">{body.subtitle}</span>}
        <button type="button" class="iconbtn" aria-label={t('context.close')} onClick={() => actions.select(null)}>
          ×
        </button>
      </header>
      {body.content}
    </aside>
  );
}

interface Card {
  title: string;
  subtitle?: string;
  content: preact.ComponentChildren;
}

function describe(state: GameView, ref: EntityRef, actions: UiActions): Card | null {
  switch (ref.kind) {
    case 'worker': {
      const worker = state.workers.find((w) => w.id === ref.id);
      if (!worker) return null;
      const progress = worker.status === 'working' && worker.workTotal > 0 ? 1 - worker.workLeft / worker.workTotal : null;
      return {
        title: worker.name,
        subtitle: t(`role.${worker.role}`),
        content: (
          <>
            <p class={`context__lead ${worker.status === 'blocked' ? 'tone-bad' : ''}`}>{activityText(state, worker)}</p>
            {progress !== null && (
              <Field
                label={t('context.worker.progress')}
                value={<Bar value={progress} tone="good" label={t('context.worker.progress')} />}
              />
            )}
            <Field
              label={t('people.fatigue')}
              value={
                <>
                  <Bar value={worker.fatigue / 100} tone={worker.fatigue > 70 ? 'bad' : 'plain'} label={t('people.fatigue')} />
                  <span class="field__number">{formatPercent(worker.fatigue / 100, 0)}</span>
                </>
              }
            />
            <Field
              label={t('people.morale')}
              value={
                <>
                  <Bar value={worker.morale / 100} tone={worker.morale < 40 ? 'bad' : 'good'} label={t('people.morale')} />
                  <span class="field__number">{formatPercent(worker.morale / 100, 0)}</span>
                </>
              }
            />
            <Field label={t('people.duty')} value={<DutyPicker worker={worker} actions={actions} />} />
          </>
        ),
      };
    }

    case 'rack': {
      const rack = state.racks.find((r) => r.id === ref.id);
      if (!rack) return null;
      const levels = rackContents(state, rack.id);
      const address = levels[0]?.slots[0]?.locId.split('-').slice(0, 2).join('-') ?? '';
      const inUse = checkDemolition(state, rack.id) !== null;
      return {
        title: t('context.rack.title', { address }),
        content: (
          <>
            <table class="rack">
              <tbody>
                {levels.map((level) => (
                  <tr key={level.level}>
                    <th scope="row">{t('context.rack.level', { level: level.level })}</th>
                    {level.slots.map((slot) => (
                      <td key={slot.locId} class={slot.pallet ? 'rack__full' : ''} title={slot.locId}>
                        {slot.pallet ? (
                          <button type="button" class="rack__slot" onClick={() => actions.select({ kind: 'pallet', id: slot.pallet?.id ?? 0 })}>
                            <span>{slot.pallet.skuId}</span>
                            <span class="rack__qty">{t('unit.pieces', { count: slot.pallet.qty })}</span>
                          </button>
                        ) : (
                          <span class="rack__none">{t(slot.reserved ? 'context.rack.reserved' : 'context.rack.empty')}</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <Field label={t('context.rack.capacity')} value={t('unit.kg', { value: formatAmount(balance.rack.capacityKg * 100, 0) })} />
            <p class="note">{t('context.rack.reach')}</p>
            <button
              type="button"
              class="btn btn--danger"
              disabled={inUse}
              title={inUse ? t('build.error.rack-in-use') : undefined}
              data-testid="context-demolish"
              onClick={() => actions.demolish(rack.id)}
            >
              {t('context.rack.demolish')}
            </button>
          </>
        ),
      };
    }

    case 'pallet': {
      const pallet = state.pallets.get(ref.id);
      if (!pallet) return null;
      const sku = state.skus.get(pallet.skuId);
      const carrier = state.workers.find((w) => w.carrying === pallet.id);
      const where =
        pallet.locId !== 'in-transit'
          ? pallet.locId
          : carrier
            ? t('context.pallet.carried', { name: carrier.name })
            : t('context.pallet.onTruck');
      return {
        title: skuName(pallet.skuId),
        subtitle: pallet.skuId,
        content: (
          <>
            <Field label={t('context.pallet.client')} value={clientName(pallet.clientId)} />
            <Field
              label={t('context.pallet.qty')}
              value={t('context.pallet.qtyValue', { qty: pallet.qty, full: sku?.unitsPerPallet ?? pallet.qty })}
            />
            <Field label={t('context.pallet.weight')} value={t('unit.kg', { value: Math.round(palletWeight(state, pallet)) })} />
            <Field label={t('context.pallet.location')} value={where} />
            <Field label={t('context.pallet.status')} value={t(`pallet.status.${pallet.status}`)} />
            {pallet.hold && <p class="context__lead tone-bad">{t(`pallet.hold.${pallet.hold}`)}</p>}
            <Field label={t('context.pallet.arrived')} value={whenText(state, pallet.arrivedTick)} />
            <Field
              label={t('context.pallet.expiry')}
              value={
                pallet.expiryDay === null
                  ? t('context.pallet.noExpiry')
                  : t('context.pallet.expiryDay', { day: pallet.expiryDay + 1 })
              }
            />
          </>
        ),
      };
    }

    case 'truck': {
      const truck = state.trucks.find((tr) => tr.id === ref.id);
      if (!truck) return null;
      return {
        title: truck.kind === 'pickup' ? t('truck.carrier') : clientName(truck.clientId),
        content: (
          <>
            <p class={`context__lead ${truck.status === 'waiting' ? 'tone-warn' : ''}`}>{truckStatusText(state, truck)}</p>
            <Field label={t('context.truck.window')} value={windowText(truck)} />
            {truck.arrivedTick !== null && (
              <Field label={t('context.truck.arrived')} value={whenText(state, truck.arrivedTick)} />
            )}
            {truck.kind === 'inbound' ? (
              <Field
                label={t('context.truck.cargo')}
                value={t('context.truck.cargoValue', { left: truck.cargo.length, total: truck.manifest })}
              />
            ) : (
              truck.departureTick !== null && (
                <Field label={t('context.truck.departs')} value={whenText(state, truck.departureTick)} />
              )
            )}
          </>
        ),
      };
    }

    case 'dock': {
      const dock = state.hall.docks.find((d) => d.id === ref.id);
      if (!dock) return null;
      const day = dockDay(state, dock.id);
      const truck = state.trucks.find((tr) => tr.id === dock.truckId);
      return {
        title: t('context.dock.title'),
        content: (
          <>
            <Field
              label={t('context.dock.truck')}
              value={
                truck ? (
                  <button type="button" class="link" onClick={() => actions.select({ kind: 'truck', id: truck.id })}>
                    {truck.kind === 'pickup' ? t('truck.carrier') : clientName(truck.clientId)}
                  </button>
                ) : (
                  t('context.dock.free')
                )
              }
            />
            <Field
              label={t('context.dock.busy')}
              value={t('context.dock.busyValue', {
                busy: durationText(day.busyMinutes),
                elapsed: durationText(day.elapsedMinutes),
                percent: formatPercent(day.elapsedMinutes > 0 ? day.busyMinutes / day.elapsedMinutes : 0, 0),
              })}
            />
            <Field label={t('context.dock.trucks')} value={String(day.trucks)} />
          </>
        ),
      };
    }

    case 'vehicle': {
      const vehicle = state.vehicles.find((v) => v.id === ref.id);
      if (!vehicle) return null;
      const user = state.workers.find((w) => w.id === vehicle.userId);
      return {
        title: t(`vehicle.${vehicle.kind}`),
        content: (
          <>
            <Field label={t('context.vehicle.user')} value={user ? user.name : t('context.vehicle.parked')} />
            <Field
              label={t('context.vehicle.reach')}
              value={t('context.vehicle.reachValue', { levels: balance.vehicles[vehicle.kind].reachLevels })}
            />
            <Field label={t('context.vehicle.hours')} value={t('unit.hours', { value: vehicle.hours.toFixed(1) })} />
          </>
        ),
      };
    }

    default:
      return null;
  }
}
