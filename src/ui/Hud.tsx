import { balance } from '../data/balance';
import { t } from '../data/i18n';
import { formatClock, formatMoney, formatPercent } from './format';

export interface HudProps {
  /** 0-based day of the simulation. */
  day: number;
  tick: number;
  cash: number;
  /** On time and in full so far today (0–1), or null when nothing was due yet. */
  otif: number | null;
  incidents: number;
  speed: number;
  paused: boolean;
  onSpeed(speed: number): void;
  onPause(): void;
}

/** Top bar: date and time, simulation speed, today's OTIF, incidents, cash. */
export function Hud({ day, tick, cash, otif, incidents, speed, paused, onSpeed, onPause }: HudProps) {
  const otifTone = otif === null ? '' : otif >= 0.95 ? 'tone-good' : otif >= 0.85 ? 'tone-warn' : 'tone-bad';
  return (
    <header class="hud" data-testid="hud">
      <div class="hud__group">
        <span class="hud__title">{t('app.title')}</span>
        <span class="hud__value" data-testid="hud-day">
          {t('hud.day', { day: day + 1 })}
        </span>
        <span class="hud__value hud__clock" data-testid="hud-time">
          {formatClock(tick)}
        </span>
      </div>

      <div class="hud__group" role="group" aria-label={t('hud.speed')}>
        <button
          type="button"
          class={`speed ${paused ? 'speed--active' : ''}`}
          aria-pressed={paused}
          title={t('hud.pause')}
          data-testid="speed-pause"
          onClick={onPause}
        >
          <span class="speed__pause" aria-hidden="true" />
          <span class="visually-hidden">{t('hud.pause')}</span>
        </button>
        {balance.time.speeds.map((s) => (
          <button
            key={s}
            type="button"
            class={`speed ${!paused && speed === s ? 'speed--active' : ''}`}
            aria-pressed={!paused && speed === s}
            data-testid={`speed-${s}`}
            onClick={() => onSpeed(s)}
          >
            {t('hud.speedX', { speed: s })}
          </button>
        ))}
      </div>

      <div class="hud__group">
        <span class="hud__label">{t('hud.otif')}</span>
        <span class={`hud__value ${otifTone}`} data-testid="hud-otif">
          {otif === null ? t('report.none') : formatPercent(otif, 0)}
        </span>
        <span class="hud__label hud__gap">{t('hud.incidents')}</span>
        <span class={`hud__value ${incidents > 0 ? 'tone-bad' : ''}`} data-testid="hud-incidents">
          {incidents}
        </span>
        <span class="hud__label hud__gap">{t('hud.cash')}</span>
        <span class={`hud__value hud__cash ${cash < 0 ? 'tone-bad' : ''}`} data-testid="hud-cash">
          {formatMoney(cash, 0)}
        </span>
      </div>
    </header>
  );
}
