import { t } from '../../data/i18n';
import { contractEndDay, palletsOf, unbilledOf } from '../../sim/queries';
import type { GameView } from '../../sim/types';
import { Bar, Field, Section } from '../bits';
import { formatClock, formatMoney } from '../format';
import { clientName } from '../text';

/** Panel 3: reputation and, for every client, the contract and how it is being kept this month. */
export function ClientsPanel({ state }: { state: GameView }) {
  return (
    <>
      <Section title={t('clients.reputation')} aside={t('clients.reputationValue', { value: Math.round(state.reputation) })}>
        <Bar
          value={state.reputation / 100}
          tone={state.reputation >= 60 ? 'good' : state.reputation >= 35 ? 'warn' : 'bad'}
          label={t('clients.reputation')}
        />
      </Section>

      {state.clients.map((client) => {
        const { contract, month, profile } = client;
        const target = Object.values(profile.targetPallets).reduce((sum, n) => sum + n, 0);
        const breaches = month.late + month.wrong;
        return (
          <Section key={client.id} title={clientName(client.id)} aside={t(`client.kind.${client.kind}`)}>
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
