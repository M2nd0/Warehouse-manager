import { t } from '../data/i18n';
import { otifToday, unresolvedIncidents } from '../sim/queries';
import type { GameView } from '../sim/types';
import { ContextPanel } from './ContextPanel';
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
}

const PANELS: PanelId[] = ['operations', 'people', 'clients', 'finance'];

/** The whole overlay: top bar, the four panels, the context card, the tools. */
export function App({ state, ui, speed, paused, actions, onSpeed, onPause }: AppProps) {
  const empty = state.racks.length === 0 && state.tick === 0;
  return (
    <>
      <Hud
        day={state.day}
        tick={state.tick}
        cash={state.cash}
        otif={otifToday(state)}
        incidents={unresolvedIncidents(state)}
        speed={speed}
        paused={paused}
        onSpeed={onSpeed}
        onPause={onPause}
      />

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
            {ui.panel === 'clients' && <ClientsPanel state={state} />}
            {ui.panel === 'finance' && <FinancePanel state={state} />}
          </div>
        )}
      </aside>

      <div class="corner">
        {ui.selection && <ContextPanel state={state} selection={ui.selection} actions={actions} />}
        <footer class="hint">{empty ? t('hud.start') : t('hud.help')}</footer>
      </div>

      {ui.toast && (
        <div class={`toast toast--${ui.toast.tone}`} role="status" data-testid="toast">
          {ui.toast.text}
        </div>
      )}

      <Toolbar ui={ui} actions={actions} />
    </>
  );
}
