import { balance } from '../data/balance';
import { t } from '../data/i18n';
import { alerts, dayTimeline, otifToday, paceForecast, unresolvedIncidents } from '../sim/queries';
import type { GameView } from '../sim/types';
import { Alerts } from './Alerts';
import { ContextPanel } from './ContextPanel';
import { Timeline } from './Timeline';
import { GameMenu, OnboardingCard, ReportCard } from './Overlays';
import { Hud } from './Hud';
import { Toolbar } from './Toolbar';
import type { UiActions } from './controller';
import { ClientsPanel } from './panels/Clients';
import { FinancePanel } from './panels/Finance';
import { OperationsPanel } from './panels/Operations';
import { PeoplePanel } from './panels/People';
import type { PanelId, UiState } from './store';

export interface AppProps {
  state: GameView;
  ui: UiState;
  speed: number;
  paused: boolean;
  actions: UiActions;
  onSpeed(speed: number): void;
  onPause(): void;
  onReportClose(): void;
  onNew(): void;
  onExport(): void;
  onImport(file: File): void;
}

/** Orders that will miss today's carrier at the current pace (0 once it has left). */
function todayAtRisk(state: GameView): number {
  const pace = paceForecast(state);
  return pace.departureTick < (state.day + 1) * balance.time.ticksPerDay ? pace.atRisk : 0;
}

const PANELS: PanelId[] = ['operations', 'people', 'clients', 'finance'];

/** The whole overlay: top bar, the four panels, the context card, the tools. */
export function App({ state, ui, speed, paused, actions, onSpeed, onPause, onReportClose, onNew, onExport, onImport }: AppProps) {
  const empty = state.racks.length === 0 && state.tick === 0;
  return (
    <>
      <Hud
        day={state.day}
        tick={state.tick}
        cash={state.cash}
        otif={otifToday(state)}
        incidents={unresolvedIncidents(state)}
        flash={ui.cashFlash}
        speed={speed}
        paused={paused}
        onSpeed={onSpeed}
        onPause={onPause}
      />

      <Timeline line={dayTimeline(state)} atRisk={todayAtRisk(state)} actions={actions} />

      <aside class={`side ${ui.panel ? 'side--open' : ''}`}>
        <nav class="tabs" aria-label={t('panel.tabs')}>
          {PANELS.map((id, i) => (
            <button
              key={id}
              type="button"
              class={`tab ${ui.panel === id ? 'tab--active' : ''}`}
              aria-pressed={ui.panel === id}
              data-testid={`tab-${id}`}
              onClick={() => actions.togglePanel(id)}
            >
              <kbd class="tab__key">{i + 1}</kbd>
              {t(`panel.${id}`)}
            </button>
          ))}
        </nav>
        {ui.panel && (
          <div class="panel" data-testid={`panel-${ui.panel}`}>
            {ui.panel === 'operations' && <OperationsPanel state={state} actions={actions} />}
            {ui.panel === 'people' && <PeoplePanel state={state} actions={actions} />}
            {ui.panel === 'clients' && <ClientsPanel state={state} actions={actions} />}
            {ui.panel === 'finance' && <FinancePanel state={state} />}
          </div>
        )}
      </aside>

      <div class="leftcol">
        <OnboardingCard state={state} />
        <Alerts state={state} alerts={alerts(state)} notices={ui.notices} actions={actions} />
      </div>

      <div class="corner">
        {ui.selection && <ContextPanel state={state} selection={ui.selection} actions={actions} />}
        <footer class="hint">{empty ? t('hud.start') : t('hud.help')}</footer>
        <GameMenu ui={ui} actions={actions} onNew={onNew} onExport={onExport} onImport={onImport} />
      </div>

      {ui.report && !state.gameOver && <ReportCard report={ui.report} onClose={onReportClose} />}

      {state.gameOver && (
        <div class="modal" role="alertdialog" aria-label={t('gameover.title')} data-testid="game-over">
          <div class="modal__card">
            <h2 class="modal__title tone-bad">{t('gameover.title')}</h2>
            <p>{t('gameover.text', { max: balance.finance.overdraftDays, days: state.gameOver.day + 1 })}</p>
            <button type="button" class="btn btn--primary" data-testid="game-over-new" onClick={onNew}>
              {t('menu.new')}
            </button>
          </div>
        </div>
      )}

      {ui.toast && (
        <div class={`toast toast--${ui.toast.tone}`} role="status" data-testid="toast">
          {ui.toast.text}
        </div>
      )}

      <Toolbar ui={ui} actions={actions} />
    </>
  );
}
