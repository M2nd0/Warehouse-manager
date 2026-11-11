import { t } from '../../data/i18n';
import { storageUse } from '../../sim/economy/report';
import { choiceAvailable } from '../../sim/incidents';
import { labourUseToday, openOrders, otifToday, truckBoard } from '../../sim/queries';
import type { EntityRef, GameView } from '../../sim/types';
import { Badge, Empty, Section, Stat } from '../bits';
import type { Tone } from '../bits';
import type { UiActions } from '../controller';
import { describeIncident } from '../incidentText';
import { balance } from '../../data/balance';
import { formatMoney, formatPercent } from '../format';
import { activityText, clientName, truckStatusText, whenText, windowText } from '../text';

const ORDERS_SHOWN = 12;

type Order = GameView['orders'][number];

const orderTone = (order: Order): Tone =>
  order.late ? 'bad' : order.status === 'ready' ? 'good' : order.status === 'picking' ? 'warn' : 'plain';

/** Panel 1: the truck queue, open orders, who is doing what, incidents. */
export function OperationsPanel({ state, actions }: { state: GameView; actions: UiActions }) {
  const onSelect = (ref: EntityRef): void => actions.select(ref);
  const incidents = state.incidents.filter((i) => i.resolved === null);
  const otif = otifToday(state);
  const labour = labourUseToday(state);
  const storage = storageUse(state);
  const trucks = truckBoard(state);
  const orders = openOrders(state);
  const late = orders.filter((o) => o.late).length;
  const present = state.workers.filter((w) => w.status !== 'off');

  return (
    <>
      <div class="stats">
        <Stat
          label={t('ops.otif')}
          value={otif === null ? t('report.none') : formatPercent(otif, 0)}
          tone={otif === null ? 'plain' : otif >= 0.95 ? 'good' : otif >= 0.85 ? 'warn' : 'bad'}
        />
        <Stat label={t('ops.openOrders')} value={String(orders.length)} tone={late > 0 ? 'bad' : 'plain'} />
        <Stat label={t('ops.labour')} value={labour === null ? t('report.none') : formatPercent(labour, 0)} />
        <Stat
          label={t('ops.storage')}
          value={t('ops.storageValue', { used: storage.used, capacity: storage.capacity })}
          tone={storage.capacity > 0 && storage.used / storage.capacity > 0.9 ? 'warn' : 'plain'}
        />
      </div>

      <Section title={t('ops.incidents')} aside={String(incidents.length)}>
        {incidents.length === 0 && <Empty text={t('ops.noIncidents')} />}
        {incidents.map((incident) => {
          const text = describeIncident(state, incident);
          const subject = incident.subject;
          const locatable = subject && subject.kind !== 'client' && subject.kind !== 'order' && subject.kind !== 'location';
          return (
            <article key={incident.id} class="incident" data-testid="incident" data-kind={incident.kind}>
              <header class="incident__head">
                {locatable ? (
                  <button type="button" class="incident__title link" onClick={() => onSelect(subject)}>
                    {text.title}
                  </button>
                ) : (
                  <span class="incident__title">{text.title}</span>
                )}
              </header>
              <p class="incident__text">{text.text}</p>
              <p class="incident__cause">
                <span class="tone-dim">{t('incident.cause')}: </span>
                {text.cause}
              </p>
              <div class="incident__choices">
                {text.choices.map((choice) => (
                  <button
                    key={choice.id}
                    type="button"
                    class="btn btn--choice"
                    disabled={!choiceAvailable(state, incident, choice.id)}
                    data-testid={`choice-${choice.id}`}
                    onClick={() => actions.act({ type: 'resolve-incident', incidentId: incident.id, choiceId: choice.id })}
                  >
                    {choice.label}
                  </button>
                ))}
              </div>
              {text.deadline && <p class="note">{text.deadline}</p>}
            </article>
          );
        })}
      </Section>

      <Section title={t('putaway.title')}>
        <span class="segmented" role="group" aria-label={t('putaway.title')}>
          <button
            type="button"
            class={`segmented__item ${state.settings.putawayStrategy === 'chaos' ? 'segmented__item--on' : ''}`}
            aria-pressed={state.settings.putawayStrategy === 'chaos'}
            data-testid="putaway-chaos"
            onClick={() => actions.act({ type: 'set-putaway', strategy: 'chaos' })}
          >
            {t('putaway.chaos')}
          </button>
          <button
            type="button"
            class={`segmented__item ${state.settings.putawayStrategy === 'fixed' ? 'segmented__item--on' : ''}`}
            aria-pressed={state.settings.putawayStrategy === 'fixed'}
            data-testid="putaway-fixed"
            onClick={() => actions.act({ type: 'set-putaway', strategy: 'fixed' })}
          >
            {state.settings.fixedPositions
              ? t('putaway.fixed')
              : t('putaway.fixedBuy', { price: formatMoney(balance.putaway.fixedPositionsPrice, 0) })}
          </button>
        </span>
        <p class="note">{t(`putaway.note.${state.settings.putawayStrategy}`)}</p>
      </Section>

      <Section title={t('ops.trucks')} aside={String(trucks.length)}>
        {trucks.length === 0 && <Empty text={t('ops.noTrucks')} />}
        <ul class="list">
          {trucks.map((truck) => {
            const onSite = truck.status === 'waiting' || truck.status === 'at-dock';
            return (
              <li key={truck.id}>
                <button
                  type="button"
                  class="row"
                  disabled={!onSite}
                  onClick={() => onSelect({ kind: 'truck', id: truck.id })}
                >
                  <span class="row__main">
                    {truck.kind === 'pickup' ? t('truck.carrier') : clientName(truck.clientId)}
                    {truck.kind === 'inbound' && <span class="row__dim"> · {t('truck.pallets', { count: truck.manifest })}</span>}
                  </span>
                  <span class="row__side">{windowText(truck)}</span>
                  <span class={`row__sub ${truck.status === 'waiting' ? 'tone-warn' : ''}`}>
                    {truckStatusText(state, truck)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </Section>

      <Section
        title={t('ops.orders')}
        aside={late > 0 ? t('ops.ordersLate', { count: orders.length, late }) : String(orders.length)}
      >
        {orders.length === 0 && <Empty text={t('ops.noOrders')} />}
        <ul class="list">
          {orders.slice(0, ORDERS_SHOWN).map((order) => (
            <li key={order.id} class="row row--static">
              <span class="row__main">
                {t('order.title', { id: order.id })}
                <span class="row__dim"> · {clientName(order.clientId)}</span>
              </span>
              <span class="row__side">
                <Badge text={t(order.late ? 'order.late' : `order.status.${order.status}`)} tone={orderTone(order)} />
              </span>
              <span class="row__sub">
                {t('order.lines', { count: order.lines.length })} · {t('order.due', { when: whenText(state, order.deadlineTick) })}
              </span>
            </li>
          ))}
        </ul>
        {orders.length > ORDERS_SHOWN && <p class="more">{t('ops.more', { count: orders.length - ORDERS_SHOWN })}</p>}
      </Section>

      <Section title={t('ops.staff')} aside={t('ops.staffOnSite', { present: present.length, total: state.workers.length })}>
        <ul class="list">
          {state.workers.map((worker) => (
            <li key={worker.id}>
              <button
                type="button"
                class="row"
                disabled={worker.status === 'off'}
                onClick={() => onSelect({ kind: 'worker', id: worker.id })}
              >
                <span class="row__main">{worker.name}</span>
                <span class={`row__sub ${worker.status === 'blocked' ? 'tone-bad' : ''}`}>
                  {activityText(state, worker)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Section>

    </>
  );
}
