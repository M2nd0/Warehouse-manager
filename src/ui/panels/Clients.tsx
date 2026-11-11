import { t } from '../../data/i18n';
import { contractEndDay, palletsOf, unbilledOf } from '../../sim/queries';
import type { GameView } from '../../sim/types';
import { balance } from '../../data/balance';
import { Bar, Field, Section } from '../bits';
import type { UiActions } from '../controller';
import { formatClock, formatMoney } from '../format';
import { clientName } from '../text';

/** Panel 3: reputation and, for every client, the contract and how it is being kept this month. */
export function ClientsPanel({ state, actions }: { state: GameView; actions: UiActions }) {
  return (
    <>
      <Section title={t('clients.reputation')} aside={t('clients.reputationValue', { value: Math.round(state.reputation) })}>
        <Bar
          value={state.reputation / 100}
          tone={state.reputation >= 60 ? 'good' : state.reputation >= 35 ? 'warn' : 'bad'}
          label={t('clients.reputation')}
        />
      </Section>

      {state.offers.length > 0 && (
        <Section title={t('clients.offers')} aside={String(state.offers.length)}>
          {state.offers.map((offer) => {
            const client = state.clients.find((c) => c.id === offer.clientId);
            if (!client) return null;
            const pallets = Object.values(client.profile.targetPallets).reduce((sum, n) => sum + n, 0);
            return (
              <article key={offer.clientId} class="card card--offer" data-testid="offer">
                <p class="incident__text">
                  {t('clients.offerText', { client: clientName(client.id), pallets, orders: client.profile.ordersPerDay })}
                </p>
                <Field
                  label={t('clients.fees')}
                  value={t('clients.feesValue', {
                    storage: formatMoney(client.contract.storageFeePerPalletMonth),
                    receiving: formatMoney(client.contract.receivingFeePerPallet),
                    line: formatMoney(client.contract.pickFeePerLine),
                  })}
                />
                <p class="note">{t('clients.offerUntil', { day: offer.expiresDay })}</p>
                <div class="btnrow">
                  <button type="button" class="btn btn--primary" data-testid="offer-accept" onClick={() => actions.act({ type: 'accept-offer', clientId: client.id })}>
                    {t('clients.accept')}
                  </button>
                  <button type="button" class="btn" data-testid="offer-decline" onClick={() => actions.act({ type: 'decline-offer', clientId: client.id })}>
                    {t('clients.decline')}
                  </button>
                </div>
              </article>
            );
          })}
        </Section>
      )}

      {state.clients.filter((client) => client.active || palletsOf(state, client.id) > 0).map((client) => {
        const { contract, month, profile } = client;
        const target = Object.values(profile.targetPallets).reduce((sum, n) => sum + n, 0);
        const breaches = month.late + month.wrong;
        return (
          <Section key={client.id} title={clientName(client.id)} aside={client.active ? t(`client.kind.${client.kind}`) : t('clients.noContract')}>
            <div class="grid3">
              <div class="stat">
                <span class="stat__value">{month.shipped}</span>
                <span class="stat__label">{t('clients.shipped')}</span>
              </div>
              <div class="stat">
                <span class={`stat__value ${month.late > 0 ? 'tone-bad' : ''}`}>{month.late}</span>
                <span class="stat__label">{t('clients.late')}</span>
              </div>
              <div class="stat">
                <span class={`stat__value ${month.wrong > 0 ? 'tone-bad' : ''}`}>{month.wrong}</span>
                <span class="stat__label">{t('clients.wrong')}</span>
              </div>
            </div>
            <Field
              label={t('clients.sla')}
              value={t('clients.slaValue', { hours: contract.slaHours, cutoff: formatClock(contract.cutoffMinute) })}
              tone={breaches > 0 ? 'warn' : 'plain'}
            />
            <Field
              label={t('clients.breachDays')}
              value={t('clients.breachDaysValue', { count: month.breachDays, max: balance.clients.breachDaysToLeave })}
              tone={month.breachDays > 0 ? 'bad' : 'plain'}
            />
            <Field label={t('clients.stock')} value={t('clients.stockValue', { pallets: palletsOf(state, client.id), target })} />
            <Field label={t('clients.unbilled')} value={formatMoney(unbilledOf(state, client.id))} />
            <Field
              label={t('clients.fees')}
              value={t('clients.feesValue', {
                storage: formatMoney(contract.storageFeePerPalletMonth),
                receiving: formatMoney(contract.receivingFeePerPallet),
                line: formatMoney(contract.pickFeePerLine),
              })}
            />
            <Field
              label={t('clients.penalties')}
              value={t('clients.penaltiesValue', {
                late: formatMoney(contract.latePenalty, 0),
                wrong: formatMoney(contract.errorPenalty, 0),
              })}
            />
            <Field label={t('clients.ends')} value={t('hud.day', { day: contractEndDay(contract) + 1 })} />
          </Section>
        );
      })}
    </>
  );
}
