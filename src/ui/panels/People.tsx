import { t } from '../../data/i18n';
import type { EntityRef, GameView } from '../../sim/types';
import { Bar, Field, Pips, Section } from '../bits';
import { formatMoney, formatPercent } from '../format';
import { activityText, shiftText } from '../text';

/** Panel 2: everyone on the payroll — what they are like and what they are doing. */
export function PeoplePanel({ state, onSelect }: { state: GameView; onSelect(ref: EntityRef): void }) {
  const payroll = state.workers.reduce((sum, w) => sum + w.wagePerMonth, 0);
  return (
    <>
      <div class="stats">
        <div class="stat">
          <span class="stat__value">{state.workers.length}</span>
          <span class="stat__label">{t('people.headcount')}</span>
        </div>
        <div class="stat">
          <span class="stat__value">{t('unit.perMonth', { amount: formatMoney(payroll, 0) })}</span>
          <span class="stat__label">{t('people.payroll')}</span>
        </div>
      </div>

      <Section title={t('people.staff')} aside={t('people.shift', { shift: shiftText() })}>
        {state.workers.map((worker) => (
          <article key={worker.id} class="card">
            <header class="card__head">
              <button
                type="button"
                class="card__name"
                disabled={worker.status === 'off'}
                onClick={() => onSelect({ kind: 'worker', id: worker.id })}
              >
                {worker.name}
              </button>
              <span class="card__role">{t(`role.${worker.role}`)}</span>
            </header>
            <p class={`card__doing ${worker.status === 'blocked' ? 'tone-bad' : ''}`}>{activityText(state, worker)}</p>
            <div class="grid2">
              <Field label={t('stat.speed')} value={<Pips value={worker.stats.speed} label={t('stat.speed')} />} />
              <Field label={t('stat.accuracy')} value={<Pips value={worker.stats.accuracy} label={t('stat.accuracy')} />} />
              <Field label={t('stat.care')} value={<Pips value={worker.stats.care} label={t('stat.care')} />} />
              <Field label={t('stat.stamina')} value={<Pips value={worker.stats.stamina} label={t('stat.stamina')} />} />
            </div>
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
            <Field label={t('people.wage')} value={t('unit.perMonth', { amount: formatMoney(worker.wagePerMonth, 0) })} />
            <Field label={t('people.since')} value={t('hud.day', { day: worker.hiredDay + 1 })} />
          </article>
        ))}
      </Section>
    </>
  );
}
