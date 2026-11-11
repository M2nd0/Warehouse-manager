import { t } from '../data/i18n';
import type { DayTimeline, TimelineTruck } from '../sim/queries';
import { TICKS_PER_DAY } from '../sim/time';
import type { UiActions } from './controller';
import { formatClock } from './format';
import { clientName } from './text';

/** Left edge of a minute of the day, in percent of the strip. */
const at = (minute: number): string => `${(Math.min(TICKS_PER_DAY, Math.max(0, minute)) / TICKS_PER_DAY) * 100}%`;
const span = (from: number, to: number): { left: string; width: string } => ({
  left: at(from),
  width: `${(Math.max(0, to - from) / TICKS_PER_DAY) * 100}%`,
});

const HOURS = [0, 3, 6, 9, 12, 15, 18, 21, 24];

/** Trucks whose bars would overlap go on separate rows. */
export function truckRows(trucks: readonly TimelineTruck[]): number[] {
  const ends: number[] = [];
  return trucks.map((truck) => {
    // A bar is drawn from the window start, or from the arrival if that came earlier.
    const from = Math.min(truck.from, truck.arrived ?? truck.from);
    const to = Math.max(truck.to, truck.left ?? 0);
    let row = ends.findIndex((end) => end <= from);
    if (row < 0) row = ends.length;
    ends[row] = to + 20;
    return row;
  });
}

function truckTitle(truck: TimelineTruck): string {
  const who = truck.kind === 'pickup' ? t('truck.carrier') : clientName(truck.clientId);
  const window = t('time.window', { from: formatClock(truck.from), to: formatClock(truck.to) });
  return `${who} · ${window} · ${t(`timeline.truck.${truck.status}`)}`;
}

export interface TimelineProps {
  line: DayTimeline;
  /** Orders that will miss the carrier at the current pace. */
  atRisk: number;
  actions: UiActions;
}

/**
 * The day at a glance (FUN-PLAN step 1): the shift, every truck's window,
 * the order cutoff, the carrier's departure and where the clock is now.
 */
export function Timeline({ line, atRisk, actions }: TimelineProps) {
  const rows = truckRows(line.trucks);
  const rowCount = Math.max(1, ...rows.map((r) => r + 1));
  return (
    <section class="timeline" aria-label={t('timeline.label')} data-testid="timeline">
      <div class="timeline__track" style={{ height: `${15 + rowCount * 12}px` }}>
        <div
          class="timeline__shift"
          style={span(line.shift.start, line.shift.end)}
          title={t('timeline.shift', { from: formatClock(line.shift.start), to: formatClock(line.shift.end) })}
          data-testid="timeline-shift"
        >
          <span class="timeline__shiftlabel">{t('timeline.shiftShort')}</span>
        </div>
        {line.overtime > 0 && (
          <div
            class="timeline__shift timeline__shift--overtime"
            style={span(line.shift.end, line.shift.end + line.overtime)}
            title={t('timeline.overtime')}
          />
        )}
        <div class="timeline__past" style={{ width: at(line.now) }} />

        {line.trucks.map((truck, i) => {
          const state = truck.waiting ? 'waiting' : truck.status;
          return (
            <button
              key={truck.id}
              type="button"
              class={`timeline__truck timeline__truck--${truck.kind} timeline__truck--${state}`}
              style={{ ...span(truck.from, truck.to), top: `${15 + rows[i] * 12}px` }}
              title={truckTitle(truck)}
              data-testid="timeline-truck"
              data-status={state}
              onClick={() => actions.focus({ kind: 'truck', id: truck.id }, null)}
            >
              <span class="timeline__trucklabel">
                {truck.kind === 'pickup' ? t('timeline.carrierShort') : clientName(truck.clientId)}
              </span>
            </button>
          );
        })}

        {line.cutoffs.map((minute) => (
          <div
            key={minute}
            class="timeline__mark timeline__mark--cutoff"
            style={{ left: at(minute) }}
            title={t('timeline.cutoff', { time: formatClock(minute) })}
          >
            <span class="timeline__marklabel">{t('timeline.cutoffShort')}</span>
          </div>
        ))}
        <div
          class={`timeline__mark timeline__mark--departure ${atRisk > 0 ? 'timeline__mark--risk' : ''}`}
          style={{ left: at(line.departure) }}
          title={t('timeline.departure', { time: formatClock(line.departure) })}
          data-testid="timeline-departure"
        >
          <span class="timeline__marklabel">
            {atRisk > 0 ? t('timeline.departureRisk', { count: atRisk }) : t('timeline.departureShort')}
          </span>
        </div>
        {line.marks.map((mark) => (
          <div
            key={mark.key}
            class={`timeline__mark timeline__mark--${mark.kind}`}
            style={{ left: at(mark.minute) }}
            title={t(`timeline.mark.${mark.kind}`, { time: formatClock(mark.minute) })}
          />
        ))}

        <div class="timeline__now" style={{ left: at(line.now) }} data-testid="timeline-now" />
      </div>
      <div class="timeline__hours" aria-hidden="true">
        {HOURS.map((hour) => (
          <span key={hour} class="timeline__hour" style={{ left: at(hour * 60) }}>
            {hour < 10 ? `0${hour}` : hour}
          </span>
        ))}
      </div>
    </section>
  );
}
