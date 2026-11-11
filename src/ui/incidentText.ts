import { balance } from '../data/balance';
import { t, tData } from '../data/i18n';
import type { GameView } from '../sim/types';
import { formatMoney } from './format';
import { clientName, durationText, skuName, whenText } from './text';

/** Wording of incidents: what happened, why, and what each choice means. */

type Incident = GameView['incidents'][number];
const I = balance.incidents;

/** Everything the incident texts may mention, ready to print. */
function paramsOf(state: GameView, incident: Incident): Record<string, string | number> {
  const p = incident.params;
  const money = (cents: number | undefined): string => formatMoney(cents ?? 0, 0);
  const subject = incident.subject;
  const pallet = subject?.kind === 'pallet' ? state.pallets.get(subject.id) : undefined;
  const worker = subject?.kind === 'worker' ? state.workers.find((w) => w.id === subject.id) : undefined;
  const truck = subject?.kind === 'truck' ? state.trucks.find((tr) => tr.id === subject.id) : undefined;
  return {
    ...p,
    client: subject?.kind === 'client' ? clientName(subject.id) : '',
    sku: pallet ? skuName(pallet.skuId) : '',
    name: worker?.name ?? '',
    untilDay: (p.untilDay ?? 0) + 1,
    waited: durationText(state.tick - (truck?.arrivedTick ?? incident.createdTick - I.congestionAfterMinutes)),
    penalty: money(p.penalty),
    replaceCost: money(Math.round((p.penalty ?? 0) * I.replacementFactor)),
    disputeCost: money(Math.round((p.penalty ?? 0) * I.disputeLossFactor)),
    countCost: money(p.countCost),
    compensation: money(p.compensation),
    repackCost: money(p.repackCost),
    hideCost: money(Math.round((p.compensation ?? 0) * I.hideCaughtFactor)),
    rebookFee: money(p.rebookFee),
    tempWage: t('unit.perMonth', { amount: money(I.tempWagePerMonth) }),
  };
}

export interface IncidentText {
  title: string;
  text: string;
  cause: string;
  /** When the do-nothing choice applies, if there is a deadline. */
  deadline: string | null;
  choices: { id: string; label: string }[];
}

export function describeIncident(state: GameView, incident: Incident): IncidentText {
  const params = paramsOf(state, incident);
  const choices = incident.choices.map((choice) => ({
    id: choice.id,
    label: tData(choice.labelKey, choice.id, params),
  }));
  return {
    title: tData(`incident.${incident.kind}.title`, incident.kind),
    text: tData(`incident.${incident.kind}.text`, '', params),
    cause: tData(incident.cause, ''),
    deadline:
      incident.deadlineTick === null
        ? null
        : t('incident.decideBy', {
            when: whenText(state, incident.deadlineTick),
            fallback: choices[0]?.label ?? '',
          }),
    choices,
  };
}

export const incidentTitle = (incident: Incident): string =>
  tData(`incident.${incident.kind}.title`, incident.kind);
