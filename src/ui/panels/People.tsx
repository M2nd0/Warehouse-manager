import { balance } from '../../data/balance';
import { t } from '../../data/i18n';
import { headcount, inTraining } from '../../sim/people';
import type { Duty, GameView } from '../../sim/types';
import { Bar, Empty, Field, Pips, Section } from '../bits';
import type { UiActions } from '../controller';
import { formatMoney, formatPercent } from '../format';
import { activityText, shiftText } from '../text';

type Worker = GameView['workers'][number];
const DUTIES: Duty[] = ['all', 'inbound', 'picking'];

/** Anything out of the ordinary about a worker, in a line. */
function statusNote(state: GameView, worker: Worker): { text: string; tone: string } | null {
  if (worker.leaving) return { text: t('people.leaving'), tone: 'tone-warn' };
  if (worker.sickUntilDay !== null) return { text: t('people.sick', { day: worker.sickUntilDay + 1 }), tone: 'tone-bad' };
  if (worker.unwellUntilDay !== null) return { text: t('people.unwell'), tone: 'tone-warn' };
  if (worker.tempUntilDay !== null) return { text: t('people.tempUntil', { day: worker.tempUntilDay + 1 }), tone: 'tone-dim' };
  if (inTraining(worker, state.day)) return { text: t('people.training', { day: worker.trainingUntilDay + 1 }), tone: 'tone-warn' };
  return null;
}

/** What someone may be given: everything, only receiving, only picking. */
export function DutyPicker({ worker, actions }: { worker: Worker; actions: UiActions }) {
  return (
    <span class="segmented" role="group" aria-label={t('people.duty')}>
      {DUTIES.map((duty) => (
        <button
          key={duty}
          type="button"
          class={`segmented__item ${worker.duty === duty ? 'segmented__item--on' : ''}`}
          aria-pressed={worker.duty === duty}
          data-testid={`duty-${duty}`}
          onClick={() => actions.act({ type: 'set-duty', workerId: worker.id, duty })}
        >
          {t(`duty.${duty}`)}
        </button>
      ))}
    </span>
  );
}

/** Panel 2: everyone on the payroll, and today's applicants. */
export function PeoplePanel({ state, actions }: { state: GameView; actions: UiActions }) {
  const payroll = state.workers.reduce((sum, w) => sum + w.wagePerMonth, 0);
  const staff = headcount(state);
  const full = staff >= balance.people.maxStaff;
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
        {state.workers.map((worker) => {
          const note = statusNote(state, worker);
          return (
            <article key={worker.id} class="card" data-testid="worker-card">
              <header class="card__head">
                <button
                  type="button"
                  class="card__name"
                  disabled={worker.status === 'off'}
                  onClick={() => actions.select({ kind: 'worker', id: worker.id })}
                >
                  {worker.name}
                </button>
                <span class="card__role">{t(`role.${worker.role}`)}</span>
              </header>
              <p class={`card__doing ${worker.status === 'blocked' ? 'tone-bad' : ''}`}>{activityText(state, worker)}</p>
              {note && <p class={`card__note ${note.tone}`}>{note.text}</p>}
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
                    <Bar
                      value={worker.fatigue / 100}
                      tone={worker.fatigue > balance.people.fatigue.threshold ? 'bad' : 'plain'}
                      label={t('people.fatigue')}
                    />
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
              <Field label={t('people.duty')} value={<DutyPicker worker={worker} actions={actions} />} />
              {!worker.leaving && (
                <button
                  type="button"
                  class="btn btn--danger"
                  data-testid="dismiss"
                  onClick={() => actions.act({ type: 'dismiss', workerId: worker.id })}
                >
                  {t('people.dismiss')}
                </button>
              )}
            </article>
          );
        })}
      </Section>

      <Section
        title={t('people.candidates')}
        aside={t('people.staffLimit', { count: staff, max: balance.people.maxStaff })}
      >
        {state.candidates.length === 0 && <Empty text={t('people.noCandidates')} />}
        {state.candidates.map((candidate) => (
          <article key={candidate.id} class="card" data-testid="candidate">
            <header class="card__head">
              <span class="card__name card__name--plain">{candidate.name}</span>
              <span class="card__role">
                {t('people.asks')} {t('unit.perMonth', { amount: formatMoney(candidate.wagePerMonth, 0) })}
              </span>
            </header>
            <div class="grid2">
              <Field label={t('stat.speed')} value={<Pips value={candidate.stats.speed} label={t('stat.speed')} />} />
              <Field label={t('stat.accuracy')} value={<Pips value={candidate.stats.accuracy} label={t('stat.accuracy')} />} />
              <Field label={t('stat.care')} value={<Pips value={candidate.stats.care} label={t('stat.care')} />} />
              <Field label={t('stat.stamina')} value={<Pips value={candidate.stats.stamina} label={t('stat.stamina')} />} />
            </div>
            <button
              type="button"
              class="btn"
              disabled={full}
              title={full ? t('build.error.staff-limit') : undefined}
              data-testid="hire"
              onClick={() => actions.act({ type: 'hire', candidateId: candidate.id })}
            >
              {t('people.hire')}
            </button>
          </article>
        ))}
      </Section>
    </>
  );
}
